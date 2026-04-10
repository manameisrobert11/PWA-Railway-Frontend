// StartPage.jsx — Mobile-friendly dashboard start page
import React, { useEffect, useState, useMemo } from 'react';

// Simple bar chart component
function BarChart({ data, title, color = 'var(--blue)' }) {
  const safeData = Array.isArray(data) ? data : [];
  const maxValue = Math.max(...safeData.map((d) => d.value), 1);

  return (
    <div style={{ marginTop: 8 }}>
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          marginBottom: 8,
          color: 'var(--muted)',
        }}
      >
        {title}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {safeData.slice(0, 6).map((item, idx) => (
          <div
            key={idx}
            style={{
              display: 'grid',
              gridTemplateColumns: '64px 1fr 34px',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <div
              style={{
                fontSize: 12,
                color: 'var(--muted)',
                textOverflow: 'ellipsis',
                overflow: 'hidden',
                whiteSpace: 'nowrap',
              }}
            >
              {item.label}
            </div>

            <div
              style={{
                height: 18,
                background: 'var(--line)',
                borderRadius: 999,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${(item.value / maxValue) * 100}%`,
                  height: '100%',
                  background: color,
                  borderRadius: 999,
                  transition: 'width 0.5s ease',
                }}
              />
            </div>

            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                textAlign: 'right',
                color: 'var(--ink)',
              }}
            >
              {item.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Mini line chart
function TrendChart({ data, color = 'var(--blue)' }) {
  if (!data || data.length < 2) return null;

  const maxVal = Math.max(...data, 1);
  const minVal = Math.min(...data, 0);
  const range = maxVal - minVal || 1;
  const height = 42;
  const width = 120;

  const points = data
    .map((val, idx) => {
      const x = (idx / (data.length - 1)) * width;
      const y = height - ((val - minVal) / range) * height;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg width={width} height={height} style={{ display: 'block', flexShrink: 0 }}>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StatCard({ label, value, subValue, trend, color = 'var(--blue)', icon }) {
  const trendUp = trend > 0;
  const trendDown = trend < 0;

  return (
    <div
      className="card"
      style={{
        padding: 14,
        minWidth: 155,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 8,
        }}
      >
        <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 600 }}>{label}</span>
        {icon && <span style={{ fontSize: 18, lineHeight: 1 }}>{icon}</span>}
      </div>

      <div style={{ fontSize: 24, fontWeight: 800, color, lineHeight: 1.05 }}>{value}</div>

      {(subValue || trend !== undefined) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12 }}>
          {trend !== undefined && trend !== 0 && (
            <span
              style={{
                color: trendUp ? '#22c55e' : trendDown ? '#ef4444' : 'var(--muted)',
                fontWeight: 700,
              }}
            >
              {trendUp ? '↑' : '↓'} {Math.abs(trend)}%
            </span>
          )}
          {subValue && <span style={{ color: 'var(--muted)' }}>{subValue}</span>}
        </div>
      )}
    </div>
  );
}

function DonutChart({ mainCount, altCount }) {
  const total = mainCount + altCount || 1;
  const mainPct = (mainCount / total) * 100;
  const altPct = (altCount / total) * 100;

  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const mainStroke = (mainPct / 100) * circumference;
  const altStroke = (altPct / 100) * circumference;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        flexWrap: 'wrap',
      }}
    >
      <svg width="88" height="88" viewBox="0 0 88 88" style={{ flexShrink: 0 }}>
        <circle cx="44" cy="44" r={radius} fill="none" stroke="var(--line)" strokeWidth="10" />
        <circle
          cx="44"
          cy="44"
          r={radius}
          fill="none"
          stroke="var(--blue)"
          strokeWidth="10"
          strokeDasharray={`${mainStroke} ${circumference}`}
          strokeLinecap="round"
          transform="rotate(-90 44 44)"
          style={{ transition: 'stroke-dasharray 0.5s ease' }}
        />
        <circle
          cx="44"
          cy="44"
          r={radius}
          fill="none"
          stroke="#f59e0b"
          strokeWidth="10"
          strokeDasharray={`${altStroke} ${circumference}`}
          strokeDashoffset={-mainStroke}
          strokeLinecap="round"
          transform="rotate(-90 44 44)"
          style={{ transition: 'stroke-dasharray 0.5s ease' }}
        />
        <text
          x="44"
          y="44"
          textAnchor="middle"
          dy="0.35em"
          fontSize="15"
          fontWeight="800"
          fill="var(--ink)"
        >
          {total}
        </text>
      </svg>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 12, height: 12, borderRadius: 3, background: 'var(--blue)' }} />
          <span style={{ fontSize: 13 }}>
            MAIN: <strong>{mainCount}</strong> ({mainPct.toFixed(0)}%)
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 12, height: 12, borderRadius: 3, background: '#f59e0b' }} />
          <span style={{ fontSize: 13 }}>
            ALT: <strong>{altCount}</strong> ({altPct.toFixed(0)}%)
          </span>
        </div>
      </div>
    </div>
  );
}

function ActivityItem({ scan }) {
  const timeAgo = (date) => {
    const now = new Date();
    const diff = Math.floor((now - new Date(date)) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 0',
        borderBottom: '1px solid var(--line)',
      }}
    >
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: 10,
          background: 'var(--blue)',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 13,
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        {(scan.operator || 'U')[0].toUpperCase()}
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            textOverflow: 'ellipsis',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
          }}
        >
          {scan.serial}
        </div>
        <div
          style={{
            fontSize: 12,
            color: 'var(--muted)',
            textOverflow: 'ellipsis',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
          }}
        >
          {scan.operator} • {scan.destination || scan.loadedAt || 'No destination'}
        </div>
      </div>

      <div style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>
        {timeAgo(scan.timestamp)}
      </div>
    </div>
  );
}

const API_BASE = import.meta.env.VITE_API_BASE || '';
const api = (p) => {
  const path = p.startsWith('/') ? p : `/${p}`;
  if (API_BASE) {
    if (API_BASE.endsWith('/api')) return `${API_BASE}${path}`;
    return `${API_BASE}/api${path}`;
  }
  return `/api${path}`;
};

export default function StartPage({
  onStartMain,
  onStartAlt,
  onExportMain,
  onExportAlt,
  operator,
  setOperator,
  onOpenAdmin,
}) {
  const [now, setNow] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    mainTotal: 0,
    altTotal: 0,
    mainScans: [],
    altScans: [],
  });

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    async function fetchStats() {
      setLoading(true);
      try {
        const [mainCountRes, altCountRes, mainScansRes, altScansRes] = await Promise.all([
          fetch(api('/staged/count')),
          fetch(api('/staged-alt/count')),
          fetch(api('/staged?limit=500')),
          fetch(api('/staged-alt?limit=500')),
        ]);

        const mainCount = await mainCountRes.json().catch(() => ({ count: 0 }));
        const altCount = await altCountRes.json().catch(() => ({ count: 0 }));
        const mainScans = await mainScansRes.json().catch(() => ({ rows: [] }));
        const altScans = await altScansRes.json().catch(() => ({ rows: [] }));

        setStats({
          mainTotal: mainCount.count || 0,
          altTotal: altCount.count || 0,
          mainScans: mainScans.rows || [],
          altScans: altScans.rows || [],
        });
      } catch (e) {
        console.error('Failed to fetch stats:', e);
      } finally {
        setLoading(false);
      }
    }

    fetchStats();
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, []);

  const analytics = useMemo(() => {
    const allScans = [...stats.mainScans, ...stats.altScans];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);

    const monthAgo = new Date(today);
    monthAgo.setMonth(monthAgo.getMonth() - 1);

    const todayScans = allScans.filter((s) => new Date(s.timestamp) >= today);
    const weekScans = allScans.filter((s) => new Date(s.timestamp) >= weekAgo);
    const monthScans = allScans.filter((s) => new Date(s.timestamp) >= monthAgo);

    const twoWeeksAgo = new Date(weekAgo);
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 7);

    const prevWeekScans = allScans.filter((s) => {
      const d = new Date(s.timestamp);
      return d >= twoWeeksAgo && d < weekAgo;
    });

    const weekTrend =
      prevWeekScans.length > 0
        ? Math.round(((weekScans.length - prevWeekScans.length) / prevWeekScans.length) * 100)
        : 0;

    const byOperator = {};
    allScans.forEach((s) => {
      const op = s.operator || 'Unknown';
      byOperator[op] = (byOperator[op] || 0) + 1;
    });
    const operatorData = Object.entries(byOperator)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);

    const byRailType = {};
    allScans.forEach((s) => {
      const rt = s.railType || 'Unknown';
      byRailType[rt] = (byRailType[rt] || 0) + 1;
    });
    const railTypeData = Object.entries(byRailType)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);

    const byGrade = {};
    allScans.forEach((s) => {
      const g = s.grade || 'Unknown';
      byGrade[g] = (byGrade[g] || 0) + 1;
    });
    const gradeData = Object.entries(byGrade)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);

    const dailyTrend = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const nextD = new Date(d);
      nextD.setDate(nextD.getDate() + 1);

      const count = allScans.filter((s) => {
        const sd = new Date(s.timestamp);
        return sd >= d && sd < nextD;
      }).length;

      dailyTrend.push(count);
    }

    const recentScans = [...allScans]
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 5);

    const byDestination = {};
    allScans.forEach((s) => {
      const dest = s.destination || 'Not set';
      byDestination[dest] = (byDestination[dest] || 0) + 1;
    });
    const destinationData = Object.entries(byDestination)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);

    return {
      total: allScans.length,
      todayCount: todayScans.length,
      weekCount: weekScans.length,
      monthCount: monthScans.length,
      weekTrend,
      operatorData,
      railTypeData,
      gradeData,
      dailyTrend,
      recentScans,
      destinationData,
    };
  }, [stats]);

  const timeStr = now.toLocaleTimeString(undefined, { hour12: false });
  const dateStr = now.toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  const mobileTwoCol = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
    gap: 10,
  };

  const dashboardGrid = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: 14,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Hero */}
      <section className="card" style={{ display: 'grid', gap: 12, padding: 20 }}>
        <div>
          <h2 style={{ margin: 0, lineHeight: 1.15, fontSize: 24 }}>
            Welcome to <span style={{ color: 'var(--blue)' }}>Rail Inventory</span>
          </h2>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6 }}>
            {dateStr} • <span style={{ fontVariantNumeric: 'tabular-nums' }}>{timeStr}</span>
          </div>
        </div>

        <div style={mobileTwoCol}>
          <button type="button" className="btn" onClick={onStartMain}>
            Start MAIN
          </button>
          <button type="button" className="btn btn-outline" onClick={onStartAlt}>
            Start ALT
          </button>
        </div>

        <div style={mobileTwoCol}>
          <button type="button" className="btn btn-outline" onClick={onExportMain}>
            Export MAIN
          </button>
          <button type="button" className="btn btn-outline" onClick={onExportAlt}>
            Export ALT
          </button>
        </div>
      </section>

      {/* Quick settings */}
      <section className="card" style={{ display: 'grid', gap: 10, padding: 20 }}>
        <h3 style={{ margin: 0 }}>Quick Settings</h3>
        <div>
          <label className="status">Operator</label>
          <br />
          <input
            className="input"
            value={operator}
            onChange={(e) => setOperator(e.target.value)}
            placeholder="Clerk A"
            autoComplete="name"
          />
        </div>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
          Tip: Set the operator here before you begin scanning.
        </p>
      </section>

      {/* Stats row */}
      <div
        style={{
          display: 'flex',
          gap: 10,
          overflowX: 'auto',
          paddingBottom: 2,
          scrollbarWidth: 'thin',
        }}
      >
        <StatCard label="Total" value={loading ? '...' : analytics.total} icon="📊" color="var(--blue)" />
        <StatCard label="Today" value={loading ? '...' : analytics.todayCount} icon="📅" color="#22c55e" />
        <StatCard
          label="This Week"
          value={loading ? '...' : analytics.weekCount}
          trend={analytics.weekTrend}
          subValue="vs last week"
          icon="📈"
          color="#3b82f6"
        />
        <StatCard label="Month" value={loading ? '...' : analytics.monthCount} icon="🗓️" color="#8b5cf6" />
      </div>

      {/* Important analytics first */}
      <div style={dashboardGrid}>
        <section className="card" style={{ padding: 20 }}>
          <h3 style={{ margin: '0 0 14px 0', fontSize: 15 }}>MAIN vs ALT</h3>
          {loading ? (
            <div style={{ color: 'var(--muted)', fontSize: 14 }}>Loading...</div>
          ) : (
            <DonutChart mainCount={stats.mainTotal} altCount={stats.altTotal} />
          )}
        </section>

        <section className="card" style={{ padding: 20 }}>
          <h3 style={{ margin: '0 0 8px 0', fontSize: 15 }}>7-Day Trend</h3>
          {loading ? (
            <div style={{ color: 'var(--muted)', fontSize: 14 }}>Loading...</div>
          ) : (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                flexWrap: 'wrap',
                marginBottom: 8,
              }}
            >
              <TrendChart data={analytics.dailyTrend} />
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                {analytics.dailyTrend.reduce((a, b) => a + b, 0)} scans in 7 days
              </div>
            </div>
          )}

          <BarChart data={analytics.operatorData} title="By Operator" color="var(--blue)" />
        </section>
      </div>

      {/* Recent activity higher up for mobile usefulness */}
      <section className="card" style={{ padding: 20 }}>
        <h3 style={{ margin: '0 0 12px 0', fontSize: 15 }}>Recent Activity</h3>
        {loading ? (
          <div style={{ color: 'var(--muted)', fontSize: 14 }}>Loading...</div>
        ) : analytics.recentScans.length > 0 ? (
          <div>
            {analytics.recentScans.map((scan, idx) => (
              <ActivityItem key={scan.id || idx} scan={scan} />
            ))}
          </div>
        ) : (
          <div
            style={{
              color: 'var(--muted)',
              fontSize: 13,
              padding: '18px 0',
              textAlign: 'center',
            }}
          >
            No recent scans. Start scanning to see activity here.
          </div>
        )}
      </section>

      {/* Secondary analytics */}
      <div style={dashboardGrid}>
        <section className="card" style={{ padding: 20 }}>
          <h3 style={{ margin: '0 0 8px 0', fontSize: 15 }}>By Rail Type</h3>
          {loading ? (
            <div style={{ color: 'var(--muted)', fontSize: 14 }}>Loading...</div>
          ) : (
            <BarChart data={analytics.railTypeData} title="Rail Types" color="#3b82f6" />
          )}
        </section>

        <section className="card" style={{ padding: 20 }}>
          <h3 style={{ margin: '0 0 8px 0', fontSize: 15 }}>By Grade</h3>
          {loading ? (
            <div style={{ color: 'var(--muted)', fontSize: 14 }}>Loading...</div>
          ) : (
            <BarChart data={analytics.gradeData} title="Grades" color="#8b5cf6" />
          )}
        </section>
      </div>

      <section className="card" style={{ padding: 20 }}>
        <h3 style={{ margin: '0 0 8px 0', fontSize: 15 }}>Top Destinations</h3>
        {loading ? (
          <div style={{ color: 'var(--muted)', fontSize: 14 }}>Loading...</div>
        ) : (
          <BarChart data={analytics.destinationData} title="By Destination" color="#f59e0b" />
        )}
      </section>

      {/* Admin panel only if provided */}
      {typeof onOpenAdmin === 'function' && (
        <section
          className="card"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
            background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)',
            color: '#fff',
            padding: 20,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10, color: '#fff' }}>
              <span style={{ fontSize: 22 }}>🛡️</span>
              Admin Panel
            </h3>
            <p style={{ margin: '8px 0 0', fontSize: 13, opacity: 0.85 }}>
              View history, audit log, and restore deleted scans
            </p>
          </div>

          <button
            type="button"
            onClick={onOpenAdmin}
            className="btn"
            style={{
              background: 'rgba(255,255,255,0.14)',
              border: '1px solid rgba(255,255,255,0.28)',
              boxShadow: 'none',
            }}
          >
            Open Admin Panel
          </button>
        </section>
      )}

      <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--muted)', padding: '2px 0 10px' }}>
        Dashboard auto-refreshes every 30 seconds
      </div>
    </div>
  );
}
