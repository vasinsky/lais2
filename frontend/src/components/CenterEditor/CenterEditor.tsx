import { API_BASE_URL } from "../../config";
import React, { useEffect, useState, useRef } from 'react';
import Editor from '@monaco-editor/react';
import { Save, Code, RotateCcw, FileText, AlertCircle } from 'lucide-react';
import { FileHistoryItem } from '../LeftSidebar/ProjectTree';
import { useToast } from '../Toast';

interface Props {
  activeFile: { path: string; type: 'code' | 'image' } | null;
  activeProject: string | null;
  theme: 'light' | 'dark';
  selectedHistoryItem: FileHistoryItem | null;
  overrideContent?: string;
  onClearHistorySelection: () => void;
  onNewRevisionSaved: (rev: FileHistoryItem) => void;
  onContentChange?: (code: string) => void;
}

export default function CenterEditor({ 
  activeFile, 
  activeProject, 
  theme, 
  selectedHistoryItem,
  overrideContent,
  onClearHistorySelection,
  onNewRevisionSaved,
  onContentChange
}: Props) {
  const { showToast } = useToast();
  const [currentDiskContent, setCurrentDiskContent] = useState('');
  const [editorContent, setEditorContent] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const fetchCurrentFile = () => {
    if (!activeProject || !activeFile || activeFile.type === 'image') return;
    fetch(`${API_BASE_URL}/projects/${activeProject}/file?path=${encodeURIComponent(activeFile.path)}`)
      .then(res => res.json())
      .then(d => {
        const text = d.content || '';
        setCurrentDiskContent(text);
        if (!selectedHistoryItem) {
          setEditorContent(text);
          if (onContentChange) onContentChange(text);
        }
      })
      .catch(() => showToast("Error loading file", "error"));
  };

  useEffect(() => {
    fetchCurrentFile();
  }, [activeFile?.path, activeProject]);

  useEffect(() => {
    if (selectedHistoryItem) {
      setEditorContent(selectedHistoryItem.content);
    } else if (overrideContent !== undefined && overrideContent !== editorContent) {
      setEditorContent(overrideContent);
    }
  }, [selectedHistoryItem, overrideContent]);

  const handleSave = async () => {
    if (!activeProject || !activeFile || savingRef.current) return;

    if (editorContent === currentDiskContent) {
      showToast("No changes to save", "warning");
      return;
    }

    savingRef.current = true;
    setSaving(true);

    try {
      const res = await fetch(`${API_BASE_URL}/projects/${activeProject}/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: activeFile.path, content: editorContent })
      });

      if (!res.ok) {
        showToast("Failed to save file", "error");
        return;
      }

      const data = await res.json();
      if (data.status === 'ok') {
        setCurrentDiskContent(editorContent);
        showToast(`Saved "${activeFile.path}"`, "success");
        if (data.revision) {
          onNewRevisionSaved(data.revision);
        }
      } else if (data.status === 'no_changes') {
        showToast("No changes to save", "warning");
      }
    } catch {
      showToast("Failed to save file", "error");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleRevert = async () => {
    if (!activeProject || !activeFile || !selectedHistoryItem || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);

    const targetContent = selectedHistoryItem.content;
    const targetTimestamp = selectedHistoryItem.timestamp;

    try {
      const res = await fetch(`${API_BASE_URL}/projects/${activeProject}/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: activeFile.path, content: targetContent })
      });

      if (!res.ok) {
        showToast("Failed to revert file", "error");
        return;
      }

      const data = await res.json();
      setCurrentDiskContent(targetContent);
      setEditorContent(targetContent);
      onClearHistorySelection();

      if (data.revision) {
        onNewRevisionSaved(data.revision);
      }
      showToast(`Reverted and applied revision (${targetTimestamp})`, "success");
    } catch {
      showToast("Failed to revert file", "error");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleReturnToCurrent = () => {
    onClearHistorySelection();
    showToast("Switched to current version", "info");
  };

  if (!activeFile) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', gap: '8px' }}>
        <Code size={36} strokeWidth={1.5} color="var(--border-divider)" />
        <span style={{ fontSize: '12.5px' }}>Select a file in the project explorer to view or edit</span>
      </div>
    );
  }

  const isViewingHistory = !!selectedHistoryItem;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-editor)' }}>
      <div style={{ 
        height: '38px', 
        background: isViewingHistory ? 'rgba(245, 158, 11, 0.12)' : 'var(--bg-header)', 
        borderBottom: isViewingHistory ? '1.5px solid #f59e0b' : '1px solid var(--border-color)', 
        padding: '0 12px', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between',
        transition: 'all 0.2s ease'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            background: 'var(--bg-editor)',
            height: '28px',
            padding: '0 10px',
            borderRadius: '5px',
            border: '1px solid var(--border-color)',
            fontSize: '12px',
            color: 'var(--text-main)',
            fontFamily: 'monospace'
          }}>
            <span>{activeFile.path}</span>
          </div>

          {isViewingHistory && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '2px 8px',
              borderRadius: '4px',
              background: '#fef3c7',
              color: '#b45309',
              fontSize: '11px',
              fontWeight: 600,
              border: '1px solid #fde68a'
            }}>
              <AlertCircle size={12} />
              <span>Viewing Revision ({selectedHistoryItem.timestamp})</span>
            </div>
          )}
        </div>

        {activeFile.type === 'code' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {isViewingHistory ? (
              <>
                <button 
                  onClick={handleReturnToCurrent}
                  className="theme-toggle-btn"
                  style={{ padding: '4px 10px', fontSize: '11.5px', gap: '5px' }}
                  title="Return to current version"
                >
                  <FileText size={13} color="var(--btn-primary)" />
                  <span>Current Version</span>
                </button>

                <button 
                  onClick={handleRevert} 
                  disabled={saving}
                  style={{
                    background: '#f59e0b',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '4px 12px',
                    fontSize: '11.5px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    boxShadow: '0 1px 3px rgba(245, 158, 11, 0.3)'
                  }}
                  title="Apply revision to disk"
                >
                  <RotateCcw size={12} />
                  <span>{saving ? 'Applying...' : 'Apply Revision'}</span>
                </button>
              </>
            ) : (
              <button 
                onClick={handleSave} 
                disabled={saving}
                className="btn-primary"
                style={{ padding: '4px 12px', fontSize: '11.5px' }}
              >
                <Save size={12} />
                <span>{saving ? 'Saving...' : 'Save'}</span>
              </button>
            )}
          </div>
        )}
      </div>

      <div style={{ flex: 1, position: 'relative' }}>
        {activeFile.type === 'code' ? (
          <Editor
            key={selectedHistoryItem ? selectedHistoryItem.id : (activeFile.path + '_current')}
            theme={theme === 'dark' ? 'vs-dark' : 'vs'}
            path={activeFile.path}
            value={editorContent}
            onChange={(val) => {
              if (!isViewingHistory) {
                const nextVal = val || '';
                setEditorContent(nextVal);
                if (onContentChange) onContentChange(nextVal);
              }
            }}
            options={{ 
              readOnly: isViewingHistory,
              minimap: { enabled: false }, 
              fontSize: 13, 
              scrollBeyondLastLine: false,
              renderLineHighlight: 'all',
              fontFamily: "'JetBrains Mono', 'Fira Code', Menlo, Consolas, monospace"
            }}
          />
        ) : (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-panel)' }}>
            <img 
              src={`/api/projects/${activeProject}/file?path=${encodeURIComponent(activeFile.path)}`} 
              alt={activeFile.path}
              style={{ maxWidth: '90%', maxHeight: '90%', objectFit: 'contain', borderRadius: '4px', border: '1px solid var(--border-color)' }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
