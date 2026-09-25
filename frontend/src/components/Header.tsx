import React, { useEffect, useState } from 'react';
import { Cpu, Image as ImageIcon, Sun, Moon, Layers, BrainCircuit } from 'lucide-react';

interface ServiceStatus {
  online: boolean;
  url: string;
  count: number;
  error?: string | null;
}

interface Props {
  selectedOllama: string;
  onSelectOllama: (v: string) => void;
  selectedComfy: string;
  onSelectComfy: (v: string) => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onOpenMemory: () => void;
}

export default function Header({ 
  selectedOllama, 
  onSelectOllama, 
  selectedComfy, 
  onSelectComfy,
  theme,
  onToggleTheme,
  onOpenMemory
}: Props) {
  const [ollamaStatus, setOllamaStatus] = useState<ServiceStatus>({ online: false, url: '', count: 0 });
  const [comfyStatus, setComfyStatus] = useState<ServiceStatus>({ online: false, url: '', count: 0 });
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [comfyModels, setComfyModels] = useState<string[]>([]);
  const [rulesCount, setRulesCount] = useState<number>(0);

  const fetchStatus = () => {
    fetch('http://localhost:8000/api/system/status')
      .then(res => res.json())
      .then(data => {
        setOllamaStatus({
          online: data.ollama.online,
          url: data.ollama.url,
          count: data.ollama.count,
          error: data.ollama.error
        });
        setComfyStatus({
          online: data.comfy.online,
          url: data.comfy.url,
          count: data.comfy.count,
          error: data.comfy.error
        });
        setOllamaModels(data.ollama.models || []);
        setComfyModels(data.comfy.checkpoints || []);
      })
      .catch(() => {});
  };

  const checkRules = () => {
    fetch('http://localhost:8000/api/prompts/')
      .then(res => res.json())
      .then(prompts => {
        setRulesCount(Array.isArray(prompts) ? prompts.length : 0);
      })
      .catch(() => {});
  };

  useEffect(() => {
    fetchStatus();
    checkRules();
    const interval = setInterval(() => {
      fetchStatus();
      checkRules();
    }, 8000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="studio-header">
      {/* Brand logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div style={{
          width: '26px', height: '26px', borderRadius: '7px',
          background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
          boxShadow: '0 2px 8px rgba(59, 130, 246, 0.35)'
        }}>
          <Layers size={15} />
        </div>
        <span style={{ fontSize: '13px', fontWeight: 700, letterSpacing: '0.03em', color: 'var(--text-main)' }}>
          LOCAL AI STUDIO
        </span>
      </div>

      {/* Action Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {/* Ollama selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div className="tooltip-container" style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <span style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: ollamaStatus.online ? '#10b981' : '#ef4444',
              boxShadow: ollamaStatus.online ? '0 0 6px #10b981' : '0 0 6px #ef4444',
              display: 'inline-block'
            }} />
            <div className="tooltip-bubble">
              <div style={{ fontWeight: 600, marginBottom: '4px', color: ollamaStatus.online ? '#10b981' : '#ef4444' }}>
                Ollama: {ollamaStatus.online ? 'Online' : 'Offline'}
              </div>
              <div><b>Endpoint:</b> {ollamaStatus.url}</div>
              <div><b>Available Models:</b> {ollamaStatus.count}</div>
              {ollamaStatus.error && <div style={{ color: '#ef4444', marginTop: '4px' }}><b>Error:</b> {ollamaStatus.error}</div>}
            </div>
          </div>

          <Cpu size={14} color="#3b82f6" />
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Ollama:</span>
          <select 
            value={selectedOllama} 
            onChange={e => onSelectOllama(e.target.value)}
            className="studio-select"
            style={{ maxWidth: '190px' }}
          >
            {ollamaModels.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>

        <div className="header-divider" />

        {/* ComfyUI selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <div className="tooltip-container" style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <span style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: comfyStatus.online ? '#10b981' : '#ef4444',
              boxShadow: comfyStatus.online ? '0 0 6px #10b981' : '0 0 6px #ef4444',
              display: 'inline-block'
            }} />
            <div className="tooltip-bubble">
              <div style={{ fontWeight: 600, marginBottom: '4px', color: comfyStatus.online ? '#10b981' : '#ef4444' }}>
                ComfyUI: {comfyStatus.online ? 'Online' : 'Offline'}
              </div>
              <div><b>Endpoint:</b> {comfyStatus.url}</div>
              <div><b>Checkpoints:</b> {comfyStatus.count}</div>
              {comfyStatus.error && <div style={{ color: '#ef4444', marginTop: '4px' }}><b>Error:</b> {comfyStatus.error}</div>}
            </div>
          </div>

          <ImageIcon size={14} color="#ec4899" />
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Comfy:</span>
          <select 
            value={selectedComfy} 
            onChange={e => onSelectComfy(e.target.value)}
            className="studio-select"
            style={{ maxWidth: '190px' }}
          >
            {comfyModels.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>

        <div className="header-divider" />

        {/* Memory Button */}
        <button 
          onClick={onOpenMemory}
          className="theme-toggle-btn"
          style={{
            background: rulesCount > 0 ? 'rgba(59, 130, 246, 0.12)' : 'var(--input-bg)',
            borderColor: rulesCount > 0 ? 'var(--btn-primary)' : 'var(--input-border)',
            fontWeight: 600,
            padding: '5px 11px',
            color: rulesCount > 0 ? 'var(--btn-primary)' : 'var(--text-main)'
          }}
          title="Open Global Memory and Rules"
        >
          <BrainCircuit size={15} color="var(--btn-primary)" />
          <span>Memory ({rulesCount})</span>
        </button>

        <div className="header-divider" />

        {/* Theme Toggle */}
        <button 
          onClick={onToggleTheme}
          className="theme-toggle-btn"
          title={theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
        >
          {theme === 'light' ? (
            <>
              <Moon size={14} color="#64748b" />
              <span>Dark</span>
            </>
          ) : (
            <>
              <Sun size={14} color="#f59e0b" />
              <span>Light</span>
            </>
          )}
        </button>
      </div>
    </header>
  );
}
