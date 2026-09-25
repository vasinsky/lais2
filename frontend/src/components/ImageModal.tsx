import React, { useEffect } from 'react';
import { X, Download } from 'lucide-react';

interface Props {
  isOpen: boolean;
  imageUrl: string | null;
  prompt?: string;
  onClose: () => void;
}

export default function ImageModal({ isOpen, imageUrl, prompt, onClose }: Props) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !imageUrl) return null;

  const handleDownload = async () => {
    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `comfyui_${Date.now()}.png`;
      link.click();
      window.URL.revokeObjectURL(url);
    } catch {
      window.open(imageUrl, '_blank');
    }
  };

  return (
    <div 
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        backdropFilter: 'blur(5px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px'
      }}
    >
      <div 
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative',
          maxWidth: '90vw',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          background: 'var(--bg-card)',
          borderRadius: '12px',
          border: '1px solid var(--border-color)',
          overflow: 'hidden',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
        }}
      >
        <div style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '10px 16px',
          background: 'var(--bg-panel)',
          borderBottom: '1px solid var(--border-color)'
        }}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-main)' }}>
            Full Size Preview
          </span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={handleDownload}
              className="theme-toggle-btn"
              title="Скачать изображение"
              style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 8px', fontSize: '11px' }}
            >
              <Download size={14} />
              Сохранить
            </button>
            <button
              onClick={onClose}
              className="theme-toggle-btn"
              title="Закрыть (Esc)"
              style={{ padding: '4px 8px' }}
            >
              <X size={15} />
            </button>
          </div>
        </div>

        <div style={{ padding: '12px', display: 'flex', justifyContent: 'center', alignItems: 'center', maxHeight: '72vh', overflow: 'hidden' }}>
          <img 
            src={imageUrl} 
            alt="Generated high-res"
            style={{ 
              maxWidth: '100%', 
              maxHeight: '70vh', 
              objectFit: 'contain',
              borderRadius: '8px'
            }} 
          />
        </div>

        {prompt && (
          <div style={{
            width: '100%',
            padding: '10px 16px',
            background: 'var(--bg-panel-sub)',
            borderTop: '1px solid var(--border-color)',
            fontSize: '11.5px',
            color: 'var(--text-muted)',
            maxHeight: '80px',
            overflowY: 'auto'
          }}>
            <b style={{ color: 'var(--text-main)', marginRight: '6px' }}>Prompt:</b>
            {prompt}
          </div>
        )}
      </div>
    </div>
  );
}
