import React, { useState, useRef, useCallback } from 'react';
import { Terminal as TerminalIcon, ChevronDown, ChevronUp, Trash2, RefreshCw, Cpu } from 'lucide-react';
import TerminalTab, { TerminalTabRef } from './TerminalTab';
import ConsoleTab, { ConsoleTabRef } from './ConsoleTab';

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
  const [logCount, setLogCount] = useState<number>(0);

  const terminalRef = useRef<TerminalTabRef>(null);
  const consoleRef = useRef<ConsoleTabRef>(null);
  const isDragging = useRef(false);

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
      setTimeout(() => terminalRef.current?.fit(), 50);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [height, isCollapsed, onHeightChange, onToggleCollapse]);

  const handleClear = () => {
    if (activeTab === 'terminal') {
      terminalRef.current?.clear();
    } else {
      consoleRef.current?.clear();
    }
  };

  const handleReset = () => {
    if (activeTab === 'terminal') {
      terminalRef.current?.reset();
    }
  };

  const currentFolder = activeProject ? `projects/${activeProject}` : 'projects/ (global)';

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
            {logCount > 0 && (
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
                {logCount}
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
          <TerminalTab
            ref={terminalRef}
            mode={mode}
            activeProject={activeProject}
            isActive={activeTab === 'terminal'}
            isCollapsed={isCollapsed}
          />
          <ConsoleTab
            ref={consoleRef}
            activeProject={activeProject}
            isActive={activeTab === 'console'}
            isCollapsed={isCollapsed}
            onLogCountChange={setLogCount}
          />
        </div>
      )}
    </div>
  );
}
