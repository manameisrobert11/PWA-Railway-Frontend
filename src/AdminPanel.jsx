// src/AdminPanel.jsx — Admin Panel with History & Audit Log
import React, { useEffect, useState, useCallback } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE || '';
const api = (p) => {
  const path = p.startsWith('/') ? p : `/${p}`;
  if (API_BASE) {
    if (API_BASE.endsWith('/api')) return `${API_BASE}${path}`;
    return `${API_BASE}/api${path}`;
  }
  return `/api${path}`;
};

// Format time ago
const timeAgo = (date) => {
  if (!date) return 'Unknown';
  const now = new Date();
  const d = new Date(date);
  const diff = Math.floor((now - d) / 1000);
  
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString();
};

// Format full date
const formatDate = (date) => {
  if (!date) return 'Unknown';
  return new Date(date).toLocaleString();
};

// Action type badge
function ActionBadge({ action }) {
  const colors = {
    create: { bg: '#dcfce7', color: '#16a34a', label: 'Created' },
    delete: { bg: '#fee2e2', color: '#dc2626', label: 'Deleted' },
    edit: { bg: '#dbeafe', color: '#2563eb', label: 'Edited' },
    restore: { bg: '#f3e8ff', color: '#9333ea', label: 'Restored' },
    clear: { bg: '#fef3c7', color: '#d97706', label: 'Cleared All' },
  };
  
  const style = colors[action] || { bg: '#f1f5f9', color: '#64748b', label: action };
  
  return (
    <span style={{
      padding: '2px 8px',
      borderRadius: 6,
      background: style.bg,
      color: style.color,
      fontSize: 11,
      fontWeight: 600,
      textTransform: 'uppercase',
    }}>
      {style.label}
    </span>
  );
}

// History item component
function HistoryItem({ item, onRestore, isRestoring }) {
  const canRestore = item.action === 'delete' && item.scanData;
  
  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: 12,
      padding: '14px 0',
      borderBottom: '1px solid var(--border)',
    }}>
      {/* Timeline dot */}
      <div style={{
        width: 10,
        height: 10,
        borderRadius: '50%',
        background: item.action === 'delete' ? '#ef4444' : 
                    item.action === 'create' ? '#22c55e' : 
                    item.action === 'restore' ? '#9333ea' : '#3b82f6',
        marginTop: 4,
        flexShrink: 0,
      }} />
      
      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <ActionBadge action={item.action} />
          <span style={{ 
            fontSize: 14, 
            fontWeight: 600,
            textOverflow: 'ellipsis',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
          }}>
            {item.serial || 'Multiple Items'}
          </span>
          <span style={{
            padding: '1px 6px',
            borderRadius: 4,
            background: item.mode === 'alt' ? '#fef3c7' : '#e0e7ff',
            color: item.mode === 'alt' ? '#92400e' : '#3730a3',
            fontSize: 10,
            fontWeight: 600,
          }}>
            {(item.mode || 'main').toUpperCase()}
          </span>
        </div>
        
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
          {item.operator && <span>by {item.operator} • </span>}
          <span title={formatDate(item.timestamp)}>{timeAgo(item.timestamp)}</span>
          {item.details && <span> • {item.details}</span>}
        </div>
        
        {/* Scan details (expandable) */}
        {item.scanData && (
          <div style={{
            marginTop: 8,
            padding: 10,
            background: 'var(--surface)',
            borderRadius: 6,
            fontSize: 12,
          }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 6 }}>
              {item.scanData.grade && <div><strong>Grade:</strong> {item.scanData.grade}</div>}
              {item.scanData.railType && <div><strong>Rail Type:</strong> {item.scanData.railType}</div>}
              {item.scanData.destination && <div><strong>Destination:</strong> {item.scanData.destination}</div>}
              {item.scanData.operator && <div><strong>Operator:</strong> {item.scanData.operator}</div>}
            </div>
          </div>
        )}
      </div>
      
      {/* Restore button */}
      {canRestore && (
        <button
          onClick={() => onRestore(item)}
          disabled={isRestoring}
          style={{
            padding: '6px 12px',
            borderRadius: 6,
            border: '1px solid #9333ea',
            background: 'transparent',
            color: '#9333ea',
            fontSize: 12,
            fontWeight: 600,
            cursor: isRestoring ? 'not-allowed' : 'pointer',
            opacity: isRestoring ? 0.5 : 1,
            whiteSpace: 'nowrap',
          }}
        >
          {isRestoring ? 'Restoring...' : '↩ Restore'}
        </button>
      )}
    </div>
  );
}

