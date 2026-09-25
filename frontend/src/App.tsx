import React, { useState, useRef, useCallback, useEffect } from 'react';
import Header from './components/Header';
import ProjectTree, { FileHistoryItem } from './components/LeftSidebar/ProjectTree';
import CenterEditor from './components/CenterEditor/CenterEditor';
import RightPanel from './components/RightPanel/RightPanel';
import MemoryModal from './components/MemoryModal';
import { useToast } from './components/Toast';

export default function App() {
  const { showToast } = useToast();
  const [selectedOllama, setSelectedOllama] = useState('qwen2.5-coder:7b-instruct-q4_K_M');
  const [selectedComfy, setSelectedComfy] = useState('Realistic_Vision_V6.0_NV_B1_fp16.safetensors');
  const [activeProject, setActiveProject] = useState<string | null>(null);
  const [activeFile, setActiveFile] = useState<{ path: string; type: 'code' | 'image' } | null>(null);
  const [activeFileContent, setActiveFileContent] = useState<string>('');
  const [isMemoryOpen, setIsMemoryOpen] = useState(false);

  // Режим правой панели (Global Chat или Project Agent)
  const [chatMode, setChatMode] = useState<'chat' | 'agent'>('chat');

  const [fileHistory, setFileHistory] = useState<FileHistoryItem[]>([]);
  const [selectedHistoryItem, setSelectedHistoryItem] = useState<FileHistoryItem | null>(null);

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem('studio_theme') as 'light' | 'dark') || 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('studio_theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    const nextTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(nextTheme);
    showToast(`Switched to ${nextTheme} mode`, "info");
  };

  const loadHistoryForCurrentFile = useCallback((proj: string | null, filePath: string | null) => {
    if (!proj || !filePath) {
      setFileHistory([]);
      setSelectedHistoryItem(null);
      return;
    }
    fetch(`http://localhost:8000/api/projects/${encodeURIComponent(proj)}/history?path=${encodeURIComponent(filePath)}`)
      .then(res => res.json())
      .then((data: FileHistoryItem[]) => {
        setFileHistory(Array.isArray(data) ? data : []);
      })
      .catch(() => setFileHistory([]));
  }, []);

  useEffect(() => {
    loadHistoryForCurrentFile(activeProject, activeFile?.path || null);
  }, [activeProject, activeFile?.path, loadHistoryForCurrentFile]);

  const handleAddNewRevision = (newRev: FileHistoryItem) => {
    setFileHistory(prev => [newRev, ...prev.filter(item => item.id !== newRev.id)]);
  };

  const handleLiveStreamToEditor = (targetPath: string, codeChunk: string, isStart: boolean) => {
    if (!activeFile || activeFile.path !== targetPath) {
      setActiveFile({ path: targetPath, type: 'code' });
      setSelectedHistoryItem(null);
    }
    setActiveFileContent(prev => isStart ? codeChunk : (prev + codeChunk));
  };

  const [leftWidth, setLeftWidth] = useState(280);
  const [rightWidth, setRightWidth] = useState(420);

  const isDraggingLeft = useRef(false);
  const isDraggingRight = useRef(false);

  const startDragLeft = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingLeft.current = true;
    const onMouseMove = (ev: MouseEvent) => {
      if (!isDraggingLeft.current) return;
      const newWidth = Math.max(220, Math.min(ev.clientX - 8, 550));
      setLeftWidth(newWidth);
    };
    const onMouseUp = () => {
      isDraggingLeft.current = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, []);

  const startDragRight = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRight.current = true;
    const onMouseMove = (ev: MouseEvent) => {
      if (!isDraggingRight.current) return;
      const newWidth = Math.max(300, Math.min(window.innerWidth - ev.clientX - 8, 750));
      setRightWidth(newWidth);
    };
    const onMouseUp = () => {
      isDraggingRight.current = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, []);

  return (
    <div className="studio-layout">
      <Header 
        selectedOllama={selectedOllama}
        onSelectOllama={setSelectedOllama}
        selectedComfy={selectedComfy}
        onSelectComfy={setSelectedComfy}
        theme={theme}
        onToggleTheme={toggleTheme}
        onOpenMemory={() => setIsMemoryOpen(true)}
      />

      <div className="studio-main">
        <div className="panel-card" style={{ width: `${leftWidth}px`, flexShrink: 0 }}>
          <ProjectTree 
            activeProject={activeProject}
            activeFilePath={activeFile?.path}
            fileHistory={fileHistory}
            selectedHistoryId={selectedHistoryItem?.id || null}
            onSelectProject={(proj) => {
              setActiveProject(proj);
              setSelectedHistoryItem(null);
              // При выборе/создании/клике по проекту — переключаем чат на агента
              if (proj) setChatMode('agent');
            }}
            onOpenFile={(path, type) => {
              setActiveFile({ path, type });
              setSelectedHistoryItem(null);
              // При открытии любого файла проекта — переключаем чат на агента
              setChatMode('agent');
            }}
            onCloseFile={() => {
              setActiveFile(null);
              setSelectedHistoryItem(null);
              setFileHistory([]);
            }}
            onSelectHistoryItem={(item) => setSelectedHistoryItem(item)}
            onHistoryCleared={() => {
              setFileHistory([]);
              setSelectedHistoryItem(null);
            }}
          />
        </div>

        <div className="resize-gutter" onMouseDown={startDragLeft} />

        <div className="panel-card" style={{ flex: 1, minWidth: 300 }}>
          <CenterEditor 
            activeFile={activeFile}
            activeProject={activeProject}
            theme={theme}
            selectedHistoryItem={selectedHistoryItem}
            overrideContent={activeFileContent}
            onClearHistorySelection={() => setSelectedHistoryItem(null)}
            onNewRevisionSaved={handleAddNewRevision}
            onContentChange={(code) => setActiveFileContent(code)}
          />
        </div>

        <div className="resize-gutter" onMouseDown={startDragRight} />

        <div className="panel-card" style={{ width: `${rightWidth}px`, flexShrink: 0 }}>
          <RightPanel 
            mode={chatMode}
            onModeChange={setChatMode}
            activeProject={activeProject}
            activeFilePath={activeFile?.path}
            activeFileContent={activeFileContent}
            selectedOllama={selectedOllama}
            selectedComfy={selectedComfy}
            onLiveStreamToEditor={handleLiveStreamToEditor}
            onFileAutoSaved={(filePath, rev) => {
              if (activeFile?.path === filePath) {
                handleAddNewRevision(rev);
              }
              showToast(`File "${filePath}" updated and saved`, "success");
            }}
          />
        </div>
      </div>

      <MemoryModal 
        isOpen={isMemoryOpen} 
        onClose={() => setIsMemoryOpen(false)} 
      />
    </div>
  );
}
