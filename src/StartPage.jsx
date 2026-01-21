// StartPage.jsx — Enhanced with Dashboard & Analytics
import React, { useEffect, useState, useMemo } from 'react';

// Simple bar chart component (no external dependencies)
function BarChart({ data, title, color = 'var(--accent)' }) {
  const maxValue = Math.max(...data.map(d => d.value), 1);
  
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--muted)' }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {data.slice(0, 6).map((item, idx) => (
          <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ 
              width: 70, 
              fontSize: 12, 
              color: 'var(--muted)',
              textOverflow: 'ellipsis',
              overflow: 'hidden',
              whiteSpace: 'nowrap'
            }}>
              {item.label}
            </div>
            <div style={{ flex: 1, height: 20, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{
                width: `${(item.value / maxValue) * 100}%`,
                height: '100%',
                background: color,
                borderRadius: 4,
                transition: 'width 0.5s ease'
              }} />
            </div>
            <div style={{ width: 36, fontSize: 12, fontWeight: 600, textAlign: 'right' }}>
              {item.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Mini line chart for trend
function TrendChart({ data, color = 'var(--accent)' }) {
  if (!data || data.length < 2) return null;
  
  const maxVal = Math.max(...data, 1);
  const minVal = Math.min(...data, 0);
  const range = maxVal - minVal || 1;
  const height = 40;
  const width = 100;
  
  const points = data.map((val, idx) => {
    const x = (idx / (data.length - 1)) * width;
    const y = height - ((val - minVal) / range) * height;
    return `${x},${y}`;
  }).join(' ');
  
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Stat card component
function StatCard({ label, value, subValue, trend, color = 'var(--accent)', icon }) {
  const trendUp = trend > 0;
  const trendDown = trend < 0;
  
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: 16,
      display: 'flex',
      flexDirection: 'column',
      gap: 8
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 500 }}>{label}</span>
        {icon && <span style={{ fontSize: 20 }}>{icon}</span>}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color }}>{value}</div>
      {(subValue || trend !== undefined) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
          {trend !== undefined && trend !== 0 && (
            <span style={{ 
              color: trendUp ? '#22c55e' : trendDown ? '#ef4444' : 'var(--muted)',
              fontWeight: 600
            }}>
              {trendUp ? '↑' : '↓'} {Math.abs(trend)}%
            </span>
          )}
          {subValue && <span style={{ color: 'var(--muted)' }}>{subValue}</span>}
        </div>
      )}
    </div>
  );
}

// Donut chart for MAIN vs ALT
function DonutChart({ mainCount, altCount }) {
  const total = mainCount + altCount || 1;
  const mainPct = (mainCount / total) * 100;
  const altPct = (altCount / total) * 100;
  
  // SVG donut
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const mainStroke = (mainPct / 100) * circumference;
  const altStroke = (altPct / 100) * circumference;
  
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
      <svg width="100" height="100" viewBox="0 0 100 100">
        <circle
          cx="50" cy="50" r={radius}
          fill="none"
          stroke="var(--border)"
          strokeWidth="12"
        />
        <circle
          cx="50" cy="50" r={radius}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="12"
          strokeDasharray={`${mainStroke} ${circumference}`}
          strokeLinecap="round"
          transform="rotate(-90 50 50)"
          style={{ transition: 'stroke-dasharray 0.5s ease' }}
        />
        <circle
          cx="50" cy="50" r={radius}
          fill="none"
          stroke="#f59e0b"
          strokeWidth="12"
          strokeDasharray={`${altStroke} ${circumference}`}
          strokeDashoffset={-mainStroke}
          strokeLinecap="round"
          transform="rotate(-90 50 50)"
          style={{ transition: 'stroke-dasharray 0.5s ease' }}
        />
        <text x="50" y="50" textAnchor="middle" dy="0.35em" fontSize="16" fontWeight="700" fill="var(--fg)">
          {total}
        </text>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 12, height: 12, borderRadius: 3, background: 'var(--accent)' }} />
          <span style={{ fontSize: 13 }}>MAIN: <strong>{mainCount}</strong> ({mainPct.toFixed(0)}%)</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 12, height: 12, borderRadius: 3, background: '#f59e0b' }} />
          <span style={{ fontSize: 13 }}>ALT: <strong>{altCount}</strong> ({altPct.toFixed(0)}%)</span>
        </div>
      </div>
    </div>
  );
}

