import React, { useState, useEffect, useCallback } from 'react';
import { 
  Folder, FolderOpen, FileCode, FileImage, Trash2, 
  ChevronRight, ChevronDown, Plus, RefreshCw, EyeOff
} from 'lucide-react';
import { useToast } from '../Toast';

export interface FileHistoryItem {
  id: string;
  timestamp: string;
  source: string;
  patch?: string;
  content?: string;
}

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  file_type?: 'code' | 'image' | 'other';
  children?: FileNode[];
}

interface Props {
  activeProject: string | null;
  activeFilePath?: string | null;
  fileHistory: FileHistoryItem[];
  selectedHistoryId: string | null;
  refreshTrigger: number;
  onSelectProject: (proj: string) => void;
  onOpenFile: (path: string, type: 'code' | 'image') => void;
  onCloseFile: () => void;
  onSelectHistoryItem: (item: FileHistoryItem) => void;
  onHistoryCleared: () => void;
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
}: Props) {
  const { showToast } = useToast();
  const [projects, setProjects] = useState<string[]>([]);
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
  const [projectFiles, setProjectFiles] = useState<Record<string, FileNode[]>>({});
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [folderContents, setFolderContents] = useState<Record<string, FileNode[]>>({});

  const loadProjects = useCallback(() => {
    fetch('http://localhost:8000/api/projects')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          const names = data.map((p: any) => typeof p === 'string' ? p : p.name);
          setProjects(names);
        }
      })
      .catch(() => setProjects([]));
  }, []);

  const loadProjectFiles = useCallback((proj: string) => {
    fetch(`http://localhost:8000/api/projects/${encodeURIComponent(proj)}/tree`)
      .then(res => res.json())
      .then(data => {
        setProjectFiles(prev => ({ ...prev, [proj]: Array.isArray(data) ? data : [] }));
      })
      .catch(() => {
        setProjectFiles(prev => ({ ...prev, [proj]: [] }));
      });
  }, []);

  const loadFolderContents = useCallback((proj: string, folderPath: string) => {
    fetch(`http://localhost:8000/api/projects/${encodeURIComponent(proj)}/tree?subpath=${encodeURIComponent(folderPath)}`)
      .then(res => res.json())
      .then(data => {
        setFolderContents(prev => ({ ...prev, [`${proj}:${folderPath}`]: Array.isArray(data) ? data : [] }));
      })
      .catch(() => {});
  }, []);

  // Перезагрузка при внешнем триггере
  useEffect(() => {
    loadProjects();
    if (activeProject) {
      loadProjectFiles(activeProject);
      // Сбрасываем и перезапрашиваем все раскрытые папки
      Object.keys(expandedFolders).forEach(key => {
        if (expandedFolders[key] && key.startsWith(`${activeProject}:`)) {
          const folderPath = key.replace(`${activeProject}:`, '');
          loadFolderContents(activeProject, folderPath);
        }
      });
    }
  }, [refreshTrigger, activeProject, loadProjects, loadProjectFiles, loadFolderContents]);

  // Авто-разворачивание активного проекта
  useEffect(() => {
    if (activeProject && !expandedProjects[activeProject]) {
      setExpandedProjects(prev => ({ ...prev, [activeProject]: true }));
      loadProjectFiles(activeProject);
    }
  }, [activeProject, expandedProjects, loadProjectFiles]);

  const toggleProject = (proj: string) => {
    const isNext = !expandedProjects[proj];
    setExpandedProjects(prev => ({ ...prev, [proj]: isNext }));
    onSelectProject(proj);
    if (isNext) {
      loadProjectFiles(proj);
    }
  };

  const toggleFolder = (proj: string, folderPath: string) => {
    const key = `${proj}:${folderPath}`;
    const isNext = !expandedFolders[key];
    setExpandedFolders(prev => ({ ...prev, [key]: isNext }));
    if (isNext) {
      loadFolderContents(proj, folderPath);
    }
  };

  const renderFileNode = (node: FileNode, proj: string, depth: number = 1) => {
    const isDir = node.type === 'directory';
    const folderKey = `${proj}:${node.path}`;
    const isFolderExpanded = !!expandedFolders[folderKey];
    const isSelected = activeFilePath === node.path;

    if (isDir) {
      const children = folderContents[folderKey] || [];
      return (
        <div key={node.path}>
          <div 
            onClick={() => toggleFolder(proj, node.path)}
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '3px 8px',
              paddingLeft: `${depth * 14}px`,
              cursor: 'pointer',
              fontSize: '11.5px',
              gap: '5px',
              borderRadius: '4px',
              color: 'var(--text-main)',
              userSelect: 'none'
            }}
            className="tree-node"
          >
            {isFolderExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {isFolderExpanded ? <FolderOpen size={13} color="var(--btn-primary)" /> : <Folder size={13} color="var(--btn-primary)" />}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
          </div>

          {isFolderExpanded && (
            <div>
              {children.map(child => renderFileNode(child, proj, depth + 1))}
            </div>
          )}
        </div>
      );
    }

    const isImage = node.file_type === 'image' || node.name.match(/\.(png|jpg|jpeg|webp|gif|svg)$/i);

    return (
      <div
        key={node.path}
        onClick={() => onOpenFile(node.path, isImage ? 'image' : 'code')}
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '3px 8px',
          paddingLeft: `${depth * 14 + 12}px`,
          cursor: 'pointer',
          fontSize: '11.5px',
          gap: '6px',
          borderRadius: '4px',
          background: isSelected ? 'var(--hover-item)' : 'transparent',
          color: isSelected ? 'var(--btn-primary)' : 'var(--text-main)',
          fontWeight: isSelected ? 600 : 400,
          userSelect: 'none'
        }}
        className="tree-node"
      >
        {isImage ? <FileImage size={13} color="#10b981" /> : <FileCode size={13} color="var(--text-muted)" />}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-panel)' }}>
      {/* Шапка дерева */}
      <div style={{
        padding: '10px 12px',
        borderBottom: '1px solid var(--border-color)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <span style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.5px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
          Projects Tree
        </span>
        <button
          onClick={() => {
            loadProjects();
            if (activeProject) loadProjectFiles(activeProject);
            showToast("Projects tree refreshed", "info");
          }}
          className="theme-toggle-btn"
          title="Refresh tree"
          style={{ padding: '2px 5px' }}
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {/* Список проектов и файлов */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 4px' }}>
        {projects.length === 0 ? (
          <div style={{ padding: '20px 10px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '11.5px' }}>
            No projects found
          </div>
        ) : (
          projects.map(proj => {
            const isExpanded = !!expandedProjects[proj];
            const isCurrent = activeProject === proj;
            const files = projectFiles[proj] || [];

            return (
              <div key={proj} style={{ marginBottom: '2px' }}>
                <div
                  onClick={() => toggleProject(proj)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '5px 8px',
                    borderRadius: '5px',
                    cursor: 'pointer',
                    background: isCurrent ? 'var(--hover-item)' : 'transparent',
                    color: isCurrent ? 'var(--btn-primary)' : 'var(--text-main)',
                    fontWeight: isCurrent ? 600 : 500,
                    fontSize: '12px'
                  }}
                  className="tree-node"
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
                    {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    {isExpanded ? <FolderOpen size={14} color="var(--btn-primary)" /> : <Folder size={14} color="var(--btn-primary)" />}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{proj}</span>
                  </div>
                </div>

                {isExpanded && (
                  <div style={{ marginTop: '2px' }}>
                    {files.length === 0 ? (
                      <div style={{ padding: '4px 8px 4px 28px', fontSize: '11px', color: 'var(--text-muted)' }}>
                        Empty folder
                      </div>
                    ) : (
                      files.map(node => renderFileNode(node, proj, 1))
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Панель истории файла */}
      {fileHistory.length > 0 && (
        <div style={{
          borderTop: '1px solid var(--border-color)',
          maxHeight: '160px',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-panel-sub)'
        }}>
          <div style={{
            padding: '6px 10px',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '10.5px',
            fontWeight: 600,
            color: 'var(--text-muted)'
          }}>
            <span>FILE HISTORY</span>
            <button
              onClick={onHistoryCleared}
              className="theme-toggle-btn"
              title="Clear history"
              style={{ padding: '1px 4px' }}
            >
              <Trash2 size={11} color="#ef4444" />
            </button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '4px' }}>
            {fileHistory.map(item => (
              <div
                key={item.id}
                onClick={() => onSelectHistoryItem(item)}
                style={{
                  padding: '4px 6px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  cursor: 'pointer',
                  background: selectedHistoryId === item.id ? 'var(--hover-item)' : 'transparent',
                  color: selectedHistoryId === item.id ? 'var(--btn-primary)' : 'var(--text-main)',
                  display: 'flex',
                  justifyContent: 'space-between'
                }}
              >
                <span>{item.source}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>
                  {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
