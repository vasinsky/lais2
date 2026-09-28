import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import BottomTerminal from '../components/BottomTerminal/BottomTerminal';

vi.mock('@xterm/xterm', () => {
  return {
    Terminal: vi.fn().mockImplementation(() => ({
      loadAddon: vi.fn(),
      open: vi.fn(),
      write: vi.fn(),
      clear: vi.fn(),
      dispose: vi.fn(),
      onData: vi.fn(),
      onResize: vi.fn(),
      cols: 80,
      rows: 24,
    })),
  };
});

vi.mock('@xterm/addon-fit', () => {
  return {
    FitAddon: vi.fn().mockImplementation(() => ({
      fit: vi.fn(),
    })),
  };
});

class MockWebSocket {
  readyState = 1;
  send = vi.fn();
  close = vi.fn();
  onopen = vi.fn();
  onmessage = vi.fn();
}
(global as any).WebSocket = MockWebSocket;

describe('BottomTerminal Component', () => {
  it('renders global projects directory when in chat mode', () => {
    render(
      <BottomTerminal
        mode="chat"
        activeProject={null}
        height={220}
        onHeightChange={vi.fn()}
        isCollapsed={false}
        onToggleCollapse={vi.fn()}
      />
    );

    expect(screen.getByText('Terminal')).toBeInTheDocument();
    expect(screen.getByText('projects/ (global)')).toBeInTheDocument();
    expect(screen.getByTitle('Clear terminal')).toBeInTheDocument();
    expect(screen.getByTitle('Restart shell')).toBeInTheDocument();
  });

  it('renders specific project directory when in agent mode', () => {
    render(
      <BottomTerminal
        mode="agent"
        activeProject="landing1"
        height={220}
        onHeightChange={vi.fn()}
        isCollapsed={false}
        onToggleCollapse={vi.fn()}
      />
    );

    expect(screen.getByText('projects/landing1')).toBeInTheDocument();
  });

  it('toggles collapse state on button click', () => {
    const handleToggle = vi.fn();
    render(
      <BottomTerminal
        mode="chat"
        activeProject={null}
        height={220}
        onHeightChange={vi.fn()}
        isCollapsed={true}
        onToggleCollapse={handleToggle}
      />
    );

    const expandBtn = screen.getByTitle('Expand terminal');
    expect(expandBtn).toBeInTheDocument();
    fireEvent.click(expandBtn);
    expect(handleToggle).toHaveBeenCalledTimes(1);
  });
});
