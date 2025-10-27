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
  const [showStart, setShowStart] = useState(false); // you said you're not using start page

  const [operator, setOperator] = useState('Clerk A');
  const [wagonId1, setWagonId1] = useState('');
  const [wagonId2, setWagonId2] = useState('');
  const [wagonId3, setWagonId3] = useState('');
  const [receivedAt, setReceivedAt] = useState('');
  const [loadedAt] = useState('WalvisBay'); // static

  const [pending, setPending] = useState(null);
  const [qrExtras, setQrExtras] = useState({ grade: '', railType: '', spec: '', lengthM: '' });

  const [dupPrompt, setDupPrompt] = useState(null);
  const [removePrompt, setRemovePrompt] = useState(null);

  // Manual entry (Damaged QR)
  const [manualSerial, setManualSerial] = useState('');
  const [manualGrade, setManualGrade] = useState('');
  const [manualRailType, setManualRailType] = useState('');
  const [manualSpec, setManualSpec] = useState('');
  const [manualLength, setManualLength] = useState('');

  // pagination + total count
  const [totalCount, setTotalCount] = useState(0);
  const [nextCursor, setNextCursor] = useState(null);
  const PAGE_SIZE = 200;

  // Socket ref
  const socketRef = useRef(null);

  // ----- Audio (beep only on successful QR scan) -----
  const beepRef = useRef(null);
  const audioUnlockedRef = useRef(false);

  const ensureBeep = (hz = 1500) => {
    try {
      if (!beepRef.current) {
        // short click-like wav
        const dataUri = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABYBAGZkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZGRkZAA=';
        const audio = new Audio();
        audio.src = dataUri;
        audio.preload = 'auto';
        beepRef.current = audio;
      }
      // Playback rate nudged by freq
      beepRef.current.playbackRate = Math.max(0.75, Math.min(2, hz / 1500));
      beepRef.current.currentTime = 0;
      const p = beepRef.current.play();
      if (p && typeof p.then === 'function') p.catch(() => {});
    } catch {}
  };

  const unlockAudio = () => {
    if (audioUnlockedRef.current) return;
    try {
      ensureBeep(1200); // attempt on gesture
      audioUnlockedRef.current = true;
    } catch {}
  };

  // initial load: total count + first page
  useEffect(() => {
    (async () => {
      try {
        const [countResp, pageResp] = await Promise.all([
          fetch(api('/staged/count')),
          fetch(api(`/staged?limit=${PAGE_SIZE}`))
        ]);
        const countData = await countResp.json().catch(()=>({count:0}));
        const pageData = await pageResp.json().catch(()=>({rows:[], nextCursor:null, total:0}));

        // normalize keys
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

  // Auto-sync offline queue when online
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
          // pull fresh page
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

  // Live sync via shared Socket.IO client
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
      setScans([]); setTotalCount(0); setNextCursor(null);
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

  // Fast membership helper
  const scanSerialSet = useMemo(() => {
    const s = new Set();
    for (const r of scans) if (r?.serial) s.add(String(r.serial).trim().toUpperCase());
    return s;
  }, [scans]);

  const findDuplicates = (serial) => {
    const key = String(serial || '').trim().toUpperCase();
    if (!key) return [];
    return scans.filter((r) => String(r.serial || '').trim().toUpperCase() === key);
  };

  // ---- QR SCAN HANDLER (beep only here) ----
  const onDetected = (rawText) => {
    const parsed = parseQrPayload(rawText);
    const serial = parsed.serial || rawText;

    if (serial) {
      const matches = findDuplicates(serial);
      if (matches.length > 0) {
        // Duplicate always shows prompt
        setDupPrompt({
          serial: String(serial).toUpperCase(),
          matches,
          candidate: {
            pending: {
              serial: String(serial).toUpperCase(),
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
        setStatus('Duplicate detected — awaiting decision');
        // successful scan still happened -> beep
        ensureBeep(1500);
        return;
      }
    }

    // Successful new scan -> beep
    ensureBeep(1500);

    setPending({
      serial: parsed.serial || rawText,
      raw: parsed.raw || String(rawText),
      capturedAt: new Date().toISOString(),
    });
    setQrExtras({
      grade: parsed.grade || '',
      railType: parsed.railType || '',
      spec: parsed.spec || '',
      lengthM: parsed.lengthM || '',
    });
    setStatus('Captured — review & Confirm');
  };

  const onUserInteract = () => {
    unlockAudio(); // called by Scanner when Start Scanner is tapped
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
      const resp = await fetch(api(`/staged/${removePrompt}`), { method: 'DELETE' });
      if (!resp.ok) throw new Error(await resp.text().catch(() => 'Failed to remove scan'));
      setScans((prev) => prev.filter((scan) => scan.id !== removePrompt));
      setTotalCount(c => Math.max(0, c - 1));
      setRemovePrompt(null);
      setStatus('Scan removed successfully');
    } catch (e) {
      console.error(e);
      alert(e.message || 'Failed to remove scan');
      setRemovePrompt(null);
    }
  };
  const discardRemovePrompt = () => setRemovePrompt(null);

  const confirmPending = async () => {
    if (!pending?.serial || !String(pending.serial).trim()) {
      alert('Nothing to save yet. Scan a QR first. If it is damaged, use “Save Damaged QR”.');
      return;
    }

    const rec = {
      serial: String(pending.serial).trim(),
      stage: 'received',
      operator,
      wagon1Id: wagonId1,
      wagon2Id: wagonId2,
      wagon3Id: wagonId3,
      receivedAt,
      loadedAt,
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
      const data = await resp.json().catch(()=>null);
      if (!resp.ok) throw new Error(data?.error || `HTTP ${resp.status}`);

      const newId = data?.id || Date.now();
      setScans((prev) => [{ id: newId, ...rec }, ...prev]);
      setTotalCount(c => c + 1);

      setPending(null);
      setQrExtras({ grade: '', railType: '', spec: '', lengthM: '' });
      setStatus('Saved to staged');
    } catch (e) {
      // Offline/failed: queue to IndexedDB for later
      await idbAdd({ payload: rec });
      setScans((prev) => [{ id: Date.now(), ...rec }, ...prev]);
      setTotalCount(c => c + 1);
      setPending(null);
      setQrExtras({ grade: '', railType: '', spec: '', lengthM: '' });
      setStatus('Saved locally (offline) — will sync');
    }
  };

  // Save Damaged QR (manual)
  const saveDamaged = async () => {
    if (!manualSerial.trim()) {
      alert('Unable to save: enter Serial or scan a QR.');
      return;
    }

    const rec = {
      serial: manualSerial.trim(),
      stage: 'received',
      operator,
      wagon1Id: wagonId1,
      wagon2Id: wagonId2,
      wagon3Id: wagonId3,
      receivedAt,
      loadedAt,
      timestamp: new Date().toISOString(),
      grade: manualGrade.trim(),
      railType: manualRailType.trim(),
      spec: manualSpec.trim(),
      lengthM: manualLength.trim(),
      qrRaw: manualSerial.trim(), // fallback
    };

    // If duplicate, warn (but allow save)
    const matches = findDuplicates(rec.serial);
    if (matches.length > 0 && !confirm(`Duplicate found (${matches.length}) — Save anyway?`)) {
      return;
    }

    try {
      const resp = await fetch(api('/scan'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rec),
      });
      const data = await resp.json().catch(()=>null);
      if (!resp.ok) throw new Error(data?.error || `HTTP ${resp.status}`);

      const newId = data?.id || Date.now();
      setScans((prev) => [{ id: newId, ...rec }, ...prev]);
      setTotalCount((c) => c + 1);

      // clear manual fields
      setManualSerial('');
      setManualGrade('');
      setManualRailType('');
      setManualSpec('');
      setManualLength('');
      setStatus('Damaged QR saved');
    } catch (e) {
      await idbAdd({ payload: rec });
      setScans((prev) => [{ id: Date.now(), ...rec }, ...prev]);
      setTotalCount((c) => c + 1);
      setManualSerial('');
      setManualGrade('');
      setManualRailType('');
      setManualSpec('');
      setManualLength('');
      setStatus('Damaged QR saved locally (offline) — will sync');
    }
  };

  // ---------- RENDER ----------
  return (
    <div className="container" style={{ paddingTop: 20, paddingBottom: 20 }}>
      <header className="app-header">
        <div className="container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="logo" />
            <div>
              <div className="title">Rail Inventory</div>
              <div className="status">{status}</div>
            </div>
          </div>
        </div>
      </header>

      <div className="grid" style={{ marginTop: 20 }}>
        {/* Scanner */}
        <section className="card">
          <h3>Scanner</h3>
          <Scanner onDetected={onDetected} onUserInteract={onUserInteract} />
          {pending && (
            <div className="notice" style={{ marginTop: 10 }}>
              <div><strong>Pending Serial:</strong> {pending.serial}</div>
              <div className="meta">Captured at: {new Date(pending.capturedAt).toLocaleString()}</div>
            </div>
          )}
        </section>

        {/* Controls + Manual Entry */}
        <section className="card">
          <h3>Controls & Manual (Damaged QR)</h3>

          {/* Operator / Wagon / Locations */}
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

          {/* Actions (QR path) */}
          <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" onClick={confirmPending} disabled={!pending}>Confirm & Save</button>
            <button
              className="btn btn-outline"
              onClick={() => { setPending(null); setQrExtras({ grade: '', railType: '', spec: '', lengthM: '' }); setStatus('Ready'); }}
            >
              Discard
            </button>
          </div>

          <hr style={{ margin: '16px 0', borderColor: 'var(--border)' }} />

          {/* Manual Entry for Damaged QR */}
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <div>
              <label className="status">Serial (Damaged QR)</label>
              <input className="input" value={manualSerial} onChange={(e) => setManualSerial(e.target.value)} placeholder="Enter serial manually" />
            </div>
            <div>
              <label className="status">Rail Type</label>
              <input className="input" value={manualRailType} onChange={(e) => setManualRailType(e.target.value)} placeholder="e.g. R260HT" />
            </div>
            <div>
              <label className="status">Grade</label>
              <input className="input" value={manualGrade} onChange={(e) => setManualGrade(e.target.value)} placeholder="e.g. SAR50" />
            </div>
            <div>
              <label className="status">Spec</label>
              <input className="input" value={manualSpec} onChange={(e) => setManualSpec(e.target.value)} placeholder="e.g. AREMA 2020" />
            </div>
            <div>
              <label className="status">Length</label>
              <input className="input" value={manualLength} onChange={(e) => setManualLength(e.target.value)} placeholder="e.g. 12m" />
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <button className="btn" onClick={saveDamaged}>Save Damaged QR</button>
          </div>
        </section>

        {/* Staged Scans */}
        <section className="card">
          <h3>Staged Scans ({totalCount})</h3>
          <div className="list">
            {scans.map((s) => (
              <div key={s.id ?? `${s.serial}-${s.timestamp}`} className="row">
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
        <div role="dialog" aria-modal="true"
          style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,.55)', display: 'grid', placeItems: 'center', zIndex: 50, padding: 16 }}>
          <div className="card" style={{ maxWidth: 520, width: '100%', border: '1px solid var(--border)', boxShadow: '0 20px 60px rgba(2,6,23,.35)' }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ width: 40, height: 40, borderRadius: 9999, display: 'grid', placeItems: 'center', background: 'rgba(220,38,38,.1)', color: 'rgb(220,38,38)', fontSize: 22 }}>⚠️</div>
              <div style={{ flex: 1 }}>
                <h3 style={{ margin: 0 }}>Are you sure?</h3>
                <div className="status" style={{ marginTop: 6 }}>Remove this staged scan?</div>
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
        <div role="dialog" aria-modal="true"
          style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,.55)', display: 'grid', placeItems: 'center', zIndex: 50, padding: 16 }}>
          <div className="card" style={{ maxWidth: 560, width: '100%', border: '1px solid var(--border)', boxShadow: '0 20px 60px rgba(2,6,23,.35)' }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ width: 40, height: 40, borderRadius: 9999, display: 'grid', placeItems: 'center', background: 'rgba(251,191,36,.15)', color: 'rgb(202,138,4)', fontSize: 22 }}>⚠️</div>
              <div style={{ flex: 1 }}>
                <h3 style={{ margin: 0 }}>Duplicate detected</h3>
                <div className="status" style={{ marginTop: 6 }}>
                  The serial <strong>{dupPrompt.serial}</strong> already exists in the staged list ({dupPrompt.matches.length}).
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
