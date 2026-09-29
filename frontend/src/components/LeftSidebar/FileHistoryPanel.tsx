import React, { useState, useRef, useCallback } from 'react';
import { History, Trash2, Clock, ChevronRight, ChevronDown } from 'lucide-react';
import { API_BASE_URL } from '../../config';
import { useToast } from '../Toast';

export interface FileHistoryItem {
  id: string;
  timestamp: string;
  source: string;
  content: string;
}

interface FileHistoryPanelProps {
  activeProject: string | null;
  activeFilePath: string | null;
  fileHistory: FileHistoryItem[];
  selectedHistoryId: string | null;
  onSelectHistoryItem: (item: FileHistoryItem | null) => void;
  onHistoryCleared: () => void;
}

function formatHistoryDate(raw: string): string {
  try {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return raw;
    const pad = (n: number) => n.toString().padStart(2, "0");
    const day = pad(d.getDate());
    const month = pad(d.getMonth() + 1);
    const year = d.getFullYear();
    const hours = pad(d.getHours());
    const minutes = pad(d.getMinutes());
    const seconds = pad(d.getSeconds());
    return `${day}.${month}.${year} ${hours}:${minutes}:${seconds}`;
  } catch {
    return raw;
  }
}

export const FileHistoryPanel: React.FC<FileHistoryPanelProps> = ({
  activeProject,
  activeFilePath,
  fileHistory,
  selectedHistoryId,
  onSelectHistoryItem,
  onHistoryCleared,
}) => {
  const { showToast } = useToast();
  const [historyHeight, setHistoryHeight] = useState<number>(() => {
    const saved = localStorage.getItem("lais_history_height");
    return saved ? parseInt(saved, 10) : 180;
  });
  const [isHistoryCollapsed, setIsHistoryCollapsed] = useState(false);
  const isDraggingHistory = useRef(false);

  const startDragHistory = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingHistory.current = true;
    const startY = e.clientY;
    const startHeight = historyHeight;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDraggingHistory.current) return;
      const delta = startY - ev.clientY;
      const newHeight = Math.max(70, Math.min(startHeight + delta, window.innerHeight * 0.45));
      setHistoryHeight(newHeight);
      localStorage.setItem("lais_history_height", newHeight.toString());
    };

    const onMouseUp = () => {
      isDraggingHistory.current = false;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [historyHeight]);

  const handleClearHistory = async () => {
    if (!activeProject || !activeFilePath) return;
    try {
      const res = await fetch(
        `${API_BASE_URL}/projects/${activeProject}/history?path=${encodeURIComponent(activeFilePath)}`,
        { method: 'DELETE' }
      );
      if (res.ok) {
        onHistoryCleared();
        showToast('File history cleared', 'info');
      }
    } catch {
      showToast('Failed to clear file history', 'error');
    }
  };

  if (!activeFilePath) return null;

  return (
    <div style={{
      height: isHistoryCollapsed ? "auto" : `${historyHeight}px`,
      borderTop: "1px solid var(--border-color)",
      display: "flex",
      flexDirection: "column",
      background: "var(--bg-panel)",
      position: "relative"
    }}>
      {!isHistoryCollapsed && (
        <div
          onMouseDown={startDragHistory}
          style={{
            position: "absolute",
            top: -3,
            left: 0,
            right: 0,
            height: 6,
            cursor: "row-resize",
            zIndex: 10
          }}
        />
      )}

      <div
        onClick={() => setIsHistoryCollapsed(prev => !prev)}
        style={{
          height: 32,
          minHeight: 32,
          padding: "0 10px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "var(--bg-header)",
          borderBottom: isHistoryCollapsed ? "none" : "1px solid var(--border-color)",
          cursor: "pointer",
          userSelect: "none"
        }}
      >
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.05em", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 5 }}>
          <History size={12} /> FILE HISTORY
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {fileHistory.length > 0 && !isHistoryCollapsed && (
            <button
              onClick={(e) => { e.stopPropagation(); handleClearHistory(); }}
              className="theme-toggle-btn"
              style={{ padding: 3 }}
              title="Clear file history"
            >
              <Trash2 size={11} />
            </button>
          )}
          <button
            type="button"
            className="theme-toggle-btn"
            style={{ padding: 2 }}
          >
            {isHistoryCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          </button>
        </div>
      </div>

      {!isHistoryCollapsed && (
        <div style={{ flex: 1, overflowY: "auto", padding: "4px 6px" }}>
          {fileHistory.length === 0 ? (
            <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center", padding: "12px 0" }}>
              No revisions yet
            </div>
          ) : (
            fileHistory.map((item) => {
              const isItemActive = selectedHistoryId === item.id;
              return (
                <div
                  key={item.id}
                  onClick={() => onSelectHistoryItem(isItemActive ? null : item)}
                  style={{
                    padding: "5px 8px",
                    borderRadius: 4,
                    marginBottom: 3,
                    cursor: "pointer",
                    fontSize: 11.5,
                    background: isItemActive ? "var(--bg-active-item, rgba(59, 130, 246, 0.15))" : "transparent",
                    color: isItemActive ? "var(--primary-color, #2563eb)" : "var(--text-main)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                    border: isItemActive ? "1px solid rgba(59, 130, 246, 0.3)" : "1px solid transparent"
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
                      <Clock size={11} style={{ opacity: 0.7 }} />
                      {formatHistoryDate(item.timestamp)}
                    </span>
                    <span style={{
                      fontSize: 9.5,
                      color: "var(--text-muted)",
                      background: "rgba(255, 255, 255, 0.06)",
                      padding: "1px 5px",
                      borderRadius: 3
                    }}>
                      {item.source}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};
