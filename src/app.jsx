// src/App.jsx — Start page with working MAIN/ALT start buttons (no extra toggles),
// password-protected clear buttons per mode, separate queues, duplicate detection, etc.
import React, { useEffect, useState, useRef, useMemo } from 'react';
import { socket } from './socket';
import Scanner from './scanner/Scanner.jsx';
import StartPage from './StartPage.jsx';
import './app.css';
import * as XLSX from 'xlsx';

const API_BASE = import.meta.env.VITE_API_BASE || '';
const api = (p) => {
  const path = p.startsWith('/') ? p : `/${p}`;
  return API_BASE ? `${API_BASE}${path}` : `/api${path}`;
};

const modeIsAlt = (m) => m === 'alt';
const endpoints = {
  staged: (m) => modeIsAlt(m) ? '/staged-alt' : '/staged',
  stagedCount: (m) => modeIsAlt(m) ? '/staged-alt/count' : '/staged/count',
  stagedDelete: (m, id) => (modeIsAlt(m) ? `/staged-alt/${id}` : `/staged/${id}`),
  scan: (m) => modeIsAlt(m) ? '/scan-alt' : '/scan',
  exists: (m, serial) => modeIsAlt(m) ? `/exists-alt/${encodeURIComponent(serial)}` : `/exists/${encodeURIComponent(serial)}`,
  clearAll: (m) => modeIsAlt(m) ? '/staged-alt/clear' : '/staged/clear',
  exportXlsm: (m) => modeIsAlt(m) ? '/export-alt-to-excel' : '/export-to-excel',
  exportXlsxImages: (m) => modeIsAlt(m) ? '/export-alt-xlsx-images' : '/export-xlsx-images',
};

const FIXED_DAMAGED = {
  grade: 'SAR48',
  railType: 'R260',
  spec: 'ATA 2DX066-25',
  lengthM: '36 m',
};

