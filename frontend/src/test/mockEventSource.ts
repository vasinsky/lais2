class MockEventSource {
  url: string;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onopen: ((ev: Event) => void) | null = null;
  readyState: number = 0;

  constructor(url: string) {
    this.url = url;
  }

  close() {}
}

if (typeof window !== 'undefined' && !window.EventSource) {
  (window as any).EventSource = MockEventSource;
  (global as any).EventSource = MockEventSource;
}
