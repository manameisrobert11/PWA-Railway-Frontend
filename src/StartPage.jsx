// StartPage.jsx
import React, { useEffect, useState } from 'react';

export default function StartPage({
  onStartMain,
  onStartAlt,
  onExportMain,
  onExportAlt,
  operator,
  setOperator,
}) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const timeStr = now.toLocaleTimeString(undefined, { hour12: false });
  const dateStr = now.toLocaleDateString(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  return (
    <div className="grid" style={{ gap: 20 }}>
      <section className="card" style={{ display: 'grid', gap: 14 }}>
        <h2 style={{ margin: 0 }}>
          Welcome to <span style={{ color: 'var(--accent)' }}>Rail Inventory</span>
        </h2>
        <div style={{ fontSize: 14, color: 'var(--muted)' }}>
          {dateStr} • <span style={{ fontVariantNumeric: 'tabular-nums' }}>{timeStr}</span>
        </div>

        {/* MAIN / ALT start buttons */}
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <button type="button" className="btn" onClick={onStartMain}>
            Start Scanning (MAIN)
          </button>
          <button type="button" className="btn btn-outline" onClick={onStartAlt}>
            Start Scanning (ALT)
          </button>
        </div>

        {/* Optional exports right from home */}
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <button type="button" className="btn btn-outline" onClick={onExportMain}>
            Export MAIN Excel (.xlsm)
          </button>
          <button type="button" className="btn btn-outline" onClick={onExportAlt}>
            Export ALT Excel (.xlsm)
          </button>
        </div>
      </section>

      <section className="card" style={{ display: 'grid', gap: 10 }}>
        <h3 style={{ margin: 0 }}>Quick Settings</h3>
        <div>
          <label className="status">Operator</label><br />
          <input
            className="input"
            value={operator}
            onChange={e => setOperator(e.target.value)}
            placeholder="Clerk A"
          />
        </div>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
          Tip: Set the operator here before you begin scanning.
        </p>
      </section>
    </div>
  );
}
