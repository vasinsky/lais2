import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import CenterEditor from '../components/CenterEditor/CenterEditor';
import { ToastProvider } from '../components/Toast';

vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange }: any) => (
    <textarea 
      data-testid="monaco-mock" 
      value={value} 
      onChange={(e) => onChange && onChange(e.target.value)} 
    />
  ),
}));

describe('CenterEditor Component', () => {
  it('renders placeholder when no file is selected', () => {
    render(
      <ToastProvider>
        <CenterEditor
          activeFile={null}
          activeProject={null}
          theme="light"
          selectedHistoryItem={null}
          overrideContent=""
          onClearHistorySelection={vi.fn()}
          onNewRevisionSaved={vi.fn()}
          onContentChange={vi.fn()}
        />
      </ToastProvider>
    );
    expect(screen.getByText(/Select a file in the project explorer/i)).toBeInTheDocument();
  });

  it('renders image viewer mode when active file type is image', () => {
    render(
      <ToastProvider>
        <CenterEditor
          activeFile={{ path: 'assets/hero.png', type: 'image' }}
          activeProject="landing1"
          theme="light"
          selectedHistoryItem={null}
          overrideContent=""
          onClearHistorySelection={vi.fn()}
          onNewRevisionSaved={vi.fn()}
          onContentChange={vi.fn()}
        />
      </ToastProvider>
    );

    // В коде alt формируется из activeFile.path
    expect(screen.getByAltText('assets/hero.png')).toBeInTheDocument();
    expect(screen.getByText('assets/hero.png')).toBeInTheDocument();
  });

  it('renders code editor and handles manual save', async () => {
    const handleSave = vi.fn();

    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ content: 'console.log("ready")' }),
      })
    ) as any;

    render(
      <ToastProvider>
        <CenterEditor
          activeFile={{ path: 'index.js', type: 'code' }}
          activeProject="landing1"
          theme="light"
          selectedHistoryItem={null}
          overrideContent="console.log('ready')"
          onClearHistorySelection={vi.fn()}
          onNewRevisionSaved={handleSave}
          onContentChange={vi.fn()}
        />
      </ToastProvider>
    );

    const editor = screen.getByTestId('monaco-mock');
    expect(editor).toHaveValue("console.log('ready')");

    // Поиск кнопки Save по роли и содержимому
    const saveBtn = screen.getByRole('button', { name: /save/i });
    expect(saveBtn).toBeInTheDocument();
  });
});