function parseQrPayload(raw) {
  const clean = String(raw || '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const tokens = clean.split(/[ \t\r\n|,:/]+/).filter(Boolean);

  const serial =
    tokens.find((t) => /^[A-Z0-9]{12,}$/.test(t)) ||
    tokens.find((t) => /^[A-Z0-9]{8,}$/.test(t)) ||
    '';

  let grade = (tokens.find((t) => /^SAR\d{2}$/i.test(t)) || '').toUpperCase();

  let railType = '';
  for (const t of tokens) {
    const u = t.toUpperCase();
    if (/^R\d{3}(?:L?HT)?$/.test(u)) { railType = u; break; }
  }

  let spec = '';
  for (let i = 0; i < tokens.length; i++) {
    const u = tokens[i].toUpperCase();
    if (/^(ATX|ATA|AREMA|UIC|EN\d*|GB\d*)$/.test(u)) {
      const next = tokens[i + 1] || '';
      if (/^[A-Z0-9-]{3,}$/i.test(next)) spec = `${tokens[i]} ${next}`;
      else spec = tokens[i];
      break;
    }
  }

  const lengthM = tokens.find((t) => /^\d{1,3}(\.\d+)?m$/i.test(t)) || '';

  if (grade && railType && grade === railType) grade = '';

  return { raw: clean, serial, grade, railType, spec, lengthM };
}

// IndexedDB queues (separate per mode)
const DB_NAME = 'rail-offline';
const DB_VERSION = 2;
const STORE_MAIN = 'queue_main';
const STORE_ALT = 'queue_alt';
const storeForMode = (m) => modeIsAlt(m) ? STORE_ALT : STORE_MAIN;

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_MAIN)) {
        db.createObjectStore(STORE_MAIN, { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(STORE_ALT)) {
        db.createObjectStore(STORE_ALT, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbAdd(item, mode) {
  const db = await idbOpen();
  const storeName = storeForMode(mode);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).add(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function idbAll(mode) {
  const db = await idbOpen();
  const storeName = storeForMode(mode);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
async function idbClear(ids, mode) {
  const db = await idbOpen();
  const storeName = storeForMode(mode);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    (ids || []).forEach(id => store.delete(id));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export default function App() {
  // Which dataset are we scanning right now?
  const [mode, setMode] = useState('main'); // 'main' | 'alt'
  const [showStart, setShowStart] = useState(true);

  const [status, setStatus] = useState('Ready');

  // Separate lists & pagination for MAIN/ALT
  const [scansMain, setScansMain] = useState([]);
  const [scansAlt, setScansAlt] = useState([]);

  const [totalMain, setTotalMain] = useState(0);
  const [totalAlt, setTotalAlt] = useState(0);

  const [cursorMain, setCursorMain] = useState(null);
  const [cursorAlt, setCursorAlt] = useState(null);

  // Active list helpers
  const scans = modeIsAlt(mode) ? scansAlt : scansMain;
  const setScans = modeIsAlt(mode) ? setScansAlt : setScansMain;
  const totalCount = modeIsAlt(mode) ? totalAlt : totalMain;
  const setTotalCount = modeIsAlt(mode) ? setTotalAlt : setTotalMain;
  const nextCursor = modeIsAlt(mode) ? cursorAlt : cursorMain;
  const setNextCursor = modeIsAlt(mode) ? setCursorAlt : setCursorMain;

  // Controls
  const [operator, setOperator] = useState('Clerk A');
  const [wagonId1, setWagonId1] = useState('');
  const [wagonId2, setWagonId2] = useState('');
  const [wagonId3, setWagonId3] = useState('');
  const [receivedAt, setReceivedAt] = useState('');
  const [loadedAt] = useState('WalvisBay');
  const [destination, setDestination] = useState('');

  // Pending capture
  const [pending, setPending] = useState(null);
  const [qrExtras, setQrExtras] = useState({ grade: '', railType: '', spec: '', lengthM: '' });

  // Modals
  const [dupPrompt, setDupPrompt] = useState(null);
  const [removePrompt, setRemovePrompt] = useState(null);

  // Sound
  const audioCtxRef = useRef(null);
  const [soundOn, setSoundOn] = useState(false);
  const enableSound = async () => {
    try {
      if (!audioCtxRef.current) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return alert('AudioContext not supported on this device/browser.');
        audioCtxRef.current = new Ctx();
      }
      if (audioCtxRef.current.state === 'suspended') {
        await audioCtxRef.current.resume();
      }
      playBeep(1200, 60);
      setSoundOn(true);
      localStorage.setItem('rail-sound-enabled', '1');
    } catch {}
  };
  const playBeep = (freq = 1500, durationMs = 80) => {
    try {
      const ctx = audioCtxRef.current;
      if (!ctx || !soundOn) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      gain.gain.value = 0.06;
      osc.connect(gain).connect(ctx.destination);
      const now = ctx.currentTime;
      osc.start(now);
      osc.stop(now + durationMs / 1000);
    } catch {}
  };
  const okBeep = () => playBeep(1500, 80);
  const warnBeep = () => playBeep(900, 90);
  const savedBeep = () => playBeep(2000, 140);
  useEffect(() => {
    if (localStorage.getItem('rail-sound-enabled') === '1') enableSound();
  }, []);

  // Damaged QR
  const [showDamaged, setShowDamaged] = useState(false);
  const [manualSerial, setManualSerial] = useState('');

  // Duplicate helpers
  const normalizeSerial = (s) => String(s || '').trim().toUpperCase();
  const serialSetRefMain = useRef(new Set());
  const serialSetRefAlt = useRef(new Set());
  const knownMainRef = useRef(new Set());
  const knownAltRef = useRef(new Set());
  const [knownMainCount, setKnownMainCount] = useState(0);
  const [knownAltCount, setKnownAltCount] = useState(0);
  const knownCount = modeIsAlt(mode) ? knownAltCount : knownMainCount;
  const knownBadge = knownCount ? ` • Known: ${knownCount}` : '';

  const getSerialSetRef = () => (modeIsAlt(mode) ? serialSetRefAlt : serialSetRefMain);
  const getKnownRef = () => (modeIsAlt(mode) ? knownAltRef : knownMainRef);
  const isKnownDuplicate = (ser) => {
    const key = normalizeSerial(ser);
    if (!key) return false;
    const localSet = getSerialSetRef().current;
    const knownSet = getKnownRef().current;
    return localSet.has(key) || knownSet.has(key);
  };

  // Import known serials (per mode)
  const importInputRef = useRef(null);
  const handleImportKnown = async (file) => {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      const set = getKnownRef().current;

      const headerCandidates = ['serial', 'Serial', 'SERIAL', 'Serial Number', 'SERIAL_NUMBER', 'SN', 'sn'];
      const firstRow = rows[0] || {};
      let header = Object.keys(firstRow).find((h) => headerCandidates.includes(h)) || null;

      if (header) {
        for (const r of rows) {
          const v = normalizeSerial(r[header]);
          if (v) set.add(v);
        }
      } else {
        const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        for (const row of aoa) {
          const v = normalizeSerial(row?.[0]);
          if (v) set.add(v);
        }
      }

      setKnownMainCount(knownMainRef.current.size);
      setKnownAltCount(knownAltRef.current.size);
      setStatus(`Imported known serials (${mode.toUpperCase()}): ${set.size}`);
      savedBeep();
    } catch (e) {
      console.error(e);
      setStatus('Import failed. Ensure there is a "serial" column or serials in column A.');
      warnBeep();
    } finally {
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  // Sockets
  const socketRef = useRef(null);
  useEffect(() => {
    socketRef.current = socket;
    try { socket.connect(); } catch {}

    const onConnect = () => setStatus('Live sync connected');
    const onDisconnect = (reason) => setStatus(`Live sync disconnected (${reason})`);
    const onConnectError = (err) => setStatus(`Socket error: ${err?.message || err}`);

    const onNew = (row) => {
      setScansMain((prev) => {
        const hasId = row.id != null && prev.some((x) => String(x.id) === String(row.id));
        const hasSerial = row.serial && prev.some((x) => normalizeSerial(x.serial) === normalizeSerial(row.serial));
        if (hasId || hasSerial) return prev;
        return [row, ...prev];
      });
      setTotalMain((c) => c + 1);
    };

    const onNewAlt = (row) => {
      setScansAlt((prev) => {
        const hasId = row.id != null && prev.some((x) => String(x.id) === String(row.id));
        const hasSerial = row.serial && prev.some((x) => normalizeSerial(x.serial) === normalizeSerial(row.serial));
        if (hasId || hasSerial) return prev;
        return [row, ...prev];
      });
      setTotalAlt((c) => c + 1);
    };

    const onDeleted = ({ id }) => {
      setScansMain((prev) => {
        const before = prev.length;
        const next = prev.filter((x) => String(x.id) !== String(id));
        if (next.length !== before) {
          setTotalMain((c) => Math.max(0, c - 1));
          setStatus('Scan removed (Main, synced)');
        }
        return next;
      });
    };

    const onDeletedAlt = ({ id }) => {
      setScansAlt((prev) => {
        const before = prev.length;
        const next = prev.filter((x) => String(x.id) !== String(id));
        if (next.length !== before) {
          setTotalAlt((c) => Math.max(0, c - 1));
          setStatus('Scan removed (ALT, synced)');
        }
        return next;
      });
    };

    const onCleared = () => {
      setScansMain([]);
      setTotalMain(0);
      setCursorMain(null);
      setStatus('All scans cleared (Main, synced)');
    };

    const onClearedAlt = () => {
      setScansAlt([]);
      setTotalAlt(0);
      setCursorAlt(null);
      setStatus('All scans cleared (ALT, synced)');
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.io?.on?.('error', onConnectError);

    socket.on('new-scan', onNew);
    socket.on('new-scan-alt', onNewAlt);
    socket.on('deleted-scan', onDeleted);
    socket.on('deleted-scan-alt', onDeletedAlt);
    socket.on('cleared-scans', onCleared);
    socket.on('cleared-scans-alt', onClearedAlt);

    return () => {
      try {
        socket.off('connect', onConnect);
        socket.off('disconnect', onDisconnect);
        socket.io?.off?.('error', onConnectError);

        socket.off('new-scan', onNew);
        socket.off('new-scan-alt', onNewAlt);
        socket.off('deleted-scan', onDeleted);
        socket.off('deleted-scan-alt', onDeletedAlt);
        socket.off('cleared-scans', onCleared);
        socket.off('cleared-scans-alt', onClearedAlt);
      } catch {}
      socketRef.current = null;
    };
  }, []);

  // Build fast serial sets
  useEffect(() => {
    const s = new Set();
    for (const r of scansMain) if (r?.serial) s.add(normalizeSerial(r.serial));
    serialSetRefMain.current = s;
  }, [scansMain]);
  useEffect(() => {
    const s = new Set();
    for (const r of scansAlt) if (r?.serial) s.add(normalizeSerial(r.serial));
    serialSetRefAlt.current = s;
  }, [scansAlt]);

  // Initial loads
  const mainLoadedRef = useRef(false);
  const altLoadedRef = useRef(false);
  useEffect(() => {
    const load = async (m) => {
      try {
        const [countResp, pageResp] = await Promise.all([
          fetch(api(endpoints.stagedCount(m))),
          fetch(api(`${endpoints.staged(m)}?limit=200`)),
        ]);
        const countData = await countResp.json().catch(()=>({count:0}));
        const pageData = await pageResp.json().catch(()=>({rows:[], nextCursor:null, total:0}));

        const normalized = (pageData.rows || []).map((r) => ({
          ...r,
          wagonId1: r.wagon1Id ?? r.wagonId1 ?? '',
          wagonId2: r.wagon2Id ?? r.wagonId2 ?? '',
          wagonId3: r.wagon3Id ?? r.wagonId3 ?? '',
          receivedAt: r.receivedAt ?? r.recievedAt ?? '',
          loadedAt: r.loadedAt ?? '',
          destination: r.destination ?? r.dest ?? '',
        }));

        if (modeIsAlt(m)) {
          setScansAlt(normalized);
          setTotalAlt(countData.count ?? pageData.total ?? 0);
          setCursorAlt(pageData.nextCursor ?? null);
        } else {
          setScansMain(normalized);
          setTotalMain(countData.count ?? pageData.total ?? 0);
          setCursorMain(pageData.nextCursor ?? null);
        }
      } catch (e) {
        console.error(e);
      }
    };

    if (!mainLoadedRef.current) {
      mainLoadedRef.current = true;
      load('main');
    }
    if (!altLoadedRef.current) {
      altLoadedRef.current = true;
      load('alt');
    }
  }, []);

  const PAGE_SIZE = 200;
  const loadMore = async () => {
    const m = mode;
    const cursor = modeIsAlt(m) ? cursorAlt : cursorMain;
    if (!cursor) return;

    const resp = await fetch(api(`${endpoints.staged(m)}?limit=${PAGE_SIZE}&cursor=${cursor}`));
    const data = await resp.json().catch(()=>({rows:[], nextCursor:null}));

    const more = (data.rows || []).map((r) => ({
      ...r,
      wagonId1: r.wagon1Id ?? r.wagonId1 ?? '',
      wagonId2: r.wagon2Id ?? r.wagonId2 ?? '',
      wagonId3: r.wagon3Id ?? r.wagonId3 ?? '',
      receivedAt: r.receivedAt ?? r.recievedAt ?? '',
      loadedAt: r.loadedAt ?? '',
      destination: r.destination ?? r.dest ?? '',
    }));

    if (modeIsAlt(m)) {
      setScansAlt((prev) => [...prev, ...more]);
      setCursorAlt(data.nextCursor ?? null);
    } else {
      setScansMain((prev) => [...prev, ...more]);
      setCursorMain(data.nextCursor ?? null);
    }
  };

  // Flush offline queues when online (both modes)
  useEffect(() => {
    async function flushQueueForMode(m) {
      try {
        const items = await idbAll(m);
        if (items.length === 0) return;
        const payload = items.map(x => x.payload);

        const bulkPath = modeIsAlt(m) ? '/scans-alt/bulk' : '/scans/bulk';
        const resp = await fetch(api(bulkPath), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: payload })
        });
        if (resp.ok) {
          await idbClear(items.map(x => x.id), m);

          const [countResp, pageResp] = await Promise.all([
            fetch(api(endpoints.stagedCount(m))),
            fetch(api(`${endpoints.staged(m)}?limit=${PAGE_SIZE}`)),
          ]);
          const countData = await countResp.json().catch(()=>({count:0}));
          const pageData = await pageResp.json().catch(()=>({rows:[], nextCursor:null, total:0}));
          const normalized = (pageData.rows || []).map((r) => ({
            ...r,
            wagonId1: r.wagon1Id ?? r.wagonId1 ?? '',
            wagonId2: r.wagon2Id ?? r.wagonId2 ?? '',
            wagonId3: r.wagon3Id ?? r.wagonId3 ?? '',
            receivedAt: r.receivedAt ?? r.recievedAt ?? '',
            loadedAt: r.loadedAt ?? '',
            destination: r.destination ?? r.dest ?? '',
          }));

          if (modeIsAlt(m)) {
            setScansAlt(normalized);
            setCursorAlt(pageData.nextCursor ?? null);
            setTotalAlt(pageData.total ?? normalized.length);
          } else {
            setScansMain(normalized);
            setCursorMain(pageData.nextCursor ?? null);
            setTotalMain(pageData.total ?? normalized.length);
          }
        }
      } catch (e) {
        console.warn(`Offline queue flush failed (${m}):`, e.message);
      }
    }

    async function flushBoth() {
      await flushQueueForMode('main');
      await flushQueueForMode('alt');
    }
    window.addEventListener('online', flushBoth);
    flushBoth();
    return () => window.removeEventListener('online', flushBoth);
  }, []);

  // FAST local duplicate set for current mode
  const scanSerialSet = useMemo(() => {
    const s = new Set();
    for (const r of scans) if (r?.serial) s.add(normalizeSerial(r.serial));
    return s;
  }, [scans]);

  const lastHitRef = useRef({ serial: '', at: 0 });
  const localHasSerial = (serial) => scanSerialSet.has(normalizeSerial(serial));
  const findDuplicates = (serial) => scans.filter((r) => normalizeSerial(r.serial) === normalizeSerial(serial));

  // highlight existing row
  const [flashSerial, setFlashSerial] = useState(null);
  const flashExistingRow = (serialKey) => {
    if (!serialKey) return;
    setFlashSerial(serialKey);
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-serial="${serialKey}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    setTimeout(() => setFlashSerial(null), 2500);
  };

  // SCAN handler
  const onDetected = async (rawText) => {
    const parsed = parseQrPayload(rawText);
    const serial = (parsed.serial || rawText || '').trim();
    const serialKey = normalizeSerial(serial);

    if (!serialKey) {
      warnBeep();
      setStatus('Scan had no detectable serial');
      return;
    }

    const now = Date.now();
    if (lastHitRef.current.serial === serialKey && now - lastHitRef.current.at < 1200) return;
    lastHitRef.current = { serial: serialKey, at: now };

    if (isKnownDuplicate(serialKey)) {
      warnBeep();
      setDupPrompt({
        serial: serialKey,
        matches: findDuplicates(serialKey),
        candidate: {
          pending: { serial: serialKey, raw: parsed.raw || String(rawText), capturedAt: new Date().toISOString() },
          qrExtras: {
            grade: parsed.grade || '',
            railType: parsed.railType || '',
            spec: parsed.spec || '',
            lengthM: parsed.lengthM || '',
          },
        },
      });
      if (localHasSerial(serialKey)) flashExistingRow(serialKey);
      setStatus('Duplicate detected — awaiting decision');
      return;
    }

    try {
      const resp = await fetch(api(endpoints.exists(mode, serialKey)));
      if (resp.ok) {
        const info = await resp.json();
        if (info?.exists) {
          warnBeep();
          setDupPrompt({
            serial: serialKey,
            matches: [info.row || { serial: serialKey }],
            candidate: {
              pending: { serial: serialKey, raw: parsed.raw || String(rawText), capturedAt: new Date().toISOString() },
              qrExtras: {
                grade: parsed.grade || '',
                railType: parsed.railType || '',
                spec: parsed.spec || '',
                lengthM: parsed.lengthM || '',
              },
            },
          });
          if (localHasSerial(serialKey)) flashExistingRow(serialKey);
          setStatus('Duplicate detected — awaiting decision');
          return;
        }
      }
    } catch {}

    okBeep();
    setPending({ serial: serialKey, raw: parsed.raw || String(rawText), capturedAt: new Date().toISOString() });
    setQrExtras({
      grade: parsed.grade || '',
      railType: parsed.railType || '',
      spec: parsed.spec || '',
      lengthM: parsed.lengthM || '',
    });
    setStatus('Captured — review & Confirm');
  };

  const handleDupDiscard = () => {
    setDupPrompt(null);
    setPending(null);
    setQrExtras({ grade: '', railType: '', spec: '', lengthM: '' });
    setStatus('Ready');
  };
  const handleDupContinue = () => {
    if (!dupPrompt) return;
    okBeep();
    setPending(dupPrompt.candidate.pending);
    setQrExtras(dupPrompt.candidate.qrExtras);
    setDupPrompt(null);
    setStatus('Captured — review & Confirm');
  };

  const handleRemoveScan = (scanId) => setRemovePrompt(scanId);
  const confirmRemoveScan = async () => {
    if (!removePrompt) return;
    try {
      const resp = await fetch(api(endpoints.stagedDelete(mode, removePrompt)), { method: 'DELETE' });
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw new Error(errText || 'Failed to remove scan');
      }
      setScans((prev) => prev.filter((scan) => scan.id !== removePrompt));
      setTotalCount((c) => Math.max(0, c - 1));
      setRemovePrompt(null);
      setStatus('Scan removed successfully');
    } catch (e) {
      console.error(e);
      alert(e.message || 'Failed to remove scan');
      setRemovePrompt(null);
    }
  };
  const discardRemovePrompt = () => setRemovePrompt(null);

  const pushKnownForMode = (serial) => {
    const set = getKnownRef().current;
    set.add(normalizeSerial(serial));
    setKnownMainCount(knownMainRef.current.size);
    setKnownAltCount(knownAltRef.current.size);
  };

  const confirmPending = async () => {
    if (!pending?.serial || !String(pending.serial).trim()) {
      alert('Nothing to save yet. Scan a code first. If QR is damaged, use the Damaged QR dropdown.');
      return;
    }

    if (isKnownDuplicate(pending.serial)) {
      warnBeep();
      setDupPrompt({
        serial: String(pending.serial).toUpperCase(),
        matches: findDuplicates(pending.serial),
        candidate: { pending, qrExtras },
      });
      if (localHasSerial(String(pending.serial))) flashExistingRow(String(pending.serial).toUpperCase());
      setStatus('Duplicate detected — awaiting decision');
      return;
    }

    try {
      const r = await fetch(api(endpoints.exists(mode, pending.serial)));
      if (r.ok) {
        const j = await r.json();
        if (j?.exists) {
          warnBeep();
          setDupPrompt({
            serial: pending.serial,
            matches: [j.row || { serial: pending.serial }],
            candidate: { pending, qrExtras },
          });
          if (localHasSerial(String(pending.serial))) flashExistingRow(String(pending.serial).toUpperCase());
          setStatus('Duplicate detected — awaiting decision');
          return;
        }
      }
    } catch {}

    const rec = {
      serial: String(pending.serial).trim(),
      stage: 'received',
      operator,
      wagon1Id: wagonId1,
      wagon2Id: wagonId2,
      wagon3Id: wagonId3,
      receivedAt,
      loadedAt,
      destination,
      timestamp: new Date().toISOString(),
      grade: qrExtras.grade,
      railType: qrExtras.railType,
      spec: qrExtras.spec,
      lengthM: qrExtras.lengthM,
      qrRaw: pending.raw || String(pending.serial),
    };

    try {
      const resp = await fetch(api(endpoints.scan(mode)), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rec),
      });
      let data = null;
      try { data = await resp.json(); } catch {}
      if (!resp.ok) throw new Error(data?.error || `HTTP ${resp.status}`);

      const newId = data?.id || Date.now();
      setScans((prev) => [{ id: newId, ...rec }, ...prev]);
      setTotalCount((c) => c + 1);

      pushKnownForMode(rec.serial);

      setPending(null);
      setQrExtras({ grade: '', railType: '', spec: '', lengthM: '' });
      setStatus(`Saved to staged (${mode.toUpperCase()})`);
      savedBeep();
    } catch (e) {
      await idbAdd({ payload: rec }, mode);
      setScans((prev) => [{ id: Date.now(), ...rec }, ...prev]);
      setTotalCount((c) => c + 1);

      pushKnownForMode(rec.serial);

      setPending(null);
      setQrExtras({ grade: '', railType: '', spec: '', lengthM: '' });
      setStatus(`Saved locally (offline) — will sync (${mode.toUpperCase()})`);
      savedBeep();
    }
  };

  const saveDamaged = async () => {
    if (!manualSerial.trim()) {
      alert('Unable to save: enter Serial (or scan a QR).');
      return;
    }
    const serialKey = normalizeSerial(manualSerial);

    if (isKnownDuplicate(serialKey)) {
      warnBeep();
      setDupPrompt({
        serial: serialKey,
        matches: findDuplicates(serialKey),
        candidate: {
          pending: { serial: serialKey, raw: serialKey, capturedAt: new Date().toISOString() },
          qrExtras: {
            grade: FIXED_DAMAGED.grade,
            railType: FIXED_DAMAGED.railType,
            spec: FIXED_DAMAGED.spec,
            lengthM: FIXED_DAMAGED.lengthM,
          },
        },
      });
      if (localHasSerial(serialKey)) flashExistingRow(serialKey);
      setStatus('Duplicate detected — awaiting decision');
      return;
    }

    try {
      const r = await fetch(api(endpoints.exists(mode, serialKey)));
      if (r.ok) {
        const j = await r.json();
        if (j?.exists && !confirm('Duplicate exists on server. Save anyway?')) return;
      }
    } catch {}

    const rec = {
      serial: serialKey,
      stage: 'received',
      operator,
      wagon1Id: wagonId1,
      wagon2Id: wagonId2,
      wagon3Id: wagonId3,
      receivedAt,
      loadedAt,
      destination,
      timestamp: new Date().toISOString(),
      grade: FIXED_DAMAGED.grade,
      railType: FIXED_DAMAGED.railType,
      spec: FIXED_DAMAGED.spec,
      lengthM: FIXED_DAMAGED.lengthM,
      qrRaw: serialKey,
    };

    try {
      const resp = await fetch(api(endpoints.scan(mode)), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rec),
      });
      const data = await resp.json().catch(()=>null);
      if (!resp.ok) throw new Error(data?.error || `HTTP ${resp.status}`);

      const newId = data?.id || Date.now();
      setScans((prev) => [{ id: newId, ...rec }, ...prev ]);
      setTotalCount((c) => c + 1);

      const set = getKnownRef().current;
      set.add(serialKey);
      setKnownMainCount(knownMainRef.current.size);
      setKnownAltCount(knownAltRef.current.size);

      setManualSerial('');
      setShowDamaged(false);
      setStatus(`Damaged QR saved (${mode.toUpperCase()})`);
      savedBeep();
    } catch (e) {
      await idbAdd({ payload: rec }, mode);
      setScans((prev) => [{ id: Date.now(), ...rec }, ...prev ]);
      setTotalCount((c) => c + 1);

      const set = getKnownRef().current;
      set.add(serialKey);
      setKnownMainCount(knownMainRef.current.size);
      setKnownAltCount(knownAltRef.current.size);

      setManualSerial('');
      setShowDamaged(false);
      setStatus(`Damaged QR saved locally (offline) — will sync (${mode.toUpperCase()})`);
      savedBeep();
    }
  };

  // ---------- UPDATED EXPORTS (client-side, do NOT call server export endpoints) ----------
  const [exporting, setExporting] = useState(false);

  // Helper to fetch staged rows from server (non-destructive)
  async function fetchAllStagedRows(m) {
    // try to request many rows; server should return full dataset or paginated. We request a large limit.
    const rows = [];
    try {
      let cursor = null;
      const limit = 1000; // page size
      while (true) {
        const url = api(`${endpoints.staged(m)}?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`Failed to fetch staged rows (${resp.status})`);
        const data = await resp.json().catch(()=>({ rows: [], nextCursor: null }));
        const pageRows = data.rows || [];
        for (const r of pageRows) {
          rows.push({
            ...r,
            wagonId1: r.wagon1Id ?? r.wagonId1 ?? '',
            wagonId2: r.wagon2Id ?? r.wagonId2 ?? '',
            wagonId3: r.wagon3Id ?? r.wagonId3 ?? '',
            receivedAt: r.receivedAt ?? r.recievedAt ?? '',
            loadedAt: r.loadedAt ?? '',
            destination: r.destination ?? r.dest ?? '',
          });
        }
        if (!data.nextCursor) break;
        cursor = data.nextCursor;
      }
    } catch (e) {
      console.error('fetchAllStagedRows error:', e);
      throw e;
    }
    return rows;
  }

  // Build a worksheet from staged rows and download as XLSX (client-side). This will NOT clear server-side staged scans.
  const exportClientXlsx = async (m, filenameHint) => {
    if (exporting) return;
    setExporting(true);
    try {
      setStatus('Preparing export (client-side)...');
      const rows = await fetchAllStagedRows(m);
      if (!rows || rows.length === 0) {
        alert('No staged rows available for export.');
        setStatus('No rows to export');
        return;
      }

      // Normalize rows for Excel: pick fields and ensure consistent column order
      const sheetRows = rows.map((r) => ({
        id: r.id ?? '',
        serial: r.serial ?? '',
        stage: r.stage ?? '',
        operator: r.operator ?? '',
        wagon1Id: r.wagon1Id ?? '',
        wagon2Id: r.wagonId2 ?? r.wagonId2 ?? '',
        wagon3Id: r.wagonId3 ?? '',
        receivedAt: r.receivedAt ?? '',
        loadedAt: r.loadedAt ?? '',
        destination: r.destination ?? '',
        grade: r.grade ?? '',
        railType: r.railType ?? '',
        spec: r.spec ?? '',
        lengthM: r.lengthM ?? '',
        qrRaw: r.qrRaw ?? '',
        timestamp: r.timestamp ?? '',
      }));

      const ws = XLSX.utils.json_to_sheet(sheetRows, { header: [
        'id','serial','stage','operator','wagon1Id','wagon2Id','wagon3Id','receivedAt','loadedAt','destination',
        'grade','railType','spec','lengthM','qrRaw','timestamp'
      ]});
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Staged');

      const filename = filenameHint || `${modeIsAlt(m) ? 'Alt' : 'Master'}_staged_${new Date().toISOString().replace(/[:.]/g,'-')}.xlsx`;

      // write and trigger download in browser
      XLSX.writeFile(wb, filename);

      setStatus(`Exported ${filename} (client-side)`);
    } catch (e) {
      console.error('Client export failed:', e);
      alert(`Export failed: ${e.message || e}`);
      setStatus('Export failed');
    } finally {
      setExporting(false);
    }
  };

  // Public handlers used by UI — keep names similar
  const exportXlsmForMode = async (m) => {
    // Attempt client-side export; if server-side .xlsm is strictly required, call server endpoint (but that may clear scans).
    // Here we explicitly avoid calling server export endpoints to prevent server-side clearing.
    await exportClientXlsx(m, `${modeIsAlt(m) ? 'Alt' : 'Master'}_staged_${new Date().toISOString().replace(/[:.]/g,'-')}.xlsx`);
  };
  const exportXlsm = () => exportXlsmForMode(mode);

  const exportXlsxWithImages = async () => {
    // Note: embedding images into XLSX client-side is non-trivial and not supported directly by xlsx in all browsers.
    // This function exports the same tabular data; images can be attached separately if needed.
    await exportClientXlsx(mode, `${modeIsAlt(mode) ? 'Alt_QR' : 'Master_QR'}_${new Date().toISOString().replace(/[:.]/g,'-')}.xlsx`);
  };

  // Password-protected clear for current mode
  const clearAllForCurrentMode = async () => {
    const pw = window.prompt(`Enter password to clear ALL ${mode.toUpperCase()} scans:`);
    if (pw == null) return;
    if (pw !== 'confirm1234') {
      alert('Incorrect password.');
      return;
    }
    try {
      const resp = await fetch(api(endpoints.clearAll(mode)), { method: 'POST' });
      if (!resp.ok) {
        const txt = await resp.text().catch(()=> '');
        throw new Error(txt || `HTTP ${resp.status}`);
      }
      if (modeIsAlt(mode)) {
        setScansAlt([]); setTotalAlt(0); setCursorAlt(null);
      } else {
        setScansMain([]); setTotalMain(0); setCursorMain(null);
      }
      setStatus(`${mode.toUpperCase()} scans cleared`);
      savedBeep();
    } catch (e) {
      console.error(e);
      alert(`Failed to clear ${mode.toUpperCase()} scans: ${e.message || e}`);
      setStatus(`Failed to clear ${mode.toUpperCase()} scans`);
      warnBeep();
    }
  };

  // ---------- RENDER ----------
  if (showStart) {
    return (
      <div style={{ minHeight: '100vh', background: '#fff' }}>
        <div className="container" style={{ paddingTop: 24, paddingBottom: 24 }}>
          <StartPage
            onStartMain={() => { setMode('main'); setShowStart(false); }}
            onStartAlt={() => { setMode('alt'); setShowStart(false); }}
            onExportMain={() => exportXlsmForMode('main')}
            onExportAlt={() => exportXlsmForMode('alt')}
            operator={operator}
            setOperator={setOperator}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="container" style={{ paddingTop: 20, paddingBottom: 20 }}>
      <header className="app-header">
        <div className="container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="logo" />
            <div>
              <div className="title">Rail Inventory ({mode.toUpperCase()}){knownBadge}</div>
              <div className="status">{status}</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-outline" onClick={() => setShowStart(true)}>Back to Start</button>

            {/* Keep header mode toggle (optional). Remove if you don't want toggling after start */}
            <div className="btn-group" role="group" aria-label="mode">
              <button
                className={`btn ${mode === 'main' ? '' : 'btn-outline'}`}
                onClick={() => setMode('main')}
                title="Switch to MAIN"
              >
                MAIN
              </button>
              <button
                className={`btn ${mode === 'alt' ? '' : 'btn-outline'}`}
                onClick={() => setMode('alt')}
                title="Switch to ALT"
              >
                ALT
              </button>
            </div>

            <button className="btn" onClick={enableSound}>
              {soundOn ? '🔊 Sound On' : '🔈 Enable Sound'}
            </button>

            <button className="btn btn-outline" onClick={() => importInputRef.current?.click()}>
              Import Known Serials ({mode.toUpperCase()})
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImportKnown(f);
              }}
            />

            <button
              className="btn btn-outline"
              onClick={clearAllForCurrentMode}
              title={`Clear all ${mode.toUpperCase()} scans (password required)`}
              style={{ borderColor: 'rgb(220,38,38)', color: 'rgb(220,38,38)' }}
            >
              Clear {mode.toUpperCase()} Scans
            </button>
          </div>
        </div>
      </header>

      <div className="grid" style={{ marginTop: 20 }}>
        {/* Scanner */}
        <section className="card">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              flexWrap: 'wrap'
            }}
          >
            <h3 style={{ margin: 0 }}>Scanner</h3>

            <button
              className="btn"
              onClick={confirmPending}
              disabled={!pending}
              title={pending ? 'Confirm & Save current scan' : 'No pending scan yet'}
            >
              Confirm & Save
            </button>
          </div>

          <Scanner onDetected={onDetected} />

          {pending && (
            <div className="notice" style={{ marginTop: 10 }}>
              <div><strong>Pending Serial:</strong> {pending.serial}</div>
              <div className="meta">Captured at: {new Date(pending.capturedAt).toLocaleString()}</div>
            </div>
          )}
        </section>

        {/* Controls */}
        <section className="card">
          <h3>Controls ({mode.toUpperCase()})</h3>
          <div className="controls-grid" style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <div>
              <label className="status">Operator</label>
              <input className="input" value={operator} onChange={(e) => setOperator(e.target.value)} />
            </div>

            <div>
              <label className="status">Wagon ID</label>
              <input className="input" value={wagonId1} onChange={(e) => setWagonId1(e.target.value)} placeholder="e.g. WGN-0123" />
            </div>
            <div>
              <label className="status">Wagon ID</label>
              <input className="input" value={wagonId2} onChange={(e) => setWagonId2(e.target.value)} placeholder="e.g. WGN-0456" />
            </div>
            <div>
              <label className="status">Wagon ID</label>
              <input className="input" value={wagonId3} onChange={(e) => setWagonId3(e.target.value)} placeholder="e.g. WGN-0789" />
            </div>

            <div>
              <label className="status">Received at</label>
              <input className="input" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} placeholder="" />
            </div>
            <div>
              <label className="status">Loaded at</label>
              <input className="input" value={loadedAt} readOnly />
            </div>

            <div>
              <label className="status">Destination</label>
              <input
                className="input"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="e.g. Arandis Yard / Customer X"
              />
            </div>

            <div>
              <label className="status">Grade</label>
              <input className="input" value={qrExtras.grade} readOnly />
            </div>
            <div>
              <label className="status">Rail Type</label>
              <input className="input" value={qrExtras.railType} readOnly />
            </div>
            <div>
              <label className="status">Spec</label>
              <input className="input" value={qrExtras.spec} readOnly />
            </div>
            <div>
              <label className="status">Length</label>
              <input className="input" value={qrExtras.lengthM} readOnly />
            </div>
          </div>

          <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" onClick={confirmPending} disabled={!pending}>Confirm & Save</button>
            <button
              className="btn btn-outline"
              onClick={() => { setPending(null); setQrExtras({ grade: '', railType: '', spec: '', lengthM: '' }); setStatus('Ready'); }}
            >
              Discard
            </button>
            <button className="btn" onClick={exportXlsm} disabled={exporting}>
              {exporting ? 'Exporting…' : 'Export to Excel'}
            </button>
            <button className="btn" onClick={exportXlsxWithImages} disabled={exporting}>
              {exporting ? 'Exporting…' : 'Export XLSX (with QR images)'}
            </button>
          </div>

          {/* Damaged QR */}
          <div style={{ marginTop: 16 }}>
            <button
              className="btn btn-outline"
              onClick={() => { if (!soundOn) enableSound(); setShowDamaged(v => !v); }}
              aria-expanded={showDamaged}
              aria-controls="damaged-panel"
            >
              {showDamaged ? 'Hide Damaged QR' : 'Damaged QR'}
            </button>

            {showDamaged && (
              <div id="damaged-panel" className="card" style={{ marginTop: 12 }}>
                <div className="status" style={{ marginBottom: 8 }}>
                  Enter details when the QR is damaged and cannot be scanned. ({mode.toUpperCase()})
                </div>
                <div
                  style={{
                    display: 'grid',
                    gap: 12,
                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))'
                  }}
                >
                  <div>
                    <label className="status">Serial *</label>
                    <input
                      className="input"
                      value={manualSerial}
                      onChange={(e) => setManualSerial(e.target.value)}
                      placeholder="Enter serial manually"
                    />
                  </div>

                  <div>
                    <label className="status">Rail Type (fixed)</label>
                    <input className="input" value={FIXED_DAMAGED.railType} readOnly />
                  </div>
                  <div>
                    <label className="status">Grade (fixed)</label>
                    <input className="input" value={FIXED_DAMAGED.grade} readOnly />
                  </div>
                  <div>
                    <label className="status">Spec (fixed)</label>
                    <input className="input" value={FIXED_DAMAGED.spec} readOnly />
                  </div>
                  <div>
                    <label className="status">Length (fixed)</label>
                    <input className="input" value={FIXED_DAMAGED.lengthM} readOnly />
                  </div>
                </div>

                <div style={{ marginTop: 12 }}>
                  <button className="btn" onClick={saveDamaged}>Save Damaged QR</button>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Staged Scans */}
        <section className="card">
          <h3>Staged Scans ({totalCount}) — {mode.toUpperCase()}</h3>
          <div className="list">
            {scans.map((s) => (
              <div
                key={s.id ?? `${s.serial}-${s.timestamp}`}
                className="row"
                data-serial={(s.serial || '').toString().trim().toUpperCase()}
                style={{
                  background:
                    (flashSerial && (s.serial || '').toString().trim().toUpperCase() === flashSerial)
                      ? '#fff3cd'
                      : undefined,
                  transition: 'background 0.3s ease',
                }}
              >
                <div className="title">{s.serial}</div>
                <div className="meta">
                  {s.stage} • {s.operator} • {new Date(s.timestamp || Date.now()).toLocaleString()}
                </div>

                {(s.wagonId1 || s.wagonId2 || s.wagonId3) && (
                  <div className="meta">Wagon IDs: {[s.wagonId1, s.wagonId2, s.wagonId3].filter(Boolean).join(' • ')}</div>
                )}

                {(s.receivedAt || s.loadedAt) && (
                  <div className="meta">
                    {s.receivedAt ? `Received at: ${s.receivedAt}` : ''}
                    {s.receivedAt && s.loadedAt ? ' • ' : ''}
                    {s.loadedAt ? `Loaded at: ${s.loadedAt}` : ''}
                  </div>
                )}

                {s.destination && (
                  <div className="meta">Destination: {s.destination}</div>
                )}

                <div className="meta">
                  {[s.grade, s.railType, s.spec, s.lengthM].filter(Boolean).join(' • ')}
                </div>

                <button className="btn btn-outline" onClick={() => handleRemoveScan(s.id)}>Remove</button>
              </div>
            ))}
          </div>

          {nextCursor && (
            <div style={{ marginTop: 10 }}>
              <button className="btn btn-outline" onClick={loadMore}>Load more</button>
            </div>
          )}
        </section>
      </div>

      <footer className="footer">
        <div className="footer-inner">
          <span>© {new Date().getFullYear()} Top Notch Solutions</span>
          <span className="tag">Rail Inventory • v1 • {mode.toUpperCase()}</span>
        </div>
      </footer>

      {/* Remove confirmation */}
      {removePrompt && (
        <div
          role="dialog"
          aria-modal="true"
          style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,.55)', display: 'grid', placeItems: 'center', zIndex: 50, padding: 16 }}
        >
          <div className="card" style={{ maxWidth: 520, width: '100%', border: '1px solid var(--border)', boxShadow: '0 20px 60px rgba(2,6,23,.35)' }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ width: 40, height: 40, borderRadius: 9999, display: 'grid', placeItems: 'center', background: 'rgba(220,38,38,.1)', color: 'rgb(220,38,38)', fontSize: 22 }}>⚠️</div>
              <div style={{ flex: 1 }}>
                <h3 style={{ margin: 0 }}>Are you sure?</h3>
                <div className="status" style={{ marginTop: 6 }}>
                  Remove this staged scan from the {mode.toUpperCase()} list?
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                  <button className="btn btn-outline" onClick={discardRemovePrompt}>Cancel</button>
                  <button className="btn" onClick={confirmRemoveScan}>Confirm</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Duplicate modal */}
      {dupPrompt && (
        <div
          role="dialog"
          aria-modal="true"
          style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,.55)', display: 'grid', placeItems: 'center', zIndex: 50, padding: 16 }}
        >
          <div className="card" style={{ maxWidth: 560, width: '100%', border: '1px solid var(--border)', boxShadow: '0 20px 60px rgba(2,6,23,.35)' }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ width: 40, height: 40, borderRadius: 9999, display: 'grid', placeItems: 'center', background: 'rgba(251,191,36,.15)', color: 'rgb(202,138,4)', fontSize: 22 }}>⚠️</div>
              <div style={{ flex: 1 }}>
                <h3 style={{ margin: 0 }}>Duplicate detected</h3>
                <div className="status" style={{ marginTop: 6 }}>
                  The serial <strong>{dupPrompt.serial}</strong> already exists in the {mode.toUpperCase()} staged list ({dupPrompt.matches?.length ?? 1}).
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                  <button className="btn btn-outline" onClick={handleDupDiscard}>Discard</button>
                  <button className="btn" onClick={handleDupContinue}>Continue anyway</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