// Stats card
function StatCard({ label, value, icon, color }) {
  return (
    <div style={{
      padding: 16,
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      textAlign: 'center',
    }}>
      <div style={{ fontSize: 24, marginBottom: 4 }}>{icon}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{label}</div>
    </div>
  );
}

export default function AdminPanel({ onBack }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // all, create, delete, restore
  const [modeFilter, setModeFilter] = useState('all'); // all, main, alt
  const [isRestoring, setIsRestoring] = useState(false);
  const [stats, setStats] = useState({
    totalCreated: 0,
    totalDeleted: 0,
    totalRestored: 0,
    recentActivity: 0,
  });
  
  // Load history from localStorage (client-side audit log)
  const loadHistory = useCallback(() => {
    try {
      const stored = localStorage.getItem('rail-audit-log');
      if (stored) {
        const parsed = JSON.parse(stored);
        setHistory(parsed.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)));
        
        // Calculate stats
        const now = new Date();
        const dayAgo = new Date(now - 24 * 60 * 60 * 1000);
        
        setStats({
          totalCreated: parsed.filter(h => h.action === 'create').length,
          totalDeleted: parsed.filter(h => h.action === 'delete').length,
          totalRestored: parsed.filter(h => h.action === 'restore').length,
          recentActivity: parsed.filter(h => new Date(h.timestamp) > dayAgo).length,
        });
      }
    } catch (e) {
      console.error('Failed to load history:', e);
    } finally {
      setLoading(false);
    }
  }, []);
  
  useEffect(() => {
    loadHistory();
  }, [loadHistory]);
  
  // Restore a deleted scan
  const handleRestore = async (item) => {
    if (!item.scanData || isRestoring) return;
    
    const confirmRestore = window.confirm(
      `Restore scan "${item.serial}" to ${(item.mode || 'main').toUpperCase()}?`
    );
    if (!confirmRestore) return;
    
    setIsRestoring(true);
    
    try {
      const endpoint = item.mode === 'alt' ? '/scan-alt' : '/scan';
      const resp = await fetch(api(endpoint), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item.scanData),
      });
      
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(text || `HTTP ${resp.status}`);
      }
      
      // Add restore entry to audit log
      addAuditEntry({
        action: 'restore',
        serial: item.serial,
        mode: item.mode || 'main',
        operator: 'Admin',
        details: `Restored from deletion`,
        scanData: item.scanData,
      });
      
      alert(`Successfully restored "${item.serial}"!`);
      loadHistory();
    } catch (e) {
      console.error('Restore failed:', e);
      alert(`Failed to restore: ${e.message}`);
    } finally {
      setIsRestoring(false);
    }
  };
  
  // Clear all history
  const handleClearHistory = () => {
    const pw = window.prompt('Enter admin password to clear audit history:');
    if (pw !== 'admin1234') {
      if (pw !== null) alert('Incorrect password.');
      return;
    }
    
    if (window.confirm('Are you sure you want to clear ALL audit history? This cannot be undone.')) {
      localStorage.removeItem('rail-audit-log');
      setHistory([]);
      setStats({ totalCreated: 0, totalDeleted: 0, totalRestored: 0, recentActivity: 0 });
      alert('Audit history cleared.');
    }
  };
  
  // Filter history
  const filteredHistory = history.filter(item => {
    if (filter !== 'all' && item.action !== filter) return false;
    if (modeFilter !== 'all' && item.mode !== modeFilter) return false;
    return true;
  });
  
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <section className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 28 }}>🛡️</span>
              Admin Panel
            </h2>
            <p style={{ margin: '8px 0 0', color: 'var(--muted)', fontSize: 14 }}>
              History & Audit Log — Track all changes and restore deleted scans
            </p>
          </div>
          <button className="btn btn-outline" onClick={onBack}>
            ← Back to Dashboard
          </button>
        </div>
      </section>
      
      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12 }}>
        <StatCard label="Total Created" value={stats.totalCreated} icon="➕" color="#22c55e" />
        <StatCard label="Total Deleted" value={stats.totalDeleted} icon="🗑️" color="#ef4444" />
        <StatCard label="Restored" value={stats.totalRestored} icon="↩️" color="#9333ea" />
        <StatCard label="Last 24h" value={stats.recentActivity} icon="⏱️" color="#3b82f6" />
      </div>
      
      {/* Filters */}
      <section className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="input"
              style={{ width: 'auto', padding: '8px 12px' }}
            >
              <option value="all">All Actions</option>
              <option value="create">Created</option>
              <option value="delete">Deleted</option>
              <option value="restore">Restored</option>
            </select>
            
            <select
              value={modeFilter}
              onChange={(e) => setModeFilter(e.target.value)}
              className="input"
              style={{ width: 'auto', padding: '8px 12px' }}
            >
              <option value="all">All Modes</option>
              <option value="main">MAIN Only</option>
              <option value="alt">ALT Only</option>
            </select>
          </div>
          
          <div style={{ display: 'flex', gap: 8 }}>
            <button 
              className="btn btn-outline" 
              onClick={loadHistory}
              style={{ fontSize: 13 }}
            >
              ↻ Refresh
            </button>
            <button 
              className="btn btn-outline" 
              onClick={handleClearHistory}
              style={{ fontSize: 13, borderColor: '#ef4444', color: '#ef4444' }}
            >
              Clear History
            </button>
          </div>
        </div>
      </section>
      
      {/* History Timeline */}
      <section className="card">
        <h3 style={{ margin: '0 0 16px' }}>
          Activity Timeline
          <span style={{ 
            marginLeft: 8, 
            fontSize: 13, 
            fontWeight: 400, 
            color: 'var(--muted)' 
          }}>
            ({filteredHistory.length} entries)
          </span>
        </h3>
        
        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>
            Loading history...
          </div>
        ) : filteredHistory.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>📋</div>
            <div>No history entries yet.</div>
            <div style={{ fontSize: 13, marginTop: 8 }}>
              Activity will be recorded as you scan, delete, and restore items.
            </div>
          </div>
        ) : (
          <div style={{ maxHeight: 500, overflowY: 'auto' }}>
            {filteredHistory.map((item, idx) => (
              <HistoryItem 
                key={item.id || idx} 
                item={item} 
                onRestore={handleRestore}
                isRestoring={isRestoring}
              />
            ))}
          </div>
        )}
      </section>
      
      {/* Info */}
      <section className="card" style={{ background: 'var(--surface)' }}>
        <h4 style={{ margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>ℹ️</span> About Audit Log
        </h4>
        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: 'var(--muted)', lineHeight: 1.8 }}>
          <li>History is stored locally in your browser</li>
          <li>Deleted scans can be restored if the data was captured</li>
          <li>Clearing history requires the admin password: <code>admin1234</code></li>
          <li>History persists across sessions but not across different devices</li>
        </ul>
      </section>
    </div>
  );
}

// ==================== HELPER: Add Audit Entry ====================
// Call this from App.jsx when actions happen
export function addAuditEntry(entry) {
  try {
    const stored = localStorage.getItem('rail-audit-log');
    const history = stored ? JSON.parse(stored) : [];
    
    const newEntry = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      ...entry,
    };
    
    history.unshift(newEntry);
    
    // Keep only last 500 entries
    const trimmed = history.slice(0, 500);
    localStorage.setItem('rail-audit-log', JSON.stringify(trimmed));
    
    return newEntry;
  } catch (e) {
    console.warn('Failed to add audit entry:', e);
    return null;
  }
}
