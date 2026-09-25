import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import RightPanel from '../components/RightPanel/RightPanel';
import { ToastProvider } from '../components/Toast';

// Мокаем глобальный fetch
global.fetch = vi.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve([]),
  })
) as any;

describe('RightPanel Component', () => {
  const defaultProps = {
    mode: 'chat' as const,
    onModeChange: vi.fn(),
    activeProject: 'landing1',
    activeFilePath: 'index.html',
    activeFileContent: '<h1>Hello</h1>',
    selectedOllama: 'qwen2.5-coder:7b-instruct-q4_K_M',
    selectedComfy: 'Realistic_Vision.safetensors',
    onLiveStreamToEditor: vi.fn(),
    onProjectCreatedFromChat: vi.fn(),
    onFileAutoSaved: vi.fn(),
    onOpenImageModal: vi.fn(),
    onInsertCodeToEditor: vi.fn(),
    onRefreshProjectTree: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders code snippet with Insert button and calls onInsertCodeToEditor', async () => {
    const handleInsert = vi.fn();

    // Мокаем возвращение истории с блоком кода
    (global.fetch as any).mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              role: 'assistant',
              content: '```javascript\nconsole.log("hello");\n```',
              modelUsed: 'qwen2.5-coder',
            },
          ]),
      })
    );

    render(
      <ToastProvider>
        <RightPanel {...defaultProps} onInsertCodeToEditor={handleInsert} />
      </ToastProvider>
    );

    const insertBtn = await screen.findByTitle('Insert into active editor');
    expect(insertBtn).toBeInTheDocument();

    fireEvent.click(insertBtn);
    expect(handleInsert).toHaveBeenCalledWith('console.log("hello");\n');
  });

  it('renders comfy execution progress and image card', async () => {
    (global.fetch as any).mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              role: 'assistant',
              content: 'Image generation completed.',
              generated_image: '/api/chat/image/view?filename=test.png',
              image_prompt: 'cyberpunk street in rain',
              image_progress: { step: 20, total: 20, percent: 100, status: 'Completed' },
            },
          ]),
      })
    );

    render(
      <ToastProvider>
        <RightPanel {...defaultProps} />
      </ToastProvider>
    );

    expect(await screen.findByText('ComfyUI Execution')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByText(/cyberpunk street in rain/i)).toBeInTheDocument();
    expect(screen.getByAltText('generated art')).toBeInTheDocument();
  });

  it('shows message actions (Copy, Delete) on mouse hover', async () => {
    (global.fetch as any).mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve([
            {
              role: 'user',
              content: 'Hello World Test Message',
            },
          ]),
      })
    );

    render(
      <ToastProvider>
        <RightPanel {...defaultProps} />
      </ToastProvider>
    );

    const messageText = await screen.findByText('Hello World Test Message');
    const msgWrapper = messageText.closest('div[style*="flex-direction: column"]');
    expect(msgWrapper).not.toBeNull();

    // Наводим курсор на сообщение
    fireEvent.mouseEnter(msgWrapper!);

    const copyBtn = screen.getByTitle('Copy message text');
    const deleteBtn = screen.getByTitle('Delete message');

    expect(copyBtn).toBeInTheDocument();
    expect(deleteBtn).toBeInTheDocument();
  });
});
