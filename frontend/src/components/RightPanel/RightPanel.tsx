import React, { useState, useRef, useEffect } from 'react';
import { 
  MessageSquare, Bot, Send, Paperclip, X, Square, Loader2, 
  Sparkles, Copy, Check, Trash2, AlertTriangle 
} from 'lucide-react';

interface ChatMessage {
  role: string;
  content: string;
  images?: string[];
  modelUsed?: string;
}

interface Props {
  activeProject: string | null;
  selectedOllama: string;
  selectedComfy: string;
}

export default function RightPanel({ activeProject, selectedOllama }: Props) {
  const [mode, setMode] = useState<'chat' | 'agent'>('chat');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  
  const [loading, setLoading] = useState(false);
  const [activeModelInfo, setActiveModelInfo] = useState<string | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const loadHistory = () => {
    if (mode === 'chat') {
      fetch('http://localhost:8000/api/chat/history')
        .then(res => res.json())
        .then(data => setMessages(Array.isArray(data) ? data : []))
        .catch(console.error);
    } else {
      if (!activeProject) {
        setMessages([]);
        return;
      }
      fetch(`http://localhost:8000/api/agent/${encodeURIComponent(activeProject)}/history`)
        .then(res => res.json())
        .then(data => setMessages(Array.isArray(data) ? data : []))
        .catch(console.error);
    }
  };

  useEffect(() => {
    loadHistory();
  }, [mode, activeProject]);

  const confirmClearHistory = () => {
    setShowClearConfirm(false);
    if (mode === 'chat') {
      fetch('http://localhost:8000/api/chat/history', { method: 'DELETE' })
        .then(() => setMessages([]));
    } else {
      if (!activeProject) return;
      fetch(`http://localhost:8000/api/agent/${encodeURIComponent(activeProject)}/history`, { method: 'DELETE' })
        .then(() => setMessages([]));
    }
  };

  const handleCopyMessage = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => {
      setCopiedIndex(null);
    }, 2000);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64Pure = result.split(',')[1];
      setAttachedImage(base64Pure);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            setAttachedImage(result.split(',')[1]);
          };
          reader.readAsDataURL(file);
          e.preventDefault();
          break;
        }
      }
    }
  };

  const stopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setLoading(false);
    setActiveModelInfo(null);
  };

  const sendMessage = async () => {
    if ((!input.trim() && !attachedImage) || loading) return;

    const userMsg: ChatMessage = {
      role: 'user',
      content: input,
      images: attachedImage ? [attachedImage] : undefined
    };

    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput('');
    setAttachedImage(null);
    setLoading(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const endpoint = mode === 'chat' 
      ? 'http://localhost:8000/api/chat/completions'
      : 'http://localhost:8000/api/agent/execute';

    const payload = mode === 'chat'
      ? { 
          model: selectedOllama, 
          messages: nextMessages.map(m => ({ role: m.role, content: m.content, images: m.images }))
        }
      : { 
          project_name: activeProject, 
          prompt: userMsg.content, 
          model: selectedOllama 
        };

    const assistantMsg: ChatMessage = { role: 'assistant', content: '' };
    setMessages(prev => [...prev, assistantMsg]);

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (line.startsWith('data:')) {
              try {
                const data = JSON.parse(line.replace('data:', '').trim());
                if (data.type === 'meta') {
                  setActiveModelInfo(data.model);
                  assistantMsg.modelUsed = data.model;
                  continue;
                }

                const token = data.message?.content || '';
                assistantMsg.content += token;
                setMessages(prev => [...prev.slice(0, -1), { ...assistantMsg }]);
              } catch (e) {}
            }
          }
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        assistantMsg.content += ' [stopped by user]';
        setMessages(prev => [...prev.slice(0, -1), { ...assistantMsg }]);
      } else {
        console.error(err);
      }
    } finally {
      setLoading(false);
      setActiveModelInfo(null);
      abortControllerRef.current = null;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-panel)' }}>
      {/* Header Tabs */}
      <div style={{ 
        padding: '8px 12px', 
        borderBottom: '1px solid var(--border-color)', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between', 
        background: 'var(--bg-header)' 
      }}>
        <div style={{ 
          display: 'flex', 
          background: 'var(--input-bg)', 
          border: '1px solid var(--input-border)', 
          padding: '3px', 
          borderRadius: '7px',
          gap: '2px'
        }}>
          <button 
            onClick={() => setMode('chat')}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 12px', fontSize: '12px',
              fontWeight: 600, borderRadius: '5px', border: 'none', cursor: 'pointer',
              background: mode === 'chat' ? '#3574f0' : 'transparent',
              color: mode === 'chat' ? '#ffffff' : 'var(--text-muted)',
              boxShadow: mode === 'chat' ? '0 1px 4px rgba(53, 116, 240, 0.35)' : 'none',
              transition: 'all 0.15s ease'
            }}
          >
            <MessageSquare size={13} color={mode === 'chat' ? '#ffffff' : 'var(--text-muted)'} />
            <span>Global Chat</span>
          </button>
          
          <button 
            onClick={() => setMode('agent')}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 12px', fontSize: '12px',
              fontWeight: 600, borderRadius: '5px', border: 'none', cursor: 'pointer',
              background: mode === 'agent' ? '#3574f0' : 'transparent',
              color: mode === 'agent' ? '#ffffff' : 'var(--text-muted)',
              boxShadow: mode === 'agent' ? '0 1px 4px rgba(53, 116, 240, 0.35)' : 'none',
              transition: 'all 0.15s ease'
            }}
          >
            <Bot size={13} color={mode === 'agent' ? '#ffffff' : 'var(--text-muted)'} />
            <span>Project Agent</span>
          </button>
        </div>

        {/* Right header controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', maxWidth: '120px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {mode === 'agent' ? (activeProject ? `📂 ${activeProject}` : '⚠️ No Project') : '🌐 Global'}
          </span>

          {messages.length > 0 && (
            <button
              onClick={() => setShowClearConfirm(true)}
              className="theme-toggle-btn"
              title="Clear conversation history"
              style={{ padding: '4px 6px', color: '#ef4444' }}
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Messages Feed */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px', marginTop: '30px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
            <Sparkles size={24} color="#3574f0" />
            <span>{mode === 'chat' ? 'Conversation history is empty. Ask anything.' : `Agent active for project ${activeProject || '(select a project on the left)'}.`}</span>
          </div>
        )}

        {messages.map((m, i) => {
          const isUser = m.role === 'user';
          const isCopied = copiedIndex === i;

          return (
            <div 
              key={i} 
              className="chat-message-bubble"
              style={{
                position: 'relative',
                padding: '10px 14px',
                borderRadius: '9px',
                maxWidth: '85%',
                alignSelf: isUser ? 'flex-end' : 'flex-start',
                background: isUser ? '#3574f0' : 'var(--bg-card)',
                color: isUser ? '#ffffff' : 'var(--text-main)',
                border: isUser ? 'none' : '1px solid var(--border-color)',
                fontSize: '12.5px',
                lineHeight: 1.5,
                boxShadow: isUser ? '0 2px 8px rgba(53, 116, 240, 0.28)' : '0 1px 3px rgba(0,0,0,0.05)',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                userSelect: 'text'
              }}
            >
              {/* Floating Copy Button */}
              {m.content && (
                <button
                  onClick={() => handleCopyMessage(m.content, i)}
                  className="msg-copy-btn"
                  title="Copy message"
                  style={{
                    position: 'absolute',
                    top: '6px',
                    right: '6px',
                    background: isUser ? 'rgba(0, 0, 0, 0.3)' : 'var(--hover-item)',
                    border: 'none',
                    borderRadius: '4px',
                    padding: '3px 6px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    color: isUser ? '#ffffff' : 'var(--text-muted)',
                    fontSize: '10px'
                  }}
                >
                  {isCopied ? <Check size={11} color={isUser ? '#ffffff' : '#10b981'} /> : <Copy size={11} />}
                  {isCopied && <span>Copied!</span>}
                </button>
              )}

              {/* Uploaded images render */}
              {m.images && m.images.map((imgBase64, idx) => (
                <img 
                  key={idx}
                  src={`data:image/jpeg;base64,${imgBase64}`}
                  alt="user upload"
                  style={{ maxWidth: '240px', maxHeight: '180px', borderRadius: '6px', objectFit: 'cover', border: '1px solid rgba(255,255,255,0.3)' }}
                />
              ))}

              {/* Model badge */}
              {m.role === 'assistant' && m.modelUsed && (
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  via {m.modelUsed}
                </div>
              )}

              {/* Text content */}
              <span style={{ 
                whiteSpace: 'pre-wrap', 
                paddingRight: m.content ? '18px' : '0',
                color: isUser ? '#ffffff' : 'inherit'
              }}>
                {m.content}
              </span>
            </div>
          );
        })}

        {/* Loading Spinner Indicator */}
        {loading && (
          <div style={{
            alignSelf: 'flex-start',
            background: 'var(--bg-card-sub)',
            border: '1px solid var(--border-color)',
            padding: '8px 12px',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '11.5px',
            color: 'var(--text-muted)'
          }}>
            <Loader2 size={14} className="spin-animate" color="#3574f0" />
            <span>
              {activeModelInfo 
                ? `Running ${activeModelInfo}...` 
                : (attachedImage ? 'Analyzing image via minicpm-v...' : 'Thinking...')}
            </span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Field Container */}
      <div style={{ padding: '8px', borderTop: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '6px', background: 'var(--bg-panel)' }}>
        {attachedImage && (
          <div style={{
            position: 'relative',
            width: 'fit-content',
            background: 'var(--bg-editor)',
            border: '1px solid var(--border-color)',
            borderRadius: '6px',
            padding: '4px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <img 
              src={`data:image/jpeg;base64,${attachedImage}`} 
              alt="attached" 
              style={{ width: '40px', height: '40px', objectFit: 'cover', borderRadius: '4px' }}
            />
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Image attached for MiniCPM-V</span>
            <button 
              onClick={() => setAttachedImage(null)}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px', color: 'var(--text-muted)' }}
              title="Remove image"
            >
              <X size={14} />
            </button>
          </div>
        )}

        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileChange} 
            accept="image/*" 
            style={{ display: 'none' }} 
          />

          <button 
            onClick={() => fileInputRef.current?.click()}
            className="theme-toggle-btn"
            title="Attach image for analysis (or paste Cmd+V)"
            style={{ padding: '6px 8px' }}
          >
            <Paperclip size={14} color={attachedImage ? "#3574f0" : "var(--text-muted)"} />
          </button>

          <input 
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !loading && sendMessage()}
            onPaste={handlePaste}
            placeholder={attachedImage ? "Ask a question about this image..." : (mode === 'chat' ? 'Ask anything...' : 'Instruct agent to modify code...')}
            className="studio-input"
            style={{ flex: 1 }}
          />

          {loading ? (
            <button 
              onClick={stopGeneration} 
              style={{
                background: '#ef4444',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                padding: '6px 10px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '11px',
                fontWeight: 600
              }}
              title="Stop generation"
            >
              <Square size={12} fill="#fff" />
              <span>Stop</span>
            </button>
          ) : (
            <button 
              onClick={sendMessage} 
              disabled={!input.trim() && !attachedImage}
              className="btn-primary" 
              style={{ padding: '6px 10px' }}
            >
              <Send size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Modal Confirm Clear History (100% English UI) */}
      {showClearConfirm && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.65)',
          backdropFilter: 'blur(3px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 3000
        }}>
          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            borderRadius: '10px',
            width: '400px',
            boxShadow: '0 20px 40px rgba(0,0,0,0.3)',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{
                width: '38px', height: '38px', borderRadius: '50%', background: '#fee2e2',
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ef4444'
              }}>
                <AlertTriangle size={20} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--text-main)' }}>
                  Clear History
                </h3>
                <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
                  {mode === 'chat' ? 'Clear all Global Chat messages?' : `Clear agent session for "${activeProject}"?`}
                </p>
              </div>
            </div>

            <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.45 }}>
              This conversation history will be permanently deleted from the database.
            </p>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
              <button
                onClick={() => setShowClearConfirm(false)}
                className="theme-toggle-btn"
                style={{ padding: '6px 12px', fontSize: '12px' }}
              >
                Cancel
              </button>
              <button
                onClick={confirmClearHistory}
                style={{
                  background: '#ef4444',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '6px 14px',
                  fontSize: '12px',
                  fontWeight: 500,
                  cursor: 'pointer'
                }}
              >
                Clear History
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
