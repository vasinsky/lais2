import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal as TerminalIcon, ChevronDown, ChevronUp, Trash2, RefreshCw } from 'lucide-react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { BACKEND_PORT } from '../../config';

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
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermInstance = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
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
      fontSize: 12.5,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#0d1117',
        foreground: '#c9d1d9',
        cursor: '#58a6ff',
        selectionBackground: 'rgba(56, 139, 253, 0.4)',
        black: '#484f58',
        red: '#ff7b72',
        green: '#3fb950',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#bc8cff',
        cyan: '#39c5cf',
        white: '#b1bac4',
      }
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    fitAddon.fit();

    xtermInstance.current = term;
    fitAddonRef.current = fitAddon;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const params = new URLSearchParams();
    if (mode === 'agent' && activeProject) {
      params.set('mode', 'agent');
      params.set('project', activeProject);
    } else {
      params.set('mode', 'chat');
    }

    const wsUrl = `${protocol}//${window.location.hostname}:${BACKEND_PORT}/api/terminal/ws?${params.toString()}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      const { cols, rows } = term;
      ws.send(`__RESIZE__:${cols}:${rows}`);
    };

    ws.onmessage = (event) => {
      term.write(event.data);
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(`__RESIZE__:${cols}:${rows}`);
      }
    });
  }, [mode, activeProject]);

  useEffect(() => {
    if (!isCollapsed) {
      const timer = setTimeout(() => {
        initTerminal();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [mode, activeProject, isCollapsed, initTerminal]);

  useEffect(() => {
    const handleResize = () => {
      fitAddonRef.current?.fit();
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!isCollapsed) {
      setTimeout(() => fitAddonRef.current?.fit(), 100);
    }
  }, [height, isCollapsed]);

  const handleClear = () => {
    xtermInstance.current?.clear();
  };

  const handleReset = () => {
    initTerminal();
  };

  const currentFolder = (mode === 'agent' && activeProject) 
    ? `projects/${activeProject}` 
    : 'projects/ (global)';

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: isCollapsed ? '36px' : `${height}px`,
      minHeight: '36px',
      background: '#0d1117',
      borderTop: '1px solid var(--border-color)',
      overflow: 'hidden',
      transition: isDragging.current ? 'none' : 'height 0.15s ease'
    }}>
      {/* Drag handle & header */}
      <div 
        onMouseDown={startDrag}
        style={{
          height: 35,
          minHeight: 35,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 10px',
          background: 'var(--bg-header, #161b22)',
          borderBottom: isCollapsed ? 'none' : '1px solid var(--border-color)',
          cursor: 'row-resize',
          userSelect: 'none'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <TerminalIcon size={14} style={{ color: 'var(--primary-color, #388bfd)' }} />
          <span style={{ fontWeight: 600, color: 'var(--text-main, #c9d1d9)' }}>Terminal</span>
          <span style={{ 
            fontSize: 11, 
            color: 'var(--text-muted, #8b949e)', 
            background: 'rgba(255,255,255,0.06)',
            padding: '2px 6px',
            borderRadius: 4,
            fontFamily: 'monospace'
          }}>
            {currentFolder}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} onMouseDown={(e) => e.stopPropagation()}>
          <button
            onClick={handleClear}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted, #8b949e)', cursor: 'pointer', padding: 4 }}
            title="Clear terminal"
          >
            <Trash2 size={13} />
          </button>
          <button
            onClick={handleReset}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted, #8b949e)', cursor: 'pointer', padding: 4 }}
            title="Restart shell"
          >
            <RefreshCw size={13} />
          </button>
          <button
            onClick={onToggleCollapse}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted, #8b949e)', cursor: 'pointer', padding: 4 }}
            title={isCollapsed ? "Expand terminal" : "Collapse terminal"}
          >
            {isCollapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {/* Terminal Viewport */}
      {!isCollapsed && (
        <div 
          ref={terminalRef} 
          style={{ 
            flex: 1, 
            padding: '6px 8px', 
            overflow: 'hidden', 
            backgroundColor: '#0d1117' 
          }} 
        />
      )}
    </div>
  );
}
