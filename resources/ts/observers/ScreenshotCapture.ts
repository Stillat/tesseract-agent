import { toJpeg } from 'html-to-image';
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

  private readonly captureInterval = 1000;
  private readonly debounceDelay = 200;
  private readonly quality = 0.85;
  private readonly pixelRatio = 1;

  constructor(connector: AgentConnector) {
    this.connector = connector;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.connector.log('ScreenshotCapture started');

    // Timer fallback — ensures at least ~1 FPS
    this.intervalId = setInterval(() => this.capture(), this.captureInterval);

    // MutationObserver — captures on DOM changes (debounced)
    this.observer = new MutationObserver(() => {
      if (this.debounceTimeout) clearTimeout(this.debounceTimeout);
      this.debounceTimeout = setTimeout(() => this.capture(), this.debounceDelay);
    });

    this.observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });

    // Scroll listener — captures on scroll for ruler updates
    this.scrollHandler = () => {
      if (this.debounceTimeout) clearTimeout(this.debounceTimeout);
      this.debounceTimeout = setTimeout(() => this.capture(), this.debounceDelay);
    };
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

  private syncFormState(): void {
    document.querySelectorAll<HTMLInputElement>('input[type="checkbox"], input[type="radio"]').forEach(el => {
      if (el.checked) {
        el.setAttribute('checked', '');
      } else {
        el.removeAttribute('checked');
      }
    });
  }

  private async capture(): Promise<void> {
    if (!this.running || this.capturing) return;

    // Skip if page is hidden
    if (document.hidden) return;

    this.capturing = true;

    try {
      // Sync form state to attributes so html-to-image clone captures it
      this.syncFormState();

      const data = await toJpeg(document.body, {
        quality: this.quality,
        pixelRatio: this.pixelRatio,
        skipAutoScale: true,
        skipFonts: true,
        filter: (el: Element) => {
          return el.getAttribute?.('data-agent-ignore') !== 'true';
        },
      });

      const width = Math.round(document.body.scrollWidth * this.pixelRatio);
      const height = Math.round(document.body.scrollHeight * this.pixelRatio);

      this.connector.send(MessageTypes.PREVIEW_FRAME, {
        data,
        width,
        height,
        scrollX: Math.round(window.scrollX),
        scrollY: Math.round(window.scrollY),
        viewportWidth: Math.round(window.innerWidth),
        viewportHeight: Math.round(window.innerHeight),
        timestamp: Date.now(),
        url: window.location.href,
      });
    } catch (e) {
      this.connector.log('ScreenshotCapture error: ' + (e as Error).message);
    } finally {
      this.capturing = false;
    }
  }
}
