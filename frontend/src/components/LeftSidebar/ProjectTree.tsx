import { consoleLogger } from "../../services/consoleLogger";
import { API_BASE_URL } from "../../config";
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Folder, FolderOpen, FileCode, FileImage, RotateCw, Trash2, FilePlus, FolderPlus, History, Clock, ChevronRight, ChevronDown, AlertTriangle, Eye, EyeOff, Play, Square, Loader2, ExternalLink, X } from 'lucide-react';
import { useToast } from '../Toast';

export interface FileHistoryItem {
  id: string;
  timestamp: string;
  source: string;
  content: string;
}

interface TreeItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
  file_type: 'code' | 'image' | 'other';
  children?: TreeItem[];
}

interface ProjectTreeProps {
  activeProject: string | null;
  activeFilePath: string | null;
  fileHistory: FileHistoryItem[];
  selectedHistoryId: string | null;
  refreshTrigger: number;
  onSelectProject: (name: string) => void;
  onOpenFile: (path: string, type: 'code' | 'image') => void;
  onCloseFile: () => void;
  onSelectHistoryItem: (item: FileHistoryItem | null) => void;
  onHistoryCleared: () => void;
}

type ModalType = 'create-file' | 'create-folder' | 'delete-file' | 'delete-project' | null;

interface ModalState {
  type: ModalType;
  projName: string;
  targetPath?: string;
  isFolder?: boolean;
}

const HIDDEN_PROJECTS_STORAGE_KEY = 'lais_hidden_projects';

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


