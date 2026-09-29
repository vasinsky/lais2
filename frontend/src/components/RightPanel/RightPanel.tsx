import React, { useState, useEffect } from 'react';
import { MessageSquare, Sparkles } from 'lucide-react';
import { API_BASE_URL } from "../../config";
import { FileHistoryItem } from '../LeftSidebar/ProjectTree';
import ChatView from './ChatView';
import AgentView from './AgentView';

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
  const [sessionStats, setSessionStats] = useState<{ msgCount: number; sizeKb: number }>({ msgCount: 0, sizeKb: 0 });
  const [modelContext, setModelContext] = useState<number | null>(null);

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
    const targetModel = selectedOllama || 'qwen2.5-coder:7b-instruct-q4_K_M';
    fetchModelContext(targetModel);
  }, [selectedOllama]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-panel)' }}>
      {/* Top Tabs */}
      <div className="right-panel-header" style={{
        height: 38,
        display: 'flex',
        alignItems: 'center',
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

      {/* Mode View Router */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {mode === 'chat' ? (
          <ChatView
            selectedOllama={selectedOllama}
            selectedComfy={selectedComfy}
            onProjectCreatedFromChat={onProjectCreatedFromChat}
            onRefreshProjectTree={onRefreshProjectTree}
            onOpenImageModal={onOpenImageModal}
            onInsertCodeToEditor={onInsertCodeToEditor}
            onStatsChange={setSessionStats}
          />
        ) : (
          <AgentView
            activeProject={activeProject}
            activeFilePath={activeFilePath}
            activeFileContent={activeFileContent}
            selectedOllama={selectedOllama}
            selectedComfy={selectedComfy}
            onLiveStreamToEditor={onLiveStreamToEditor}
            onFileAutoSaved={onFileAutoSaved}
            onRefreshProjectTree={onRefreshProjectTree}
            onOpenImageModal={onOpenImageModal}
            onInsertCodeToEditor={onInsertCodeToEditor}
            onStatsChange={setSessionStats}
          />
        )}
      </div>
    </div>
  );
}
