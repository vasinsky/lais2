import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Archive, ChevronRight, ChevronDown, Plus, Clock, Loader2, RotateCcw, Trash2, AlertTriangle, X } from 'lucide-react';
import { API_BASE_URL } from '../../config';
import { useToast } from '../Toast';
import { consoleLogger } from '../../services/consoleLogger';

export interface BackupItem {
  filename: string;
  display_name: string;
  size_bytes: number;
  created_at: string;
}

interface BackupPanelProps {
  activeProject?: string | null;
  onRestoreSuccess?: () => void;
}

function formatSizeMB(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb < 0.01 ? "<0.01 MB" : `${mb.toFixed(2)} MB`;
}

export const BackupPanel: React.FC<BackupPanelProps> = ({ activeProject, onRestoreSuccess }) => {
  const { showToast } = useToast();
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [loading, setLoading] = useState(false);

  // Modal: Create
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [progress, setProgress] = useState(0);

  // Modal: Restore
  const [restoreItem, setRestoreItem] = useState<BackupItem | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);

  // Modal: Delete
  const [deleteItem, setDeleteItem] = useState<BackupItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [backupHeight, setBackupHeight] = useState<number>(() => {
    const saved = localStorage.getItem("lais_backup_height");
    return saved ? parseInt(saved, 10) : 160;
  });
  const [isBackupCollapsed, setIsBackupCollapsed] = useState(false);
  const isDraggingBackup = useRef(false);

  const fetchBackups = useCallback(async (projName: string) => {
    const targetUrl = `${API_BASE_URL}/projects/${encodeURIComponent(projName)}/backups`;
    const startTime = Date.now();

    consoleLogger.log({
      project: projName,
      type: "request",
      method: "GET",
      url: targetUrl,
      payload: { action: "list_backups" }
    });

    try {
      setLoading(true);
      const res = await fetch(targetUrl);
      const durationMs = Date.now() - startTime;
      let respData = null;
      try { respData = await res.clone().json(); } catch (_) {}

      consoleLogger.log({
        project: projName,
        type: res.ok ? "response" : "error",
        method: "GET",
        url: targetUrl,
        status: res.status,
        durationMs,
        payload: respData
      });

      if (res.ok) {
        setBackups(respData || []);
      }
    } catch (err: any) {
      consoleLogger.log({
        project: projName,
        type: "error",
        method: "GET",
        url: targetUrl,
        durationMs: Date.now() - startTime,
        payload: { error: err?.message || String(err) }
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeProject) {
      fetchBackups(activeProject);
    } else {
      setBackups([]);
    }
  }, [activeProject, fetchBackups]);

  const startDragBackup = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingBackup.current = true;
    const startY = e.clientY;
    const startHeight = backupHeight;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDraggingBackup.current) return;
      const delta = startY - ev.clientY;
      const newHeight = Math.max(70, Math.min(startHeight + delta, window.innerHeight * 0.45));
      setBackupHeight(newHeight);
      localStorage.setItem("lais_backup_height", newHeight.toString());
    };

    const onMouseUp = () => {
      isDraggingBackup.current = false;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [backupHeight]);

  const handleCreateBackup = async () => {
    if (!activeProject || isArchiving) return;
    setIsArchiving(true);
    setProgress(15);

    const targetUrl = `${API_BASE_URL}/projects/${encodeURIComponent(activeProject)}/backups`;
    const startTime = Date.now();

    consoleLogger.log({
      project: activeProject,
      type: "request",
      method: "POST",
      url: targetUrl,
      payload: { action: "create_backup" }
    });

    const progressInterval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 88) return prev;
        return prev + Math.floor(Math.random() * 12) + 5;
      });
    }, 150);

    try {
      const res = await fetch(targetUrl, { method: 'POST' });
      const durationMs = Date.now() - startTime;
      let respData = null;
      try { respData = await res.clone().json(); } catch (_) {}

      consoleLogger.log({
        project: activeProject,
        type: res.ok ? "response" : "error",
        method: "POST",
        url: targetUrl,
        status: res.status,
        durationMs,
        payload: respData
      });

      clearInterval(progressInterval);
      setProgress(100);

      if (res.ok) {
        const newBackup: BackupItem = respData;
        setBackups((prev) => [newBackup, ...prev]);
        showToast(`Backup created: ${newBackup.display_name}`, 'success');
        setTimeout(() => {
          setIsModalOpen(false);
          setIsArchiving(false);
          setProgress(0);
        }, 300);
      } else {
        showToast(respData?.detail || 'Failed to create backup', 'error');
        setIsArchiving(false);
        setProgress(0);
      }
    } catch (err: any) {
      clearInterval(progressInterval);
      consoleLogger.log({
        project: activeProject,
        type: "error",
        method: "POST",
        url: targetUrl,
        durationMs: Date.now() - startTime,
        payload: { error: err?.message || String(err) }
      });
      showToast('Error creating backup', 'error');
      setIsArchiving(false);
      setProgress(0);
    }
  };

  const handleRestoreBackup = async () => {
    if (!activeProject || !restoreItem || isRestoring) return;
    setIsRestoring(true);

    const targetUrl = `${API_BASE_URL}/projects/${encodeURIComponent(activeProject)}/backups/${encodeURIComponent(restoreItem.filename)}/restore`;
    const startTime = Date.now();

    consoleLogger.log({
      project: activeProject,
      type: "request",
      method: "POST",
      url: targetUrl,
      payload: { action: "restore_backup", filename: restoreItem.filename }
    });

    try {
      const res = await fetch(targetUrl, { method: 'POST' });
      const durationMs = Date.now() - startTime;
      let respData = null;
      try { respData = await res.clone().json(); } catch (_) {}

      consoleLogger.log({
        project: activeProject,
        type: res.ok ? "response" : "error",
        method: "POST",
        url: targetUrl,
        status: res.status,
        durationMs,
        payload: respData
      });

      if (res.ok) {
        showToast(`Project restored from ${restoreItem.display_name}`, 'success');
        setRestoreItem(null);
        onRestoreSuccess?.();
      } else {
        showToast(respData?.detail || 'Failed to restore backup', 'error');
      }
    } catch (err: any) {
      consoleLogger.log({
        project: activeProject,
        type: "error",
        method: "POST",
        url: targetUrl,
        durationMs: Date.now() - startTime,
        payload: { error: err?.message || String(err) }
      });
      showToast('Error restoring backup', 'error');
    } finally {
      setIsRestoring(false);
    }
  };

  const handleDeleteBackup = async () => {
    if (!activeProject || !deleteItem || isDeleting) return;
    setIsDeleting(true);

    const targetUrl = `${API_BASE_URL}/projects/${encodeURIComponent(activeProject)}/backups/${encodeURIComponent(deleteItem.filename)}`;
    const startTime = Date.now();

    consoleLogger.log({
      project: activeProject,
      type: "request",
      method: "DELETE",
      url: targetUrl,
      payload: { action: "delete_backup", filename: deleteItem.filename }
    });

    try {
      const res = await fetch(targetUrl, { method: 'DELETE' });
      const durationMs = Date.now() - startTime;
      let respData = null;
      try { respData = await res.clone().json(); } catch (_) {}

      consoleLogger.log({
        project: activeProject,
        type: res.ok ? "response" : "error",
        method: "DELETE",
        url: targetUrl,
        status: res.status,
        durationMs,
        payload: respData
      });

      if (res.ok) {
        setBackups((prev) => prev.filter(b => b.filename !== deleteItem.filename));
        showToast(`Backup ${deleteItem.display_name} deleted`, 'info');
        setDeleteItem(null);
      } else {
        showToast(respData?.detail || 'Failed to delete backup', 'error');
      }
    } catch (err: any) {
      consoleLogger.log({
        project: activeProject,
        type: "error",
        method: "DELETE",
        url: targetUrl,
        durationMs: Date.now() - startTime,
        payload: { error: err?.message || String(err) }
      });
      showToast('Error deleting backup', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  if (!activeProject) return null;

  return (
    <div style={{
      height: isBackupCollapsed ? "auto" : `${backupHeight}px`,
      borderTop: "1px solid var(--border-color)",
      display: "flex",
      flexDirection: "column",
      background: "var(--bg-panel)",
      position: "relative"
    }}>
      {!isBackupCollapsed && (
        <div
          onMouseDown={startDragBackup}
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

      {/* Header */}
      <div
        onClick={() => setIsBackupCollapsed(prev => !prev)}
        style={{
          height: 32,
          minHeight: 32,
          padding: "0 10px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "var(--bg-header)",
          borderBottom: isBackupCollapsed ? "none" : "1px solid var(--border-color)",
          cursor: "pointer",
          userSelect: "none"
        }}
      >
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.05em", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 5 }}>
          <Archive size={12} /> BACKUPS
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsModalOpen(true);
            }}
            className="theme-toggle-btn"
            style={{ padding: 3 }}
            title={`Create backup of ${activeProject}`}
          >
            <Plus size={13} />
          </button>
          <button
            type="button"
            className="theme-toggle-btn"
            style={{ padding: 2 }}
          >
            {isBackupCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          </button>
        </div>
      </div>

      {/* List */}
      {!isBackupCollapsed && (
        <div style={{ flex: 1, overflowY: "auto", padding: "4px 6px" }}>
          {loading && backups.length === 0 ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "16px", color: "var(--text-muted)" }}>
              <Loader2 size={16} className="spin" />
            </div>
          ) : backups.length === 0 ? (
            <div style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: "16px 8px",
              gap: 6,
              color: "var(--text-muted)"
            }}>
              <Archive size={18} style={{ opacity: 0.4 }} />
              <span style={{ fontSize: 11 }}>No backups available</span>
            </div>
          ) : (
            backups.map((item) => (
              <div
                key={item.filename}
                className="tree-item-row"
                style={{
                  padding: "4px 6px",
                  borderRadius: 4,
                  marginBottom: 3,
                  fontSize: 11.5,
                  background: "transparent",
                  color: "var(--text-main)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between"
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6, overflow: "hidden" }}>
                  <Clock size={11} style={{ opacity: 0.7, flexShrink: 0 }} />
                  <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.display_name}
                  </span>
                  <span style={{ fontSize: 10.5, color: "var(--text-muted)", flexShrink: 0 }}>
                    ({formatSizeMB(item.size_bytes)})
                  </span>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 3, flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={() => setRestoreItem(item)}
                    className="tree-action-btn"
                    title={`Restore project from backup (${item.display_name})`}
                    style={{ padding: 2.5 }}
                  >
                    <RotateCcw size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteItem(item)}
                    className="tree-action-btn delete-btn"
                    title={`Delete backup (${item.display_name})`}
                    style={{ padding: 2.5 }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Modal: Create Backup */}
      {isModalOpen && (
        <div
          onClick={() => !isArchiving && setIsModalOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: 16
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 380,
              backgroundColor: 'var(--bg-card, #1e293b)',
              color: 'var(--text-main, #f8fafc)',
              borderRadius: 12,
              border: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
              overflow: 'hidden'
            }}
          >
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 16px',
              borderBottom: '1px solid var(--border-color, rgba(255, 255, 255, 0.08))'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 13.5 }}>
                <div style={{ width: 26, height: 26, borderRadius: 6, background: 'rgba(59, 130, 246, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Archive size={15} color="#3b82f6" />
                </div>
                <span>Create Project Backup</span>
              </div>
              {!isArchiving && (
                <button
                  onClick={() => setIsModalOpen(false)}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted, #94a3b8)', cursor: 'pointer', padding: 4 }}
                >
                  <X size={16} />
                </button>
              )}
            </div>

            <div style={{ padding: '16px' }}>
              <p style={{ margin: '0 0 12px 0', fontSize: 13, color: 'var(--text-muted, #94a3b8)', lineHeight: 1.4 }}>
                Are you sure you want to create a full backup archive for project <strong style={{ color: 'var(--text-main, #fff)' }}>{activeProject}</strong>?
              </p>

              {isArchiving ? (
                <div style={{ marginTop: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 6, color: "var(--text-muted)" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <Loader2 size={12} className="spin" /> Archiving project files...
                    </span>
                    <span style={{ fontWeight: 600 }}>{progress}%</span>
                  </div>
                  <div style={{
                    width: "100%",
                    height: 8,
                    background: "rgba(255, 255, 255, 0.08)",
                    borderRadius: 4,
                    overflow: "hidden"
                  }}>
                    <div style={{
                      width: `${progress}%`,
                      height: "100%",
                      background: "linear-gradient(90deg, #3b82f6, #60a5fa)",
                      transition: "width 0.2s ease-in-out"
                    }} />
                  </div>
                </div>
              ) : (
                <div style={{
                  padding: '8px 10px',
                  borderRadius: 6,
                  background: 'rgba(0, 0, 0, 0.25)',
                  border: '1px solid var(--border-color, rgba(255, 255, 255, 0.08))',
                  fontSize: 12,
                  color: 'var(--text-muted)'
                }}>
                  The archive will be saved as a .zip snapshot inside the project storage.
                </div>
              )}
            </div>

            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: 8,
              padding: '12px 16px',
              borderTop: '1px solid var(--border-color, rgba(255, 255, 255, 0.08))',
              background: 'rgba(0, 0, 0, 0.1)'
            }}>
              <button
                type="button"
                disabled={isArchiving}
                onClick={() => setIsModalOpen(false)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 6,
                  border: '1px solid var(--border-color, rgba(255, 255, 255, 0.15))',
                  background: 'transparent',
                  color: 'var(--text-main, #f8fafc)',
                  cursor: isArchiving ? 'not-allowed' : 'pointer',
                  fontSize: 12.5,
                  fontWeight: 500
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isArchiving}
                onClick={handleCreateBackup}
                style={{
                  padding: '6px 14px',
                  borderRadius: 6,
                  border: 'none',
                  background: '#2563eb',
                  color: '#ffffff',
                  cursor: isArchiving ? 'not-allowed' : 'pointer',
                  fontSize: 12.5,
                  fontWeight: 600,
                  boxShadow: '0 1px 2px rgba(0, 0, 0, 0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6
                }}
              >
                {isArchiving && <Loader2 size={13} className="spin" />}
                {isArchiving ? 'Archiving...' : 'Create Backup'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Restore Backup */}
      {restoreItem && (
        <div
          onClick={() => !isRestoring && setRestoreItem(null)}
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: 16
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 400,
              backgroundColor: 'var(--bg-card, #1e293b)',
              color: 'var(--text-main, #f8fafc)',
              borderRadius: 12,
              border: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
              overflow: 'hidden'
            }}
          >
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 16px',
              borderBottom: '1px solid var(--border-color, rgba(255, 255, 255, 0.08))'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 13.5 }}>
                <div style={{ width: 26, height: 26, borderRadius: 6, background: 'rgba(239, 68, 68, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <AlertTriangle size={15} color="#ef4444" />
                </div>
                <span>Restore Backup?</span>
              </div>
              {!isRestoring && (
                <button
                  onClick={() => setRestoreItem(null)}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted, #94a3b8)', cursor: 'pointer', padding: 4 }}
                >
                  <X size={16} />
                </button>
              )}
            </div>

            <div style={{ padding: '16px' }}>
              <p style={{ margin: '0 0 10px 0', fontSize: 13, color: 'var(--text-muted, #94a3b8)', lineHeight: 1.4 }}>
                Are you sure you want to restore project <strong style={{ color: 'var(--text-main, #fff)' }}>{activeProject}</strong> from snapshot <strong style={{ color: 'var(--text-main, #fff)' }}>{restoreItem.display_name}</strong>?
              </p>
              <div style={{
                padding: '8px 10px',
                borderRadius: 6,
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                fontSize: 12,
                color: '#f87171',
                lineHeight: 1.4
              }}>
                Warning: All current files and changes in this project will be deleted and replaced with this backup archive.
              </div>
            </div>

            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: 8,
              padding: '12px 16px',
              borderTop: '1px solid var(--border-color, rgba(255, 255, 255, 0.08))',
              background: 'rgba(0, 0, 0, 0.1)'
            }}>
              <button
                type="button"
                disabled={isRestoring}
                onClick={() => setRestoreItem(null)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 6,
                  border: '1px solid var(--border-color, rgba(255, 255, 255, 0.15))',
                  background: 'transparent',
                  color: 'var(--text-main, #f8fafc)',
                  cursor: isRestoring ? 'not-allowed' : 'pointer',
                  fontSize: 12.5,
                  fontWeight: 500
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isRestoring}
                onClick={handleRestoreBackup}
                style={{
                  padding: '6px 14px',
                  borderRadius: 6,
                  border: 'none',
                  background: '#ef4444',
                  color: '#ffffff',
                  cursor: isRestoring ? 'not-allowed' : 'pointer',
                  fontSize: 12.5,
                  fontWeight: 600,
                  boxShadow: '0 1px 2px rgba(0, 0, 0, 0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6
                }}
              >
                {isRestoring && <Loader2 size={13} className="spin" />}
                {isRestoring ? 'Restoring...' : 'Restore'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Delete Backup */}
      {deleteItem && (
        <div
          onClick={() => !isDeleting && setDeleteItem(null)}
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: 16
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 380,
              backgroundColor: 'var(--bg-card, #1e293b)',
              color: 'var(--text-main, #f8fafc)',
              borderRadius: 12,
              border: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
              overflow: 'hidden'
            }}
          >
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 16px',
              borderBottom: '1px solid var(--border-color, rgba(255, 255, 255, 0.08))'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 13.5 }}>
                <div style={{ width: 26, height: 26, borderRadius: 6, background: 'rgba(239, 68, 68, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Trash2 size={15} color="#ef4444" />
                </div>
                <span>Delete Backup?</span>
              </div>
              {!isDeleting && (
                <button
                  onClick={() => setDeleteItem(null)}
                  style={{ background: 'none', border: 'none', color: 'var(--text-muted, #94a3b8)', cursor: 'pointer', padding: 4 }}
                >
                  <X size={16} />
                </button>
              )}
            </div>

            <div style={{ padding: '16px' }}>
              <p style={{ margin: '0 0 10px 0', fontSize: 13, color: 'var(--text-muted, #94a3b8)', lineHeight: 1.4 }}>
                Are you sure you want to permanently delete backup <strong style={{ color: 'var(--text-main, #fff)' }}>{deleteItem.display_name}</strong>?
              </p>
              <div style={{
                padding: '8px 10px',
                borderRadius: 6,
                background: 'rgba(0, 0, 0, 0.25)',
                border: '1px solid var(--border-color, rgba(255, 255, 255, 0.08))',
                fontSize: 12,
                color: 'var(--text-muted)'
              }}>
                Size: {formatSizeMB(deleteItem.size_bytes)}
              </div>
            </div>

            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: 8,
              padding: '12px 16px',
              borderTop: '1px solid var(--border-color, rgba(255, 255, 255, 0.08))',
              background: 'rgba(0, 0, 0, 0.1)'
            }}>
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => setDeleteItem(null)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 6,
                  border: '1px solid var(--border-color, rgba(255, 255, 255, 0.15))',
                  background: 'transparent',
                  color: 'var(--text-main, #f8fafc)',
                  cursor: isDeleting ? 'not-allowed' : 'pointer',
                  fontSize: 12.5,
                  fontWeight: 500
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={handleDeleteBackup}
                style={{
                  padding: '6px 14px',
                  borderRadius: 6,
                  border: 'none',
                  background: '#ef4444',
                  color: '#ffffff',
                  cursor: isDeleting ? 'not-allowed' : 'pointer',
                  fontSize: 12.5,
                  fontWeight: 600,
                  boxShadow: '0 1px 2px rgba(0, 0, 0, 0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6
                }}
              >
                {isDeleting && <Loader2 size={13} className="spin" />}
                {isDeleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
