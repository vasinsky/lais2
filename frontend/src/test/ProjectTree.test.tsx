import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ProjectTree, { FileHistoryItem } from '../components/LeftSidebar/ProjectTree';
import { ToastProvider } from '../components/Toast';

describe('ProjectTree Component', () => {
  const mockOpenFile = vi.fn();
  const mockSelectProject = vi.fn();
  const mockSelectHistory = vi.fn();
  const mockClearHistory = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn((url: string) => {
      if (url.endsWith('/api/projects')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(['landing1', 'backend_app']),
        });
      }
      if (url.includes('/tree')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([
            { name: 'index.html', path: 'index.html', type: 'file', file_type: 'code' },
            { name: 'logo.png', path: 'logo.png', type: 'file', file_type: 'image' }
          ]),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    }) as any;
  });

  it('renders project list and opens files with proper type detection', async () => {
    render(
      <ToastProvider>
        <ProjectTree
          activeProject="landing1"
          activeFilePath={null}
          fileHistory={[]}
          selectedHistoryId={null}
          refreshTrigger={0}
          onSelectProject={mockSelectProject}
          onOpenFile={mockOpenFile}
          onCloseFile={vi.fn()}
          onSelectHistoryItem={mockSelectHistory}
          onHistoryCleared={mockClearHistory}
        />
      </ToastProvider>
    );

    expect(await screen.findByText('landing1')).toBeInTheDocument();
    expect(screen.getByText('backend_app')).toBeInTheDocument();

    // Кликаем по файлу кода
    const codeFile = await screen.findByText('index.html');
    fireEvent.click(codeFile);
    expect(mockOpenFile).toHaveBeenCalledWith('index.html', 'code');

    // Кликаем по картинке
    const imgFile = await screen.findByText('logo.png');
    fireEvent.click(imgFile);
    expect(mockOpenFile).toHaveBeenCalledWith('logo.png', 'image');
  });

  it('renders and selects file history revisions', async () => {
    const history: FileHistoryItem[] = [
      { id: 'rev1', timestamp: new Date().toISOString(), source: 'Auto-save v1', content: 'v1' },
      { id: 'rev2', timestamp: new Date().toISOString(), source: 'Agent refactor', content: 'v2' }
    ];

    render(
      <ToastProvider>
        <ProjectTree
          activeProject="landing1"
          activeFilePath="index.html"
          fileHistory={history}
          selectedHistoryId={null}
          refreshTrigger={0}
          onSelectProject={mockSelectProject}
          onOpenFile={mockOpenFile}
          onCloseFile={vi.fn()}
          onSelectHistoryItem={mockSelectHistory}
          onHistoryCleared={mockClearHistory}
        />
      </ToastProvider>
    );

    expect(screen.getByText('FILE HISTORY')).toBeInTheDocument();
    const revItem = screen.getByText('Agent refactor');
    fireEvent.click(revItem);
    expect(mockSelectHistory).toHaveBeenCalledWith(history[1]);
  });
});
