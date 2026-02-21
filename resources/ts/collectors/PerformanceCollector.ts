import { MessageTypes } from '../types/messages';
import type { AgentConnector } from '../core/AgentConnector';

interface Capabilities {
  isIOS: boolean;
  isAndroid: boolean;
  isMobile: boolean;
  isWebView: boolean;
  hasPerformanceObserver: boolean;
  supportsLongTask: boolean;
  supportsLayoutShift: boolean;
  supportsLCP: boolean;
  supportsMemory: boolean;
  supportsPaintTiming: boolean;
  platform: 'ios' | 'android' | 'desktop';
}

interface LongTask {
  duration: number;
  startTime: number;
  name: string;
  timestamp: number;
}

interface MemoryInfo {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

interface Metrics {
  fps: number;
  longTasks: LongTask[];
  cls: number;
  lcp: number;
  fcp: number;
  memory: MemoryInfo | null;
}

declare global {
  interface Performance {
    memory?: {
      usedJSHeapSize: number;
      totalJSHeapSize: number;
      jsHeapSizeLimit: number;
    };
  }
}

export class PerformanceCollector {
  private connector: AgentConnector;
  private running = false;
  private streamInterval: ReturnType<typeof setInterval> | null = null;
  private capabilities: Capabilities;
  private metrics: Metrics;
  private frameCount = 0;
  private lastFrameTime = 0;
  private fpsRafId: number | null = null;
  private longTaskObserver: PerformanceObserver | null = null;
  private recentLongTasks: LongTask[] = [];
  private clsObserver: PerformanceObserver | null = null;
  private lcpObserver: PerformanceObserver | null = null;
  private clsValue = 0;
  private lcpValue = 0;

  constructor(connector: AgentConnector) {
    this.connector = connector;
    this.capabilities = this.detectCapabilities();
    this.metrics = {
      fps: 0,
      longTasks: [],
      cls: 0,
      lcp: 0,
      fcp: 0,
      memory: null,
    };
  }

  private detectCapabilities(): Capabilities {
    const ua = navigator.userAgent || '';
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isAndroid = /Android/.test(ua);
    const isWebView =
      /(wv|WebView)/i.test(ua) ||
      (isIOS && !/Safari/.test(ua)) ||
      !!(window as unknown as { ReactNativeWebView?: unknown }).ReactNativeWebView;

    const hasPerformanceObserver = typeof PerformanceObserver !== 'undefined';

    let supportsLongTask = false;
    let supportsLayoutShift = false;
    let supportsLCP = false;

    if (hasPerformanceObserver) {
      try {
        const supported = PerformanceObserver.supportedEntryTypes || [];
        supportsLongTask = supported.includes('longtask');
        supportsLayoutShift = supported.includes('layout-shift');
        supportsLCP = supported.includes('largest-contentful-paint');
      } catch { }
    }

    return {
      isIOS,
      isAndroid,
      isMobile: isIOS || isAndroid,
      isWebView,
      hasPerformanceObserver,
      supportsLongTask,
      supportsLayoutShift,
      supportsLCP,
      supportsMemory: !!performance.memory,
      supportsPaintTiming: typeof performance.getEntriesByType === 'function',
      platform: isIOS ? 'ios' : isAndroid ? 'android' : 'desktop',
    };
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    const { platform, isWebView, isMobile } = this.capabilities;
    const envLabel = isWebView ? `${platform} webview` : isMobile ? `${platform} browser` : 'desktop';
    this.connector.log(`PerformanceCollector started (${envLabel})`);

    this.startFPSMonitor();
    this.startPerformanceObservers();
    this.collectPaintTimings();

    this.streamInterval = setInterval(() => this.streamMetrics(), 1000);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;

    this.connector.log('PerformanceCollector stopped');

    if (this.fpsRafId) {
      cancelAnimationFrame(this.fpsRafId);
      this.fpsRafId = null;
    }

    if (this.longTaskObserver) {
      this.longTaskObserver.disconnect();
      this.longTaskObserver = null;
    }
    if (this.clsObserver) {
      this.clsObserver.disconnect();
      this.clsObserver = null;
    }
    if (this.lcpObserver) {
      this.lcpObserver.disconnect();
      this.lcpObserver = null;
    }

    if (this.streamInterval) {
      clearInterval(this.streamInterval);
      this.streamInterval = null;
    }
  }

