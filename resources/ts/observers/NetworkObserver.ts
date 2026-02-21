import { MessageTypes } from '../types/messages';
import type { AgentConnector } from '../core/AgentConnector';

declare global {
  interface XMLHttpRequest {
    _agentId?: string;
    _agentMethod?: string;
    _agentUrl?: string;
    _agentStart?: number;
  }
}

export class NetworkObserver {
  private connector: AgentConnector;
  private enabled = false;
  private originalFetch: typeof fetch | null = null;
  private originalXhrOpen: typeof XMLHttpRequest.prototype.open | null = null;
  private originalXhrSend: typeof XMLHttpRequest.prototype.send | null = null;
  private resourceErrorHandler: ((event: ErrorEvent) => void) | null = null;

  constructor(connector: AgentConnector) {
    this.connector = connector;
  }

  start(): void {
    if (this.enabled) return;

    try {
      this.interceptFetch();
      this.interceptXhr();
      this.interceptResourceErrors();
      this.enabled = true;
      this.connector.log('Network observer started');
    } catch (e) {
      this.enabled = false;
      throw e;
    }
  }

  stop(): void {
    if (!this.enabled) return;
    this.enabled = false;

    if (this.originalFetch) {
      window.fetch = this.originalFetch;
      this.originalFetch = null;
    }

    if (this.originalXhrOpen) {
      XMLHttpRequest.prototype.open = this.originalXhrOpen;
      this.originalXhrOpen = null;
    }
    if (this.originalXhrSend) {
      XMLHttpRequest.prototype.send = this.originalXhrSend;
      this.originalXhrSend = null;
    }

    if (this.resourceErrorHandler) {
      window.removeEventListener('error', this.resourceErrorHandler as EventListener, true);
      this.resourceErrorHandler = null;
    }

    this.connector.log('Network observer stopped');
  }

  private interceptFetch(): void {
    this.originalFetch = window.fetch;
    const self = this;

    window.fetch = async function (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
      const id = self.generateId();
      const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
      const method = init.method || (input instanceof Request ? input.method : 'GET');

      if (self.shouldIgnore(url)) {
        return self.originalFetch!.apply(this, [input, init]);
      }

      const startTime = performance.now();
      const isLivewire = self.isLivewireRequest(url);

      self.connector.log(`[Fetch] Intercepted: ${method.toUpperCase()} ${url}`);

      self.connector.send(MessageTypes.NETWORK_REQUEST, {
        id,
        method: method.toUpperCase(),
        url,
        headers: self.serializeHeaders(init.headers),
        body: self.truncateBody(init.body),
        startTime: Date.now(),
        isLivewire,
      });

      try {
        const response = await self.originalFetch!.apply(this, [input, init]);
        const duration = performance.now() - startTime;

        const clone = response.clone();
        let responseBody: string | null = null;
        let responseSize = 0;
        try {
          responseBody = await clone.text();
          responseSize = responseBody.length;
        } catch {
          // Ignore
        }

        self.connector.send(MessageTypes.NETWORK_RESPONSE, {
          id,
          status: response.status,
          statusText: response.statusText,
          headers: self.serializeHeaders(response.headers),
          body: self.truncateBody(responseBody),
          bodySize: responseSize,
          duration: Math.round(duration),
          failed: response.status >= 400,
        });

        return response;
      } catch (error) {
        const err = error as Error;
        self.connector.send(MessageTypes.NETWORK_ERROR, {
          id,
          error: err.message,
          errorName: err.name,
          stack: err.stack?.substring(0, 500),
          method: method.toUpperCase(),
          url,
          duration: Math.round(performance.now() - startTime),
        });
        throw error;
      }
    };
  }

