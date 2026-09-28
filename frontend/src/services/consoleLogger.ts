export interface LogEntry {
  id: string;
  timestamp: string;
  project: string;
  type: 'request' | 'response' | 'error' | 'info';
  method: string;
  url: string;
  payload?: any;
  status?: number;
  durationMs?: number;
}

type Listener = () => void;
const STORAGE_KEY = 'studio_console_logs';
const MAX_LOGS_PER_PROJECT = 80;

class ConsoleLogger {
  private logs: Record<string, LogEntry[]> = {};
  private listeners: Set<Listener> = new Set();

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (data) {
        this.logs = JSON.parse(data);
      }
    } catch (_) {
      this.logs = {};
    }
  }

  private saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.logs));
    } catch (_) {}
  }

  log(entry: Omit<LogEntry, 'id' | 'timestamp'>) {
    const id = Math.random().toString(36).substring(2, 9);
    const timestamp = new Date().toLocaleTimeString();
    const proj = entry.project || 'general';

    const currentLogs = this.logs[proj] || [];
    const updated = [
      ...currentLogs,
      {
        ...entry,
        id,
        timestamp
      }
    ].slice(-MAX_LOGS_PER_PROJECT); // храним последние 80 записей

    this.logs[proj] = updated;
    this.saveToStorage();
    this.notify();
  }

  getLogs(project: string | null): LogEntry[] {
    const key = project || 'general';
    return [...(this.logs[key] || [])];
  }

  clearLogs(project: string | null) {
    const key = project || 'general';
    this.logs[key] = [];
    this.saveToStorage();
    this.notify();
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    this.listeners.forEach((cb) => cb());
  }
}

export const consoleLogger = new ConsoleLogger();