  private startFPSMonitor(): void {
    this.lastFrameTime = performance.now();
    this.frameCount = 0;

    const tick = (now: number): void => {
      if (!this.running) return;

      this.frameCount++;

      const elapsed = now - this.lastFrameTime;
      if (elapsed >= 1000) {
        this.metrics.fps = Math.round((this.frameCount * 1000) / elapsed);
        this.frameCount = 0;
        this.lastFrameTime = now;
      }

      this.fpsRafId = requestAnimationFrame(tick);
    };

    this.fpsRafId = requestAnimationFrame(tick);
  }

  private startPerformanceObservers(): void {
    if (!this.capabilities.hasPerformanceObserver) {
      return;
    }

    if (this.capabilities.supportsLongTask) {
      try {
        this.longTaskObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            const task: LongTask = {
              duration: Math.round(entry.duration),
              startTime: Math.round(entry.startTime),
              name: entry.name,
              timestamp: Date.now(),
            };
            this.recentLongTasks.push(task);
            if (this.recentLongTasks.length > 20) {
              this.recentLongTasks.shift();
            }
          }
        });
        this.longTaskObserver.observe({ entryTypes: ['longtask'] });
      } catch { }
    }

    if (this.capabilities.supportsLayoutShift) {
      try {
        this.clsObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            const layoutShift = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
            if (!layoutShift.hadRecentInput) {
              this.clsValue += layoutShift.value || 0;
            }
          }
          this.metrics.cls = Math.round(this.clsValue * 1000) / 1000;
        });
        this.clsObserver.observe({ entryTypes: ['layout-shift'], buffered: true });
      } catch { }
    }

    if (this.capabilities.supportsLCP) {
      try {
        this.lcpObserver = new PerformanceObserver((list) => {
          const entries = list.getEntries();
          if (entries.length > 0) {
            const lastEntry = entries[entries.length - 1];
            this.lcpValue = lastEntry.startTime;
            this.metrics.lcp = Math.round(this.lcpValue);
          }
        });
        this.lcpObserver.observe({ entryTypes: ['largest-contentful-paint'], buffered: true });
      } catch { }
    }
  }

  private collectPaintTimings(): void {
    try {
      const paintEntries = performance.getEntriesByType('paint');
      for (const entry of paintEntries) {
        if (entry.name === 'first-contentful-paint') {
          this.metrics.fcp = Math.round(entry.startTime);
        }
      }
    } catch { }
  }

  private getMemoryUsage(): MemoryInfo | null {
    if (performance.memory) {
      return {
        usedJSHeapSize: performance.memory.usedJSHeapSize,
        totalJSHeapSize: performance.memory.totalJSHeapSize,
        jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
      };
    }
    return null;
  }

  private streamMetrics(): void {
    if (!this.connector.isConnected()) return;

    this.metrics.memory = this.getMemoryUsage();

    const now = Date.now();
    this.metrics.longTasks = this.recentLongTasks.filter((task) => now - task.timestamp < 2000);

    const payload = {
      fps: this.metrics.fps,
      longTasks: this.metrics.longTasks,
      cls: this.metrics.cls,
      lcp: this.metrics.lcp,
      fcp: this.metrics.fcp,
      memory: this.metrics.memory,
      timestamp: now,
      capabilities: {
        platform: this.capabilities.platform,
        isMobile: this.capabilities.isMobile,
        isWebView: this.capabilities.isWebView,
        supportsLongTask: this.capabilities.supportsLongTask,
        supportsLayoutShift: this.capabilities.supportsLayoutShift,
        supportsLCP: this.capabilities.supportsLCP,
        supportsMemory: this.capabilities.supportsMemory,
      },
    };

    this.connector.send(MessageTypes.PERFORMANCE_METRICS, payload);
  }
}
