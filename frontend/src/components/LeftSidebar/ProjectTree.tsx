import React, { useEffect, useState, useRef, useCallback } from 'react';
import { 
  Folder, FolderOpen, FileCode, Plus, ChevronRight, ChevronDown, 
  FolderPlus, FilePlus, RefreshCw, Trash2, Eye, EyeOff, AlertTriangle, X,
  History, Clock, Container, Terminal
} from 'lucide-react';
import { useToast } from '../Toast';

interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  children: FileNode[];
}

export interface ProjectItem {
  name: string;
  is_hidden: boolean;
  project_type?: 'static' | 'docker' | 'python';
}

export interface FileHistoryItem {
  id: string;
  timestamp: string;
  created_at: string;
  content: string;
}

interface Props {
  activeProject: string | null;
  activeFilePath?: string | null;
  fileHistory: FileHistoryItem[];
  selectedHistoryId: string | null;
  onSelectProject: (p: string | null) => void;
  onOpenFile: (path: string, type: 'code' | 'image') => void;
  onCloseFile?: () => void;
  onSelectHistoryItem: (item: FileHistoryItem | null) => void;
  onHistoryCleared: () => void;
  refreshTrigger?: number;
}

export default function ProjectTree({ 
  activeProject, 
  activeFilePath, 
  fileHistory,
  selectedHistoryId,
  onSelectProject, 
  onOpenFile, 
  onCloseFile,
  onSelectHistoryItem,
  onHistoryCleared,
  refreshTrigger
}: Props) {
  const { showToast } = useToast();
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [showHidden, setShowHidden] = useState<boolean>(() => {
    return localStorage.getItem('studio_show_hidden_projects') === 'true';
  });
  
  const [projectTrees, setProjectTrees] = useState<{ [proj: string]: FileNode[] }>({});
  const [expandedProjects, setExpandedProjects] = useState<{ [proj: string]: boolean }>({});
  const [expandedFolders, setExpandedFolders] = useState<{ [path: string]: boolean }>({});
  
  const [isCreatingProj, setIsCreatingProj] = useState(false);
  const [newProjName, setNewProjName] = useState('');
  const [newProjType, setNewProjType] = useState<'static' | 'docker' | 'python'>('static');
  
  const [isCreatingItem, setIsCreatingItem] = useState<{ type: 'file' | 'folder' } | null>(null);
  const [newItemName, setNewItemName] = useState('');

  const [projectToDelete, setProjectToDelete] = useState<string | null>(null);
  const [historyHeight, setHistoryHeight] = useState<number>(220);
  const [showClearHistoryConfirm, setShowClearHistoryConfirm] = useState(false);
  const isDraggingSplit = useRef(false);

  const loadProjects = useCallback((selectDefault: boolean = false) => {
    fetch('http://localhost:8000/api/projects/')
      .then(res => {
        if (!res.ok) throw new Error("Ошибка загрузки списка проектов");
        return res.json();
      })
      .then((data: ProjectItem[]) => {
        setProjects(data);
        if (selectDefault) {
          const visible = data.filter(p => showHidden || !p.is_hidden);
          if (visible.length > 0 && !activeProject) {
            selectProject(visible[0].name);
          }
        }
      })
      .catch(err => {
        showToast(err.message || "Не удалось загрузить проекты", "error");
      });
  }, [showHidden, activeProject]);

  const loadProjectTree = useCallback((proj: string) => {
    fetch(`http://localhost:8000/api/projects/${encodeURIComponent(proj)}/tree`)
      .then(res => {
        if (!res.ok) throw new Error(`Ошибка загрузки файлов для ${proj}`);
        return res.json();
      })
      .then((tree: FileNode[]) => {
        setProjectTrees(prev => ({ ...prev, [proj]: tree }));
      })
      .catch(err => {
        showToast(err.message || "Не удалось загрузить дерево файлов", "error");
      });
  }, [showToast]);

  // Загрузка при старте и по refreshTrigger
  useEffect(() => {
    loadProjects(false);
  }, [showHidden, refreshTrigger, loadProjects]);

  // Реакция на изменение activeProject снаружи (например, при создании из чата)
  useEffect(() => {
    if (activeProject) {
      setExpandedProjects(prev => ({ ...prev, [activeProject]: true }));
      loadProjectTree(activeProject);
    }
  }, [activeProject, loadProjectTree]);

  const toggleShowHidden = () => {
    const next = !showHidden;
    setShowHidden(next);
    localStorage.setItem('studio_show_hidden_projects', String(next));
    showToast(next ? "Скрытые проекты отображаются" : "Скрытые проекты скрыты", "info");
  };

  const selectProject = (proj: string) => {
    onSelectProject(proj);
    setExpandedProjects(prev => ({ ...prev, [proj]: true }));
    loadProjectTree(proj);
  };

  const toggleProject = (proj: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const willExpand = !expandedProjects[proj];
    setExpandedProjects(prev => ({ ...prev, [proj]: willExpand }));
    if (willExpand) {
      loadProjectTree(proj);
    }
  };

  const toggleFolder = (fullPath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedFolders(prev => ({ ...prev, [fullPath]: !prev[fullPath] }));
  };

  const handleToggleHideProject = (proj: string, e: React.MouseEvent) => {
    e.stopPropagation();
    fetch(`http://localhost:8000/api/projects/${encodeURIComponent(proj)}/toggle-visibility`, { method: 'POST' })
      .then(res => {
        if (!res.ok) throw new Error("Не удалось изменить видимость");
        return res.json();
      })
      .then(data => {
        loadProjects(false);
        showToast(data.is_hidden ? `Проект "${proj}" скрыт` : `Проект "${proj}" теперь видим`, "info");
      })
      .catch(err => {
        showToast(err.message, "error");
      });
  };

  const confirmDeleteProject = () => {
    if (!projectToDelete) return;
    const targetProj = projectToDelete;
    
    fetch(`http://localhost:8000/api/projects/${encodeURIComponent(targetProj)}`, {
      method: 'DELETE'
    }).then(res => {
      if (res.ok) {
        showToast(`Проект "${targetProj}" успешно удален`, "success");
        if (activeProject === targetProj) {
          if (onCloseFile) onCloseFile();
          onSelectProject(null);
        }
        loadProjects(false);
      } else {
        showToast(`Не удалось удалить проект "${targetProj}"`, "error");
      }
      setProjectToDelete(null);
    }).catch(() => {
      showToast("Ошибка сети при удалении проекта", "error");
      setProjectToDelete(null);
    });
  };

  const confirmClearFileHistory = () => {
    if (!activeProject || !activeFilePath) return;
    fetch(`http://localhost:8000/api/projects/${encodeURIComponent(activeProject)}/history?path=${encodeURIComponent(activeFilePath)}`, {
      method: 'DELETE'
    }).then(res => {
      if (res.ok) {
        onHistoryCleared();
        showToast(`История ревизий для "${activeFilePath}" очищена`, "success");
      } else {
        showToast("Не удалось очистить историю версий", "error");
      }
      setShowClearHistoryConfirm(false);
    }).catch(() => {
      showToast("Ошибка сети при очистке истории", "error");
      setShowClearHistoryConfirm(false);
    });
  };

  const createProject = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newProjName.trim();
    if (!name) return;

    fetch('http://localhost:8000/api/projects/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, project_type: newProjType })
    })
      .then(res => {
        if (!res.ok) throw new Error("Проект с таким именем уже существует или имя некорректно");
        return res.json();
      })
      .then(data => {
        showToast(`Проект "${data.name}" (${data.project_type}) успешно создан`, "success");
        setNewProjName('');
        setIsCreatingProj(false);
        loadProjects(false);
        selectProject(data.name);
      })
      .catch(err => {
        showToast(err.message || "Ошибка создания проекта", "error");
      });
  };

  const cancelCreateProject = () => {
    setIsCreatingProj(false);
    setNewProjName('');
  };

  const createItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newItemName.trim() || !activeProject || !isCreatingItem) return;
    const itemType = isCreatingItem.type;
    const itemName = newItemName.trim();

    fetch(`http://localhost:8000/api/projects/${encodeURIComponent(activeProject)}/create-item`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        path: itemName, 
        is_dir: itemType === 'folder' 
      })
    }).then(res => {
      if (res.ok) {
        showToast(`${itemType === 'folder' ? 'Папка' : 'Файл'} "${itemName}" успешно создана`, "success");
        setNewItemName('');
        setIsCreatingItem(null);
        loadProjectTree(activeProject);
      } else {
        showToast(`Не удалось создать ${itemType === 'folder' ? 'папку' : 'файл'}`, "error");
      }
    }).catch(() => {
      showToast("Ошибка сети при создании элемента", "error");
    });
  };

  const handleDeleteItem = (proj: string, itemPath: string, isDir: boolean, e: React.MouseEvent) => {
    e.stopPropagation();
    const confirmed = window.confirm(`Удалить ${isDir ? 'папку' : 'файл'} "${itemPath}"?`);
    if (!confirmed) return;

    fetch(`http://localhost:8000/api/projects/${encodeURIComponent(proj)}/item?path=${encodeURIComponent(itemPath)}`, {
      method: 'DELETE'
    }).then(res => {
      if (res.ok) {
        showToast(`${isDir ? 'Папка' : 'Файл'} "${itemPath}" удален`, "success");
        if (activeFilePath === itemPath && onCloseFile) {
          onCloseFile();
        }
        loadProjectTree(proj);
      } else {
        showToast(`Не удалось удалить "${itemPath}"`, "error");
      }
    }).catch(() => {
      showToast("Ошибка сети при удалении", "error");
    });
  };

  const startDragSplit = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingSplit.current = true;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDraggingSplit.current) return;
      const container = document.getElementById('left-panel-container');
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const newHeight = Math.max(100, Math.min(rect.bottom - ev.clientY, rect.height - 150));
      setHistoryHeight(newHeight);
    };

    const onMouseUp = () => {
      isDraggingSplit.current = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, []);

  const renderProjectIcon = (type?: string) => {
    if (type === 'docker') {
      return <Container size={15} color="#0db7ed" title="Docker Project" />;
    }
    if (type === 'python') {
      return <Terminal size={15} color="#eab308" title="Python Project" />;
    }
    return <Folder size={14} color="#3574f0" title="Static Web Project" />;
  };

  const renderNodes = (proj: string, nodes: FileNode[]) => (
    <ul style={{ listStyle: 'none', paddingLeft: '14px', margin: 0 }}>
      {nodes.map(node => {
        const fullNodeKey = `${proj}:${node.path}`;
        const isExpanded = !!expandedFolders[fullNodeKey];

        return (
          <li key={node.path} style={{ margin: '1px 0' }}>
            {node.is_dir ? (
              <div>
                <div 
                  onClick={(e) => toggleFolder(fullNodeKey, e)}
                  style={{ 
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '3px 4px', color: 'var(--text-muted)', fontSize: '11.5px', 
                    cursor: 'pointer', borderRadius: '4px' 
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--hover-item)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', overflow: 'hidden' }}>
                    {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    <Folder size={13} color="#3574f0" />
                    <span style={{ fontWeight: 500, color: 'var(--text-main)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                      {node.name}
                    </span>
                  </div>
                  <button
                    onClick={(e) => handleDeleteItem(proj, node.path, true, e)}
                    title="Удалить папку"
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center' }}
                  >
                    <Trash2 size={12} color="#ef4444" />
                  </button>
                </div>
                {isExpanded && node.children && renderNodes(proj, node.children)}
              </div>
            ) : (
              <div 
                onClick={() => {
                  onSelectProject(proj);
                  onOpenFile(node.path, node.name.match(/\.(png|jpg|jpeg|webp)$/i) ? 'image' : 'code');
                }}
                style={{ 
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '3px 6px', color: 'var(--text-main)', fontSize: '11.5px', 
                  cursor: 'pointer', borderRadius: '4px', paddingLeft: '18px',
                  background: activeFilePath === node.path && activeProject === proj ? 'var(--hover-item)' : 'transparent'
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--hover-item)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = activeFilePath === node.path && activeProject === proj ? 'var(--hover-item)' : 'transparent')}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
                  <FileCode size={13} color="var(--text-muted)" />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {node.name}
                  </span>
                </div>
                <button
                  onClick={(e) => handleDeleteItem(proj, node.path, false, e)}
                  title="Удалить файл"
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px', display: 'flex', alignItems: 'center' }}
                >
                  <Trash2 size={12} color="#ef4444" />
                </button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );

  const visibleProjects = projects.filter(p => showHidden || !p.is_hidden);

  return (
    <div id="left-panel-container" style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-panel)', overflow: 'hidden' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 120, overflow: 'hidden' }}>
        <div style={{ 
          padding: '8px 12px', 
          borderBottom: '1px solid var(--border-color)', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between',
          background: 'var(--bg-card)'
        }}>
          <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Projects Tree
          </span>

          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <button 
              onClick={toggleShowHidden}
              title={showHidden ? "Скрыть скрытые проекты" : "Показать скрытые проекты"}
              className="theme-toggle-btn"
              style={{ 
                padding: '3px 6px',
                background: showHidden ? 'var(--hover-item)' : 'transparent',
                color: showHidden ? 'var(--btn-primary)' : 'var(--text-muted)'
              }}
            >
              {showHidden ? <Eye size={13} /> : <EyeOff size={13} />}
            </button>

            <button 
              onClick={() => setIsCreatingProj(prev => !prev)}
              title="Создать проект"
              className="theme-toggle-btn"
              style={{ padding: '3px 6px' }}
            >
              <Plus size={13} color="#3574f0" />
            </button>
            <button 
              onClick={() => loadProjects(false)}
              title="Обновить список"
              className="theme-toggle-btn"
              style={{ padding: '3px 6px' }}
            >
              <RefreshCw size={12} color="var(--text-muted)" />
            </button>
          </div>
        </div>

        {isCreatingProj && (
          <form 
            onSubmit={createProject} 
            style={{ 
              padding: '8px 12px', 
              borderBottom: '1px solid var(--border-color)', 
              background: 'var(--input-bg)', 
              display: 'flex', 
              flexDirection: 'column',
              gap: '6px'
            }}
          >
            <div style={{ display: 'flex', gap: '6px' }}>
              <input 
                autoFocus
                value={newProjName}
                onChange={e => setNewProjName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Escape') cancelCreateProject(); }}
                placeholder="Имя проекта..."
                className="studio-input"
                style={{ flex: 1, padding: '4px 6px', fontSize: '11.5px' }}
              />
              <button type="submit" className="btn-primary" style={{ padding: '4px 8px' }}>Add</button>
              <button 
                type="button" 
                onClick={cancelCreateProject}
                className="theme-toggle-btn" 
                style={{ padding: '4px 6px' }}
                title="Отмена (Esc)"
              >
                <X size={12} />
              </button>
            </div>
            
            <div style={{ display: 'flex', gap: '4px', fontSize: '10.5px' }}>
              <button
                type="button"
                onClick={() => setNewProjType('static')}
                style={{
                  flex: 1,
                  padding: '3px',
                  borderRadius: '4px',
                  border: '1px solid var(--border-color)',
                  background: newProjType === 'static' ? '#3574f0' : 'transparent',
                  color: newProjType === 'static' ? '#fff' : 'var(--text-muted)',
                  cursor: 'pointer'
                }}
              >
                Static
              </button>
              <button
                type="button"
                onClick={() => setNewProjType('docker')}
                style={{
                  flex: 1,
                  padding: '3px',
                  borderRadius: '4px',
                  border: '1px solid var(--border-color)',
                  background: newProjType === 'docker' ? '#0db7ed' : 'transparent',
                  color: newProjType === 'docker' ? '#fff' : 'var(--text-muted)',
                  cursor: 'pointer'
                }}
              >
                Docker
              </button>
              <button
                type="button"
                onClick={() => setNewProjType('python')}
                style={{
                  flex: 1,
                  padding: '3px',
                  borderRadius: '4px',
                  border: '1px solid var(--border-color)',
                  background: newProjType === 'python' ? '#eab308' : 'transparent',
                  color: newProjType === 'python' ? '#000' : 'var(--text-muted)',
                  cursor: 'pointer'
                }}
              >
                Python
              </button>
            </div>
          </form>
        )}

        {activeProject && (
          <div style={{ padding: '4px 12px', background: 'var(--bg-panel-sub)', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '5px' }}>
              {renderProjectIcon(projects.find(p => p.name === activeProject)?.project_type)}
              <b style={{ color: 'var(--text-main)' }}>{activeProject}</b>
            </span>
            <div style={{ display: 'flex', gap: '4px' }}>
              <button 
                onClick={() => setIsCreatingItem({ type: 'file' })}
                title="Создать файл"
                className="theme-toggle-btn"
                style={{ padding: '2px 5px' }}
              >
                <FilePlus size={12} />
              </button>
              <button 
                onClick={() => setIsCreatingItem({ type: 'folder' })}
                title="Создать папку"
                className="theme-toggle-btn"
                style={{ padding: '2px 5px' }}
              >
                <FolderPlus size={12} />
              </button>
              <button 
                onClick={() => setProjectToDelete(activeProject)}
                title="Удалить проект"
                className="theme-toggle-btn"
                style={{ padding: '2px 5px', color: '#ef4444' }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        )}

        {isCreatingItem && (
          <form onSubmit={createItem} style={{ padding: '6px 12px', borderBottom: '1px solid var(--border-color)', background: 'var(--input-bg)', display: 'flex', gap: '6px' }}>
            <input 
              autoFocus
              value={newItemName}
              onChange={e => setNewItemName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') setIsCreatingItem(null); }}
              placeholder={isCreatingItem.type === 'file' ? "src/app.py или index.html..." : "src/components..."}
              className="studio-input"
              style={{ flex: 1, padding: '4px 6px', fontSize: '11px' }}
            />
            <button type="submit" className="btn-primary" style={{ padding: '3px 7px', fontSize: '11px' }}>OK</button>
            <button type="button" onClick={() => setIsCreatingItem(null)} className="theme-toggle-btn" style={{ padding: '3px 7px', fontSize: '11px' }}>✕</button>
          </form>
        )}

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 6px' }}>
          {visibleProjects.length === 0 ? (
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', marginTop: '20px' }}>
              {projects.length > 0 ? 'Все проекты скрыты. Нажмите на иконку глаза выше.' : 'Нет проектов. Нажмите «+» или напишите в чат.'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {visibleProjects.map(p => {
                const proj = p.name;
                const isSelected = activeProject === proj;
                const isExpanded = !!expandedProjects[proj];
                const tree = projectTrees[proj] || [];

                return (
                  <div key={proj} style={{ opacity: p.is_hidden ? 0.6 : 1 }}>
                    <div 
                      onClick={() => selectProject(proj)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '4px 6px',
                        borderRadius: '5px',
                        cursor: 'pointer',
                        background: isSelected ? 'var(--hover-item)' : 'transparent',
                        border: isSelected ? '1px solid var(--border-color)' : '1px solid transparent'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
                        <span onClick={(e) => toggleProject(proj, e)} style={{ display: 'flex', alignItems: 'center' }}>
                          {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                        </span>
                        {renderProjectIcon(p.project_type)}
                        <span style={{ fontSize: '12px', fontWeight: isSelected ? 600 : 500, color: 'var(--text-main)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                          {proj}
                        </span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                        <button
                          onClick={(e) => handleToggleHideProject(proj, e)}
                          title={p.is_hidden ? "Показать проект" : "Скрыть проект"}
                          style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '3px 4px', display: 'flex', alignItems: 'center', color: 'var(--text-muted)' }}
                        >
                          {p.is_hidden ? <EyeOff size={13} color="#f59e0b" /> : <Eye size={13} />}
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setProjectToDelete(proj);
                          }}
                          title="Удалить проект"
                          style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '3px 4px', display: 'flex', alignItems: 'center' }}
                        >
                          <Trash2 size={13} color="#ef4444" />
                        </button>
                      </div>
                    </div>

                    {isExpanded && (
                      <div style={{ marginTop: '2px' }}>
                        {tree.length === 0 ? (
                          <div style={{ fontSize: '11px', color: 'var(--text-muted)', paddingLeft: '28px', padding: '4px 0' }}>
                            (Пустой проект)
                          </div>
                        ) : (
                          renderNodes(proj, tree)
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div 
        className="resize-gutter-horizontal" 
        onMouseDown={startDragSplit}
        title="Перетащите вверх/вниз для изменения высоты истории"
      />

      <div style={{ height: `${historyHeight}px`, flexShrink: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg-card-sub)', overflow: 'hidden' }}>
        <div style={{ 
          padding: '6px 12px', 
          borderBottom: '1px solid var(--border-color)', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between',
          background: 'var(--bg-card)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <History size={13} color="var(--btn-primary)" />
            <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              File History
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {activeFilePath && (
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', maxWidth: '90px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {activeFilePath}
              </span>
            )}
            {fileHistory.length > 0 && (
              <button
                onClick={() => setShowClearHistoryConfirm(true)}
                title="Очистить историю версий этого файла"
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '2px',
                  display: 'flex',
                  alignItems: 'center',
                  color: '#ef4444'
                }}
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {!activeFilePath ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '11px', marginTop: '24px' }}>
              Выберите файл для просмотра ревизий.
            </div>
          ) : fileHistory.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '11px', marginTop: '24px' }}>
              История пуста. Сохраните файл для записи ревизии.
            </div>
          ) : (
            fileHistory.map((item, idx) => {
              const isSelected = selectedHistoryId === item.id;
              return (
                <div
                  key={item.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectHistoryItem(isSelected ? null : item);
                  }}
                  className={`history-item-row ${isSelected ? 'is-active' : ''}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 8px',
                    borderRadius: '5px',
                    cursor: 'pointer',
                    background: isSelected ? 'rgba(53, 116, 240, 0.16)' : 'transparent',
                    border: isSelected ? '1px solid #3574f0' : '1px solid transparent',
                    color: isSelected ? '#3574f0' : 'var(--text-muted)',
                    fontWeight: isSelected ? 600 : 400
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
                    <Clock size={12} color={isSelected ? '#3574f0' : 'var(--text-muted)'} />
                    <span style={{ fontSize: '11px', whiteSpace: 'nowrap' }}>
                      {item.timestamp || item.created_at?.substring(0, 19).replace('T', ' ') || 'Snapshot'}
                    </span>
                  </div>
                  {idx === 0 && (
                    <span style={{ fontSize: '9px', background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', padding: '1px 5px', borderRadius: '4px', fontWeight: 600 }}>
                      LATEST
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {projectToDelete && (
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
            width: '420px',
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
                  Удаление проекта
                </h3>
                <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
                  Вы действительно хотите удалить <b style={{ color: 'var(--text-main)' }}>{projectToDelete}</b>?
                </p>
              </div>
            </div>

            <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.45 }}>
              Это действие необратимо удалит папку проекта на диске, все файлы и их историю версий.
            </p>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
              <button
                onClick={() => setProjectToDelete(null)}
                className="theme-toggle-btn"
                style={{ padding: '6px 12px', fontSize: '12px' }}
              >
                Отмена
              </button>
              <button
                onClick={confirmDeleteProject}
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
                Удалить проект
              </button>
            </div>
          </div>
        </div>
      )}

      {showClearHistoryConfirm && (
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
                  Очистка истории версий
                </h3>
                <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
                  Очистить все снимки для <b style={{ color: 'var(--text-main)' }}>{activeFilePath}</b>?
                </p>
              </div>
            </div>

            <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.45 }}>
              Все записанные версии этого файла будут безвозвратно удалены из базы данных.
            </p>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
              <button
                onClick={() => setShowClearHistoryConfirm(false)}
                className="theme-toggle-btn"
                style={{ padding: '6px 12px', fontSize: '12px' }}
              >
                Отмена
              </button>
              <button
                onClick={confirmClearFileHistory}
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
                Очистить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
