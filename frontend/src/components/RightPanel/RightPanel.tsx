import { API_BASE_URL } from "../../config";
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

  const [sessionStats, setSessionStats] = useState<{ msgCount: number; sizeKb: number }>({ msgCount: 0, sizeKb: 0 });
  const [modelContext, setModelContext] = useState<number | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const fetchSessionStats = async () => {
    try {
      const url = mode === 'chat' 
        ? `${API_BASE_URL}/chat/stats`
        : (activeProject ? `${API_BASE_URL}/agent/${encodeURIComponent(activeProject)}/stats` : null);
      if (!url) {
        setSessionStats({ msgCount: 0, sizeKb: 0 });
        return;
      }
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setSessionStats({ msgCount: data.msg_count || 0, sizeKb: data.size_kb || 0 });
      }
    } catch {
      // fallback
    }
  };

  const fetchModelContext = async (modelName: string) => {
    if (!modelName) return;
    try {
      const res = await fetch(`${API_BASE_URL}/system/model-info?model=${encodeURIComponent(modelName)}`);
      if (res.ok) {
        const data = await res.json();
        setModelContext(data.context_length || null);
      }
    } catch {
      setModelContext(null);
    }
  };

  useEffect(() => {
    fetchSessionStats();
  }, [mode, activeProject, messages.length]);

  useEffect(() => {
    const targetModel = selectedOllama || 'qwen2.5-coder:7b-instruct-q4_K_M';
    fetchModelContext(targetModel);
  }, [selectedOllama]);

  const loadHistory = () => {
    if (mode === 'chat') {
      fetch(`${API_BASE_URL}/chat/history`)
        .then(res => res.json())
        .then(data => setMessages(Array.isArray(data) ? data : []))
        .catch(() => setMessages([]));
    } else {
      if (!activeProject) {
        setMessages([]);
        return;
      }
      fetch(`${API_BASE_URL}/agent/${encodeURIComponent(activeProject)}/history`)
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
      fetch(`${API_BASE_URL}/chat/history`, { method: 'DELETE' })
        .then(res => {
          if (res.ok) {
            setMessages([]);
            setSessionStats({ msgCount: 0, sizeKb: 0 });
            showToast("Global Chat history cleared", "info");
          }
        });
    } else if (activeProject) {
      fetch(`${API_BASE_URL}/agent/${encodeURIComponent(activeProject)}/history`, { method: 'DELETE' })
        .then(res => {
          if (res.ok) {
            setMessages([]);
            setSessionStats({ msgCount: 0, sizeKb: 0 });
            showToast(`Agent history for "${activeProject}" cleared`, "info");
          }
        });
    }
  };

  const handleDeleteMessage = (idxToDelete: number) => {
    setMessages(prev => prev.filter((_, idx) => idx !== idxToDelete));
    showToast("Message deleted from view", "info");
  };

  const handleStopExecution = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    fetch(`${API_BASE_URL}/chat/stop`, { method: 'POST' }).catch(() => {});
    setIsLoading(false);
    showToast("Execution stopped", "info");
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const base64 = ev.target?.result as string;
        if (base64) {
          setSelectedImages(prev => [...prev, base64]);
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const handleSendMessage = async () => {
    const trimmed = inputVal.trim();
    if ((!trimmed && selectedImages.length === 0) || isLoading) return;

    if (mode === 'agent' && !activeProject) {
      showToast("Please select a project to use Project Agent", "warning");
      return;
    }

    const userMsg: ChatMessage = {
      role: 'user',
      content: trimmed,
      images: selectedImages.length > 0 ? selectedImages : undefined
    };

    setMessages(prev => [...prev, userMsg]);
    setInputVal('');
    setSelectedImages([]);
    setIsLoading(true);

    abortControllerRef.current = new AbortController();

    const assistantMsgPlaceholder: ChatMessage = {
      role: 'assistant',
      content: '',
      modelUsed: selectedOllama
    };
    setMessages(prev => [...prev, assistantMsgPlaceholder]);

    try {
      if (mode === 'chat') {
        const res = await fetch(`${API_BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [...messages, userMsg],
            model: selectedOllama,
            comfy_checkpoint: selectedComfy
          }),
          signal: abortControllerRef.current.signal
        });

        if (!res.ok || !res.body) {
          throw new Error('Failed to start chat completion');
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const rawData = line.slice(6).trim();
              if (rawData === '[DONE]') break;
              try {
                const parsed = JSON.parse(rawData);
                if (parsed.message?.content) {
                  setMessages(prev => {
                    const next = [...prev];
                    const lastIdx = next.length - 1;
                    if (lastIdx >= 0) {
                      next[lastIdx] = {
                        ...next[lastIdx],
                        content: next[lastIdx].content + parsed.message.content
                      };
                    }
                    return next;
                  });
                } else if (parsed.type === 'image_progress') {
                  setMessages(prev => {
                    const next = [...prev];
                    const lastIdx = next.length - 1;
                    if (lastIdx >= 0) {
                      next[lastIdx] = {
                        ...next[lastIdx],
                        image_progress: parsed.data
                      };
                    }
                    return next;
                  });
                } else if (parsed.type === 'image_result') {
                  setMessages(prev => {
                    const next = [...prev];
                    const lastIdx = next.length - 1;
                    if (lastIdx >= 0) {
                      next[lastIdx] = {
                        ...next[lastIdx],
                        generated_image: parsed.url,
                        image_prompt: parsed.prompt,
                        image_progress: undefined
                      };
                    }
                    return next;
                  });
                } else if (parsed.type === 'project_created') {
                  const targetProj = parsed.project_name || parsed.project;
                  onProjectCreatedFromChat(targetProj, parsed.default_file);
                  onRefreshProjectTree?.();
                  if (targetProj) {
                    fetch(`${API_BASE_URL}/agent/${encodeURIComponent(targetProj)}/history`)
                      .then(res => res.json())
                      .then(data => {
                        if (Array.isArray(data) && data.length > 0) {
                          setMessages(data);
                        }
                      })
                      .catch(() => {});
                  }
                }
              } catch {
                // ignore
              }
            }
          }
        }
      } else {
        const res = await fetch(`${API_BASE_URL}/agent/execute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            project_name: activeProject,
            prompt: trimmed,
            model: selectedOllama,
            active_file: activeFilePath || undefined,
            file_content: activeFileContent || undefined,
            comfy_checkpoint: selectedComfy
          }),
          signal: abortControllerRef.current.signal
        });

        if (!res.ok || !res.body) {
          throw new Error('Failed to start agent task execution');
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const rawData = line.slice(6).trim();
              if (rawData === '[DONE]') break;
              try {
                const parsed = JSON.parse(rawData);
                if (parsed.message?.content) {
                  setMessages(prev => {
                    const next = [...prev];
                    const lastIdx = next.length - 1;
                    if (lastIdx >= 0) {
                      next[lastIdx] = {
                        ...next[lastIdx],
                        content: next[lastIdx].content + parsed.message.content
                      };
                    }
                    return next;
                  });
                } else if (parsed.type === 'stream_code') {
                  onLiveStreamToEditor(parsed.path, parsed.chunk, parsed.is_start);
                } else if (parsed.type === 'file_saved') {
                  onFileAutoSaved(parsed.path, parsed.revision);
                  onRefreshProjectTree?.();
                } else if (parsed.type === 'image_progress') {
                  setMessages(prev => {
                    const next = [...prev];
                    const lastIdx = next.length - 1;
                    if (lastIdx >= 0) {
                      next[lastIdx] = {
                        ...next[lastIdx],
                        image_progress: parsed.data
                      };
                    }
                    return next;
                  });
                } else if (parsed.type === 'image_result') {
                  setMessages(prev => {
                    const next = [...prev];
                    const lastIdx = next.length - 1;
                    if (lastIdx >= 0) {
                      next[lastIdx] = {
                        ...next[lastIdx],
                        generated_image: parsed.url,
                        image_prompt: parsed.prompt,
                        image_progress: undefined
                      };
                    }
                    return next;
                  });
                  onRefreshProjectTree?.();
                }
              } catch {
                // ignore
              }
            }
          }
        }
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        showToast("Error processing request", "error");
      }
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
      fetchSessionStats();
    }
  };

  const handleCopyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCodeIdx(id);
    setTimeout(() => setCopiedCodeIdx(null), 2000);
  };

  const renderMessageContent = (content: string) => {
    const codeBlockRegex = /```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g;
    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = codeBlockRegex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        parts.push(
          <span key={`text-${lastIndex}`}>
            {content.substring(lastIndex, match.index)}
          </span>
        );
      }
      const lang = match[1] || 'code';
      const code = match[2];
      const codeId = `code-${match.index}`;

      parts.push(
        <div key={codeId} style={{
          marginTop: 6,
          marginBottom: 6,
          borderRadius: 6,
          overflow: 'hidden',
          border: '1px solid var(--border-color)',
          background: '#0d1117'
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '3px 8px',
            backgroundColor: 'rgba(255,255,255,0.05)',
            fontSize: 11,
            color: '#8b949e'
          }}>
            <span>{lang}</span>
            <div style={{ display: 'flex', gap: 6 }}>
              {onInsertCodeToEditor && (
                <button
                  onClick={() => onInsertCodeToEditor(code)}
                  title="Insert into active editor"
                  style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3, fontSize: 11 }}
                >
                  <ArrowDownToLine size={12} />
                  Insert
                </button>
              )}
              <button
                onClick={() => handleCopyText(code, codeId)}
                title="Copy code"
                style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3, fontSize: 11 }}
              >
                {copiedCodeIdx === codeId ? <Check size={12} color="#10b981" /> : <Copy size={12} />}
                Copy
              </button>
            </div>
          </div>
          <pre style={{ margin: 0, padding: '8px 10px', overflowX: 'auto', fontSize: 12, color: '#e6edf3', fontFamily: 'monospace' }}>
            <code>{code}</code>
          </pre>
        </div>
      );
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < content.length) {
      parts.push(
        <span key={`text-${lastIndex}`}>
          {content.substring(lastIndex)}
        </span>
      );
    }

    return parts.length > 0 ? parts : content;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-panel)' }}>
      {/* Header Tabs */}
      <div className="right-panel-header" style={{
        height: 38,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 8px',
        borderBottom: '1px solid var(--border-color)',
        background: 'var(--bg-header)'
      }}>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            onClick={() => onModeChange('chat')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '4px 10px',
              borderRadius: 5,
              border: 'none',
              background: mode === 'chat' ? 'var(--bg-active-tab, rgba(59, 130, 246, 0.15))' : 'transparent',
              color: mode === 'chat' ? 'var(--primary-color, #2563eb)' : 'var(--text-muted)',
              fontWeight: 600,
              fontSize: 12,
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
              gap: 5,
              padding: '4px 10px',
              borderRadius: 5,
              border: 'none',
              background: mode === 'agent' ? 'var(--bg-active-tab, rgba(59, 130, 246, 0.15))' : 'transparent',
              color: mode === 'agent' ? 'var(--primary-color, #2563eb)' : 'var(--text-muted)',
              fontWeight: 600,
              fontSize: 12,
              cursor: 'pointer'
            }}
          >
            <Sparkles size={13} />
            Project Agent
          </button>
        </div>

        <button
          onClick={handleClearHistory}
          className="theme-toggle-btn"
          style={{ padding: 4 }}
          title={mode === 'chat' ? "Clear Global Chat" : "Clear Project Agent History"}
        >
          <Trash2 size={13} />
        </button>
      </div>

      {/* Diagnostics / Status Bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '4px 12px',
        backgroundColor: 'var(--bg-subtle, rgba(0, 0, 0, 0.2))',
        borderBottom: '1px solid var(--border-color)',
        fontSize: '11px',
        color: 'var(--text-muted)',
        fontFamily: 'monospace'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span title="Total messages in current session">
            <strong style={{ color: 'var(--text-main)' }}>Messages:</strong> {sessionStats.msgCount}
          </span>
          <span title="MongoDB BSON session size">
            <strong style={{ color: 'var(--text-main)' }}>DB:</strong> {sessionStats.sizeKb > 1024 ? `${(sessionStats.sizeKb / 1024).toFixed(2)} MB` : `${sessionStats.sizeKb} KB`}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }} title="Active model context window size">
          <strong style={{ color: 'var(--text-main)' }}>Context:</strong> 
          <span style={{ color: 'var(--primary-color, #3b82f6)', fontWeight: 600 }}>
            {modelContext ? (modelContext >= 1024 ? `${Math.round(modelContext / 1024)}k` : `${modelContext}`) : 'auto'}
          </span>
        </div>
      </div>

      {mode === 'agent' && (
        <div style={{
          padding: '4px 12px',
          fontSize: 11,
          borderBottom: '1px solid var(--border-color)',
          color: 'var(--text-muted)'
        }}>
          Project: <strong style={{ color: 'var(--text-main)' }}>{activeProject || 'None'}</strong>
        </div>
      )}

      {/* Messages Scroll Area */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {messages.length === 0 ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', gap: 8 }}>
            {mode === 'chat' ? <MessageSquare size={32} opacity={0.3} /> : <Sparkles size={32} opacity={0.3} />}
            <span style={{ fontSize: 12 }}>
              {mode === 'chat' ? 'Start a conversation or ask for code/images' : (activeProject ? `Ready to assist in "${activeProject}"` : 'Select a project to activate agent')}
            </span>
          </div>
        ) : (
          messages.map((msg, idx) => {
            const isUser = msg.role === 'user';
            return (
              <div 
                key={idx}
                onMouseEnter={() => setHoveredMsgIdx(idx)}
                onMouseLeave={() => setHoveredMsgIdx(null)}
                style={{
                  display: 'flex',
                  flexDirection: isUser ? 'row-reverse' : 'row',
                  alignItems: 'flex-start',
                  gap: 6,
                  alignSelf: isUser ? 'flex-end' : 'flex-start',
                  maxWidth: '92%'
                }}
              >
                {/* Bubble */}
                <div style={{
                  padding: '8px 12px',
                  borderRadius: 8,
                  fontSize: 12.5,
                  lineHeight: 1.45,
                  background: isUser ? 'var(--primary-color, #2563eb)' : 'var(--bg-card, #ffffff)',
                  color: isUser ? '#ffffff' : 'var(--text-main, #0f172a)',
                  border: isUser ? 'none' : '1px solid var(--border-color, #e2e8f0)',
                  wordBreak: 'break-word',
                  boxShadow: isUser ? 'none' : '0 1px 2px rgba(0,0,0,0.05)'
                }}>
                  {renderMessageContent(msg.content)}

                  {/* ComfyUI Progress Bar */}
                  {msg.image_progress && (
                    <div style={{ marginTop: 8, padding: 8, borderRadius: 6, background: 'rgba(0,0,0,0.2)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                        <span>ComfyUI Execution</span>
                        <span>{msg.image_progress.percent}%</span>
                      </div>
                      <div style={{ height: 4, width: '100%', background: 'rgba(255,255,255,0.2)', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${msg.image_progress.percent}%`, background: '#10b981', transition: 'width 0.2s' }} />
                      </div>
                    </div>
                  )}

                  {/* Generated Image Result Card */}
                  {msg.generated_image && (
                    <div style={{ marginTop: 8, position: 'relative', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border-color)' }}>
                      <img 
                        src={msg.generated_image} 
                        alt="generated art" 
                        style={{ width: '100%', maxHeight: 260, objectFit: 'cover', display: 'block' }}
                      />
                      {msg.image_prompt && (
                        <div style={{ padding: '4px 6px', fontSize: 11, color: 'var(--text-muted)' }}>
                          {msg.image_prompt}
                        </div>
                      )}
                      <button
                        onClick={() => onOpenImageModal?.(msg.generated_image!, msg.image_prompt)}
                        style={{
                          position: 'absolute',
                          top: 6,
                          right: 6,
                          background: 'rgba(0,0,0,0.6)',
                          border: 'none',
                          color: '#fff',
                          padding: 4,
                          borderRadius: 4,
                          cursor: 'pointer'
                        }}
                        title="Enlarge image"
                      >
                        <Maximize2 size={13} />
                      </button>
                    </div>
                  )}
                </div>

                {/* Side Hover Actions (never overlaps text) */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3,
                  padding: '2px 4px',
                  borderRadius: 6,
                  background: 'var(--bg-card, #ffffff)',
                  border: '1px solid var(--border-color, #e2e8f0)',
                  boxShadow: '0 2px 5px rgba(0,0,0,0.08)',
                  opacity: hoveredMsgIdx === idx ? 1 : 0,
                  pointerEvents: hoveredMsgIdx === idx ? 'auto' : 'none',
                  transition: 'opacity 0.15s ease',
                  marginTop: 2
                }}>
                  <button
                    onClick={() => handleCopyText(msg.content, `msg-${idx}`)}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--text-muted, #64748b)',
                      padding: 3,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                    title="Copy message"
                  >
                    {copiedCodeIdx === `msg-${idx}` ? <Check size={12} color="#10b981" /> : <Copy size={12} />}
                  </button>
                  <button
                    onClick={() => handleDeleteMessage(idx)}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--text-muted, #64748b)',
                      padding: 3,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                    title="Delete message"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div style={{ padding: '8px 10px', borderTop: '1px solid var(--border-color)', background: 'var(--bg-header)' }}>
        {selectedImages.length > 0 && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 6, overflowX: 'auto' }}>
            {selectedImages.map((img, i) => (
              <div key={i} style={{ position: 'relative', width: 44, height: 44, borderRadius: 4, overflow: 'hidden' }}>
                <img src={img} alt="attachment" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                <button
                  onClick={() => setSelectedImages(prev => prev.filter((_, idx) => idx !== i))}
                  style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(0,0,0,0.7)', border: 'none', color: '#fff', borderRadius: '50%', width: 14, height: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10 }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImageSelect}
            accept="image/*"
            multiple
            style={{ display: 'none' }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="theme-toggle-btn"
            style={{ padding: 6 }}
            title="Attach images"
          >
            <Paperclip size={15} />
          </button>

          <textarea
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
              }
            }}
            placeholder={mode === 'chat' ? "Ask question or request image..." : "Give task to agent..."}
            rows={2}
            style={{
              flex: 1,
              resize: 'none',
              borderRadius: 6,
              border: '1px solid var(--border-color)',
              background: 'var(--bg-panel)',
              color: 'var(--text-main)',
              padding: '6px 8px',
              fontSize: 12.5,
              outline: 'none'
            }}
          />

          {isLoading ? (
            <button
              onClick={handleStopExecution}
              style={{
                padding: '8px 12px',
                borderRadius: 6,
                border: 'none',
                background: '#ef4444',
                color: '#fff',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4
              }}
              title="Stop execution"
            >
              <Square size={14} fill="#fff" />
            </button>
          ) : (
            <button
              onClick={handleSendMessage}
              style={{
                padding: '8px 12px',
                borderRadius: 6,
                border: 'none',
                background: 'var(--primary-color, #2563eb)',
                color: '#fff',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4
              }}
              title="Send message"
            >
              <Send size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