export default function ProjectTree({
  activeProject,
  activeFilePath,
  fileHistory,
  selectedHistoryId,
  refreshTrigger,
  onSelectProject,
  onOpenFile,
  onCloseFile,
  onSelectHistoryItem,
  onHistoryCleared
}: ProjectTreeProps) {
  const handleOpenPreview = (projName: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const host = window.location.hostname || "localhost";
    const ts = Date.now();
    const cStatus = composeStatus[projName];
    const pyStatus = pythonStatus[projName];

    // 1. Если запущен Docker Compose — открываем его внешний порт
    if (cStatus?.running && cStatus.port) {
      window.open(`http://${host}:${cStatus.port}/?_t=${ts}`, "_blank", "noopener,noreferrer");
      return;
    }

    // 2. Если запущен Python-сервер — открываем встроенный прокси бэкенда
    if (pyStatus?.running) {
      const port = window.location.port ? "8000" : "";
      const url = `http://${host}:${port || 8000}/api/projects/${encodeURIComponent(projName)}/python/proxy/?_t=${ts}`;
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }

    // 3. Статический проект (HTML / JS / CSS)
    const port = window.location.port ? "8000" : "";
    const url = `http://${host}:${port || 8000}/api/projects/${encodeURIComponent(projName)}/preview/?_t=${ts}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };
  const [projects, setProjects] = useState<string[]>([]);
  const [composeStatus, setComposeStatus] = useState<Record<string, { has_compose: boolean; running: boolean; port?: number | null }>>({});
  const [pythonStatus, setPythonStatus] = useState<Record<string, { has_python: boolean; running: boolean; port?: number | null }>>({});
  const [loadingPython, setLoadingPython] = useState<Record<string, boolean>>({});
  const [loadingCompose, setLoadingCompose] = useState<Record<string, boolean>>({});

  const checkPythonStatus = async (projName: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/projects/${encodeURIComponent(projName)}/python/status`);
      if (res.ok) {
        const data = await res.json();
        setPythonStatus(prev => ({ ...prev, [projName]: data }));
      }
    } catch (_) {}
  };

  const handlePythonToggle = async (projName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const isRunning = pythonStatus[projName]?.running;
    const action = isRunning ? "stop" : "start";
    setLoadingPython(prev => ({ ...prev, [projName]: true }));
    const targetUrl = `${API_BASE_URL}/projects/${encodeURIComponent(projName)}/python/${action}`;
    const startTime = Date.now();
    consoleLogger.log({
      project: projName,
      type: "request",
      method: "POST",
      url: targetUrl,
      payload: { action, target: "python-process" }
    });

    try {
      const res = await fetch(targetUrl, { method: "POST" });
      const durationMs = Date.now() - startTime;
      let respData = null;
      try { respData = await res.clone().json(); } catch (_) {}

      consoleLogger.log({
        project: projName,
        type: res.ok ? "response" : "error",
        method: "POST",
        url: targetUrl,
        status: res.status,
        durationMs,
        payload: respData
      });

      if (res.ok) {
        await checkPythonStatus(projName);
      }
    } catch (err: any) {
      consoleLogger.log({
        project: projName,
        type: "error",
        method: "POST",
        url: targetUrl,
        durationMs: Date.now() - startTime,
        payload: { error: err?.message || String(err) }
      });
    } finally {
      setLoadingPython(prev => ({ ...prev, [projName]: false }));
    }
  };

  const checkComposeStatus = async (projName: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/projects/${encodeURIComponent(projName)}/compose/status`);
      if (res.ok) {
        const data = await res.json();
        setComposeStatus(prev => ({ ...prev, [projName]: data }));
      }
    } catch (_) {}
  };

    // Auto-check docker-compose status for projects
  useEffect(() => {
    if (projects && projects.length > 0) {
      projects.forEach((p) => { checkComposeStatus(p); checkPythonStatus(p); });
    }
  }, [projects]);

  const toggleCompose = async (projName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const current = composeStatus[projName];
    const action = current?.running ? 'down' : 'up';
    setLoadingCompose(prev => ({ ...prev, [projName]: true }));
    const targetUrl = `${API_BASE_URL}/projects/${encodeURIComponent(projName)}/compose/${action}`;
    const startTime = Date.now();
    consoleLogger.log({
      project: projName,
      type: "request",
      method: "POST",
      url: targetUrl,
      payload: { action, target: "docker-compose" }
    });

    try {
      const res = await fetch(targetUrl, { method: "POST" });
      const durationMs = Date.now() - startTime;
      let respData = null;
      try { respData = await res.clone().json(); } catch (_) {}

      consoleLogger.log({
        project: projName,
        type: res.ok ? "response" : "error",
        method: "POST",
        url: targetUrl,
        status: res.status,
        durationMs,
        payload: respData
      });

      if (res.ok) {
        await checkComposeStatus(projName);
      }
    } catch (err: any) {
      consoleLogger.log({
        project: projName,
        type: "error",
        method: "POST",
        url: targetUrl,
        durationMs: Date.now() - startTime,
        payload: { error: err?.message || String(err) }
      });
    }
    setLoadingCompose(prev => ({ ...prev, [projName]: false }));
  };

  const [treeData, setTreeData] = useState<Record<string, TreeItem[]>>({});
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [draggedItem, setDraggedItem] = useState<{ path: string; projName: string } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const [hiddenProjects, setHiddenProjects] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(HIDDEN_PROJECTS_STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [showHidden, setShowHidden] = useState<boolean>(false);

  const [modal, setModal] = useState<ModalState | null>(null);
  const [modalInputVal, setModalInputVal] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const { showToast } = useToast();
  const [historyHeight, setHistoryHeight] = useState<number>(() => {
    const saved = localStorage.getItem("lais_history_height");
    return saved ? parseInt(saved, 10) : 220;
  });
  const isDraggingHistory = useRef(false);

  const startDragHistory = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingHistory.current = true;
    const startY = e.clientY;
    const startHeight = historyHeight;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDraggingHistory.current) return;
      const delta = startY - ev.clientY;
      const newHeight = Math.max(90, Math.min(startHeight + delta, window.innerHeight * 0.6));
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


  const fetchProjects = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/projects`);
      if (res.ok) {
        const data = await res.json();
        setProjects(data);
      }
    } catch (e) {
      console.error('Failed to load projects', e);
    }
  };

  const fetchTree = async (projectName: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/projects/${projectName}/tree`);
      if (res.ok) {
        const data = await res.json();
        setTreeData(prev => ({ ...prev, [projectName]: data }));
      }
    } catch (e) {
      console.error(`Failed to load tree for ${projectName}`, e);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, [refreshTrigger]);

  useEffect(() => {
    if (activeProject) {
      fetchTree(activeProject);
      setExpandedFolders(prev => ({ ...prev, [activeProject]: true }));
    }
  }, [activeProject, refreshTrigger]);

  useEffect(() => {
    if (modal && !modal.type?.startsWith('delete')) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [modal]);

  const toggleHideProject = (projName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setHiddenProjects(prev => {
      const next = prev.includes(projName)
        ? prev.filter(p => p !== projName)
        : [...prev, projName];
      try {
        localStorage.setItem(HIDDEN_PROJECTS_STORAGE_KEY, JSON.stringify(next));
      } catch (err) {
        console.error('Failed to save hidden projects', err);
      }
      return next;
    });
  };

  const toggleFolder = (folderKey: string, projectName?: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const isExpanding = !expandedFolders[folderKey];
    setExpandedFolders(prev => ({ ...prev, [folderKey]: isExpanding }));
    if (isExpanding && projectName) {
      fetchTree(projectName);
    }
  };

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

  const openCreateProjectModal = () => {
    setModalInputVal('');
    setModal({ type: 'create-project', projName: '' });
  };

  const openCreateModal = (type: 'create-file' | 'create-folder') => {
    if (!activeProject) {
      showToast('Please select a project first', 'warning');
      return;
    }
    setModalInputVal('');
    setModal({ type, projName: activeProject });
  };

  const openDeleteFileModal = (projName: string, targetPath: string, isFolder: boolean, e: React.MouseEvent) => {
    e.stopPropagation();
    setModal({ type: 'delete-file', projName, targetPath, isFolder });
  };

  const openDeleteProjectModal = (projName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setModal({ type: 'delete-project', projName });
  };

  const closeModal = () => {
    setModal(null);
    setModalInputVal('');
  };

  const handleModalSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!modal) return;

    if (modal.type === 'create-project') {
      const projName = modalInputVal.trim();
      if (!projName) return;
      try {
        const res = await fetch(`${API_BASE_URL}/projects`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: projName })
        });
        if (res.ok) {
          showToast(`Project "${projName}" created`, 'success');
          await fetchProjects();
          onSelectProject(projName);
          closeModal();
        } else {
          const err = await res.json();
          showToast(err.detail || 'Failed to create project', 'error');
        }
      } catch {
        showToast('Error creating project', 'error');
      }
      return;
    }

    if (modal.type === 'create-file') {
      const filename = modalInputVal.trim();
      if (!filename) return;
      try {
        const res = await fetch(`${API_BASE_URL}/projects/${modal.projName}/file`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: filename, content: '' })
        });
        if (res.ok) {
          showToast(`File "${filename}" created`, 'success');
          fetchTree(modal.projName);
          onOpenFile(filename, 'code');
          closeModal();
        } else {
          const err = await res.json();
          showToast(err.detail || 'Failed to create file', 'error');
        }
      } catch {
        showToast('Error creating file', 'error');
      }
    } else if (modal.type === 'create-folder') {
      const foldername = modalInputVal.trim();
      if (!foldername) return;
      try {
        const res = await fetch(`${API_BASE_URL}/projects/${modal.projName}/directory`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: foldername })
        });
        if (res.ok) {
          showToast(`Directory "${foldername}" created`, 'success');
          fetchTree(modal.projName);
          closeModal();
        } else {
          const err = await res.json();
          showToast(err.detail || 'Failed to create directory', 'error');
        }
      } catch {
        showToast('Error creating directory', 'error');
      }
    } else if (modal.type === 'delete-file' && modal.targetPath) {
      try {
        const res = await fetch(`${API_BASE_URL}/projects/${modal.projName}/file?path=${encodeURIComponent(modal.targetPath)}`, {
          method: 'DELETE'
        });
        if (res.ok) {
          showToast(`Deleted: ${modal.targetPath}`, 'info');
          if (activeFilePath === modal.targetPath) {
            onCloseFile();
          }
          fetchTree(modal.projName);
          closeModal();
        } else {
          const err = await res.json();
          showToast(err.detail || 'Failed to delete item', 'error');
        }
      } catch {
        showToast('Error deleting item', 'error');
      }
    } else if (modal.type === 'delete-project') {
      try {
        const res = await fetch(`${API_BASE_URL}/projects/${modal.projName}`, {
          method: 'DELETE'
        });
        if (res.ok) {
          showToast(`Project "${modal.projName}" deleted`, 'info');
          if (activeProject === modal.projName) {
            onCloseFile();
            onSelectProject('');
          }
          fetchProjects();
          closeModal();
        } else {
          const err = await res.json();
          showToast(err.detail || 'Failed to delete project', 'error');
        }
      } catch {
        showToast('Error deleting project', 'error');
      }
    }
  };

  const handleDragStart = (e: React.DragEvent, projName: string, path: string) => {
    e.stopPropagation();
    setDraggedItem({ projName, path });
    e.dataTransfer.setData('text/plain', JSON.stringify({ projName, path }));
  };

  const handleDragOver = (e: React.DragEvent, targetPath: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (dropTarget !== targetPath) {
      setDropTarget(targetPath);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(null);
  };

  const handleDrop = async (e: React.DragEvent, projName: string, destFolder: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(null);

    if (!draggedItem || draggedItem.projName !== projName) return;
    if (draggedItem.path === destFolder) return;

    try {
      const res = await fetch(`${API_BASE_URL}/projects/${projName}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: draggedItem.path,
          destination: destFolder
        })
      });

      if (res.ok) {
        showToast('Moved successfully', 'success');
        fetchTree(projName);
      } else {
        const err = await res.json();
        showToast(err.detail || 'Failed to move item', 'error');
      }
    } catch {
      showToast('Network error while moving', 'error');
    } finally {
      setDraggedItem(null);
    }
  };

  const renderTreeNodes = (items: TreeItem[], projName: string) => {
    return items.map((node) => {
      const isSelected = activeFilePath === node.path && activeProject === projName;
      if (node.type === 'directory') {
        const folderKey = `${projName}:${node.path}`;
        const isExpanded = !!expandedFolders[folderKey];
        const isTarget = dropTarget === node.path;

        return (
          <div 
            key={node.path} 
            style={{ marginLeft: 12 }}
            onDragOver={(e) => handleDragOver(e, node.path)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, projName, node.path)}
          >
            <div 
              draggable
              onDragStart={(e) => handleDragStart(e, projName, node.path)}
              onClick={(e) => toggleFolder(folderKey, undefined, e)}
              className="tree-item-row"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '3px 6px',
                cursor: 'pointer',
                borderRadius: 4,
                fontSize: 12.5,
                color: 'var(--text-main)',
                background: isTarget ? 'rgba(59, 130, 246, 0.2)' : 'transparent'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
                <span onClick={(e) => toggleFolder(folderKey, undefined, e)} style={{ display: 'flex', alignItems: 'center' }}>
                  {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                </span>
                {isExpanded ? <FolderOpen size={14} color="#3b82f6" /> : <Folder size={14} color="#3b82f6" />}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
              </div>
              <button 
                className="tree-action-btn hover-only"
                onClick={(e) => openDeleteFileModal(projName, node.path, true, e)}
                title="Delete directory"
              >
                <Trash2 size={12} />
              </button>
            </div>
            {isExpanded && node.children && renderTreeNodes(node.children, projName)}
          </div>
        );
      }

      return (
        <div
          key={node.path}
          draggable
          onDragStart={(e) => handleDragStart(e, projName, node.path)}
          onClick={() => {
            if (activeProject !== projName) {
              onSelectProject(projName);
            }
            onOpenFile(node.path, node.file_type === 'image' ? 'image' : 'code');
          }}
          className="tree-item-row"
          style={{
            marginLeft: 18,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '3px 6px',
            cursor: 'grab',
            borderRadius: 4,
            fontSize: 12,
            background: isSelected ? 'var(--bg-active-item, rgba(59, 130, 246, 0.15))' : 'transparent',
            color: isSelected ? 'var(--primary-color, #2563eb)' : 'var(--text-muted)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
            {node.file_type === 'image' ? (
              <FileImage size={13} color="#10b981" />
            ) : (
              <FileCode size={13} color="#64748b" />
            )}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {node.name}
            </span>
          </div>
          <button 
            className="tree-action-btn hover-only"
            onClick={(e) => openDeleteFileModal(projName, node.path, false, e)}
            title="Delete file"
          >
            <Trash2 size={12} />
          </button>
        </div>
      );
    });
  };

  const visibleProjects = projects.filter(p => showHidden || !hiddenProjects.includes(p));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-panel)', position: 'relative' }}>
      {/* Header */}
      <div style={{
        height: 38,
        padding: '0 10px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '1px solid var(--border-color)'
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
          PROJECTS TREE
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {activeProject ? (
            <>
              <button
                onClick={() => openCreateModal('create-file')}
                className="theme-toggle-btn"
                style={{ padding: 4 }}
                title={`New file in ${activeProject}`}
              >
                <FilePlus size={13} />
              </button>
              <button
                onClick={() => openCreateModal('create-folder')}
                className="theme-toggle-btn"
                style={{ padding: 4 }}
                title={`New folder in ${activeProject}`}
              >
                <FolderPlus size={13} />
              </button>
            </>
          ) : (
            <button
              onClick={openCreateProjectModal}
              className="theme-toggle-btn"
              style={{ padding: 4 }}
              title="New project directory"
            >
              <FolderPlus size={13} />
            </button>
          )}
          <button
            onClick={() => setShowHidden(prev => !prev)}
            className="theme-toggle-btn"
            style={{ 
              padding: 4, 
              color: showHidden ? 'var(--primary-color, #2563eb)' : 'var(--text-muted)',
              background: showHidden ? 'rgba(59, 130, 246, 0.15)' : 'transparent'
            }}
            title={showHidden ? "Hide hidden projects" : "Show hidden projects"}
          >
            {showHidden ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>

          <button
            onClick={() => {
              fetchProjects();
              if (activeProject) fetchTree(activeProject);
            }}
            className="theme-toggle-btn"
            style={{ padding: 4 }}
            title="Refresh Projects Tree"
          >
            <RotateCw size={13} />
          </button>
        </div>
      </div>

      {/* Projects List */}
      <div 
        style={{ flex: 1, overflowY: 'auto', padding: '8px 6px' }}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            onSelectProject("");
          }
        }}
      >
        {visibleProjects.length === 0 ? (
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', textAlign: 'center', marginTop: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <div>
              {projects.length > 0 && !showHidden 
                ? 'All projects are hidden' 
                : 'No projects in workspace'}
            </div>
            <button
              onClick={openCreateProjectModal}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                borderRadius: 4,
                border: '1px solid var(--border-color)',
                background: 'var(--bg-panel)',
                color: 'var(--text-main)',
                cursor: 'pointer',
                fontSize: 11.5
              }}
            >
              <FolderPlus size={13} />
              New Project
            </button>
          </div>
        ) : (
          visibleProjects.map((proj) => {
            const isProjExpanded = !!expandedFolders[proj];
            const isProjActive = activeProject === proj;
            const isRootTarget = dropTarget === `${proj}:root`;
            const isHidden = hiddenProjects.includes(proj);

            return (
              <div 
                key={proj} 
                style={{ 
                  marginBottom: 4,
                  opacity: isHidden ? 0.6 : 1.0
                }}
                onDragOver={(e) => handleDragOver(e, `${proj}:root`)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, proj, "")}
              >
                <div
                  onClick={() => onSelectProject(proj)}
                  className="tree-item-row"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '4px 8px',
                    borderRadius: 5,
                    cursor: 'pointer',
                    fontSize: 12.5,
                    fontWeight: 600,
                    background: isRootTarget ? 'rgba(59, 130, 246, 0.2)' : (isProjActive ? 'rgba(59, 130, 246, 0.1)' : 'transparent'),
                    color: isProjActive ? 'var(--primary-color, #2563eb)' : 'var(--text-main)'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
                    <span 
                      onClick={(e) => toggleFolder(proj, proj, e)}
                      style={{ display: 'inline-flex', alignItems: 'center', padding: 2 }}
                    >
                      {isProjExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    </span>
                    {isProjExpanded ? <FolderOpen size={15} color="#3b82f6" /> : <Folder size={15} color="#3b82f6" />}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {proj}
                    </span>
                  </div>

                  {/* Иконки действий для проектов: всегда видны при активности строки или ховере */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    {pythonStatus[proj]?.has_python && !composeStatus[proj]?.has_compose && (
                      <button
                        className="tree-action-btn project-btn"
                        onClick={(e) => handlePythonToggle(proj, e)}
                        title={
                          loadingPython[proj]
                            ? "Working..."
                            : pythonStatus[proj]?.running
                            ? `Stop Python Server "${proj}"`
                            : `Start Python Server "${proj}"`
                        }
                        style={{
                          color: pythonStatus[proj]?.running
                            ? "var(--success-color, #10b981)"
                            : "var(--text-muted)"
                        }}
                      >
                        {loadingPython[proj] ? (
                          <span className="spinner-border spinner-border-sm" style={{ width: 12, height: 12 }} />
                        ) : pythonStatus[proj]?.running ? (
                          <Square size={13} />
                        ) : (
                          <Play size={13} />
                        )}
                      </button>
                    )}
                    {composeStatus[proj]?.has_compose && (
                      <button
                        className="tree-action-btn project-btn"
                        onClick={(e) => toggleCompose(proj, e)}
                        disabled={loadingCompose[proj]}
                        title={composeStatus[proj]?.running ? "Stop containers (docker compose down)" : "Build & Start containers (docker compose up -d)"}
                        style={{
                          color: composeStatus[proj]?.running ? '#22c55e' : 'var(--text-muted)'
                        }}
                      >
                        {loadingCompose[proj] ? (
                          <Loader2 size={13} className="spin" />
                        ) : composeStatus[proj]?.running ? (
                          <Square size={13} />
                        ) : (
                          <Play size={13} />
                        )}
                      </button>
                    )}
                    <button
                      className="tree-action-btn project-btn"
                      onClick={(e) => handleOpenPreview(proj, e)}
                      title={`Preview project "${proj}" (index.*)`}
                      style={{ color: 'var(--text-muted)' }}
                    >
                      <ExternalLink size={13} />
                    </button>
                    <button
                      className="tree-action-btn project-btn"
                      onClick={(e) => toggleHideProject(proj, e)}
                      title={isHidden ? `Unhide ${proj}` : `Hide ${proj}`}
                      style={{
                        color: isHidden ? 'var(--primary-color, #2563eb)' : 'var(--text-muted)'
                      }}
                    >
                      {isHidden ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                    <button
                      className="tree-action-btn project-btn delete-btn"
                      onClick={(e) => openDeleteProjectModal(proj, e)}
                      title={`Delete project "${proj}"`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
                {isProjExpanded && treeData[proj] && (
                  <div style={{ marginTop: 2 }}>
                    {renderTreeNodes(treeData[proj], proj)}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

            {/* File History Section */}
      {activeFilePath && (
        <div style={{
          height: `${historyHeight}px`,
          minHeight: 90,
          borderTop: "1px solid var(--border-color)",
          display: "flex",
          flexDirection: "column",
          background: "var(--bg-panel)",
          position: "relative"
        }}>
          {/* Horizontal drag handle */}
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

          <div style={{
            height: 32,
            minHeight: 32,
            padding: "0 10px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "var(--bg-header)",
            borderBottom: "1px solid var(--border-color)"
          }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.05em", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 5 }}>
              <History size={12} /> FILE HISTORY
            </span>
            {fileHistory.length > 0 && (
              <button 
                onClick={handleClearHistory} 
                className="theme-toggle-btn"
                style={{ padding: 3 }}
                title="Clear file history"
              >
                <Trash2 size={11} />
              </button>
            )}
          </div>
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
        </div>
      )}

      {/* Modern Modal Overlay */}
      {modal && (
        <div 
          onClick={closeModal}
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
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)',
              overflow: 'hidden',
              animation: 'modalFadeIn 0.15s ease-out'
            }}
          >
            {/* Modal Header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 16px',
              borderBottom: '1px solid var(--border-color, rgba(255, 255, 255, 0.08))'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 13.5 }}>
                {modal.type?.startsWith('delete') ? (
                  <div style={{ width: 26, height: 26, borderRadius: 6, background: 'rgba(239, 68, 68, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <AlertTriangle size={15} color="#ef4444" />
                  </div>
                ) : modal.type === 'create-file' ? (
                  <div style={{ width: 26, height: 26, borderRadius: 6, background: 'rgba(59, 130, 246, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <FilePlus size={15} color="#3b82f6" />
                  </div>
                ) : (
                  <div style={{ width: 26, height: 26, borderRadius: 6, background: 'rgba(16, 185, 129, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <FolderPlus size={15} color="#10b981" />
                  </div>
                )}
                <span>
                  {modal.type === 'delete-project'
                    ? 'Delete project?'
                    : modal.type === 'delete-file'
                    ? `Delete ${modal.isFolder ? 'folder' : 'file'}?`
                    : modal.type === 'create-file'
                    ? 'Create New File'
                    : 'Create New Folder'}
                </span>
              </div>
              <button 
                onClick={closeModal}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted, #94a3b8)', cursor: 'pointer', padding: 4 }}
              >
                <X size={16} />
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ padding: '16px' }}>
              {modal.type === 'delete-project' ? (
                <div>
                  <p style={{ margin: '0 0 10px 0', fontSize: 13, color: 'var(--text-muted, #94a3b8)', lineHeight: 1.4 }}>
                    Are you sure you want to permanently delete this entire project and all of its contents?
                  </p>
                  <div style={{
                    padding: '8px 10px',
                    borderRadius: 6,
                    background: 'rgba(0, 0, 0, 0.25)',
                    border: '1px solid var(--border-color, rgba(255, 255, 255, 0.08))',
                    fontSize: 12,
                    fontFamily: 'monospace',
                    wordBreak: 'break-all',
                    color: '#ef4444'
                  }}>
                    {modal.projName}
                  </div>
                </div>
              ) : modal.type === 'delete-file' ? (
                <div>
                  <p style={{ margin: '0 0 10px 0', fontSize: 13, color: 'var(--text-muted, #94a3b8)', lineHeight: 1.4 }}>
                    Are you sure you want to permanently delete this item from the project?
                  </p>
                  <div style={{
                    padding: '8px 10px',
                    borderRadius: 6,
                    background: 'rgba(0, 0, 0, 0.25)',
                    border: '1px solid var(--border-color, rgba(255, 255, 255, 0.08))',
                    fontSize: 12,
                    fontFamily: 'monospace',
                    wordBreak: 'break-all',
                    color: '#ef4444'
                  }}>
                    {modal.targetPath}
                  </div>
                </div>
              ) : (
                <form onSubmit={handleModalSubmit}>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted, #94a3b8)', marginBottom: 6 }}>
                    {modal.type === 'create-file' ? 'File name with extension:' : 'Directory name:'}
                  </label>
                  <input
                    ref={inputRef}
                    type="text"
                    value={modalInputVal}
                    onChange={(e) => setModalInputVal(e.target.value)}
                    placeholder={modal.type === 'create-file' ? 'e.g. index.js or styles.css' : 'e.g. assets or components'}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: 6,
                      border: '1px solid var(--border-color, rgba(255, 255, 255, 0.15))',
                      background: 'rgba(0, 0, 0, 0.2)',
                      color: 'var(--text-main, #f8fafc)',
                      fontSize: 13,
                      outline: 'none',
                      boxSizing: 'border-box'
                    }}
                  />
                </form>
              )}
            </div>

            {/* Modal Footer */}
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
                onClick={closeModal}
                style={{
                  padding: '6px 12px',
                  borderRadius: 6,
                  border: '1px solid var(--border-color, rgba(255, 255, 255, 0.15))',
                  background: 'transparent',
                  color: 'var(--text-main, #f8fafc)',
                  cursor: 'pointer',
                  fontSize: 12.5,
                  fontWeight: 500
                }}
              >
                Cancel
              </button>
              {modal.type?.startsWith('delete') ? (
                <button
                  type="button"
                  onClick={() => handleModalSubmit()}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 6,
                    border: 'none',
                    background: '#ef4444',
                    color: '#ffffff',
                    cursor: 'pointer',
                    fontSize: 12.5,
                    fontWeight: 600,
                    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.2)'
                  }}
                >
                  Delete
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleModalSubmit()}
                  disabled={!modalInputVal.trim()}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 6,
                    border: 'none',
                    background: modalInputVal.trim() ? '#2563eb' : '#475569',
                    color: '#ffffff',
                    cursor: modalInputVal.trim() ? 'pointer' : 'not-allowed',
                    fontSize: 12.5,
                    fontWeight: 600,
                    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.2)'
                  }}
                >
                  Create
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes modalFadeIn {
          from { opacity: 0; transform: scale(0.96); }
          to { opacity: 1; transform: scale(1); }
        }
        .tree-action-btn {
          background: none;
          border: none;
          cursor: pointer;
          color: var(--text-muted);
          padding: 3px;
          border-radius: 4px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          transition: background 0.15s, color 0.15s;
        }
        .tree-action-btn.hover-only {
          display: none;
        }
        .tree-item-row:hover .tree-action-btn.hover-only {
          display: inline-flex;
        }
        .tree-action-btn:hover {
          color: var(--primary-color, #2563eb);
          background: rgba(59, 130, 246, 0.12);
        }
        .tree-action-btn.delete-btn:hover,
        .tree-action-btn[title*="Delete"]:hover {
          color: #ef4444 !important;
          background: rgba(239, 68, 68, 0.15) !important;
        }
      `}</style>
    </div>
  );
}