  private interceptXhr(): void {
    this.originalXhrOpen = XMLHttpRequest.prototype.open;
    this.originalXhrSend = XMLHttpRequest.prototype.send;
    const self = this;

    XMLHttpRequest.prototype.open = function (
      method: string,
      url: string | URL,
      async: boolean = true,
      username?: string | null,
      password?: string | null
    ): void {
      this._agentId = self.generateId();
      this._agentMethod = method;
      this._agentUrl = String(url);
      this._agentStart = undefined;
      return self.originalXhrOpen!.apply(this, [method, url, async, username, password]);
    };

    XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null): void {
      const xhr = this;
      const id = xhr._agentId!;
      const url = xhr._agentUrl!;

      if (self.shouldIgnore(url)) {
        return self.originalXhrSend!.apply(this, [body]);
      }

      xhr._agentStart = performance.now();
      const isLivewire = self.isLivewireRequest(url);

      self.connector.log(`[XHR] Intercepted: ${(xhr._agentMethod || 'GET').toUpperCase()} ${url}`);

      self.connector.send(MessageTypes.NETWORK_REQUEST, {
        id,
        method: (xhr._agentMethod || 'GET').toUpperCase(),
        url,
        body: self.truncateBody(body as string | null),
        startTime: Date.now(),
        isLivewire,
      });

      xhr.addEventListener('load', () => {
        const duration = performance.now() - (xhr._agentStart || 0);
        const responseBody = xhr.responseText;

        self.connector.send(MessageTypes.NETWORK_RESPONSE, {
          id,
          status: xhr.status,
          statusText: xhr.statusText,
          headers: self.parseXhrHeaders(xhr.getAllResponseHeaders()),
          body: self.truncateBody(responseBody),
          bodySize: responseBody ? responseBody.length : 0,
          duration: Math.round(duration),
          failed: xhr.status >= 400,
        });
      });

      xhr.addEventListener('error', () => {
        self.connector.send(MessageTypes.NETWORK_ERROR, {
          id,
          error: 'Network error',
          errorName: 'NetworkError',
          method: (xhr._agentMethod || 'GET').toUpperCase(),
          url: xhr._agentUrl,
          duration: Math.round(performance.now() - (xhr._agentStart || 0)),
        });
      });

      xhr.addEventListener('abort', () => {
        self.connector.send(MessageTypes.NETWORK_ERROR, {
          id,
          error: 'Request aborted',
          errorName: 'AbortError',
          method: (xhr._agentMethod || 'GET').toUpperCase(),
          url: xhr._agentUrl,
          duration: Math.round(performance.now() - (xhr._agentStart || 0)),
        });
      });

      xhr.addEventListener('timeout', () => {
        self.connector.send(MessageTypes.NETWORK_ERROR, {
          id,
          error: 'Request timeout',
          errorName: 'TimeoutError',
          method: (xhr._agentMethod || 'GET').toUpperCase(),
          url: xhr._agentUrl,
          duration: Math.round(performance.now() - (xhr._agentStart || 0)),
        });
      });

      return self.originalXhrSend!.apply(this, [body]);
    };
  }

  private interceptResourceErrors(): void {
    const self = this;

    this.resourceErrorHandler = function (event: ErrorEvent) {
        const target = event.target as HTMLElement | null;
        if (!target || target === (window as unknown as HTMLElement)) return;

        const tagName = target.tagName?.toLowerCase();
        if (!['script', 'link', 'img', 'video', 'audio', 'source', 'iframe'].includes(tagName)) {
          return;
        }

        const url = (target as HTMLImageElement).src || (target as HTMLLinkElement).href;
        if (!url || self.shouldIgnore(url)) return;

        const id = self.generateId();
        const resourceType = tagName === 'link' ? 'stylesheet' : tagName;

        self.connector.send(MessageTypes.NETWORK_REQUEST, {
          id,
          method: 'GET',
          url,
          headers: {},
          body: null,
          startTime: Date.now(),
          isLivewire: false,
          resourceType,
        });

        self.connector.send(MessageTypes.NETWORK_ERROR, {
          id,
          error: `Failed to load ${resourceType}`,
          errorName: 'ResourceLoadError',
          method: 'GET',
          url,
          resourceType,
          duration: 0,
        });

        self.connector.log(`[Resource] Failed to load ${resourceType}: ${url}`);
    };

    window.addEventListener('error', this.resourceErrorHandler as EventListener, true);
  }

  private shouldIgnore(url: string): boolean {
    if (!url) return true;
    const urlStr = String(url);
    return urlStr.includes('/_agent') || urlStr.includes('ws://') || urlStr.includes('wss://');
  }

  private isLivewireRequest(url: string): boolean {
    if (!url) return false;
    const urlStr = String(url);
    return urlStr.includes('/livewire/') || urlStr.includes('livewire/message') || urlStr.includes('livewire/update');
  }

  private generateId(): string {
    return 'net_' + Math.random().toString(36).substring(2, 11);
  }

  private serializeHeaders(headers: HeadersInit | Headers | undefined): Record<string, string> {
    if (!headers) return {};

    if (headers instanceof Headers) {
      const result: Record<string, string> = {};
      headers.forEach((value, key) => {
        result[key] = value;
      });
      return result;
    }

    if (typeof headers === 'object') {
      if (Array.isArray(headers)) {
        const result: Record<string, string> = {};
        for (const [key, value] of headers) {
          result[key] = value;
        }
        return result;
      }
      return { ...headers };
    }

    return {};
  }

  private parseXhrHeaders(headerStr: string): Record<string, string> {
    if (!headerStr) return {};

    const result: Record<string, string> = {};
    const lines = headerStr.trim().split(/[\r\n]+/);

    for (const line of lines) {
      const parts = line.split(': ');
      const key = parts.shift();
      const value = parts.join(': ');
      if (key) {
        result[key.toLowerCase()] = value;
      }
    }

    return result;
  }

  private truncateBody(body: BodyInit | string | null | undefined, maxSize = 50000): string | null {
    if (!body) return null;

    let str: string;
    if (typeof body === 'string') {
      str = body;
    } else if (body instanceof FormData) {
      return '[FormData]';
    } else if (body instanceof Blob) {
      return `[Blob: ${body.size} bytes]`;
    } else if (body instanceof ArrayBuffer) {
      return `[ArrayBuffer: ${body.byteLength} bytes]`;
    } else {
      try {
        str = JSON.stringify(body);
      } catch {
        str = String(body);
      }
    }

    if (str.length > maxSize) {
      return str.substring(0, maxSize) + `... [truncated, ${str.length} total]`;
    }

    return str;
  }
}