// Activity item
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
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '10px 0',
      borderBottom: '1px solid var(--border)'
    }}>
      <div style={{
        width: 36,
        height: 36,
        borderRadius: 8,
        background: 'var(--accent)',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 14,
        fontWeight: 600
      }}>
        {(scan.operator || 'U')[0].toUpperCase()}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ 
          fontSize: 13, 
          fontWeight: 600,
          textOverflow: 'ellipsis',
          overflow: 'hidden',
          whiteSpace: 'nowrap'
        }}>
          {scan.serial}
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          {scan.operator} • {scan.destination || scan.loadedAt || 'No destination'}
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
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
}) {
  const [now, setNow] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    mainTotal: 0,
    altTotal: 0,
    mainScans: [],
    altScans: [],
  });
  
  // Clock
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  
  // Fetch data for dashboard
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
    // Refresh every 30 seconds
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, []);
  
  // Computed stats
  const analytics = useMemo(() => {
    const allScans = [...stats.mainScans, ...stats.altScans];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    
    const monthAgo = new Date(today);
    monthAgo.setMonth(monthAgo.getMonth() - 1);
    
    // Filter by date
    const todayScans = allScans.filter(s => new Date(s.timestamp) >= today);
    const weekScans = allScans.filter(s => new Date(s.timestamp) >= weekAgo);
    const monthScans = allScans.filter(s => new Date(s.timestamp) >= monthAgo);
    
    // Previous week for trend calculation
    const twoWeeksAgo = new Date(weekAgo);
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 7);
    const prevWeekScans = allScans.filter(s => {
      const d = new Date(s.timestamp);
      return d >= twoWeeksAgo && d < weekAgo;
    });
    const weekTrend = prevWeekScans.length > 0 
      ? Math.round(((weekScans.length - prevWeekScans.length) / prevWeekScans.length) * 100)
      : 0;
    
    // By operator
    const byOperator = {};
    allScans.forEach(s => {
      const op = s.operator || 'Unknown';
      byOperator[op] = (byOperator[op] || 0) + 1;
    });
    const operatorData = Object.entries(byOperator)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
    
    // By rail type
    const byRailType = {};
    allScans.forEach(s => {
      const rt = s.railType || 'Unknown';
      byRailType[rt] = (byRailType[rt] || 0) + 1;
    });
    const railTypeData = Object.entries(byRailType)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
    
    // By grade
    const byGrade = {};
    allScans.forEach(s => {
      const g = s.grade || 'Unknown';
      byGrade[g] = (byGrade[g] || 0) + 1;
    });
    const gradeData = Object.entries(byGrade)
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
    
    // Daily trend (last 7 days)
    const dailyTrend = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const nextD = new Date(d);
      nextD.setDate(nextD.getDate() + 1);
      const count = allScans.filter(s => {
        const sd = new Date(s.timestamp);
        return sd >= d && sd < nextD;
      }).length;
      dailyTrend.push(count);
    }
    
    // Recent scans (combined, sorted by timestamp)
    const recentScans = allScans
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 5);
    
    // By destination
    const byDestination = {};
    allScans.forEach(s => {
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
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
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
        
        {/* Export buttons */}
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <button type="button" className="btn btn-outline" onClick={onExportMain}>
            Export MAIN Excel
          </button>
          <button type="button" className="btn btn-outline" onClick={onExportAlt}>
            Export ALT Excel
          </button>
        </div>
      </section>
      
      {/* Stats Cards */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        <StatCard 
          label="Total Scans" 
          value={loading ? '...' : analytics.total} 
          icon="📊"
          color="var(--accent)"
        />
        <StatCard 
          label="Today" 
          value={loading ? '...' : analytics.todayCount} 
          icon="📅"
          color="#22c55e"
        />
        <StatCard 
          label="This Week" 
          value={loading ? '...' : analytics.weekCount}
          trend={analytics.weekTrend}
          subValue="vs last week"
          icon="📈"
          color="#3b82f6"
        />
        <StatCard 
          label="This Month" 
          value={loading ? '...' : analytics.monthCount} 
          icon="🗓️"
          color="#8b5cf6"
        />
      </div>
      
      {/* Main vs Alt + Trend */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        <section className="card">
          <h3 style={{ margin: '0 0 16px 0', fontSize: 15 }}>MAIN vs ALT Distribution</h3>
          {loading ? (
            <div style={{ color: 'var(--muted)', fontSize: 14 }}>Loading...</div>
          ) : (
            <DonutChart mainCount={stats.mainTotal} altCount={stats.altTotal} />
          )}
        </section>
        
        <section className="card">
          <h3 style={{ margin: '0 0 8px 0', fontSize: 15 }}>7-Day Trend</h3>
          {loading ? (
            <div style={{ color: 'var(--muted)', fontSize: 14 }}>Loading...</div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <TrendChart data={analytics.dailyTrend} />
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                {analytics.dailyTrend.reduce((a, b) => a + b, 0)} scans in 7 days
              </div>
            </div>
          )}
          
          <BarChart 
            data={analytics.operatorData} 
            title="By Operator" 
            color="var(--accent)" 
          />
        </section>
      </div>
      

      
      {/* Recent Activity */}
      <section className="card">
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
          <div style={{ color: 'var(--muted)', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>
            No recent scans. Start scanning to see activity here.
          </div>
        )}
      </section>
      
      {/* Quick Settings */}
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
      
      {/* Footer */}
      <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--muted)', padding: '10px 0' }}>
        Dashboard auto-refreshes every 30 seconds
      </div>
    </div>
  );
}
