import React, { useState, useEffect, useRef } from 'react';
import { 
  Send, Sparkles, MessageSquare, Terminal, Trash2, Paperclip, X,
  CheckCircle, ArrowRight
} from 'lucide-react';
import { useToast } from '../Toast';
import { FileHistoryItem } from '../LeftSidebar/ProjectTree';

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  images?: string[];
  modelUsed?: string;
  created_at?: string;
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
}

export default function RightPanel({
  mode,
  onModeChange,
  activeProject,
  activeFilePath,
  activeFileContent,
  selectedOllama,
  onLiveStreamToEditor,
  onProjectCreatedFromChat,
  onFileAutoSaved
}: Props) {
  const { showToast } = useToast();
  const [inputVal, setInputVal] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeModelUsed, setActiveModelUsed] = useState<string | null>(null);
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
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
            showToast("История Global Chat очищена", "info");
          }
        });
    } else if (activeProject) {
      fetch(`http://localhost:8000/api/agent/${encodeURIComponent(activeProject)}/history`, { method: 'DELETE' })
        .then(res => {
          if (res.ok) {
            setMessages([]);
            showToast(`История агента "${activeProject}" очищена`, "info");
          }
        });
    }
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

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const prompt = inputVal.trim();
    if (!prompt || isLoading) return;

    if (mode === 'agent' && !activeProject) {
      showToast("Сначала выберите или создайте проект слева", "error");
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

    if (mode === 'chat') {
      try {
        const res = await fetch('http://localhost:8000/api/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: selectedOllama,
            messages: [...messages, userMsg],
            stream: true
          })
        });

        if (!res.ok) throw new Error("Сетевая ошибка при обращении к серверу");

        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        let assistantReply = '';
        let isStarted = false;

        while (reader) {
          const { done, value } = await reader.read();
          if (done) break;

          const rawText = decoder.decode(value, { stream: true });
          const lines = rawText.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.substring(6));

                if (data.type === 'meta') {
                  setActiveModelUsed(data.model);
                } else if (data.type === 'project_created') {
                  // Вызов создания проекта без прерывания чтения
                  onProjectCreatedFromChat(data.project_name, data.default_file);
                } else if (data.message && data.message.content) {
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
        showToast(err.message || "Ошибка отправки сообщения", "error");
      } finally {
        setIsLoading(false);
      }
    } else {
      // Режим Project Agent
      try {
        const res = await fetch('http://localhost:8000/api/agent/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            project_name: activeProject,
            prompt: prompt,
            model: selectedOllama,
            images: currentImages.length > 0 ? currentImages : undefined,
            active_file_path: activeFilePath || undefined,
            active_file_content: activeFileContent || undefined
          })
        });

        if (!res.ok) throw new Error("Сетевая ошибка при исполнении задачи");

        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        let assistantReply = '';
        let isStarted = false;
        let isStreamingToFile = false;
        let currentStreamFile = '';

        while (reader) {
          const { done, value } = await reader.read();
          if (done) break;

          const rawText = decoder.decode(value, { stream: true });
          const lines = rawText.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.substring(6));

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
        showToast(err.message || "Ошибка исполнения агентом", "error");
      } finally {
        setIsLoading(false);
      }
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-panel)', overflow: 'hidden' }}>
      {/* Переключатель режимов */}
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
            title="Очистить историю"
            className="theme-toggle-btn"
            style={{ padding: '3px 6px', color: '#ef4444' }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Индикатор текущего контекста агента */}
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
            Проект: <b style={{ color: 'var(--text-main)' }}>{activeProject || 'Не выбран'}</b>
          </span>
          {activeFilePath && (
            <span style={{ color: 'var(--text-muted)', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              Файл: <b style={{ color: 'var(--text-main)' }}>{activeFilePath}</b>
            </span>
          )}
        </div>
      )}

      {/* Список сообщений */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
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
                  Задавайте любые вопросы или создавайте проекты фразой:<br/>
                  <code style={{ background: 'var(--hover-item)', padding: '2px 5px', borderRadius: '4px' }}>создай докер проект test-docker</code>
                </p>
              </>
            ) : (
              <>
                <Sparkles size={32} opacity={0.3} />
                <p style={{ margin: 0, fontSize: '13px', fontWeight: 500 }}>Project Developer Agent</p>
                <p style={{ margin: 0, fontSize: '11.5px', lineHeight: 1.4 }}>
                  {activeProject 
                    ? `Агент готов к работе в контексте проекта "${activeProject}". Пишите команды генерации кода или анализа файлов.` 
                    : 'Выберите проект в левой панели для активации агента.'}
                </p>
              </>
            )}
          </div>
        ) : (
          messages.map((m, idx) => (
            <div 
              key={idx} 
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: m.role === 'user' ? 'flex-end' : 'flex-start'
              }}
            >
              {m.role === 'assistant' && (
                <div style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '5px', 
                  marginBottom: '4px', 
                  fontSize: '10px', 
                  color: 'var(--text-muted)' 
                }}>
                  <Terminal size={11} color="var(--btn-primary)" />
                  <span>{m.modelUsed || activeModelUsed || selectedOllama}</span>
                </div>
              )}

              <div 
                style={{
                  maxWidth: '88%',
                  padding: '9px 13px',
                  borderRadius: '10px',
                  fontSize: '12.5px',
                  lineHeight: '1.45',
                  wordBreak: 'break-word',
                  whiteSpace: 'pre-wrap',
                  background: m.role === 'user' ? 'var(--btn-primary)' : 'var(--bg-card)',
                  color: m.role === 'user' ? '#ffffff' : 'var(--text-main)',
                  border: m.role === 'user' ? 'none' : '1px solid var(--border-color)',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.06)'
                }}
              >
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
                {m.content}
              </div>
            </div>
          ))
        )}

        {isLoading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', fontSize: '11.5px' }}>
            <Sparkles size={14} className="animate-spin" />
            <span>Генерация ответа...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Превью прикрепленных картинок */}
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

      {/* Поле ввода */}
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
          title="Прикрепить скриншот/изображение"
          className="theme-toggle-btn"
          style={{ padding: '6px 7px' }}
        >
          <Paperclip size={15} />
        </button>

        <input 
          value={inputVal}
          onChange={e => setInputVal(e.target.value)}
          placeholder={mode === 'chat' ? "Спросите что-нибудь или: создай докер проект test-docker..." : "Укажите задачу для проекта..."}
          className="studio-input"
          style={{ flex: 1, padding: '7px 10px', fontSize: '12px' }}
          disabled={isLoading}
        />

        <button 
          type="submit" 
          className="btn-primary" 
          style={{ padding: '7px 12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          disabled={isLoading || !inputVal.trim()}
        >
          <Send size={14} />
        </button>
      </form>
    </div>
  );
}
