// src/scanner/Scanner.jsx
import React, { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType, NotFoundException } from '@zxing/library';

export default function Scanner({ onDetected, onUserInteract, fps = 10 }) {
  const videoRef = useRef(null);
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState('Idle');

  const readerRef = useRef(null);
  const streamRef = useRef(null);
  const mounted = useRef(false);

  // Manual decode loop handles
  const decodingRef = useRef(false);
  const loopTimerRef = useRef(null);
  const COOLDOWN_OK_MS = 800;     // after a success, pause briefly
  const SCAN_INTERVAL_MS = 120;   // how often to attempt a decode

  // Performance mode
  const [fastMode, setFastMode] = useState(true); // Fast (TRY_HARDER off) vs Accurate

  // Throttle duplicate result bursts
  const lastTextRef = useRef('');
  const lastAtRef = useRef(0);
  const THROTTLE_MS = 1000;

  // Camera controls
  const [hasTorch, setHasTorch] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  const [hasZoom, setHasZoom] = useState(false);
  const [zoomMin, setZoomMin] = useState(1);
  const [zoomMax, setZoomMax] = useState(1);
  const [zoom, setZoom] = useState(1);

  const [hasExposureComp, setHasExposureComp] = useState(false);
  const [expMin, setExpMin] = useState(0);
  const [expMax, setExpMax] = useState(0);
  const [expStep, setExpStep] = useState(1);
  const [exposure, setExposure] = useState(0);

  const stopStream = () => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => { try { t.stop(); } catch {} });
        streamRef.current = null;
      }
    } catch {}
  };

  const safeResetReader = () => {
    try { readerRef.current?.reset?.(); } catch {}
  };

  const buildHints = (fast) => {
    try {
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]);
      // Fast mode: turn off TRY_HARDER (major speed boost on clean codes)
      if (!fast) hints.set(DecodeHintType.TRY_HARDER, true); // only in Accurate mode
      // Optional: if your QR is always “pure”, uncomment for another speed bump
      // hints.set(DecodeHintType.PURE_BARCODE, true);
      return hints;
    } catch {
      return undefined;
    }
  };

  useEffect(() => {
    mounted.current = true;
    readerRef.current = new BrowserMultiFormatReader(buildHints(fastMode));
    return () => {
      mounted.current = false;
      clearInterval(loopTimerRef.current);
      safeResetReader();
      stopStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rebuild hints when mode changes
  useEffect(() => {
    try {
      readerRef.current = new BrowserMultiFormatReader(buildHints(fastMode));
      setStatus((s) => `${s.split(' | ')[0]} | Mode: ${fastMode ? 'Fast' : 'Accurate'}`);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fastMode]);

  async function pickRearDeviceId() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videos = devices.filter((d) => d.kind === 'videoinput');
      if (videos.length === 0) return undefined;
      const rear =
        videos.find((d) => /rear|back|environment/i.test(d.label)) ||
        videos.find((d) => d.label?.toLowerCase?.().includes('wide')) ||
        videos[0];
      return rear?.deviceId;
    } catch {
      return undefined;
    }
  }

  async function applyTrackEnhancements(track) {
    if (!track?.applyConstraints) return;

    const caps = track.getCapabilities?.() || {};
    const settings = track.getSettings?.() || {};

    try {
      await track.applyConstraints({
        advanced: [
          { focusMode: 'continuous' },
          { exposureMode: 'continuous' },
          { whiteBalanceMode: 'continuous' },
        ],
      });
    } catch {}

    // Torch
    if (typeof caps.torch === 'boolean') {
      setHasTorch(true);
      try { await track.applyConstraints({ advanced: [{ torch: false }] }); } catch {}
    } else {
      setHasTorch(false);
    }

    // Zoom
    const zoomCaps = caps.zoom;
    if (typeof zoomCaps === 'number' || (zoomCaps && typeof zoomCaps.min === 'number')) {
      const min = (zoomCaps.min ?? 1);
      const max = (zoomCaps.max ?? Math.max(1, settings.zoom || 1));
      setHasZoom(true);
      setZoomMin(min);
      setZoomMax(max);

      const initialZoom = Math.min(max, Math.max(min, (settings.zoom || min) * 1.35));
      setZoom(initialZoom);
      try { await track.applyConstraints({ advanced: [{ zoom: initialZoom }] }); } catch {}
    } else {
      setHasZoom(false);
    }

    // Exposure compensation
    const expCaps = caps.exposureCompensation;
    if (expCaps && (typeof expCaps.min === 'number' || typeof expCaps.max === 'number')) {
      const { min = -2, max = 2, step = 1 } = expCaps;
      setHasExposureComp(true);
      setExpMin(min);
      setExpMax(max);
      setExpStep(step);
      setExposure(settings.exposureCompensation ?? 0);
    } else {
      setHasExposureComp(false);
    }
  }

  const startScanner = async () => {
    try { onUserInteract && onUserInteract(); } catch {}

    if (!navigator.mediaDevices?.getUserMedia) {
      alert('Camera API not supported');
      return;
    }

    setStatus('Starting camera...');
    try {
      const deviceId = await pickRearDeviceId();
      // ↓ Use 1280×720; often faster than 1080p to decode.
      const constraints = {
        video: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          facingMode: deviceId ? undefined : { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          aspectRatio: { ideal: 16 / 9 },
          frameRate: { ideal: 24 }, // 24 is enough and reduces CPU burn
        },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (!mounted.current) return;
      streamRef.current = stream;

      const track = stream.getVideoTracks?.()[0];
      await applyTrackEnhancements(track);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsInline', 'true');
        videoRef.current.setAttribute('muted', 'true');
        await videoRef.current.play().catch(() => {});
      }
      setActive(true);
      setStatus(`Scanning... | Mode: ${fastMode ? 'Fast' : 'Accurate'}`);

      // Kick off manual decode loop
      clearInterval(loopTimerRef.current);
      loopTimerRef.current = setInterval(async () => {
        if (!mounted.current || !active) return;
        if (decodingRef.current) return; // skip if a decode is running
        decodingRef.current = true;
        try {
          // Single-shot decode on current video frame
          const result = await readerRef.current.decodeOnceFromVideoElement(videoRef.current);
          if (result) {
            const text = result.getText ? result.getText() : result.text;
            if (text) {
              const now = Date.now();
              if (!(text === lastTextRef.current && now - lastAtRef.current < THROTTLE_MS)) {
                lastTextRef.current = text;
                lastAtRef.current = now;
                try { onDetected && onDetected(text); } catch {}
                // pause a moment after a successful scan
                await new Promise(r => setTimeout(r, COOLDOWN_OK_MS));
              }
            }
          }
        } catch (err) {
          // NotFoundException = no code in this frame -> ignore silently
          if (!(err instanceof NotFoundException)) {
            // Other errors: log lightly in dev
            // console.debug('decode error', err?.message || err);
          }
        } finally {
          decodingRef.current = false;
        }
      }, SCAN_INTERVAL_MS);
    } catch (err) {
      console.error('Camera access error:', err);
      alert('Unable to access camera');
      setStatus('Error starting camera');
    }
  };

  const stopScanner = () => {
    setActive(false);
    clearInterval(loopTimerRef.current);
    decodingRef.current = false;
    setStatus('Stopped');
    safeResetReader();
    stopStream();
  };

  const toggleTorch = async () => {
    try {
      const track = streamRef.current?.getVideoTracks?.()[0];
      if (!track || !track.applyConstraints) return;
      const next = !torchOn;
      await track.applyConstraints({ advanced: [{ torch: next }] });
      setTorchOn(next);
    } catch (e) {
      console.warn('Torch not supported:', e?.message);
    }
  };

  const onZoomChange = async (v) => {
    const val = parseFloat(v);
    setZoom(val);
    try {
      const track = streamRef.current?.getVideoTracks?.()[0];
      if (!track?.applyConstraints) return;
      await track.applyConstraints({ advanced: [{ zoom: val }] });
    } catch (e) {
      console.warn('Zoom not supported:', e?.message);
    }
  };

  const onExposureChange = async (v) => {
    const val = parseFloat(v);
    setExposure(val);
    try {
      const track = streamRef.current?.getVideoTracks?.()[0];
      if (!track?.applyConstraints) return;
      await track.applyConstraints({ advanced: [{ exposureCompensation: val }] });
    } catch (e) {
      console.warn('Exposure compensation not supported:', e?.message);
    }
  };

  const onVideoClick = async () => {
    try {
      const track = streamRef.current?.getVideoTracks?.()[0];
      if (!track?.applyConstraints) return;
      await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
    } catch {}
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="status" style={{ fontSize: 12, opacity: 0.8 }}>{status}</div>

      <video
        ref={videoRef}
        style={{ width: '100%', borderRadius: 8, background: '#000' }}
        muted
        playsInline
        autoPlay
        onClick={onVideoClick}
      />

      {/* Controls */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <button
          className={`btn ${fastMode ? '' : 'btn-outline'}`}
          onClick={() => setFastMode(true)}
          title="Faster on clean codes"
        >
          Fast
        </button>
        <button
          className={`btn ${!fastMode ? '' : 'btn-outline'}`}
          onClick={() => setFastMode(false)}
          title="More tolerant on damaged/low-contrast codes"
        >
          Accurate
        </button>

        {hasTorch && (
          <button className="btn btn-outline" onClick={toggleTorch}>
            {torchOn ? 'Torch Off' : 'Torch On'}
          </button>
        )}

        {hasZoom && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <label className="status" style={{ minWidth: 44 }}>Zoom</label>
            <input
              type="range"
              min={zoomMin}
              max={zoomMax}
              step="0.1"
              value={zoom}
              onChange={(e) => onZoomChange(e.target.value)}
            />
            <span className="status">{zoom.toFixed(1)}×</span>
          </div>
        )}

        {hasExposureComp && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <label className="status" style={{ minWidth: 70 }}>Exposure</label>
            <input
              type="range"
              min={expMin}
              max={expMax}
              step={expStep || 1}
              value={exposure}
              onChange={(e) => onExposureChange(e.target.value)}
            />
            <span className="status">{exposure}</span>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        {!active ? (
          <button
            className="btn"
            onClick={startScanner}
            onPointerDown={onUserInteract}
            onKeyDown={onUserInteract}
          >
            Start Scanner
          </button>
        ) : (
          <button className="btn btn-outline" onClick={stopScanner}>Stop Scanner</button>
        )}
      </div>

      <div className="status" style={{ fontSize: 11, opacity: 0.7 }}>
        Tips: good light (Torch), get closer, use Zoom a bit. “Fast” mode is quickest; switch to “Accurate” for tough codes.
      </div>
    </div>
  );
}
