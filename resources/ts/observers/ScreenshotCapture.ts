import { MessageTypes } from '../types/messages';
import type { AgentConnector } from '../core/AgentConnector';

export class ScreenshotCapture {
  private connector: AgentConnector;
  private observer: MutationObserver | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private debounceTimeout: ReturnType<typeof setTimeout> | null = null;
  private scrollHandler: (() => void) | null = null;
  private capturing = false;
  private running = false;

  // Adaptive throttling
  private lastCaptureDuration = 0;
  private consecutiveFailures = 0;
  private captureGeneration = 0;

  private readonly quality = 0.7;
  private readonly maxConsecutiveFailures = 5;

  // Timing — native capture is fast (~10-50ms)
  private readonly captureInterval = 1000;
  private readonly debounceDelay = 200;
  private readonly captureTimeout = 3000;

  private csrfToken = '';

  constructor(connector: AgentConnector) {
    this.connector = connector;
  }

  start(): void {
    // Preview is disabled until stable — remove this guard to re-enable
    this.connector.log('ScreenshotCapture: preview is disabled');
    return;

    if (this.running) return;

    // Read CSRF token from the page's meta tag (set by Laravel)
    this.csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';

    this.running = true;
    this.connector.log('ScreenshotCapture started (native)');

    // Timer — ensures periodic captures even without DOM changes
    this.intervalId = setInterval(() => this.capture(), this.captureInterval);

    // MutationObserver — captures on DOM changes (debounced)
    this.observer = new MutationObserver(() => this.scheduleCapture());

    this.observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'src', 'href', 'hidden', 'checked', 'selected', 'value', 'disabled'],
    });

    // Scroll listener — captures on scroll for ruler updates
    this.scrollHandler = () => this.scheduleCapture();
    window.addEventListener('scroll', this.scrollHandler, { passive: true });

    // Capture immediately
    this.capture();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    if (this.scrollHandler) {
      window.removeEventListener('scroll', this.scrollHandler);
      this.scrollHandler = null;
    }

    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
      this.debounceTimeout = null;
    }

    this.connector.log('ScreenshotCapture stopped');
  }

  private scheduleCapture(): void {
    if (this.debounceTimeout) clearTimeout(this.debounceTimeout);

    if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
      return; // Let the interval timer handle retries
    }

    const delay = Math.max(this.debounceDelay, this.lastCaptureDuration * 1.5);
    this.debounceTimeout = setTimeout(() => this.capture(), delay);
  }

  private async capture(): Promise<void> {
    if (!this.running || this.capturing) return;
    if (document.hidden) return;

    this.capturing = true;
    const generation = ++this.captureGeneration;
    const startTime = performance.now();

    try {
      // Call the NativePHP HTTP bridge to capture screenshot natively
      const response = await Promise.race([
        fetch('/_native/api/call', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-CSRF-TOKEN': this.csrfToken,
          },
          body: JSON.stringify({
            method: 'Screenshot.Capture',
            params: { quality: this.quality },
          }),
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Capture timeout')), this.captureTimeout)
        ),
      ]);

      if (!response.ok) {
        throw new Error(`Bridge HTTP ${response.status}`);
      }

      const json = await response.json();
      if (json.status === 'error') {
        throw new Error(json.message || 'Bridge error');
      }

      const result = json.data;
      if (result.error) {
        throw new Error(result.error);
      }

      // Discard if a newer capture generation was started
      if (generation !== this.captureGeneration) return;

      this.lastCaptureDuration = performance.now() - startTime;
      this.consecutiveFailures = 0;

      this.connector.send(MessageTypes.PREVIEW_FRAME, {
        data: result.data,
        width: Math.round(window.innerWidth),
        height: Math.round(window.innerHeight),
        pageWidth: document.documentElement.scrollWidth,
        pageHeight: document.documentElement.scrollHeight,
        scrollX: Math.round(window.scrollX),
        scrollY: Math.round(window.scrollY),
        viewportWidth: Math.round(window.innerWidth),
        viewportHeight: Math.round(window.innerHeight),
        timestamp: Date.now(),
        url: window.location.href,
      });
    } catch (e) {
      this.lastCaptureDuration = performance.now() - startTime;
      this.consecutiveFailures++;

      const errorMsg = e instanceof Error ? e.message
        : (typeof e === 'string' ? e : JSON.stringify(e));
      this.connector.log(`ScreenshotCapture error (${this.consecutiveFailures}): ${errorMsg}`);

      if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
        this.connector.log('ScreenshotCapture: backing off — will retry via interval timer');
      }
    } finally {
      this.capturing = false;
    }
  }
}
