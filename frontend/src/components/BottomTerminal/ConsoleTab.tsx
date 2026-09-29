import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import { consoleLogger, LogEntry } from '../../services/consoleLogger';

export interface ConsoleTabRef {
  clear: () => void;
}

interface Props {
  activeProject: string | null;
  isActive: boolean;
  isCollapsed: boolean;
  onLogCountChange?: (count: number) => void;
}

const ConsoleTab = forwardRef<ConsoleTabRef, Props>(({
  activeProject,
  isActive,
  isCollapsed,
  onLogCountChange
}, ref) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const consoleBottomRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    clear: () => {
      consoleLogger.clearLogs(activeProject);
    }
  }));

  useEffect(() => {
    const current = consoleLogger.getLogs(activeProject);
    setLogs([...current]);
    onLogCountChange?.(current.length);

    const unsubscribe = consoleLogger.subscribe(() => {
      const updated = consoleLogger.getLogs(activeProject);
      setLogs([...updated]);
      onLogCountChange?.(updated.length);
    });

    let es: EventSource | null = null;
    const targetProject = activeProject || "general";
    if (targetProject) {
      es = new EventSource(`/api/projects/${encodeURIComponent(targetProject)}/events`);
      es.onmessage = (ev) => {
        try {
          const item = JSON.parse(ev.data);
          consoleLogger.log(item);
        } catch (_) {}
      };
    }

    return () => {
      unsubscribe();
      if (es) {
        es.close();
      }
    };
  }, [activeProject, onLogCountChange]);

  useEffect(() => {
    if (isActive && !isCollapsed) {
      consoleBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, isActive, isCollapsed]);

  return (
    <div
      style={{
        display: isActive ? 'block' : 'none',
        width: '100%',
        height: '100%',
        padding: '8px 12px',
        overflowY: 'auto',
        backgroundColor: '#0d1117',
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        fontSize: 12,
        color: '#c9d1d9',
        userSelect: 'text',
        WebkitUserSelect: 'text'
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
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
              <span style={{ color: '#8b949e', fontSize: 11 }}>[{log.timestamp}]</span>
              <span
                style={{
                  fontWeight: 600,
                  color:
                    log.type === 'error'
                      ? '#f85149'
                      : log.type === 'response'
                      ? '#2ea043'
                      : log.type === 'info'
                      ? '#a371f7'
                      : '#388bfd'
                }}
              >
                {log.type === 'request'
                  ? '→ REQ'
                  : log.type === 'response'
                  ? '← RES'
                  : log.type === 'info'
                  ? 'ℹ INFO'
                  : '✖ ERR'}
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
                  padding: '6px 8px',
                  background: 'rgba(0,0,0,0.3)',
                  borderRadius: 4,
                  fontSize: 11,
                  lineHeight: 1.45,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  overflowWrap: 'anywhere',
                  overflowX: 'hidden',
                  color: '#8b949e',
                  userSelect: 'text',
                  WebkitUserSelect: 'text',
                  cursor: 'text'
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
  );
});

export default ConsoleTab;
