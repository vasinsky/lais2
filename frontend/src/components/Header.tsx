import React, { useEffect, useState } from 'react';
import { Layers, Sparkles, Moon, Sun, BrainCircuit } from 'lucide-react';

interface Props {
  selectedOllama: string;
  onSelectOllama: (val: string) => void;
  selectedComfy: string;
  onSelectComfy: (val: string) => void;
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
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [comfyCheckpoints, setComfyCheckpoints] = useState<string[]>([]);
  const [rulesCount, setRulesCount] = useState<number>(0);

  useEffect(() => {
    fetch('http://localhost:8000/api/status')
      .then(res => res.json())
      .then(data => {
        if (data.ollama && data.ollama.models) {
          const names: string[] = data.ollama.models.map((m: any) => m.name);
          setOllamaModels(names);

          // Дефолт: qwen2.5-coder:7b-instruct-q4_K_M или любая qwen-coder
          const preferredCoder = names.find((n: string) => n.includes('qwen2.5-coder:7b-instruct-q4_K_M'))
            || names.find((n: string) => n.includes('qwen2.5-coder'))
            || names.find((n: string) => n.includes('coder'))
            || names[0];

          if (preferredCoder && (!selectedOllama || selectedOllama === 'dolphin-llama3:latest')) {
            onSelectOllama(preferredCoder);
          }
        }
        if (data.comfyui && data.comfyui.checkpoints) {
          setComfyCheckpoints(data.comfyui.checkpoints);
          if (data.comfyui.checkpoints.length > 0 && !selectedComfy) {
            onSelectComfy(data.comfyui.checkpoints[0]);
          }
        }
      })
      .catch(console.error);

    fetch('http://localhost:8000/api/prompts/')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setRulesCount(data.filter(r => r.is_active).length);
        }
      })
      .catch(console.error);
  }, []);

  return (
    <header className="studio-header">
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <img 
          src="/favicon.svg" 
          alt="VAIS Logo" 
          style={{ width: '24px', height: '24px', borderRadius: '50%' }}
        />
        <span style={{ fontSize: '13px', fontWeight: 700, letterSpacing: '0.04em', color: 'var(--text-main)' }}>
          LOCAL AI STUDIO
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981' }} />
          <Layers size={14} color="var(--text-muted)" />
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 500 }}>Ollama:</span>
          <select 
            value={selectedOllama} 
            onChange={e => onSelectOllama(e.target.value)}
            className="studio-select"
          >
            {ollamaModels.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>

        <div className="header-divider" />

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981' }} />
          <Sparkles size={14} color="var(--text-muted)" />
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 500 }}>Comfy:</span>
          <select 
            value={selectedComfy} 
            onChange={e => onSelectComfy(e.target.value)}
            className="studio-select"
          >
            {comfyCheckpoints.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        <div className="header-divider" />

        <button 
          onClick={onOpenMemory}
          className="theme-toggle-btn"
          title="System prompts & Rules"
          style={{ gap: '6px', color: rulesCount > 0 ? 'var(--btn-primary)' : 'var(--text-muted)' }}
        >
          <BrainCircuit size={14} color={rulesCount > 0 ? "var(--btn-primary)" : "currentColor"} />
          <span style={{ fontWeight: 600 }}>System prompts ({rulesCount})</span>
        </button>

        <button 
          onClick={onToggleTheme} 
          className="theme-toggle-btn"
          title={theme === 'dark' ? "Switch to Light Mode" : "Switch to Dark Mode"}
        >
          {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
        </button>
      </div>
    </header>
  );
}
