import React, { useState, useEffect, useRef } from 'react';
import { 
  Send, Sparkles, MessageSquare, Terminal, Trash2, Paperclip,
  Maximize2, Image as ImageIcon, Square, Loader2, Copy, Check,
  Code, ArrowDownToLine, FolderPlus
} from 'lucide-react';
import { useToast } from '../Toast';
import { FileHistoryItem } from '../LeftSidebar/ProjectTree';

export interface ImageProgressInfo {
  step: number;
  total: number;
  percent: number;
  status: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  images?: string[];
  modelUsed?: string;
  created_at?: string;
  generated_image?: string;
  image_prompt?: string;
  image_progress?: ImageProgressInfo;
}

interface Props {
  mode: 'chat' | 'agent';
  onModeChange: (m: 'chat' | 'agent') => void;
  activeProject: string | null;
  activeFilePath?: string | null;
  activeFileContent?: string;
  selectedOllama: string;
  selectedComfy: string;
  onLiveStreamToEditor: (targetPath: string, chunk: string, isStart: boolean) => void;
  onProjectCreatedFromChat: (projName: string, defaultFile?: string) => void;
  onFileAutoSaved: (filePath: string, revision: FileHistoryItem) => void;
  onOpenImageModal?: (imageUrl: string, prompt?: string) => void;
  onInsertCodeToEditor?: (code: string) => void;
  onRefreshProjectTree?: () => void;
}

