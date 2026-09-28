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

class ConsoleLogger {
  private logs: Record<string, LogEntry[]> = {};
  private listeners: Set<Listener> = new Set();

  log(entry: Omit<LogEntry, 'id' | 'timestamp'>) {
    const id = Math.random().toString(36).substring(2, 9);
    const timestamp = new Date().toLocaleTimeString();
    const proj = entry.project || 'general';

    if (!this.logs[proj]) {
      this.logs[proj] = [];
    }

    this.logs[proj].push({
      ...entry,
      id,
      timestamp
    });

    this.notify();
  }

  getLogs(project: string | null): LogEntry[] {
    const key = project || 'general';
    return this.logs[key] || [];
  }

  clearLogs(project: string | null) {
    const key = project || 'general';
    this.logs[key] = [];
    this.notify();
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    this.listeners.forEach(cb => cb());
  }
}

export const consoleLogger = new ConsoleLogger();
