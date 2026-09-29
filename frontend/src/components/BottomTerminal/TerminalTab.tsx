import React, { useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { BACKEND_PORT } from '../../config';

export interface TerminalTabRef {
  clear: () => void;
  reset: () => void;
  fit: () => void;
}

interface Props {
  mode: 'chat' | 'agent';
  activeProject: string | null;
  isActive: boolean;
  isCollapsed: boolean;
}

const TerminalTab = forwardRef<TerminalTabRef, Props>(({
  mode,
  activeProject,
  isActive,
  isCollapsed
}, ref) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermInstance = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

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

  useImperativeHandle(ref, () => ({
    clear: () => {
      xtermInstance.current?.clear();
    },
    reset: () => {
      initTerminal();
    },
    fit: () => {
      fitAddonRef.current?.fit();
    }
  }));

  useEffect(() => {
    let timer: any = null;
    if (!isCollapsed && isActive) {
      timer = setTimeout(() => initTerminal(), 60);
    }
    return () => {
      if (timer) clearTimeout(timer);
      if (wsRef.current) {
        if (wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.close();
        } else if (wsRef.current.readyState === WebSocket.CONNECTING) {
          wsRef.current.onopen = () => wsRef.current?.close();
        }
        wsRef.current = null;
      }
      if (xtermInstance.current) {
        xtermInstance.current.dispose();
        xtermInstance.current = null;
      }
    };
  }, [initTerminal, isCollapsed, isActive]);

  return (
    <div
      ref={terminalRef}
      style={{
        display: isActive ? 'block' : 'none',
        width: '100%',
        height: '100%',
        padding: '6px 8px',
        backgroundColor: '#0d1117'
      }}
    />
  );
});

export default TerminalTab;
