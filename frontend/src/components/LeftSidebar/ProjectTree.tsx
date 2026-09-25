import { API_BASE_URL } from "../../config";
import React, { useState, useEffect } from 'react';
import { 
  Folder, 
  FolderOpen, 
  FileCode, 
  FileImage, 
  RotateCw, 
  History, 
  Trash2, 
  Clock, 
  ChevronRight, 
  ChevronDown 
} from 'lucide-react';
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
  const [projects, setProjects] = useState<string[]>([]);
  const [treeData, setTreeData] = useState<Record<string, TreeItem[]>>({});
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [isLoading, setIsLoading] = useState(false);
  const { addToast } = useToast();

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

  const toggleFolder = (folderKey: string, projectName?: string) => {
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
        `/api/projects/${activeProject}/history?path=${encodeURIComponent(activeFilePath)}`, 
        { method: 'DELETE' }
      );
      if (res.ok) {
        onHistoryCleared();
        addToast('File history cleared', 'info');
      }
    } catch (e) {
      addToast('Failed to clear file history', 'error');
    }
  };

  const renderTreeNodes = (items: TreeItem[], projName: string) => {
    return items.map((node) => {
      const isSelected = activeFilePath === node.path && activeProject === projName;
      if (node.type === 'directory') {
        const folderKey = `${projName}:${node.path}`;
        const isExpanded = !!expandedFolders[folderKey];
        return (
          <div key={node.path} style={{ marginLeft: 12 }}>
            <div 
              onClick={() => toggleFolder(folderKey)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 6px',
                cursor: 'pointer',
                borderRadius: 4,
                fontSize: 12.5,
                color: 'var(--text-main)'
              }}
            >
              {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              {isExpanded ? <FolderOpen size={14} color="#3b82f6" /> : <Folder size={14} color="#3b82f6" />}
              <span>{node.name}</span>
            </div>
            {isExpanded && node.children && renderTreeNodes(node.children, projName)}
          </div>
        );
      }

      return (
        <div
          key={node.path}
          onClick={() => {
            if (activeProject !== projName) {
              onSelectProject(projName);
            }
            onOpenFile(node.path, node.file_type === 'image' ? 'image' : 'code');
          }}
          style={{
            marginLeft: 18,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '3px 6px',
            cursor: 'pointer',
            borderRadius: 4,
            fontSize: 12,
            background: isSelected ? 'var(--bg-active-item, rgba(59, 130, 246, 0.15))' : 'transparent',
            color: isSelected ? 'var(--primary-color, #2563eb)' : 'var(--text-muted)'
          }}
        >
          {node.file_type === 'image' ? (
            <FileImage size={13} color="#10b981" />
          ) : (
            <FileCode size={13} color="#64748b" />
          )}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {node.name}
          </span>
        </div>
      );
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-panel)' }}>
      {/* Header */}
      <div style={{
        height: 38,
        padding: '0 12px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '1px solid var(--border-color)'
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
          PROJECTS TREE
        </span>
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

      {/* Projects List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 6px' }}>
        {projects.length === 0 ? (
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', textAlign: 'center', marginTop: 20 }}>
            No projects in workspace
          </div>
        ) : (
          projects.map((proj) => {
            const isProjExpanded = !!expandedFolders[proj];
            const isProjActive = activeProject === proj;
            return (
              <div key={proj} style={{ marginBottom: 4 }}>
                <div
                  onClick={() => {
                    onSelectProject(proj);
                    toggleFolder(proj, proj);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '4px 8px',
                    borderRadius: 5,
                    cursor: 'pointer',
                    fontSize: 12.5,
                    fontWeight: 600,
                    background: isProjActive ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                    color: isProjActive ? 'var(--primary-color, #2563eb)' : 'var(--text-main)'
                  }}
                >
                  {isProjExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  {isProjExpanded ? <FolderOpen size={15} color="#3b82f6" /> : <Folder size={15} color="#3b82f6" />}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {proj}
                  </span>
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

      {/* Persistent File History Block */}
      {true && (
        <div style={{
          height: 180,
          borderTop: '1px solid var(--border-color)',
          background: 'var(--bg-editor, #fafafa)',
          display: 'flex',
          flexDirection: 'column'
        }}>
          <div style={{
            height: 30,
            padding: '0 10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid var(--border-color)',
            background: 'var(--bg-panel)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <History size={12} color="var(--primary-color, #2563eb)" />
              <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--text-muted)' }}>
                FILE HISTORY ({fileHistory.length})
              </span>
            </div>
            {fileHistory.length > 0 && (
              <button
                onClick={handleClearHistory}
                className="theme-toggle-btn"
                style={{ padding: '2px 4px', border: 'none' }}
                title="Clear revision history"
              >
                <Trash2 size={12} color="#ef4444" />
              </button>
            )}
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '6px' }}>
            {fileHistory.length === 0 ? (
              <div style={{ 
                height: '100%', 
                display: 'flex', 
                flexDirection: 'column', 
                alignItems: 'center', 
                justifyContent: 'center', 
                fontSize: 11, 
                color: 'var(--text-muted)',
                textAlign: 'center',
                padding: '0 8px'
              }}>
                <span>No revisions yet</span>
                <span style={{ fontSize: 10, opacity: 0.7, marginTop: 2 }}>
                  Press Ctrl+S / Save to record snapshots
                </span>
              </div>
            ) : (
              fileHistory.map((item) => {
                const isSelected = selectedHistoryId === item.id;
                return (
                  <div
                    key={item.id}
                    onClick={() => onSelectHistoryItem(isSelected ? null : item)}
                    style={{
                      padding: '4px 8px',
                      borderRadius: 4,
                      marginBottom: 3,
                      cursor: 'pointer',
                      fontSize: 11,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 2,
                      background: isSelected ? 'var(--primary-color, #2563eb)' : 'var(--bg-panel)',
                      color: isSelected ? '#ffffff' : 'var(--text-main)',
                      border: '1px solid var(--border-color)'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {new Date(item.timestamp).toLocaleString([], { dateStyle: 'short', timeStyle: 'medium' })}
                      </span>
                      <span style={{ fontSize: 9.5, opacity: 0.8, textTransform: 'capitalize' }}>
                        {(item.source || 'save').replace(/_/g, ' ')}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
