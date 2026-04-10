// src/App.jsx
import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { socket } from './socket';
import Scanner from './scanner/Scanner.jsx';
import StartPage from './StartPage.jsx';
import './app.css';
import * as XLSX from 'xlsx';

// kept because already in your project
import ExcelJS from 'exceljs/dist/exceljs.min.js';
import { saveAs } from 'file-saver';

const API_BASE = import.meta.env.VITE_API_BASE || '';
const api = (p) => {
  const path = p.startsWith('/') ? p : `/${p}`;
  if (API_BASE) {
    if (API_BASE.endsWith('/api')) {
      return `${API_BASE}${path}`;
    }
    return `${API_BASE}/api${path}`;
  }
  return `/api${path}`;
};

const modeIsAlt = (m) => m === 'alt';
const endpoints = {
  staged: (m) => (modeIsAlt(m) ? '/staged-alt' : '/staged'),
  stagedCount: (m) => (modeIsAlt(m) ? '/staged-alt/count' : '/staged/count'),
  stagedDelete: (m, id) => (modeIsAlt(m) ? `/staged-alt/${id}` : `/staged/${id}`),
  scan: (m) => (modeIsAlt(m) ? '/scan-alt' : '/scan'),
  exists: (m, serial) =>
    modeIsAlt(m) ? `/exists-alt/${encodeURIComponent(serial)}` : `/exists/${encodeURIComponent(serial)}`,
  clearAll: (m) => (modeIsAlt(m) ? '/staged-alt/clear' : '/staged/clear'),
  exportXlsm: (m) => (modeIsAlt(m) ? '/export-alt-to-excel' : '/export-to-excel'),
  exportXlsxImages: (m) => (modeIsAlt(m) ? '/export-alt-xlsx-images' : '/export-xlsx-images'),
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
    if (/^R\d{3}(?:L?HT)?$/.test(u)) {
      railType = u;
      break;
    }
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

// IndexedDB queues
const DB_NAME = 'rail-offline';
const DB_VERSION = 2;
const STORE_MAIN = 'queue_main';
const STORE_ALT = 'queue_alt';
const storeForMode = (m) => (modeIsAlt(m) ? STORE_ALT : STORE_MAIN);

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
    (ids || []).forEach((id) => store.delete(id));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function OfflineIndicator({ isOnline, pendingCount, isSyncing, onManualSync }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 12px',
        borderRadius: 8,
        background: isOnline ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
        border: `1px solid ${isOnline ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
        flexWrap: 'wrap',
      }}
    >
      <div
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: isOnline ? '#22c55e' : '#ef4444',
          boxShadow: isOnline ? '0 0 6px #22c55e' : '0 0 6px #ef4444',
          animation: isOnline ? 'none' : 'pulse 2s infinite',
        }}
      />

      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: isOnline ? '#22c55e' : '#ef4444',
        }}
      >
        {isOnline ? 'Online' : 'Offline'}
      </span>

      {pendingCount > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 8px',
            borderRadius: 12,
            background: '#f59e0b',
            color: '#fff',
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          <span>⏳</span>
          <span>{pendingCount} pending</span>
        </div>
      )}

      {pendingCount > 0 && isOnline && (
        <button
          onClick={onManualSync}
          disabled={isSyncing}
          style={{
            padding: '4px 10px',
            borderRadius: 6,
            border: 'none',
            background: isSyncing ? '#94a3b8' : '#3b82f6',
            color: '#fff',
            fontSize: 11,
            fontWeight: 600,
            cursor: isSyncing ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          {isSyncing ? (
            <>
              <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>↻</span>
              Syncing...
            </>
          ) : (
            <>
              <span>↑</span>
              Sync Now
            </>
          )}
        </button>
      )}
    </div>
  );
}

const styleSheet = document.createElement('style');
styleSheet.textContent = `
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
`;
if (!document.querySelector('style[data-offline-indicator]')) {
  styleSheet.setAttribute('data-offline-indicator', 'true');
  document.head.appendChild(styleSheet);
}

export default function App() {
  const [mode, setMode] = useState('main');
  const [showStart, setShowStart] = useState(true);

  const [status, setStatus] = useState('Ready');

  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingMainCount, setPendingMainCount] = useState(0);
  const [pendingAltCount, setPendingAltCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);

  const totalPendingCount = pendingMainCount + pendingAltCount;
  const currentModePendingCount = modeIsAlt(mode) ? pendingAltCount : pendingMainCount;

  const [scansMain, setScansMain] = useState([]);
  const [scansAlt, setScansAlt] = useState([]);

  const [totalMain, setTotalMain] = useState(0);
  const [totalAlt, setTotalAlt] = useState(0);

  const [cursorMain, setCursorMain] = useState(null);
  const [cursorAlt, setCursorAlt] = useState(null);

  const scans = modeIsAlt(mode) ? scansAlt : scansMain;
  const setScans = modeIsAlt(mode) ? setScansAlt : setScansMain;
  const totalCount = modeIsAlt(mode) ? totalAlt : totalMain;
  const setTotalCount = modeIsAlt(mode) ? setTotalAlt : setTotalMain;
  const nextCursor = modeIsAlt(mode) ? cursorAlt : cursorMain;

  const [operator, setOperator] = useState('Clerk A');
  const [wagonId1, setWagonId1] = useState('');
  const [wagonId2, setWagonId2] = useState('');
  const [wagonId3, setWagonId3] = useState('');
  const [receivedAt, setReceivedAt] = useState('');
  const [loadedAt] = useState('WalvisBay');
  const [destination, setDestination] = useState('');

  const [pending, setPending] = useState(null);
  const [qrExtras, setQrExtras] = useState({ grade: '', railType: '', spec: '', lengthM: '' });

  const [dupPrompt, setDupPrompt] = useState(null);
  const [removePrompt, setRemovePrompt] = useState(null);

  // Sound: on by default, only muted if explicitly saved as muted
  const audioCtxRef = useRef(null);
  const [soundOn, setSoundOn] = useState(() => localStorage.getItem('rail-sound-muted') !== '1');

  const ensureAudioReady = useCallback(async () => {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;

    if (!audioCtxRef.current) {
      audioCtxRef.current = new Ctx();
    }

    if (audioCtxRef.current.state === 'suspended') {
      await audioCtxRef.current.resume();
    }

    return audioCtxRef.current;
  }, []);

  const playBeepDirect = useCallback((ctx, freq = 1500, durationMs = 80) => {
    try {
      if (!ctx) return;
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
  }, []);

  const playBeep = useCallback(
    async (freq = 1500, durationMs = 80) => {
      try {
        if (!soundOn) return;
        const ctx = await ensureAudioReady();
        if (!ctx || ctx.state !== 'running') return;
        playBeepDirect(ctx, freq, durationMs);
      } catch {}
    },
    [soundOn, ensureAudioReady, playBeepDirect]
  );

  const scanBeep = useCallback(() => {
    playBeep(1500, 80);
  }, [playBeep]);

  const toggleSound = useCallback(() => {
    setSoundOn((prev) => {
      const next = !prev;
      localStorage.setItem('rail-sound-muted', next ? '0' : '1');
      return next;
    });
  }, []);

  const [showDamaged, setShowDamaged] = useState(false);
  const [manualSerial, setManualSerial] = useState('');

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

  const updatePendingCounts = useCallback(async () => {
    try {
      const mainItems = await idbAll('main');
      const altItems = await idbAll('alt');
      setPendingMainCount(mainItems.length);
      setPendingAltCount(altItems.length);
    } catch (e) {
      console.warn('Failed to get pending counts:', e);
    }
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setStatus('Back online — ready to sync');
    };

    const handleOffline = () => {
      setIsOnline(false);
      setStatus('You are offline — scans will be saved locally');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    updatePendingCounts();

    const interval = setInterval(updatePendingCounts, 5000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(interval);
    };
  }, [updatePendingCounts]);

  const socketRef = useRef(null);
  useEffect(() => {
    socketRef.current = socket;
    try {
      socket.connect();
    } catch {}

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

  const mainLoadedRef = useRef(false);
  const altLoadedRef = useRef(false);
  const PAGE_SIZE = 200;

  useEffect(() => {
    const load = async (m) => {
      try {
        const [countResp, pageResp] = await Promise.all([
          fetch(api(endpoints.stagedCount(m))),
          fetch(api(`${endpoints.staged(m)}?limit=200`)),
        ]);
        const countData = await countResp.json().catch(() => ({ count: 0 }));
        const pageData = await pageResp.json().catch(() => ({ rows: [], nextCursor: null, total: 0 }));

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

  const loadMore = async () => {
    const m = mode;
    const cursor = modeIsAlt(m) ? cursorAlt : cursorMain;
    if (!cursor) return;

    const resp = await fetch(api(`${endpoints.staged(m)}?limit=${PAGE_SIZE}&cursor=${cursor}`));
    const data = await resp.json().catch(() => ({ rows: [], nextCursor: null }));

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

  const flushQueueForMode = useCallback(async (m) => {
    try {
      const items = await idbAll(m);
      if (items.length === 0) return { flushed: 0 };

      const payload = items.map((x) => x.payload);
      const bulkPath = modeIsAlt(m) ? '/scans-alt/bulk' : '/scans/bulk';

      const resp = await fetch(api(bulkPath), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: payload }),
      });

      if (resp.ok) {
        await idbClear(items.map((x) => x.id), m);

        const [countResp, pageResp] = await Promise.all([
          fetch(api(endpoints.stagedCount(m))),
          fetch(api(`${endpoints.staged(m)}?limit=${PAGE_SIZE}`)),
        ]);
        const countData = await countResp.json().catch(() => ({ count: 0 }));
        const pageData = await pageResp.json().catch(() => ({ rows: [], nextCursor: null, total: 0 }));
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
          setTotalAlt(countData.count ?? pageData.total ?? normalized.length);
        } else {
          setScansMain(normalized);
          setCursorMain(pageData.nextCursor ?? null);
          setTotalMain(countData.count ?? pageData.total ?? normalized.length);
        }

        return { flushed: items.length };
      }

      return { flushed: 0, error: 'Server returned error' };
    } catch (e) {
      console.warn(`Offline queue flush failed (${m}):`, e.message);
      return { flushed: 0, error: e.message };
    }
  }, []);

  const handleManualSync = useCallback(async () => {
    if (!isOnline || isSyncing) return;

    setIsSyncing(true);
    setStatus('Syncing offline scans...');

    try {
      const mainResult = await flushQueueForMode('main');
      const altResult = await flushQueueForMode('alt');

      const totalFlushed = (mainResult.flushed || 0) + (altResult.flushed || 0);

      await updatePendingCounts();

      if (totalFlushed > 0) {
        setStatus(`✓ Synced ${totalFlushed} offline scan${totalFlushed > 1 ? 's' : ''}`);
      } else if (mainResult.error || altResult.error) {
        setStatus('Sync failed — will retry later');
      } else {
        setStatus('No pending scans to sync');
      }
    } catch (e) {
      console.error('Manual sync failed:', e);
      setStatus('Sync failed — please try again');
    } finally {
      setIsSyncing(false);
    }
  }, [isOnline, isSyncing, flushQueueForMode, updatePendingCounts]);

  useEffect(() => {
    async function flushBoth() {
      if (!isOnline) return;
      await flushQueueForMode('main');
      await flushQueueForMode('alt');
      await updatePendingCounts();
    }

    window.addEventListener('online', flushBoth);
    flushBoth();

    return () => window.removeEventListener('online', flushBoth);
  }, [isOnline, flushQueueForMode, updatePendingCounts]);

  async function flushLocalQueueBeforeExport({ useAlt = false } = {}) {
    try {
      const m = useAlt ? 'alt' : 'main';
      const items = await idbAll(m);
      if (!items || items.length === 0) return { flushed: 0 };

      const payload = items.map((x) => x.payload || x);
      const url = useAlt ? api('/scans-alt/bulk') : api('/scans/bulk');

      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: payload }),
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        console.warn('Bulk upload failed:', text || resp.status);
        return { flushed: 0, error: text || `HTTP ${resp.status}` };
      }

      const body = await resp.json().catch(() => ({}));
      await idbClear(items.map((x) => x.id), m);
      await updatePendingCounts();
      return { flushed: payload.length, result: body };
    } catch (e) {
      console.warn('flushLocalQueueBeforeExport error:', e?.message || e);
      return { flushed: 0, error: e?.message || String(e) };
    }
  }

  const scanSerialSet = useMemo(() => {
    const s = new Set();
    for (const r of scans) if (r?.serial) s.add(normalizeSerial(r.serial));
    return s;
  }, [scans]);

  const lastHitRef = useRef({ serial: '', at: 0 });
  const localHasSerial = (serial) => scanSerialSet.has(normalizeSerial(serial));
  const findDuplicates = (serial) => scans.filter((r) => normalizeSerial(r.serial) === normalizeSerial(serial));

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

  const onDetected = async (rawText) => {
    const parsed = parseQrPayload(rawText);
    const serial = (parsed.serial || rawText || '').trim();
    const serialKey = normalizeSerial(serial);

    if (!serialKey) {
      setStatus('Scan had no detectable serial');
      return;
    }

    const now = Date.now();
    if (lastHitRef.current.serial === serialKey && now - lastHitRef.current.at < 1200) return;
    lastHitRef.current = { serial: serialKey, at: now };

    if (isKnownDuplicate(serialKey)) {
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

    await scanBeep();
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
      try {
        data = await resp.json();
      } catch {}
      if (!resp.ok) throw new Error(data?.error || `HTTP ${resp.status}`);

      const newId = data?.id || Date.now();
      setScans((prev) => [{ id: newId, ...rec }, ...prev]);
      setTotalCount((c) => c + 1);

      pushKnownForMode(rec.serial);

      setPending(null);
      setQrExtras({ grade: '', railType: '', spec: '', lengthM: '' });
      setStatus(`Saved to staged (${mode.toUpperCase()})`);
    } catch (e) {
      await idbAdd({ payload: rec }, mode);
      await updatePendingCounts();

      setScans((prev) => [{ id: Date.now(), ...rec }, ...prev]);
      setTotalCount((c) => c + 1);

      pushKnownForMode(rec.serial);

      setPending(null);
      setQrExtras({ grade: '', railType: '', spec: '', lengthM: '' });
      setStatus(`Saved locally (offline) — will sync (${mode.toUpperCase()})`);
    }
  };

  const saveDamaged = async () => {
    if (!manualSerial.trim()) {
      alert('Unable to save: enter Serial (or scan a QR).');
      return;
    }
    const serialKey = normalizeSerial(manualSerial);

    if (isKnownDuplicate(serialKey)) {
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
      const data = await resp.json().catch(() => null);
      if (!resp.ok) throw new Error(data?.error || `HTTP ${resp.status}`);

      const newId = data?.id || Date.now();
      setScans((prev) => [{ id: newId, ...rec }, ...prev]);
      setTotalCount((c) => c + 1);

      const set = getKnownRef().current;
      set.add(serialKey);
      setKnownMainCount(knownMainRef.current.size);
      setKnownAltCount(knownAltRef.current.size);

      setManualSerial('');
      setShowDamaged(false);
      setStatus(`Damaged QR saved (${mode.toUpperCase()})`);
    } catch (e) {
      await idbAdd({ payload: rec }, mode);
      await updatePendingCounts();

      setScans((prev) => [{ id: Date.now(), ...rec }, ...prev]);
      setTotalCount((c) => c + 1);

      const set = getKnownRef().current;
      set.add(serialKey);
      setKnownMainCount(knownMainRef.current.size);
      setKnownAltCount(knownAltRef.current.size);

      setManualSerial('');
      setShowDamaged(false);
      setStatus(`Damaged QR saved locally (offline) — will sync (${mode.toUpperCase()})`);
    }
  };

  const [exporting, setExporting] = useState(false);

  async function fetchAllStagedRows(m) {
    const rows = [];
    try {
      let cursor = null;
      const limit = 1000;
      while (true) {
        const url = api(
          `${endpoints.staged(m)}?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
        );
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`Failed to fetch staged rows (${resp.status})`);
        const data = await resp.json().catch(() => ({ rows: [], nextCursor: null }));
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

  const exportLocalToExcel = async (rows, filenamePrefix) => {
    try {
      const HEADERS = [
        'Serial',
        'Stage',
        'Operator',
        'Wagon1ID',
        'Wagon2ID',
        'Wagon3ID',
        'ReceivedAt',
        'LoadedAt',
        'Destination',
        'Grade',
        'RailType',
        'Spec',
        'Length',
        'QRRaw',
        'Timestamp',
      ];

      const dataRows = rows.map((s) => [
        s.serial || '',
        s.stage || '',
        s.operator || '',
        s.wagon1Id || s.wagonId1 || '',
        s.wagon2Id || s.wagonId2 || '',
        s.wagon3Id || s.wagonId3 || '',
        s.receivedAt || '',
        s.loadedAt || '',
        s.destination || '',
        s.grade || '',
        s.railType || '',
        s.spec || '',
        s.lengthM || '',
        s.qrRaw || '',
        s.timestamp || '',
      ]);

      const aoa = [HEADERS, ...dataRows];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Scans');

      const filename = `${filenamePrefix}_${new Date().toISOString().replace(/[:.]/g, '-')}.xlsx`;
      XLSX.writeFile(wb, filename);

      return { success: true, filename, count: rows.length };
    } catch (e) {
      console.error('Local export failed:', e);
      return { success: false, error: e.message };
    }
  };

  const exportXlsmForMode = async (m) => {
    try {
      const offlineItems = await idbAll(m);
      const offlineRows = offlineItems.map((x) => x.payload || x);

      if (!isOnline) {
        setStatus('Offline — exporting local data...');

        const displayedScans = modeIsAlt(m) ? scansAlt : scansMain;

        const seenSerials = new Set();
        const allRows = [];

        for (const scan of displayedScans) {
          const key = normalizeSerial(scan.serial);
          if (key && !seenSerials.has(key)) {
            seenSerials.add(key);
            allRows.push(scan);
          }
        }

        for (const row of offlineRows) {
          const key = normalizeSerial(row.serial);
          if (key && !seenSerials.has(key)) {
            seenSerials.add(key);
            allRows.push(row);
          }
        }

        if (allRows.length === 0) {
          alert('No scans to export.');
          setStatus('No scans to export');
          return;
        }

        const result = await exportLocalToExcel(allRows, modeIsAlt(m) ? 'Alt_Offline' : 'Master_Offline');

        if (result.success) {
          setStatus(`Exported ${result.count} scans (offline) — ${result.filename}`);
        } else {
          throw new Error(result.error);
        }
        return;
      }

      setStatus('Preparing export — syncing local queue...');
      const flush = await flushLocalQueueBeforeExport({ useAlt: modeIsAlt(m) });
      if (flush.error) {
        const ok = confirm('Failed to sync offline scans to server. Export local data instead?');
        if (ok) {
          const displayedScans = modeIsAlt(m) ? scansAlt : scansMain;
          const seenSerials = new Set();
          const allRows = [];

          for (const scan of displayedScans) {
            const key = normalizeSerial(scan.serial);
            if (key && !seenSerials.has(key)) {
              seenSerials.add(key);
              allRows.push(scan);
            }
          }
          for (const row of offlineRows) {
            const key = normalizeSerial(row.serial);
            if (key && !seenSerials.has(key)) {
              seenSerials.add(key);
              allRows.push(row);
            }
          }

          const result = await exportLocalToExcel(allRows, modeIsAlt(m) ? 'Alt_Local' : 'Master_Local');
          if (result.success) {
            setStatus(`Exported ${result.count} scans (local) — ${result.filename}`);
          } else {
            throw new Error(result.error);
          }
          return;
        } else {
          setStatus('Export cancelled');
          return;
        }
      } else if (flush.flushed > 0) {
        setStatus(`Flushed ${flush.flushed} local scans — exporting...`);
      } else {
        setStatus('No local queued scans — exporting server data...');
      }

      const resp = await fetch(api(endpoints.exportXlsm(m)), { method: 'POST' });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(text || `HTTP ${resp.status}`);
      }
      const dispo = resp.headers.get('Content-Disposition') || '';
      const match = dispo.match(/filename="?([^"]+)"?/i);
      const filename = match?.[1] || `${modeIsAlt(m) ? 'Alt' : 'Master'}_${Date.now()}.xlsm`;

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
      alert(`Export failed: ${e.message}`);
      setStatus('Export failed');
    }
  };

  const exportXlsm = () => exportXlsmForMode(mode);

  const exportXlsxWithImages = async () => {
    if (exporting) return;
    setExporting(true);

    try {
      const offlineItems = await idbAll(mode);
      const offlineRows = offlineItems.map((x) => x.payload || x);

      if (!isOnline) {
        setStatus('Offline — exporting local data (without QR images)...');

        const displayedScans = scans;
        const seenSerials = new Set();
        const allRows = [];

        for (const scan of displayedScans) {
          const key = normalizeSerial(scan.serial);
          if (key && !seenSerials.has(key)) {
            seenSerials.add(key);
            allRows.push(scan);
          }
        }
        for (const row of offlineRows) {
          const key = normalizeSerial(row.serial);
          if (key && !seenSerials.has(key)) {
            seenSerials.add(key);
            allRows.push(row);
          }
        }

        if (allRows.length === 0) {
          alert('No scans to export.');
          setStatus('No scans to export');
          setExporting(false);
          return;
        }

        const result = await exportLocalToExcel(allRows, modeIsAlt(mode) ? 'Alt_Offline' : 'Master_Offline');

        if (result.success) {
          setStatus(`Exported ${result.count} scans (offline, no QR images) — ${result.filename}`);
        } else {
          throw new Error(result.error);
        }
        setExporting(false);
        return;
      }

      setStatus('Preparing export (images) — syncing local queue...');
      const flush = await flushLocalQueueBeforeExport({ useAlt: modeIsAlt(mode) });
      if (flush.error) {
        const ok = confirm('Failed to sync offline scans to server. Export local data instead (without QR images)?');
        if (ok) {
          const displayedScans = scans;
          const seenSerials = new Set();
          const allRows = [];

          for (const scan of displayedScans) {
            const key = normalizeSerial(scan.serial);
            if (key && !seenSerials.has(key)) {
              seenSerials.add(key);
              allRows.push(scan);
            }
          }
          for (const row of offlineRows) {
            const key = normalizeSerial(row.serial);
            if (key && !seenSerials.has(key)) {
              seenSerials.add(key);
              allRows.push(row);
            }
          }

          const result = await exportLocalToExcel(allRows, modeIsAlt(mode) ? 'Alt_Local' : 'Master_Local');
          if (result.success) {
            setStatus(`Exported ${result.count} scans (local, no QR images) — ${result.filename}`);
          } else {
            throw new Error(result.error);
          }
          setExporting(false);
          return;
        } else {
          setStatus('Export cancelled');
          setExporting(false);
          return;
        }
      } else if (flush.flushed > 0) {
        setStatus(`Flushed ${flush.flushed} local scans — exporting...`);
      } else {
        setStatus('No local queued scans — exporting server data...');
      }

      const resp = await fetch(api(endpoints.exportXlsxImages(mode)), { method: 'POST' });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(text || `HTTP ${resp.status}`);
      }
      const dispo = resp.headers.get('Content-Disposition') || '';
      const match = dispo.match(/filename="?([^"]+)"?/i);
      const filename = match?.[1] || `${modeIsAlt(mode) ? 'Alt_QR' : 'Master_QR'}_${Date.now()}.xlsx`;

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
    } finally {
      setExporting(false);
    }
  };

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
        const txt = await resp.text().catch(() => '');
        throw new Error(txt || `HTTP ${resp.status}`);
      }
      if (modeIsAlt(mode)) {
        setScansAlt([]);
        setTotalAlt(0);
        setCursorAlt(null);
      } else {
        setScansMain([]);
        setTotalMain(0);
        setCursorMain(null);
      }
      setStatus(`${mode.toUpperCase()} scans cleared`);
    } catch (e) {
      console.error(e);
      alert(`Failed to clear ${mode.toUpperCase()} scans: ${e.message || e}`);
      setStatus(`Failed to clear ${mode.toUpperCase()} scans`);
    }
  };

  if (showStart) {
    return (
      <div style={{ minHeight: '100vh', background: '#fff' }}>
        <div className="container" style={{ paddingTop: 24, paddingBottom: 24 }}>
          <StartPage
            onStartMain={() => {
              ensureAudioReady();
              setMode('main');
              setShowStart(false);
            }}
            onStartAlt={() => {
              ensureAudioReady();
              setMode('alt');
              setShowStart(false);
            }}
            onExportMain={() => exportXlsmForMode('main')}
            onExportAlt={() => exportXlsmForMode('alt')}
            onContinue={() => {
              ensureAudioReady();
              setMode('main');
              setShowStart(false);
            }}
            onStartScan={() => {
              ensureAudioReady();
              setMode('main');
              setShowStart(false);
            }}
            onExport={() => exportXlsmForMode('main')}
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
        <div
          className="container"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <div className="logo" />
            <div style={{ minWidth: 0 }}>
              <div className="title">
                Rail Inventory ({mode.toUpperCase()}){knownBadge}
              </div>
              <div className="status">{status}</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <OfflineIndicator
              isOnline={isOnline}
              pendingCount={totalPendingCount}
              isSyncing={isSyncing}
              onManualSync={handleManualSync}
            />

            <button className="btn btn-outline" onClick={() => setShowStart(true)}>
              Back to Start
            </button>

            <div
              className="btn-group"
              role="group"
              aria-label="mode"
              style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
            >
              <button
                className={`btn ${mode === 'main' ? '' : 'btn-outline'}`}
                onClick={() => setMode('main')}
                title="Switch to MAIN"
              >
                MAIN
                {pendingMainCount > 0 && (
                  <span
                    style={{
                      marginLeft: 4,
                      padding: '1px 5px',
                      borderRadius: 8,
                      background: '#f59e0b',
                      color: '#fff',
                      fontSize: 10,
                      fontWeight: 700,
                    }}
                  >
                    {pendingMainCount}
                  </span>
                )}
              </button>
              <button
                className={`btn ${mode === 'alt' ? '' : 'btn-outline'}`}
                onClick={() => setMode('alt')}
                title="Switch to ALT"
              >
                ALT
                {pendingAltCount > 0 && (
                  <span
                    style={{
                      marginLeft: 4,
                      padding: '1px 5px',
                      borderRadius: 8,
                      background: '#f59e0b',
                      color: '#fff',
                      fontSize: 10,
                      fontWeight: 700,
                    }}
                  >
                    {pendingAltCount}
                  </span>
                )}
              </button>
            </div>

            <button className="btn" onClick={toggleSound}>
              {soundOn ? '🔊 Mute' : '🔇 Unmute'}
            </button>
          </div>
        </div>
      </header>

      <div
        className="grid"
        style={{
          marginTop: 20,
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
        }}
      >
        <section className="card">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              flexWrap: 'wrap',
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

        <section className="card">
          <h3>Controls ({mode.toUpperCase()})</h3>
          <div
            className="controls-grid"
            style={{
              display: 'grid',
              gap: 12,
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            }}
          >
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
              <input className="input" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} />
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
            <button className="btn" onClick={confirmPending} disabled={!pending}>
              Confirm & Save
            </button>
            <button
              className="btn btn-outline"
              onClick={() => {
                setPending(null);
                setQrExtras({ grade: '', railType: '', spec: '', lengthM: '' });
                setStatus('Ready');
              }}
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

          <div style={{ marginTop: 16 }}>
            <button
              className="btn btn-outline"
              onClick={() => {
                setShowDamaged((v) => !v);
              }}
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
                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
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

        <section className="card">
          <h3>
            Staged Scans ({totalCount}) — {mode.toUpperCase()}
            {currentModePendingCount > 0 && (
              <span
                style={{
                  marginLeft: 8,
                  padding: '2px 8px',
                  borderRadius: 8,
                  background: '#f59e0b',
                  color: '#fff',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                +{currentModePendingCount} pending sync
              </span>
            )}
          </h3>
          <div className="list">
            {scans.map((s) => (
              <div
                key={s.id ?? `${s.serial}-${s.timestamp}`}
                className="row"
                data-serial={(s.serial || '').toString().trim().toUpperCase()}
                style={{
                  background:
                    flashSerial && (s.serial || '').toString().trim().toUpperCase() === flashSerial
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

                {s.destination && <div className="meta">Destination: {s.destination}</div>}

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

      <section className="card" style={{ marginTop: 20 }}>
        <h3 style={{ color: 'rgb(220,38,38)' }}>Danger Zone</h3>
        <div className="status" style={{ marginBottom: 12 }}>
          Clear all staged scans for the current mode. Password required.
        </div>
        <button
          className="btn btn-outline"
          onClick={clearAllForCurrentMode}
          title={`Clear all ${mode.toUpperCase()} scans (password required)`}
          style={{ borderColor: 'rgb(220,38,38)', color: 'rgb(220,38,38)' }}
        >
          Clear {mode.toUpperCase()} Scans
        </button>
      </section>

      <footer className="footer">
        <div className="footer-inner">
          <span>© {new Date().getFullYear()} Top Notch Solutions</span>
          <span className="tag">Rail Inventory • v1 • {mode.toUpperCase()}</span>
        </div>
      </footer>

      {removePrompt && (
        <div
          role="dialog"
          aria-modal="true"
          style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,.55)', display: 'grid', placeItems: 'center', zIndex: 50, padding: 16 }}
        >
          <div className="card" style={{ maxWidth: 520, width: '100%', border: '1px solid var(--line)', boxShadow: '0 20px 60px rgba(2,6,23,.35)' }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ width: 40, height: 40, borderRadius: 9999, display: 'grid', placeItems: 'center', background: 'rgba(220,38,38,.1)', color: 'rgb(220,38,38)', fontSize: 22 }}>⚠️</div>
              <div style={{ flex: 1 }}>
                <h3 style={{ margin: 0 }}>Are you sure?</h3>
                <div className="status" style={{ marginTop: 6 }}>
                  Remove this staged scan from the {mode.toUpperCase()} list?
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                  <button className="btn btn-outline" onClick={discardRemovePrompt}>Cancel</button>
                  <button className="btn" onClick={confirmRemoveScan}>Confirm</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {dupPrompt && (
        <div
          role="dialog"
          aria-modal="true"
          style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,.55)', display: 'grid', placeItems: 'center', zIndex: 50, padding: 16 }}
        >
          <div className="card" style={{ maxWidth: 560, width: '100%', border: '1px solid var(--line)', boxShadow: '0 20px 60px rgba(2,6,23,.35)' }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ width: 40, height: 40, borderRadius: 9999, display: 'grid', placeItems: 'center', background: 'rgba(251,191,36,.15)', color: 'rgb(202,138,4)', fontSize: 22 }}>⚠️</div>
              <div style={{ flex: 1 }}>
                <h3 style={{ margin: 0 }}>Duplicate detected</h3>
                <div className="status" style={{ marginTop: 6 }}>
                  The serial <strong>{dupPrompt.serial}</strong> already exists in the {mode.toUpperCase()} staged list ({dupPrompt.matches?.length ?? 1}).
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
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
