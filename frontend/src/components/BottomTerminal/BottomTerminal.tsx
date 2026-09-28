import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal as TerminalIcon, ChevronDown, ChevronUp, Trash2, RefreshCw, Cpu } from 'lucide-react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { BACKEND_PORT } from '../../config';
import { consoleLogger, LogEntry } from '../../services/consoleLogger';

interface Props {
  mode: 'chat' | 'agent';
  activeProject: string | null;
  height: number;
  onHeightChange: (h: number) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export default function BottomTerminal({
  mode,
  activeProject,
  height,
  onHeightChange,
  isCollapsed,
  onToggleCollapse
}: Props) {
  const [activeTab, setActiveTab] = useState<'terminal' | 'console'>('terminal');
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const terminalRef = useRef<HTMLDivElement>(null);
  const consoleBottomRef = useRef<HTMLDivElement>(null);
  const xtermInstance = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const isDragging = useRef(false);

  // Подписка на per-project логи
  useEffect(() => {
    setLogs(consoleLogger.getLogs(activeProject));
    const unsubscribe = consoleLogger.subscribe(() => {
      setLogs(consoleLogger.getLogs(activeProject));
    });
    return unsubscribe;
  }, [activeProject]);

  useEffect(() => {
    if (activeTab === 'console' && !isCollapsed) {
      consoleBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, activeTab, isCollapsed]);

  const startDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (isCollapsed) onToggleCollapse();
    isDragging.current = true;

    const startY = e.clientY;
    const startHeight = height;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = startY - ev.clientY;
      const newHeight = Math.max(120, Math.min(startHeight + delta, window.innerHeight * 0.75));
      onHeightChange(newHeight);
    };

    const onMouseUp = () => {
      isDragging.current = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      setTimeout(() => fitAddonRef.current?.fit(), 50);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [height, isCollapsed, onHeightChange, onToggleCollapse]);

  const initTerminal = useCallback(() => {
    if (!terminalRef.current) return;

    if (xtermInstance.current) {
      xtermInstance.current.dispose();
      xtermInstance.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#0d1117',
        foreground: '#c9d1d9',
        cursor: '#58a6ff'
      },
      rows: 10
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    fitAddon.fit();

    xtermInstance.current = term;
    fitAddonRef.current = fitAddon;

    const host = window.location.hostname || 'localhost';
    const port = BACKEND_PORT || 8000;
    const params = new URLSearchParams();
    if (mode) params.append('mode', mode);
    if (activeProject) params.append('project', activeProject);

    const wsUrl = `ws://${host}:${port}/api/terminal/ws?${params.toString()}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (ev) => {
      term.write(ev.data);
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    ws.onopen = () => {
      setTimeout(() => {
        try {
          fitAddon.fit();
          ws.send(`__RESIZE__:${term.cols}:${term.rows}`);
        } catch (_) {}
      }, 100);
    };
  }, [mode, activeProject]);

  useEffect(() => {
    if (!isCollapsed && activeTab === 'terminal') {
      setTimeout(() => initTerminal(), 50);
    }
    return () => {
      if (wsRef.current) wsRef.current.close();
      if (xtermInstance.current) xtermInstance.current.dispose();
    };
  }, [initTerminal, isCollapsed, activeTab]);

  const handleClear = () => {
    if (activeTab === 'terminal') {
      xtermInstance.current?.clear();
    } else {
      consoleLogger.clearLogs(activeProject);
    }
  };

  const handleReset = () => {
    if (activeTab === 'terminal') {
      initTerminal();
    }
  };

  const currentFolder = activeProject ? `projects/${activeProject}` : 'projects';

  return (
    <div
      style={{
        height: isCollapsed ? 36 : height,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#0d1117',
        borderTop: '1px solid var(--border-color)',
        transition: isDragging.current ? 'none' : 'height 0.15s ease',
        overflow: 'hidden',
        position: 'relative'
      }}
    >
      {/* Resizer Header */}
      <div
        onMouseDown={startDrag}
        style={{
          height: 36,
          minHeight: 36,
          backgroundColor: 'var(--bg-secondary, #161b22)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 12px',
          borderBottom: isCollapsed ? 'none' : '1px solid var(--border-color)',
          cursor: 'row-resize',
          userSelect: 'none'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12 }}>
          {/* Terminal Tab */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setActiveTab('terminal');
              if (isCollapsed) onToggleCollapse();
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              cursor: 'pointer',
              padding: '3px 10px',
              borderRadius: 6,
              border: activeTab === 'terminal' ? '1px solid rgba(56, 139, 253, 0.4)' : '1px solid transparent',
              backgroundColor: activeTab === 'terminal' ? 'rgba(56, 139, 253, 0.15)' : 'transparent',
              color: activeTab === 'terminal' ? '#58a6ff' : '#8b949e',
              fontWeight: activeTab === 'terminal' ? 600 : 500,
              fontSize: 12,
              transition: 'all 0.15s ease'
            }}
          >
            <TerminalIcon size={13} style={{ color: activeTab === 'terminal' ? '#58a6ff' : '#8b949e' }} />
            <span>Terminal</span>
          </button>

          {/* Console Tab */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setActiveTab('console');
              if (isCollapsed) onToggleCollapse();
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              cursor: 'pointer',
              padding: '3px 10px',
              borderRadius: 6,
              border: activeTab === 'console' ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid transparent',
              backgroundColor: activeTab === 'console' ? 'rgba(16, 185, 129, 0.15)' : 'transparent',
              color: activeTab === 'console' ? '#3fb950' : '#8b949e',
              fontWeight: activeTab === 'console' ? 600 : 500,
              fontSize: 12,
              transition: 'all 0.15s ease'
            }}
          >
            <Cpu size={13} style={{ color: activeTab === 'console' ? '#3fb950' : '#8b949e' }} />
            <span>Console</span>
            {logs.length > 0 && (
              <span
                style={{
                  fontSize: 10,
                  backgroundColor: 'rgba(63, 185, 80, 0.25)',
                  color: '#3fb950',
                  padding: '1px 6px',
                  borderRadius: 10,
                  fontWeight: 700
                }}
              >
                {logs.length}
              </span>
            )}
          </button>

          <span
            style={{
              fontSize: 11,
              color: 'var(--text-muted, #8b949e)',
              background: 'rgba(255,255,255,0.06)',
              padding: '2px 6px',
              borderRadius: 4,
              fontFamily: 'monospace'
            }}
          >
            {currentFolder}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} onMouseDown={(e) => e.stopPropagation()}>
          <button
            onClick={handleClear}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted, #8b949e)', cursor: 'pointer', padding: 4 }}
            title={activeTab === 'terminal' ? "Clear terminal" : "Clear console logs"}
          >
            <Trash2 size={13} />
          </button>
          {activeTab === 'terminal' && (
            <button
              onClick={handleReset}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted, #8b949e)', cursor: 'pointer', padding: 4 }}
              title="Restart shell"
            >
              <RefreshCw size={13} />
            </button>
          )}
          <button
            onClick={onToggleCollapse}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted, #8b949e)', cursor: 'pointer', padding: 4 }}
            title={isCollapsed ? "Expand panel" : "Collapse panel"}
          >
            {isCollapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {/* Viewport */}
      {!isCollapsed && (
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {/* Terminal View */}
          <div
            ref={terminalRef}
            style={{
              display: activeTab === 'terminal' ? 'block' : 'none',
              width: '100%',
              height: '100%',
              padding: '6px 8px',
              backgroundColor: '#0d1117'
            }}
          />

          {/* Console View */}
          {activeTab === 'console' && (
            <div
              style={{
                width: '100%',
                height: '100%',
                padding: '8px 12px',
                overflowY: 'auto',
                backgroundColor: '#0d1117',
                fontFamily: 'Menlo, Monaco, "Courier New", monospace',
                fontSize: 12,
                color: '#c9d1d9'
              }}
            >
              {logs.length === 0 ? (
                <div style={{ color: '#6e7681', fontStyle: 'italic', padding: '12px 0' }}>
                  No API events logged yet for project "{activeProject || 'general'}". Run or stop Docker/Python to see requests.
                </div>
              ) : (
                logs.map((log) => (
                  <div
                    key={log.id}
                    style={{
                      marginBottom: 8,
                      padding: '6px 8px',
                      borderRadius: 4,
                      backgroundColor: 'rgba(255, 255, 255, 0.03)',
                      borderLeft: `3px solid ${
                        log.type === 'error'
                          ? '#f85149'
                          : log.type === 'response'
                          ? '#2ea043'
                          : '#388bfd'
                      }`
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ color: '#8b949e', fontSize: 11 }}>[{log.timestamp}]</span>
                      <span
                        style={{
                          fontWeight: 600,
                          color:
                            log.type === 'error'
                              ? '#f85149'
                              : log.type === 'response'
                              ? '#2ea043'
                              : '#388bfd'
                        }}
                      >
                        {log.type === 'request' ? '→ REQ' : log.type === 'response' ? '← RES' : '✖ ERR'}
                      </span>
                      <span style={{ color: '#e6edf3', fontWeight: 500 }}>
                        {log.method} {log.url}
                      </span>
                      {log.status !== undefined && (
                        <span
                          style={{
                            padding: '1px 5px',
                            borderRadius: 3,
                            backgroundColor: log.status >= 400 ? 'rgba(248, 81, 73, 0.2)' : 'rgba(46, 160, 67, 0.2)',
                            color: log.status >= 400 ? '#f85149' : '#3fb950',
                            fontSize: 11
                          }}
                        >
                          {log.status}
                        </span>
                      )}
                      {log.durationMs !== undefined && (
                        <span style={{ color: '#8b949e', fontSize: 11 }}>{log.durationMs}ms</span>
                      )}
                    </div>
                    {log.payload && (
                      <pre
                        style={{
                          margin: 0,
                          padding: '4px 6px',
                          background: 'rgba(0,0,0,0.3)',
                          borderRadius: 3,
                          fontSize: 11,
                          overflowX: 'auto',
                          color: '#8b949e'
                        }}
                      >
                        {JSON.stringify(log.payload, null, 2)}
                      </pre>
                    )}
                  </div>
                ))
              )}
              <div ref={consoleBottomRef} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
