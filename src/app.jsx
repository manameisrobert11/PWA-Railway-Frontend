// src/app.jsx
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

// ---- Fixed values for Damaged QR ----
const FIXED_DAMAGED = {
  grade: 'SAR48',
  railType: 'R260',
  spec: 'ATA 2DX066-25',
  lengthM: '36 m',
};

// ---- QR parsing (length/spec/railType; no grade duplication) ----
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

// ---- IndexedDB offline queue ----
const DB_NAME = 'rail-offline';
const DB_VERSION = 1;
const STORE = 'queue';

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbAdd(item) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).add(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function idbAll() {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}
async function idbClear(ids) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    (ids || []).forEach(id => store.delete(id));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export default function App() {
  const [status, setStatus] = useState('Ready');
  const [scans, setScans] = useState([]);
  const [showStart, setShowStart] = useState(true);

  // NEW: active sheet (main | alt)
  const [sheet, setSheet] = useState('main');

  const [operator, setOperator] = useState('Clerk A');
  const [wagonId1, setWagonId1] = useState('');
  const [wagonId2, setWagonId2] = useState('');
  const [wagonId3, setWagonId3] = useState('');
  const [receivedAt, setReceivedAt] = useState('');
  const [loadedAt] = useState('WalvisBay'); // static as requested
  const [destination, setDestination] = useState(''); // destination

  const [pending, setPending] = useState(null);
  const [qrExtras, setQrExtras] = useState({ grade: '', railType: '', spec: '', lengthM: '' });

  const [dupPrompt, setDupPrompt] = useState(null);
  const [removePrompt, setRemovePrompt] = useState(null);

  // pagination + total count
  const [totalCount, setTotalCount] = useState(0);
  const [nextCursor, setNextCursor] = useState(null);
  const PAGE_SIZE = 200;

  // reference to socket (shared)
  const socketRef = useRef(null);

  // ------- Web-Audio beeper (user-gesture unlock) -------
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
    if (localStorage.getItem('rail-sound-enabled') === '1') {
      enableSound();
    }
  }, []);

  // ----- Damaged QR dropdown state & fields -----
  const [showDamaged, setShowDamaged] = useState(false);
  const [manualSerial, setManualSerial] = useState('');

  // ---- FAST duplicate detection helpers ----
  const serialSetRef = useRef(new Set());            // O(1) for staged membership
  const lastHitRef = useRef({ serial: '', at: 0 });  // debounce

  // ---- Known (historical) serials imported from Excel/CSV, sheet-local ----
  const knownSerialsRef = useRef(new Set());
  const [knownCount, setKnownCount] = useState(0);
  const normalizeSerial = (s) => String(s || '').trim().toUpperCase();
  const isKnownDuplicate = (serial) => {
    const key = normalizeSerial(serial);
    return key && (serialSetRef.current.has(key) || knownSerialsRef.current.has(key));
  };
  const knownBadge = knownCount ? ` • Known: ${knownCount}` : '';

  // Import UI/handler (sheet-local set)
  const importInputRef = useRef(null);
  const handleImportKnown = async (file) => {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      const set = knownSerialsRef.current;

      // Try common headers; fallback to first column
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

      setKnownCount(set.size);
      setStatus(`Imported known serials (${sheet}): ${set.size}`);
      savedBeep();
    } catch (e) {
      console.error(e);
      setStatus('Import failed. Ensure there is a "serial" column or serials in column A.');
      warnBeep();
    } finally {
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  // --- highlight & scroll the existing staged row on duplicate ---
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

  // Rebuild fast serial set anytime scans list changes
  useEffect(() => {
    const s = new Set();
    for (const r of scans) if (r?.serial) s.add(String(r.serial).trim().toUpperCase());
    serialSetRef.current = s;
  }, [scans]);

  const localHasSerial = (serial) => {
    const key = String(serial || '').trim().toUpperCase();
    if (!key) return false;
    return serialSetRef.current.has(key);
  };

  // load the first page for the current sheet
  const fetchFirstPage = async (activeSheet) => {
    try {
      const [countResp, pageResp] = await Promise.all([
        fetch(api(`/staged/count?sheet=${encodeURIComponent(activeSheet)}`)),
        fetch(api(`/staged?sheet=${encodeURIComponent(activeSheet)}&limit=${PAGE_SIZE}`))
      ]);
      const countData = await countResp.json().catch(()=>({count:0}));
      const pageData = await pageResp.json().catch(()=>({rows:[], nextCursor:null, total:0}));

      const normalized = (pageData.rows || []).map((r) => ({
        ...r,
        wagonId1: r.wagonId1 ?? r.wagon1Id ?? '',
        wagonId2: r.wagonId2 ?? r.wagon2Id ?? '',
        wagonId3: r.wagonId3 ?? r.wagon3Id ?? '',
        receivedAt: r.receivedAt ?? r.recievedAt ?? '',
        loadedAt: r.loadedAt ?? '',
        destination: r.destination ?? r.dest ?? '',
      }));

      setScans(normalized);
      setTotalCount(countData.count ?? pageData.total ?? 0);
      setNextCursor(pageData.nextCursor ?? null);
      // clear known set when switching sheets (sheet-local duplicate memory)
      knownSerialsRef.current = new Set();
      setKnownCount(0);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => { fetchFirstPage(sheet); }, [sheet]);

  const loadMore = async () => {
    if (!nextCursor) return;
    const resp = await fetch(api(`/staged?sheet=${encodeURIComponent(sheet)}&limit=${PAGE_SIZE}&cursor=${nextCursor}`));
    const data = await resp.json().catch(()=>({rows:[], nextCursor:null}));

    const more = (data.rows || []).map((r) => ({
      ...r,
      wagonId1: r.wagonId1 ?? r.wagon1Id ?? '',
      wagonId2: r.wagonId2 ?? r.wagon2Id ?? '',
      wagonId3: r.wagonId3 ?? r.wagon3Id ?? '',
      receivedAt: r.receivedAt ?? r.recievedAt ?? '',
      loadedAt: r.loadedAt ?? '',
      destination: r.destination ?? r.dest ?? '',
    }));

    setScans(prev => [...prev, ...more]);
    setNextCursor(data.nextCursor ?? null);
  };

  // Auto-sync offline queue when online (bulk honors sheet from payload)
  useEffect(() => {
    async function flushQueue() {
      try {
        const items = await idbAll();
        if (items.length === 0) return;
        const payload = items.map(x => x.payload);
        const resp = await fetch(api('/scans/bulk'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: payload })
        });
        if (resp.ok) {
          await idbClear(items.map(x => x.id));
          // Refresh the current sheet listing
          fetchFirstPage(sheet);
        }
      } catch (e) {
        console.warn('Offline queue flush failed:', e.message);
      }
    }

    window.addEventListener('online', flushQueue);
    flushQueue();
    return () => window.removeEventListener('online', flushQueue);
  }, [sheet]);

  // Live sync via shared Socket.IO client
  useEffect(() => {
    socketRef.current = socket;
    try { socket.connect(); } catch {}

    const onNew = (row) => {
      // show only if row.sheet matches current sheet
      if (!row || row.sheet !== sheet) return;
      setScans((prev) => {
        const hasId = row.id != null && prev.some((x) => String(x.id) === String(row.id));
        const hasSerial = row.serial && prev.some((x) =>
          String(x.serial).trim().toUpperCase() === String(row.serial).trim().toUpperCase()
        );
        if (hasId || hasSerial) return prev;
        return [{
          ...row,
          destination: row.destination ?? row.dest ?? '',
        }, ...prev];
      });
      setTotalCount((c) => c + 1);
    };

    const onDeleted = ({ id, sheet: s }) => {
      if (id == null || s !== sheet) return;
      setScans((prev) => {
        const before = prev.length;
        const next = prev.filter((x) => String(x.id) !== String(id));
        if (next.length !== before) {
          setTotalCount((c) => Math.max(0, c - 1));
          setStatus(`Scan removed (${sheet})`);
        }
        return next;
      });
    };

    const onCleared = (payload) => {
      // if server sends {sheet}, only clear UI for that sheet
      const clearedSheet = payload?.sheet || 'main';
      if (clearedSheet !== sheet) return;
      setScans([]);
      setTotalCount(0);
      setNextCursor(null);
      setStatus(`All scans cleared (${clearedSheet})`);
    };

    const onConnect = () => setStatus('Live sync connected');
    const onDisconnect = (reason) => setStatus(`Live sync disconnected (${reason})`);
    const onConnectError = (err) => setStatus(`Socket error: ${err?.message || err}`);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.io?.on?.('error', onConnectError);
    socket.on('new-scan', onNew);
    socket.on('deleted-scan', onDeleted);
    socket.on('cleared-scans', onCleared);

    return () => {
      try {
        socket.off('connect', onConnect);
        socket.off('disconnect', onDisconnect);
        socket.io?.off?.('error', onConnectError);
        socket.off('new-scan', onNew);
        socket.off('deleted-scan', onDeleted);
        socket.off('cleared-scans', onCleared);
      } catch {}
      socketRef.current = null;
    };
  }, [sheet]);

  const findDuplicates = (serial) => {
    const key = String(serial || '').trim().toUpperCase();
    if (!key) return [];
    return scans.filter((r) => String(r.serial || '').trim().toUpperCase() === key);
  };

  // ---- Scan handler with INSTANT duplicate detection (sheet-local) ----
  const onDetected = async (rawText) => {
    const parsed = parseQrPayload(rawText);
    const serial = (parsed.serial || rawText || '').trim();
    const serialKey = serial.toUpperCase();

    if (!serialKey) {
      warnBeep();
      setStatus('Scan had no detectable serial');
      return;
    }

    // Debounce identical frames for 1.2s
    const now = Date.now();
    if (lastHitRef.current.serial === serialKey && now - lastHitRef.current.at < 1200) {
      return;
    }
    lastHitRef.current = { serial: serialKey, at: now };

    // 1) INSTANT union check (current sheet only)
    if (isKnownDuplicate(serialKey)) {
      warnBeep();
      setDupPrompt({
        serial: serialKey,
        matches: findDuplicates(serialKey),
        candidate: {
          pending: {
            serial: serialKey,
            raw: parsed.raw || String(rawText),
            capturedAt: new Date().toISOString(),
          },
          qrExtras: {
            grade: parsed.grade || '',
            railType: parsed.railType || '',
            spec: parsed.spec || '',
            lengthM: parsed.lengthM || '',
          },
        },
      });
      if (localHasSerial(serialKey)) {
        flashExistingRow(serialKey);
      }
      setStatus(`Duplicate detected (${sheet}) — awaiting decision`);
      return;
    }

    // 2) Server check (same sheet)
    try {
      const resp = await fetch(api(`/exists/${encodeURIComponent(serialKey)}?sheet=${encodeURIComponent(sheet)}`));
      if (resp.ok) {
        const info = await resp.json();
        if (info?.exists) {
          warnBeep();
          setDupPrompt({
            serial: serialKey,
            matches: [info.row || { serial: serialKey }],
            candidate: {
              pending: {
                serial: serialKey,
                raw: parsed.raw || String(rawText),
                capturedAt: new Date().toISOString(),
              },
              qrExtras: {
                grade: parsed.grade || '',
                railType: parsed.railType || '',
                spec: parsed.spec || '',
                lengthM: parsed.lengthM || '',
              },
            },
          });
          if (localHasSerial(serialKey)) {
            flashExistingRow(serialKey);
          }
          setStatus(`Duplicate detected (${sheet}) — awaiting decision`);
          return;
        }
      }
    } catch {}

    // 3) Not a duplicate — proceed
    okBeep();
    setPending({
      serial: serialKey,
      raw: parsed.raw || String(rawText),
      capturedAt: new Date().toISOString(),
    });
    setQrExtras({
      grade: parsed.grade || '',
      railType: parsed.railType || '',
      spec: parsed.spec || '',
      lengthM: parsed.lengthM || '',
    });
    setStatus(`Captured (${sheet}) — review & Confirm`);
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
      // sheet-specific delete optional (server emits sheet in payload)
      const resp = await fetch(api(`/staged/${removePrompt}`), { method: 'DELETE' });
      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        throw new Error(errText || 'Failed to remove scan');
      }
      setScans((prev) => prev.filter((scan) => scan.id !== removePrompt));
      setTotalCount(c => Math.max(0,  c - 1));
      setRemovePrompt(null);
      setStatus(`Scan removed (${sheet})`);
    } catch (e) {
      console.error(e);
      alert(e.message || 'Failed to remove scan');
      setRemovePrompt(null);
    }
  };
  const discardRemovePrompt = () => setRemovePrompt(null);

  const confirmPending = async () => {
    if (!pending?.serial || !String(pending.serial).trim()) {
      alert('Nothing to save yet. Scan a code first. If QR is damaged, use the Damaged QR dropdown.');
      return;
    }

    // Early union check (current sheet)
    if (isKnownDuplicate(pending.serial)) {
      warnBeep();
      setDupPrompt({
        serial: String(pending.serial).toUpperCase(),
        matches: findDuplicates(pending.serial),
        candidate: { pending, qrExtras },
      });
      if (localHasSerial(String(pending.serial))) {
        flashExistingRow(String(pending.serial).toUpperCase());
      }
      setStatus(`Duplicate detected (${sheet}) — awaiting decision`);
      return;
    }

    // Re-check on server just before saving (same sheet)
    try {
      const r = await fetch(api(`/exists/${encodeURIComponent(pending.serial)}?sheet=${encodeURIComponent(sheet)}`));
      if (r.ok) {
        const j = await r.json();
        if (j?.exists) {
          warnBeep();
          setDupPrompt({
            serial: pending.serial,
            matches: [j.row || { serial: pending.serial }],
            candidate: { pending, qrExtras },
          });
          if (localHasSerial(String(pending.serial))) {
            flashExistingRow(String(pending.serial).toUpperCase());
          }
          setStatus(`Duplicate detected (${sheet}) — awaiting decision`);
          return;
        }
      }
    } catch {}

    const rec = {
      sheet,                                   // NEW
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
      const resp = await fetch(api('/scan'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rec),
      });

      let data = null;
      try { data = await resp.json(); } catch {}

      if (!resp.ok) throw new Error(data?.error || `HTTP ${resp.status}`);

      const newId = data?.id || Date.now();
      setScans((prev) => [{ id: newId, ...rec }, ...prev]);
      setTotalCount(c => c + 1);

      // also register in known set
      knownSerialsRef.current.add(normalizeSerial(rec.serial));
      setKnownCount(knownSerialsRef.current.size);

      setPending(null);
      setQrExtras({ grade: '', railType: '', spec: '', lengthM: '' });
      setStatus(`Saved to staged (${sheet})`);
      savedBeep();
    } catch (e) {
      await idbAdd({ payload: rec });
      setScans((prev) => [{ id: Date.now(), ...rec }, ...prev]);
      setTotalCount(c => c + 1);

      knownSerialsRef.current.add(normalizeSerial(rec.serial));
      setKnownCount(knownSerialsRef.current.size);

      setPending(null);
      setQrExtras({ grade: '', railType: '', spec: '', lengthM: '' });
      setStatus(`Saved locally (${sheet}) — will sync`);
      savedBeep();
    }
  };

  const saveDamaged = async () => {
    if (!manualSerial.trim()) {
      alert('Unable to save: enter Serial (or scan a QR).');
      return;
    }

    const serialKey = manualSerial.trim().toUpperCase();

    // Early union check
    if (isKnownDuplicate(serialKey)) {
      warnBeep();
      setDupPrompt({
        serial: serialKey,
        matches: findDuplicates(serialKey),
        candidate: {
          pending: {
            serial: serialKey,
            raw: serialKey,
            capturedAt: new Date().toISOString(),
          },
          qrExtras: {
            grade: FIXED_DAMAGED.grade,
            railType: FIXED_DAMAGED.railType,
            spec: FIXED_DAMAGED.spec,
            lengthM: FIXED_DAMAGED.lengthM,
          },
        },
      });
      if (localHasSerial(serialKey)) flashExistingRow(serialKey);
      setStatus(`Duplicate detected (${sheet}) — awaiting decision`);
      return;
    }

    // Optional server check (same sheet)
    try {
      const r = await fetch(api(`/exists/${encodeURIComponent(serialKey)}?sheet=${encodeURIComponent(sheet)}`));
      if (r.ok) {
        const j = await r.json();
        if (j?.exists && !confirm('Duplicate exists on this sheet. Save anyway?')) return;
      }
    } catch {}

    const rec = {
      sheet,
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
      const resp = await fetch(api('/scan'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rec),
      });
      const data = await resp.json().catch(()=>null);
      if (!resp.ok) throw new Error(data?.error || `HTTP ${resp.status}`);

      const newId = data?.id || Date.now();
      setScans((prev) => [{ id: newId, ...rec }, ...prev ]);
      setTotalCount((c) => c + 1);

      knownSerialsRef.current.add(normalizeSerial(rec.serial));
      setKnownCount(knownSerialsRef.current.size);

      setManualSerial('');
      setShowDamaged(false);
      setStatus(`Damaged QR saved (${sheet})`);
      savedBeep();
    } catch (e) {
      await idbAdd({ payload: rec });
      setScans((prev) => [{ id: Date.now(), ...rec }, ...prev ]);
      setTotalCount((c) => c + 1);

      knownSerialsRef.current.add(normalizeSerial(rec.serial));
      setKnownCount(knownSerialsRef.current.size);

      setManualSerial('');
      setShowDamaged(false);
      setStatus(`Damaged QR saved locally (${sheet}) — will sync`);
      savedBeep();
    }
  };

  const exportToExcel = async (targetSheet) => {
    try {
      const resp = await fetch(api(`/export-to-excel?sheet=${encodeURIComponent(targetSheet)}`), { method: 'POST' });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(text || `HTTP ${resp.status}`);
      }
      const dispo = resp.headers.get('Content-Disposition') || '';
      const match = dispo.match(/filename="?([^"]+)"?/i);
      const filename = match?.[1] || `Master_${targetSheet}_${Date.now()}.xlsm`;

      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatus(`Exported ${filename}`);
    } catch (e) {
      console.error('Export failed:', e);
      alert(`Export failed: ${e.message}\n(Ensure uploads/template.xlsm exists on the server)`);
      setStatus('Export failed');
    }
  };

  const exportXlsxWithImages = async () => {
    try {
      const resp = await fetch(api(`/export-xlsx-images?sheet=${encodeURIComponent(sheet)}`), { method: 'POST' });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(text || `HTTP ${resp.status}`);
      }
      const dispo = resp.headers.get('Content-Disposition') || '';
      const match = dispo.match(/filename="?([^"]+)"?/i);
      const filename = match?.[1] || `Master_QR_${sheet}_${Date.now()}.xlsx`;

      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatus(`Exported ${filename}`);
    } catch (e) {
      console.error('Export (images) failed:', e);
      alert(`Export (images) failed: ${e.message}`);
      setStatus('Export (images) failed');
    }
  };

  const clearAltSheet = async () => {
    if (!confirm('Clear ALL staged scans on ALT sheet? This cannot be undone.')) return;
    try {
      const resp = await fetch(api('/staged/clear?sheet=alt'), { method: 'POST' });
      const j = await resp.json().catch(()=>null);
      if (!resp.ok) throw new Error(j?.error || `HTTP ${resp.status}`);
      if (sheet === 'alt') {
        setScans([]); setTotalCount(0); setNextCursor(null);
      }
      setStatus(`Cleared ${j?.cleared ?? 0} rows on ALT`);
    } catch (e) {
      alert(`Failed to clear ALT: ${e.message}`);
    }
  };

  // ---------- RENDER ----------
  if (showStart) {
    return (
      <div style={{ minHeight: '100vh', background: '#fff' }}>
        <div className="container" style={{ paddingTop: 24, paddingBottom: 24 }}>
          <StartPage
            onStartSheet={(s) => { setSheet(s || 'main'); setShowStart(false); }}
            onExport={(s) => exportToExcel(s || 'main')}
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
              <div className="title">Rail Inventory — <span style={{ textTransform: 'uppercase' }}>{sheet}</span> {knownBadge}</div>
              <div className="status">{status}</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Sheet switch */}
            <div className="btn-group" role="group" aria-label="Sheet">
              <button className={`btn ${sheet==='main'?'':'btn-outline'}`} onClick={() => setSheet('main')}>Main</button>
              <button className={`btn ${sheet==='alt'?'':'btn-outline'}`} onClick={() => setSheet('alt')}>Alt</button>
            </div>

            {/* Clear ALT only shows as button for convenience (always safe) */}
            <button className="btn btn-outline" onClick={clearAltSheet} title="Clear all scans on ALT">
              Clear ALT sheet
            </button>

            <button className="btn btn-outline" onClick={() => setShowStart(true)}>Back to Start</button>
            <button className="btn" onClick={enableSound}>
              {soundOn ? '🔊 Sound On' : '🔈 Enable Sound'}
            </button>
            <button className="btn btn-outline" onClick={() => importInputRef.current?.click()}>
              Import Known Serials
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
            <h3 style={{ margin: 0 }}>Scanner ({sheet.toUpperCase()})</h3>

            {/* Quick action so you don't have to scroll */}
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
          <h3>Controls</h3>
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
            <button className="btn" onClick={() => exportToExcel(sheet)}>Export to Excel</button>
            <button className="btn" onClick={exportXlsxWithImages}>Export XLSX (with QR images)</button>
          </div>

          {/* Damaged QR dropdown */}
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
                  Enter details when the QR is damaged and cannot be scanned.
                </div>

                {/* Wagon IDs inside Damaged QR panel */}
                <div
                  style={{
                    display: 'grid',
                    gap: 12,
                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))'
                  }}
                >
                  <div>
                    <label className="status">Wagon ID 1</label>
                    <input
                      className="input"
                      value={wagonId1}
                      onChange={(e) => setWagonId1(e.target.value)}
                      placeholder="e.g. WGN-0123"
                    />
                  </div>
                  <div>
                    <label className="status">Wagon ID 2</label>
                    <input
                      className="input"
                      value={wagonId2}
                      onChange={(e) => setWagonId2(e.target.value)}
                      placeholder="e.g. WGN-0456"
                    />
                  </div>
                  <div>
                    <label className="status">Wagon ID 3</label>
                    <input
                      className="input"
                      value={wagonId3}
                      onChange={(e) => setWagonId3(e.target.value)}
                      placeholder="e.g. WGN-0789"
                    />
                  </div>
                </div>

                <hr style={{ margin: '14px 0', border: 'none', borderTop: '1px solid var(--border)' }} />

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

                <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="btn" onClick={saveDamaged}>Save Damaged QR</button>
                  <button
                    className="btn btn-outline"
                    onClick={() => { setManualSerial(''); setShowDamaged(false); }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Staged Scans */}
        <section className="card">
          <h3>Staged Scans ({totalCount})</h3>
          <div className="list">
            {scans.map((s) => (
              <div
                key={s.id ?? `${s.serial}-${s.timestamp}`}
                className="row"
                data-serial={(s.serial || '').toString().trim().toUpperCase()}
                style={{
                  background:
                    flashSerial &&
                    (s.serial || '').toString().trim().toUpperCase() === flashSerial
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
          <span className="tag">Rail Inventory • v1</span>
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
                <div className="status" style={{ marginTop: 6 }}>Are you sure you want to remove this staged scan from the list?</div>
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
                  The serial <strong>{dupPrompt.serial}</strong> already exists in the staged list ({dupPrompt.matches?.length ?? 1}) on the <strong>{sheet.toUpperCase()}</strong> sheet.
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
