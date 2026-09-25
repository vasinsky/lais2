import React, { useState, useRef, useCallback, useEffect } from 'react';
import Header from './components/Header';
import ProjectTree, { FileHistoryItem } from './components/LeftSidebar/ProjectTree';
import CenterEditor from './components/CenterEditor/CenterEditor';
import RightPanel from './components/RightPanel/RightPanel';
import MemoryModal from './components/MemoryModal';
import { useToast } from './components/Toast';

export default function App() {
  const { showToast } = useToast();
  const [selectedOllama, setSelectedOllama] = useState('dolphin-llama3:latest');
  const [selectedComfy, setSelectedComfy] = useState('Realistic_Vision_V6.0_NV_B1_fp16.safetensors');
  const [activeProject, setActiveProject] = useState<string | null>(null);
  const [activeFile, setActiveFile] = useState<{ path: string; type: 'code' | 'image' } | null>(null);
  const [isMemoryOpen, setIsMemoryOpen] = useState(false);

  // Глобальный список истории текущего файла
  const [fileHistory, setFileHistory] = useState<FileHistoryItem[]>([]);
  // Выбранная ревизия для просмотра
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

  // Загрузка истории при смене файла или проекта
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

  // Мгновенное добавление новой ревизии при сохранении
  const handleAddNewRevision = (newRev: FileHistoryItem) => {
    setFileHistory(prev => [newRev, ...prev.filter(item => item.id !== newRev.id)]);
  };

  const [leftWidth, setLeftWidth] = useState(280);
  const [rightWidth, setRightWidth] = useState(380);

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
      const newWidth = Math.max(260, Math.min(window.innerWidth - ev.clientX - 8, 700));
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
        {/* Left: Projects Tree + File History */}
        <div className="panel-card" style={{ width: `${leftWidth}px`, flexShrink: 0 }}>
          <ProjectTree 
            activeProject={activeProject}
            activeFilePath={activeFile?.path}
            fileHistory={fileHistory}
            selectedHistoryId={selectedHistoryItem?.id || null}
            onSelectProject={(proj) => {
              setActiveProject(proj);
              setSelectedHistoryItem(null);
            }}
            onOpenFile={(path, type) => {
              setActiveFile({ path, type });
              setSelectedHistoryItem(null);
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

        {/* Center: Editor */}
        <div className="panel-card" style={{ flex: 1, minWidth: 300 }}>
          <CenterEditor 
            activeFile={activeFile}
            activeProject={activeProject}
            theme={theme}
            selectedHistoryItem={selectedHistoryItem}
            onClearHistorySelection={() => setSelectedHistoryItem(null)}
            onNewRevisionSaved={handleAddNewRevision}
          />
        </div>

        <div className="resize-gutter" onMouseDown={startDragRight} />

        {/* Right: Chat & Agent */}
        <div className="panel-card" style={{ width: `${rightWidth}px`, flexShrink: 0 }}>
          <RightPanel 
            activeProject={activeProject}
            selectedOllama={selectedOllama}
            selectedComfy={selectedComfy}
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
