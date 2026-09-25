import React, { useState, useEffect } from 'react';
import { X, Trash2, Plus, Edit2, Check, BrainCircuit, ToggleLeft, ToggleRight } from 'lucide-react';

export interface SystemPromptItem {
  id: string;
  prompt: string;
  is_active: boolean;
  created_at?: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function MemoryModal({ isOpen, onClose }: Props) {
  const [prompts, setPrompts] = useState<SystemPromptItem[]>([]);
  const [newPromptText, setNewPromptText] = useState('');
  const [loading, setLoading] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const loadPrompts = () => {
    fetch('http://localhost:8000/api/prompts/')
      .then(res => res.json())
      .then(data => setPrompts(data || []))
      .catch(console.error);
  };

  useEffect(() => {
    if (isOpen) loadPrompts();
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPromptText.trim()) return;
    setLoading(true);
    fetch('http://localhost:8000/api/prompts/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: newPromptText.trim() })
    })
      .then(() => {
        setNewPromptText('');
        loadPrompts();
      })
      .finally(() => setLoading(false));
  };

  const startEdit = (p: SystemPromptItem) => {
    setEditingId(p.id);
    setEditText(p.prompt);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditText('');
  };

  const handleSaveEdit = (id: string) => {
    if (!editText.trim()) return;
    fetch(`http://localhost:8000/api/prompts/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: editText.trim() })
    }).then(() => {
      setEditingId(null);
      setEditText('');
      loadPrompts();
    });
  };

  const handleToggleActive = (id: string) => {
    fetch(`http://localhost:8000/api/prompts/${id}/toggle`, { method: 'POST' })
      .then(loadPrompts);
  };

  const handleDelete = (id: string) => {
    fetch(`http://localhost:8000/api/prompts/${id}`, { method: 'DELETE' })
      .then(loadPrompts);
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0, 0, 0, 0.65)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1000,
      backdropFilter: 'blur(3px)'
    }}>
      <div style={{
        width: '680px',
        maxHeight: '85vh',
        background: 'var(--bg-panel)',
        border: '1px solid var(--border-color)',
        borderRadius: '10px',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 20px 40px rgba(0, 0, 0, 0.4)',
        overflow: 'hidden'
      }}>
        {/* Header */}
        <div style={{
          padding: '12px 18px',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'var(--bg-header)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <BrainCircuit size={17} color="var(--btn-primary)" />
            <span style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--text-main)' }}>
              Global Memory & System Rules
            </span>
          </div>
          <button 
            onClick={onClose} 
            className="theme-toggle-btn"
            style={{ padding: '4px', border: 'none', background: 'transparent' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Content Body */}
        <div style={{ padding: '16px 18px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Add form */}
          <form onSubmit={handleCreate} style={{
            background: 'var(--bg-editor)',
            border: '1px solid var(--border-color)',
            padding: '12px',
            borderRadius: '8px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
          }}>
            <textarea 
              value={newPromptText}
              onChange={e => setNewPromptText(e.target.value)}
              placeholder="Enter system prompt / global rule text..."
              rows={4}
              className="studio-input"
              style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: '12px' }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button 
                type="submit" 
                disabled={loading || !newPromptText.trim()}
                className="btn-primary" 
                style={{ padding: '6px 14px' }}
              >
                <Plus size={13} />
                <span>Add Rule</span>
              </button>
            </div>
          </form>

          {/* Stored rules list */}
          <div>
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: '8px' }}>
              Rules List ({prompts.filter(p => p.is_active).length} Active / {prompts.length} Total)
            </span>

            {prompts.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)', fontSize: '12px' }}>
                No rules stored. Add a rule above to apply it across all models.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {prompts.map(p => {
                  const isEditing = editingId === p.id;
                  const isActive = p.is_active !== false;

                  return (
                    <div 
                      key={p.id} 
                      className={isActive ? "rule-card-active" : "rule-card-deactivated"}
                      style={{
                        padding: '10px 12px',
                        borderRadius: '8px',
                        background: isActive ? 'var(--bg-editor)' : 'var(--bg-panel-sub)',
                        border: isActive ? '1px solid var(--border-color)' : '1px dashed var(--border-divider)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                        transition: 'all 0.2s ease'
                      }}
                    >
                      {isEditing ? (
                        /* Editing view */
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <textarea 
                            value={editText}
                            onChange={e => setEditText(e.target.value)}
                            rows={4}
                            className="studio-input"
                            style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: '12px' }}
                          />
                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
                            <button 
                              type="button" 
                              onClick={cancelEdit}
                              className="theme-toggle-btn"
                              style={{ padding: '4px 10px', fontSize: '11px' }}
                            >
                              Cancel
                            </button>
                            <button 
                              type="button" 
                              onClick={() => handleSaveEdit(p.id)}
                              className="btn-primary"
                              style={{ padding: '4px 12px', fontSize: '11px' }}
                            >
                              <Check size={12} />
                              Save
                            </button>
                          </div>
                        </div>
                      ) : (
                        /* Normal view */
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                            {/* Toggle Active Switch */}
                            <button
                              onClick={() => handleToggleActive(p.id)}
                              className="theme-toggle-btn"
                              style={{ 
                                padding: '2px 8px', 
                                fontSize: '11px',
                                gap: '5px',
                                background: isActive ? 'rgba(16, 185, 129, 0.1)' : 'var(--input-bg)',
                                color: isActive ? '#10b981' : 'var(--text-muted)',
                                borderColor: isActive ? 'rgba(16, 185, 129, 0.3)' : 'var(--input-border)'
                              }}
                              title={isActive ? "Click to deactivate rule" : "Click to activate rule"}
                            >
                              {isActive ? <ToggleRight size={15} color="#10b981" /> : <ToggleLeft size={15} />}
                              <span>{isActive ? "Active" : "Disabled"}</span>
                            </button>

                            {/* Edit & Delete Controls */}
                            <div style={{ display: 'flex', gap: '4px' }}>
                              <button 
                                onClick={() => startEdit(p)}
                                className="theme-toggle-btn"
                                style={{ padding: '3px 6px' }}
                                title="Edit rule"
                              >
                                <Edit2 size={12} color="var(--text-muted)" />
                              </button>
                              <button 
                                onClick={() => handleDelete(p.id)}
                                className="theme-toggle-btn"
                                style={{ padding: '3px 6px' }}
                                title="Delete rule"
                              >
                                <Trash2 size={12} color="#ef4444" />
                              </button>
                            </div>
                          </div>

                          <p style={{
                            margin: 0,
                            fontSize: '11.5px',
                            color: isActive ? 'var(--text-main)' : 'var(--text-muted)',
                            fontFamily: 'monospace',
                            whiteSpace: 'pre-wrap',
                            lineHeight: 1.5
                          }}>
                            {p.prompt}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
