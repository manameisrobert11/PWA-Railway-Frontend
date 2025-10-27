// src/App.jsx
import React, { useEffect, useState, useRef, useMemo } from 'react';
import { socket } from './socket';
import Scanner from './scanner/Scanner.jsx';
import StartPage from './StartPage.jsx';
import './app.css';

const API_BASE = import.meta.env.VITE_API_BASE || '';
const api = (p) => {
  const path = p.startsWith('/') ? p : `/${p}`;
  return API_BASE ? `${API_BASE}${path}` : `/api${path}`;
};

// ---- QR parsing ----
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

  const [operator, setOperator] = useState('Clerk A');
  const [wagonId1, setWagonId1] = useState('');
  const [wagonId2, setWagonId2] = useState('');
  const [wagonId3, setWagonId3] = useState('');
  const [receivedAt, setReceivedAt] = useState('');
  const [loadedAt] = useState('WalvisBay');

  const [pending, setPending] = useState(null);
  const [qrExtras, setQrExtras] = useState({ grade: '', railType: '', spec: '', lengthM: '' });

  const [dupPrompt, setDupPrompt] = useState(null);
  const [removePrompt, setRemovePrompt] = useState(null);

  // Damaged QR manual entry
  const [damagedMode, setDamagedMode] = useState(false);
  const [manualSerial, setManualSerial] = useState('');

  // pagination
  const [totalCount, setTotalCount] = useState(0);
  const [nextCursor, setNextCursor] = useState(null);
  const PAGE_SIZE = 200;

  // socket ref
  const socketRef = useRef(null);

  // 🔧 Scanner restart key (force remount)
  const [scanKey, setScanKey] = useState(1);
  const restartScanner = () => {
    setScanKey(k => k + 1);
    setStatus('Scanner restarted');
  };

  // ---- SOUND: beep only on successful (non-duplicate) scan ----
  const beepRef = useRef(null);
  const audioPrimedRef = useRef(false);

  function ensureBeep() {
    try {
      if (!beepRef.current) {
        const dataUri = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABYBAGZkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZAA=';
        const a = new Audio();
        a.src = dataUri;
        a.preload = 'auto';
        beepRef.current = a;
      }
    } catch {}
  }
  useEffect(() => {
    const primeOnce = () => {
      if (audioPrimedRef.current) return;
      audioPrimedRef.current = true;
      ensureBeep();
      window.removeEventListener('pointerdown', primeOnce, true);
      window.removeEventListener('keydown', primeOnce, true);
    };
    window.addEventListener('pointerdown', primeOnce, true);
    window.addEventListener('keydown', primeOnce, true);
    return () => {
      window.removeEventListener('pointerdown', primeOnce, true);
      window.removeEventListener('keydown', primeOnce, true);
    };
  }, []);
  function playBeep() {
    try {
      ensureBeep();
      if (!beepRef.current) return;
      beepRef.current.currentTime = 0;
      const p = beepRef.current.play();
      if (p && typeof p.then === 'function') p.catch(() => {});
    } catch {}
  }

  // ---- initial load
  useEffect(() => {
    (async () => {
      try {
        const [countResp, pageResp] = await Promise.all([
          fetch(api('/staged/count')),
          fetch(api(`/staged?limit=${PAGE_SIZE}`))
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
        }));

        setScans(normalized);
        setTotalCount(countData.count ?? pageData.total ?? 0);
        setNextCursor(pageData.nextCursor ?? null);
      } catch (e) {
        console.error(e);
      }
    })();
  }, []);

  const loadMore = async () => {
    if (!nextCursor) return;
    const resp = await fetch(api(`/staged?limit=${PAGE_SIZE}&cursor=${nextCursor}`));
    const data = await resp.json().catch(()=>({rows:[], nextCursor:null}));

    const more = (data.rows || []).map((r) => ({
      ...r,
      wagonId1: r.wagonId1 ?? r.wagon1Id ?? '',
      wagonId2: r.wagonId2 ?? r.wagon2Id ?? '',
      wagonId3: r.wagonId3 ?? r.wagon3Id ?? '',
      receivedAt: r.receivedAt ?? r.recievedAt ?? '',
      loadedAt: r.loadedAt ?? '',
    }));

    setScans(prev => [...prev, ...more]);
    setNextCursor(data.nextCursor ?? null);
  };

  // ---- Auto-sync offline queue
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
          setTotalCount(c => c + payload.length);
          try {
            const pageResp = await fetch(api(`/staged?limit=${PAGE_SIZE}`));
            const pageData = await pageResp.json().catch(()=>({rows:[], nextCursor:null, total:0}));
            const normalized = (pageData.rows || []).map((r) => ({
              ...r,
              wagonId1: r.wagonId1 ?? r.wagon1Id ?? '',
              wagonId2: r.wagonId2 ?? r.wagon2Id ?? '',
              wagonId3: r.wagonId3 ?? r.wagon3Id ?? '',
              receivedAt: r.receivedAt ?? r.recievedAt ?? '',
              loadedAt: r.loadedAt ?? '',
            }));
            setScans(normalized);
            setNextCursor(pageData.nextCursor ?? null);
            setTotalCount(pageData.total ?? normalized.length);
          } catch {}
        }
      } catch (e) {
        console.warn('Offline queue flush failed:', e.message);
      }
    }
    window.addEventListener('online', flushQueue);
    flushQueue();
    return () => window.removeEventListener('online', flushQueue);
  }, []);

  // ---- Live sync via socket
  useEffect(() => {
    socketRef.current = socket;
    try { socket.connect(); } catch {}

    const onNew = (row) => {
      if (!row) return;
      setScans((prev) => {
        const hasId = row.id != null && prev.some((x) => String(x.id) === String(row.id));
        const hasSerial = row.serial && prev.some((x) =>
          String(x.serial).trim().toUpperCase() === String(row.serial).trim().toUpperCase()
        );
        if (hasId || hasSerial) return prev;
        return [{ ...row }, ...prev];
      });
      setTotalCount((c) => c + 1);
    };

    const onDeleted = ({ id }) => {
      if (id == null) return;
      setScans((prev) => {
        const before = prev.length;
        const next = prev.filter((x) => String(x.id) !== String(id));
        if (next.length !== before) {
          setTotalCount((c) => Math.max(0, c - 1));
          setStatus('Scan removed (synced)');
        }
        return next;
      });
    };

    const onCleared = () => {
      setScans([]);
      setTotalCount(0);
      setNextCursor(null);
      setStatus('All scans cleared (synced)');
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
  }, []);

  const scanSerialSet = useMemo(() => {
    const s = new Set();
    for (const r of scans) if (r?.serial) s.add(String(r.serial).trim().toUpperCase());
    return s;
  }, [scans]);

 