export default function RightPanel({
  mode,
  onModeChange,
  activeProject,
  activeFilePath,
  activeFileContent,
  selectedOllama,
  selectedComfy,
  onLiveStreamToEditor,
  onProjectCreatedFromChat,
  onFileAutoSaved,
  onOpenImageModal,
  onInsertCodeToEditor,
  onRefreshProjectTree
}: Props) {
  const { showToast } = useToast();
  const [inputVal, setInputVal] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeModelUsed, setActiveModelUsed] = useState<string | null>(null);
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const [copiedCodeIdx, setCopiedCodeIdx] = useState<string | null>(null);
  const [hoveredMsgIdx, setHoveredMsgIdx] = useState<number | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const loadHistory = () => {
    if (mode === 'chat') {
      fetch('http://localhost:8000/api/chat/history')
        .then(res => res.json())
        .then(data => setMessages(Array.isArray(data) ? data : []))
        .catch(() => setMessages([]));
    } else {
      if (!activeProject) {
        setMessages([]);
        return;
      }
      fetch(`http://localhost:8000/api/agent/${encodeURIComponent(activeProject)}/history`)
        .then(res => res.json())
        .then(data => setMessages(Array.isArray(data) ? data : []))
        .catch(() => setMessages([]));
    }
  };

  useEffect(() => {
    loadHistory();
  }, [mode, activeProject]);

  const handleClearHistory = () => {
    if (mode === 'chat') {
      fetch('http://localhost:8000/api/chat/history', { method: 'DELETE' })
        .then(res => {
          if (res.ok) {
            setMessages([]);
            showToast("Global Chat history cleared", "info");
          }
        });
    } else if (activeProject) {
      fetch(`http://localhost:8000/api/agent/${encodeURIComponent(activeProject)}/history`, { method: 'DELETE' })
        .then(res => {
          if (res.ok) {
            setMessages([]);
            showToast(`Agent history for "${activeProject}" cleared`, "info");
          }
        });
    }
  };

  const handleDeleteMessage = async (idx: number) => {
    try {
      const url = mode === 'chat' 
        ? `http://localhost:8000/api/chat/messages/${idx}`
        : `http://localhost:8000/api/agent/${encodeURIComponent(activeProject || '')}/messages/${idx}`;
      
      const res = await fetch(url, { method: 'DELETE' });
      if (res.ok) {
        setMessages(prev => prev.filter((_, i) => i !== idx));
        showToast("Message deleted", "info");
      }
    } catch {
      showToast("Failed to delete message", "error");
    }
  };

  const handleCopyText = (text: string) => {
    navigator.clipboard.writeText(text);
    showToast("Copied to clipboard", "success");
  };

  const handleCopyImage = async (imgUrl: string) => {
    try {
      const res = await fetch(imgUrl);
      const blob = await res.blob();
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob })
      ]);
      showToast("Image copied to clipboard", "success");
    } catch {
      navigator.clipboard.writeText(imgUrl);
      showToast("Image URL copied to clipboard", "info");
    }
  };

  const handleSaveImageToProject = async (imageUrl: string) => {
    if (!activeProject) {
      showToast("Select a project first in the left tree", "error");
      return;
    }

    let targetDirectory = "";
    if (activeFilePath) {
      const parts = activeFilePath.split('/');
      if (parts.length > 1) {
        targetDirectory = parts.slice(0, -1).join('/');
      }
    }

    try {
      const res = await fetch(`http://localhost:8000/api/projects/${encodeURIComponent(activeProject)}/save-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: imageUrl,
          target_dir: targetDirectory
        })
      });
      if (res.ok) {
        const data = await res.json();
        showToast(`Image saved: ${data.file_path}`, "success");
        if (onRefreshProjectTree) onRefreshProjectTree();
      } else {
        const errData = await res.json().catch(() => ({}));
        showToast(errData.detail || "Failed to save image", "error");
      }
    } catch {
      showToast("Network error saving image", "error");
    }
  };

  const handleCancelGeneration = async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    try {
      await fetch('http://localhost:8000/api/chat/interrupt', { method: 'POST' });
    } catch (_) {}

    setIsLoading(false);
    showToast("Generation cancelled", "info");
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach(file => {
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const base64 = (ev.target?.result as string)?.split(',')[1];
        if (base64) {
          setSelectedImages(prev => [...prev, base64]);
        }
      };
      reader.readAsDataURL(file);
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const renderMessageContent = (content: string, msgIdx: number) => {
    const codeBlockRegex = /```([a-zA-Z0-9_\-+]*)\n([\s\S]*?)```/g;
    const elements: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;

    while ((match = codeBlockRegex.exec(content)) !== null) {
      const matchIndex = match.index;
      if (matchIndex > lastIndex) {
        elements.push(
          <span key={`text-${lastIndex}`}>{content.substring(lastIndex, matchIndex)}</span>
        );
      }

      const lang = match[1] || 'code';
      const codeSnippet = match[2];
      const blockKey = `${msgIdx}-${matchIndex}`;

      elements.push(
        <div 
          key={`code-${blockKey}`}
          style={{
            margin: '8px 0',
            borderRadius: '6px',
            overflow: 'hidden',
            border: '1px solid var(--border-color)',
            background: 'var(--bg-panel-sub)'
          }}
        >
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '4px 8px',
            background: 'var(--bg-panel)',
            borderBottom: '1px solid var(--border-color)',
            fontSize: '11px',
            color: 'var(--text-muted)'
          }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', textTransform: 'lowercase' }}>
              <Code size={12} />
              {lang}
            </span>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(codeSnippet);
                  setCopiedCodeIdx(blockKey);
                  setTimeout(() => setCopiedCodeIdx(null), 2000);
                  showToast("Code copied", "success");
                }}
                className="theme-toggle-btn"
                style={{ padding: '2px 6px', fontSize: '10.5px', display: 'flex', alignItems: 'center', gap: '4px' }}
                title="Copy code to clipboard"
              >
                {copiedCodeIdx === blockKey ? <Check size={11} color="#10b981" /> : <Copy size={11} />}
                {copiedCodeIdx === blockKey ? "Copied" : "Copy"}
              </button>

              {onInsertCodeToEditor && activeFilePath && (
                <button
                  type="button"
                  onClick={() => {
                    onInsertCodeToEditor(codeSnippet);
                    showToast(`Inserted code into ${activeFilePath}`, "success");
                  }}
                  className="theme-toggle-btn"
                  style={{ padding: '2px 6px', fontSize: '10.5px', display: 'flex', alignItems: 'center', gap: '4px' }}
                  title="Insert into active editor"
                >
                  <ArrowDownToLine size={11} color="var(--btn-primary)" />
                  Insert
                </button>
              )}
            </div>
          </div>
          <pre style={{
            margin: 0,
            padding: '8px 10px',
            fontSize: '11.5px',
            fontFamily: 'monospace',
            overflowX: 'auto',
            whiteSpace: 'pre-wrap',
            background: 'var(--bg-card)'
          }}>
            <code>{codeSnippet}</code>
          </pre>
        </div>
      );

      lastIndex = codeBlockRegex.lastIndex;
    }

    if (lastIndex < content.length) {
      elements.push(<span key={`text-${lastIndex}`}>{content.substring(lastIndex)}</span>);
    }

    return elements;
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const prompt = inputVal.trim();
    if (!prompt || isLoading) return;

    if (mode === 'agent' && !activeProject) {
      showToast("Please select or create a project first", "error");
      return;
    }

    const currentImages = [...selectedImages];
    const userMsg: ChatMessage = {
      role: 'user',
      content: prompt,
      images: currentImages.length > 0 ? currentImages : undefined
    };

    setMessages(prev => [...prev, userMsg]);
    setInputVal('');
    setSelectedImages([]);
    setIsLoading(true);
    setActiveModelUsed(null);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    if (mode === 'chat') {
      try {
        const res = await fetch('http://localhost:8000/api/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            model: selectedOllama,
            comfy_checkpoint: selectedComfy,
            messages: [...messages, userMsg],
            stream: true
          })
        });

        if (!res.ok) throw new Error("Network error contacting backend");

        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        let assistantReply = '';
        let isStarted = false;
        let isImageTask = false;
        let buffer = '';

        while (reader) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('data:')) {
              const jsonStr = trimmed.replace(/^data:\s*/, '');
              if (!jsonStr) continue;

              try {
                const data = JSON.parse(jsonStr);

                if (data.type === 'meta') {
                  setActiveModelUsed(data.model);
                  if (data.is_image_task) {
                    isImageTask = true;
                    setMessages(prev => [...prev, {
                      role: 'assistant',
                      content: 'Translating prompt with dolphin-llama3...',
                      modelUsed: data.model,
                      image_progress: { step: 0, total: 20, percent: 0, status: 'Initializing...' }
                    }]);
                    isStarted = true;
                  }
                } else if (data.type === 'image_prompt_ready') {
                  setMessages(prev => {
                    const next = [...prev];
                    const last = next[next.length - 1];
                    if (last && last.role === 'assistant') {
                      last.image_prompt = data.prompt;
                      last.content = 'Prompt ready. Queued in ComfyUI...';
                      if (last.image_progress) {
                        last.image_progress.status = data.status || 'Queued...';
                      }
                    }
                    return next;
                  });
                } else if (data.type === 'image_progress') {
                  setMessages(prev => {
                    const next = [...prev];
                    const last = next[next.length - 1];
                    if (last && last.role === 'assistant') {
                      last.image_progress = {
                        step: data.step,
                        total: data.total,
                        percent: data.percent,
                        status: data.status
                      };
                      last.content = data.status;
                    }
                    return next;
                  });
                } else if (data.type === 'image_complete') {
                  setMessages(prev => {
                    const next = [...prev];
                    const last = next[next.length - 1];
                    if (last && last.role === 'assistant') {
                      last.generated_image = data.image_url;
                      last.image_prompt = data.prompt;
                      last.content = 'Image generation completed.';
                      if (last.image_progress) {
                        last.image_progress.percent = 100;
                        last.image_progress.status = 'Completed';
                      }
                    }
                    return next;
                  });
                  showToast("Image successfully generated!", "success");
                } else if (data.type === 'image_error') {
                  setMessages(prev => {
                    const next = [...prev];
                    const last = next[next.length - 1];
                    if (last && last.role === 'assistant') {
                      last.content = `Generation failed: ${data.error}`;
                      if (last.image_progress) {
                        last.image_progress.status = 'Failed';
                      }
                    }
                    return next;
                  });
                  showToast(data.error || "ComfyUI generation error", "error");
                } else if (data.type === 'project_created') {
                  onProjectCreatedFromChat(data.project_name, data.default_file);
                } else if (!isImageTask && data.message && data.message.content) {
                  assistantReply += data.message.content;
                  if (!isStarted) {
                    setMessages(prev => [...prev, {
                      role: 'assistant',
                      content: assistantReply,
                      modelUsed: selectedOllama
                    }]);
                    isStarted = true;
                  } else {
                    setMessages(prev => {
                      const updated = [...prev];
                      updated[updated.length - 1].content = assistantReply;
                      return updated;
                    });
                  }
                }
              } catch (_) {}
            }
          }
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          showToast(err.message || "Request failed", "error");
        }
      } finally {
        setIsLoading(false);
        abortControllerRef.current = null;
        setTimeout(loadHistory, 300);
      }
    } else {
      // Режим Project Agent
      try {
        const res = await fetch('http://localhost:8000/api/agent/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            project_name: activeProject,
            prompt: prompt,
            model: selectedOllama,
            images: currentImages.length > 0 ? currentImages : undefined,
            active_file_path: activeFilePath || undefined,
            active_file_content: activeFileContent || undefined
          })
        });

        if (!res.ok) throw new Error("Execution failed");

        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        let assistantReply = '';
        let isStarted = false;
        let isStreamingToFile = false;
        let currentStreamFile = '';
        let buffer = '';

        while (reader) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('data:')) {
              const jsonStr = trimmed.replace(/^data:\s*/, '');
              if (!jsonStr) continue;

              try {
                const data = JSON.parse(jsonStr);

                if (data.type === 'meta') {
                  setActiveModelUsed(data.model);
                } else if (data.type === 'stream_target') {
                  isStreamingToFile = true;
                  currentStreamFile = data.file_path;
                  onLiveStreamToEditor(currentStreamFile, '', true);
                } else if (data.type === 'file_saved') {
                  onFileAutoSaved(data.file_path, data.revision);
                } else if (data.message && data.message.content) {
                  const token = data.message.content;
                  assistantReply += token;

                  if (isStreamingToFile) {
                    onLiveStreamToEditor(currentStreamFile, token, false);
                  }

                  if (!isStarted) {
                    setMessages(prev => [...prev, {
                      role: 'assistant',
                      content: assistantReply,
                      modelUsed: selectedOllama
                    }]);
                    isStarted = true;
                  } else {
                    setMessages(prev => {
                      const updated = [...prev];
                      updated[updated.length - 1].content = assistantReply;
                      return updated;
                    });
                  }
                }
              } catch (_) {}
            }
          }
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          showToast(err.message || "Agent execution error", "error");
        }
      } finally {
        setIsLoading(false);
        abortControllerRef.current = null;
      }
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-panel)', overflow: 'hidden' }}>
      {/* Switch Header */}
      <div style={{ 
        padding: '8px 12px', 
        borderBottom: '1px solid var(--border-color)', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between',
        background: 'var(--bg-card)'
      }}>
        <div style={{ display: 'flex', gap: '4px' }}>
          <button
            onClick={() => onModeChange('chat')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 10px',
              borderRadius: '6px',
              border: 'none',
              background: mode === 'chat' ? 'var(--hover-item)' : 'transparent',
              color: mode === 'chat' ? 'var(--btn-primary)' : 'var(--text-muted)',
              fontSize: '11.5px',
              fontWeight: mode === 'chat' ? 600 : 500,
              cursor: 'pointer'
            }}
          >
            <MessageSquare size={13} />
            Global Chat
          </button>

          <button
            onClick={() => onModeChange('agent')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 10px',
              borderRadius: '6px',
              border: 'none',
              background: mode === 'agent' ? 'var(--hover-item)' : 'transparent',
              color: mode === 'agent' ? 'var(--btn-primary)' : 'var(--text-muted)',
              fontSize: '11.5px',
              fontWeight: mode === 'agent' ? 600 : 500,
              cursor: 'pointer'
            }}
          >
            <Sparkles size={13} />
            Project Agent
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            onClick={handleClearHistory}
            title="Clear history"
            className="theme-toggle-btn"
            style={{ padding: '3px 6px', color: '#ef4444' }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {mode === 'agent' && (
        <div style={{ 
          padding: '5px 12px', 
          background: 'var(--bg-panel-sub)', 
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '11px'
        }}>
          <span style={{ color: 'var(--text-muted)' }}>
            Project: <b style={{ color: 'var(--text-main)' }}>{activeProject || 'None'}</b>
          </span>
          {activeFilePath && (
            <span style={{ color: 'var(--text-muted)', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              File: <b style={{ color: 'var(--text-main)' }}>{activeFilePath}</b>
            </span>
          )}
        </div>
      )}

      {/* Messages Feed */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {messages.length === 0 ? (
          <div style={{ 
            height: '100%', 
            display: 'flex', 
            flexDirection: 'column', 
            alignItems: 'center', 
            justifyContent: 'center', 
            color: 'var(--text-muted)',
            textAlign: 'center',
            padding: '0 20px',
            gap: '8px'
          }}>
            {mode === 'chat' ? (
              <>
                <MessageSquare size={32} opacity={0.3} />
                <p style={{ margin: 0, fontSize: '13px', fontWeight: 500 }}>Global AI Chat</p>
                <p style={{ margin: 0, fontSize: '11.5px', lineHeight: 1.4 }}>
                  Create projects:<br/>
                  <code style={{ background: 'var(--hover-item)', padding: '2px 5px', borderRadius: '4px' }}>создай докер проект test-docker</code><br/>
                  Or generate images via ComfyUI:<br/>
                  <code style={{ background: 'var(--hover-item)', padding: '2px 5px', borderRadius: '4px' }}>создай картинку киберпанк город</code>
                </p>
              </>
            ) : (
              <>
                <Sparkles size={32} opacity={0.3} />
                <p style={{ margin: 0, fontSize: '13px', fontWeight: 500 }}>Project Developer Agent</p>
                <p style={{ margin: 0, fontSize: '11.5px', lineHeight: 1.4 }}>
                  {activeProject 
                    ? `Agent ready for "${activeProject}".` 
                    : 'Select a project on the left panel to begin.'}
                </p>
              </>
            )}
          </div>
        ) : (
          messages.map((m, idx) => (
            <div 
              key={idx} 
              onMouseEnter={() => setHoveredMsgIdx(idx)}
              onMouseLeave={() => setHoveredMsgIdx(null)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: m.role === 'user' ? 'flex-end' : 'flex-start',
                position: 'relative'
              }}
            >
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '6px', 
                marginBottom: '4px', 
                fontSize: '10.5px', 
                color: 'var(--text-muted)' 
              }}>
                {m.role === 'assistant' ? (
                  <>
                    {m.generated_image || m.image_progress ? <ImageIcon size={11} color="#10b981" /> : <Terminal size={11} color="var(--btn-primary)" />}
                    <span>{m.modelUsed || activeModelUsed || selectedOllama}</span>
                  </>
                ) : (
                  <span>You</span>
                )}
                
                {/* Actions: Copy & Delete — видны ТОЛЬКО при наведении на сообщение */}
                <div style={{ 
                  display: 'inline-flex', 
                  alignItems: 'center', 
                  gap: '4px', 
                  marginLeft: '6px',
                  opacity: hoveredMsgIdx === idx ? 1 : 0,
                  pointerEvents: hoveredMsgIdx === idx ? 'auto' : 'none',
                  transition: 'opacity 0.15s ease-in-out'
                }}>
                  <button
                    onClick={() => handleCopyText(m.content)}
                    className="theme-toggle-btn"
                    title="Copy message text"
                    style={{ padding: '2px 4px' }}
                  >
                    <Copy size={11} />
                  </button>
                  <button
                    onClick={() => handleDeleteMessage(idx)}
                    className="theme-toggle-btn"
                    title="Delete message"
                    style={{ padding: '2px 4px', color: '#ef4444' }}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>

              <div 
                style={{
                  maxWidth: '92%',
                  padding: '10px 14px',
                  borderRadius: '10px',
                  fontSize: '12.5px',
                  lineHeight: '1.45',
                  wordBreak: 'break-word',
                  background: m.role === 'user' ? 'var(--btn-primary)' : 'var(--bg-card)',
                  color: m.role === 'user' ? '#ffffff' : 'var(--text-main)',
                  border: m.role === 'user' ? 'none' : '1px solid var(--border-color)',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.06)'
                }}
              >
                {/* User attached images */}
                {m.images && m.images.length > 0 && (
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
                    {m.images.map((img, i) => (
                      <img 
                        key={i} 
                        src={`data:image/jpeg;base64,${img}`} 
                        alt="attachment" 
                        style={{ width: '80px', height: '80px', objectFit: 'cover', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.2)' }}
                      />
                    ))}
                  </div>
                )}

                {/* Persistent ComfyUI Progress Card */}
                {m.image_progress && (
                  <div style={{
                    background: 'var(--bg-panel)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    padding: '8px 10px',
                    marginBottom: '8px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '5px'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px' }}>
                      <span style={{ fontWeight: 600, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <ImageIcon size={12} color="var(--btn-primary)" />
                        ComfyUI Execution
                      </span>
                      <span style={{ color: 'var(--btn-primary)', fontWeight: 600 }}>
                        {m.image_progress.percent}%
                      </span>
                    </div>

                    <div style={{ width: '100%', height: '5px', background: 'var(--hover-item)', borderRadius: '3px', overflow: 'hidden' }}>
                      <div 
                        style={{ 
                          height: '100%', 
                          width: `${m.image_progress.percent}%`, 
                          background: 'linear-gradient(90deg, #3574f0, #10b981)',
                          transition: 'width 0.2s ease-in-out'
                        }} 
                      />
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-muted)' }}>
                      <span>{m.image_progress.status}</span>
                      {m.image_progress.total > 0 && <span>Step {m.image_progress.step} / {m.image_progress.total}</span>}
                    </div>
                  </div>
                )}

                {/* Generated Image Preview + Hover Actions */}
                {m.generated_image && (
                  <ImageCardWithHover 
                    imageUrl={m.generated_image}
                    prompt={m.image_prompt}
                    activeProject={activeProject}
                    onCopy={() => handleCopyImage(m.generated_image!)}
                    onSave={() => handleSaveImageToProject(m.generated_image!)}
                    onEnlarge={() => onOpenImageModal && onOpenImageModal(m.generated_image!, m.image_prompt)}
                  />
                )}

                {/* SD Prompt Section */}
                {m.image_prompt && (
                  <div style={{ 
                    background: 'var(--bg-panel)', 
                    padding: '6px 8px', 
                    borderRadius: '6px', 
                    border: '1px solid var(--border-color)',
                    fontSize: '11px',
                    color: 'var(--text-muted)',
                    marginBottom: '6px'
                  }}>
                    <b style={{ color: 'var(--text-main)', display: 'block', marginBottom: '2px' }}>SD Prompt (dolphin-llama3):</b>
                    <span style={{ fontStyle: 'italic' }}>{m.image_prompt}</span>
                  </div>
                )}

                {/* Content with code block insertion & copying */}
                {renderMessageContent(m.content, idx)}
              </div>
            </div>
          ))
        )}

        {isLoading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', fontSize: '11.5px' }}>
            <Loader2 size={14} className="animate-spin" />
            <span>Processing request...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Uploaded Images Preview Strip */}
      {selectedImages.length > 0 && (
        <div style={{ padding: '6px 12px', display: 'flex', gap: '8px', background: 'var(--input-bg)', borderTop: '1px solid var(--border-color)' }}>
          {selectedImages.map((b64, idx) => (
            <div key={idx} style={{ position: 'relative' }}>
              <img 
                src={`data:image/jpeg;base64,${b64}`} 
                alt="thumb" 
                style={{ width: '45px', height: '45px', objectFit: 'cover', borderRadius: '4px' }} 
              />
              <button
                onClick={() => setSelectedImages(prev => prev.filter((_, i) => i !== idx))}
                style={{
                  position: 'absolute',
                  top: '-4px',
                  right: '-4px',
                  background: '#ef4444',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '50%',
                  width: '15px',
                  height: '15px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '9px'
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input Form with Readonly & Cancel Support */}
      <form 
        onSubmit={handleSendMessage}
        style={{ 
          padding: '10px 12px', 
          borderTop: '1px solid var(--border-color)', 
          background: 'var(--bg-card)',
          display: 'flex', 
          gap: '8px', 
          alignItems: 'center' 
        }}
      >
        <input 
          type="file" 
          ref={fileInputRef} 
          onChange={handleImageUpload} 
          accept="image/*" 
          multiple 
          style={{ display: 'none' }} 
        />

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          title="Attach image"
          className="theme-toggle-btn"
          style={{ padding: '6px 7px' }}
          disabled={isLoading}
        >
          <Paperclip size={15} />
        </button>

        <input 
          value={inputVal}
          onChange={e => setInputVal(e.target.value)}
          placeholder={isLoading ? "Generating image... Please wait" : (mode === 'chat' ? "Ask something or: создай картинку киберпанк город..." : "Describe task for project...")}
          className="studio-input"
          style={{ 
            flex: 1, 
            padding: '7px 10px', 
            fontSize: '12px',
            opacity: isLoading ? 0.7 : 1,
            cursor: isLoading ? 'not-allowed' : 'text'
          }}
          readOnly={isLoading}
          disabled={isLoading}
        />

        {isLoading ? (
          <button 
            type="button" 
            onClick={handleCancelGeneration}
            title="Cancel generation"
            style={{ 
              padding: '7px 12px', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              background: '#ef4444',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              gap: '4px',
              fontSize: '11px',
              fontWeight: 600
            }}
          >
            <Square size={12} fill="#ffffff" />
            Cancel
          </button>
        ) : (
          <button 
            type="submit" 
            className="btn-primary" 
            style={{ padding: '7px 12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            disabled={!inputVal.trim()}
          >
            <Send size={14} />
          </button>
        )}
      </form>
    </div>
  );
}

// Отдельный легковесный компонент для изоляции hover-эффекта кнопок на картинке
function ImageCardWithHover({
  imageUrl,
  prompt,
  activeProject,
  onCopy,
  onSave,
  onEnlarge
}: {
  imageUrl: string;
  prompt?: string;
  activeProject: string | null;
  onCopy: () => void;
  onSave: () => void;
  onEnlarge: () => void;
}) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div 
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{ 
        position: 'relative', 
        borderRadius: '8px', 
        overflow: 'hidden', 
        border: '1px solid var(--border-color)',
        maxHeight: '260px',
        background: '#111',
        marginBottom: '8px'
      }}
    >
      <img 
        src={imageUrl} 
        alt="generated art" 
        style={{ width: '100%', display: 'block', objectFit: 'contain', cursor: 'pointer' }}
        onClick={onEnlarge}
      />
      
      {/* Кнопки действий видны ТОЛЬКО при наведении на картинку */}
      <div style={{
        position: 'absolute',
        right: '8px',
        bottom: '8px',
        display: 'flex',
        gap: '6px',
        opacity: isHovered ? 1 : 0,
        pointerEvents: isHovered ? 'auto' : 'none',
        transition: 'opacity 0.2s ease-in-out'
      }}>
        <button
          type="button"
          onClick={onCopy}
          style={{
            background: 'rgba(0, 0, 0, 0.8)',
            backdropFilter: 'blur(4px)',
            color: '#fff',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: '5px',
            padding: '4px 7px',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            fontSize: '10.5px',
            cursor: 'pointer'
          }}
          title="Copy image to clipboard"
        >
          <Copy size={11} />
          Copy
        </button>

        {activeProject && (
          <button
            type="button"
            onClick={onSave}
            style={{
              background: 'rgba(0, 0, 0, 0.8)',
              backdropFilter: 'blur(4px)',
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: '5px',
              padding: '4px 7px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '10.5px',
              cursor: 'pointer'
            }}
            title="Save image to project directory"
          >
            <FolderPlus size={11} />
            Save to Project
          </button>
        )}

        <button
          type="button"
          onClick={onEnlarge}
          style={{
            background: 'rgba(0, 0, 0, 0.8)',
            backdropFilter: 'blur(4px)',
            color: '#fff',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: '5px',
            padding: '4px 7px',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            fontSize: '10.5px',
            cursor: 'pointer'
          }}
          title="View full size"
        >
          <Maximize2 size={11} />
          Enlarge
        </button>
      </div>
    </div>
  );
}
