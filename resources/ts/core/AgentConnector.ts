import { MessageTypes } from '../types/messages';
import { serializeForTransport } from '../utils/serialize';
import type { AgentConfig } from '../types/config';
import type { MessageType } from '../types/messages';
import { DomObserver } from '../observers/DomObserver';
import { NetworkObserver } from '../observers/NetworkObserver';
import { ScreenshotCapture } from '../observers/ScreenshotCapture';
import { ComponentTracker } from '../trackers/ComponentTracker';
import { LivewireTracker } from '../trackers/LivewireTracker';
import { AlpineTracker } from '../trackers/AlpineTracker';
import { FluxTracker } from '../trackers/FluxTracker';
import { BladeTracker } from '../trackers/BladeTracker';
import { PerformanceCollector } from '../collectors/PerformanceCollector';

type EventCallback = (data: unknown) => void;
type CommandHandler = (params: Record<string, unknown>) => unknown | Promise<unknown>;

export class AgentConnector {
  config: AgentConfig;
  private socket: WebSocket | null = null;
  private connectionId: string | null = null;
  private connected = false;
  retryDelay = 1000;
  private maxRetryDelay = 30000;
  private eventHandlers = new Map<string, EventCallback[]>();
  private commandHandlers = new Map<string, CommandHandler>();
  private highlightOverlay: HTMLElement | null = null;
  private originalConsole: Record<string, (...args: unknown[]) => void> = {};
  private consoleBuffer: Array<{ level: string; args: unknown[]; timestamp: number }> = [];
  private consoleFlushTimeout: ReturnType<typeof setTimeout> | null = null;
  private consoleFlushInterval = 100;
  private consoleBufferMaxSize = 50;

  domObserver: DomObserver | null = null;
  networkObserver: NetworkObserver | null = null;
  componentTracker: ComponentTracker | null = null;
  performanceCollector: PerformanceCollector | null = null;
  screenshotCapture: ScreenshotCapture | null = null;
  private _trackersInitialized = false;

  private messageQueue: Array<Record<string, unknown>> = [];
  private maxQueueSize = 100;

  private pickerActive = false;
  private pickerOverlay: HTMLElement | null = null;
  private pickerTarget: Element | null = null;
  private pickerMoveHandler: ((e: MouseEvent) => void) | null = null;
  private pickerClickHandler: ((e: MouseEvent) => void) | null = null;

  constructor(config: AgentConfig) {
    this.config = config;
    this.registerBuiltinCommands();
    this.interceptConsole();
  }

  initializeTrackers(): void {
    if (this._trackersInitialized) return;
    this._trackersInitialized = true;

    this.domObserver = new DomObserver(this);
    this.networkObserver = new NetworkObserver(this);
    this.componentTracker = new ComponentTracker(this);
    this.componentTracker.livewireTracker = new LivewireTracker(this.componentTracker);
    this.componentTracker.alpineTracker = new AlpineTracker(this.componentTracker);
    this.componentTracker.fluxTracker = new FluxTracker(this.componentTracker);
    this.componentTracker.bladeTracker = new BladeTracker(this.componentTracker);
    this.performanceCollector = new PerformanceCollector(this);

    this.log('Trackers initialized');
  }

  connect(): void {
    if (this.socket?.readyState === WebSocket.OPEN) return;

    try {
      this.socket = new WebSocket(this.config.ws_url);
      this.socket.onopen = () => this.handleOpen();
      this.socket.onclose = () => this.handleClose();
      this.socket.onerror = () => this.log('WebSocket error');
      this.socket.onmessage = (e) => this.handleMessage(JSON.parse(e.data));
    } catch {
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  private handleOpen(): void {
    this.connected = true;
    this.retryDelay = 1000;
    this.sendHandshake();
    this.log('Connected to Agent');
  }

  private handleClose(): void {
    this.connected = false;
    this.connectionId = null;
    this.log('Disconnected from Agent');
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    setTimeout(() => {
      this.retryDelay = Math.min(this.retryDelay * 2, this.maxRetryDelay);
      this.connect();
    }, this.retryDelay);
  }

  isConnected(): boolean {
    return this.connected;
  }

  sendRaw(message: Record<string, unknown>): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    } else {
      if (this.messageQueue.length < this.maxQueueSize) {
        this.messageQueue.push(message);
      }
    }
  }

  private flushMessageQueue(): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;

    const queued = this.messageQueue.splice(0);
    for (const message of queued) {
      try {
        this.socket!.send(JSON.stringify(message));
      } catch (e) {
        this.log('Failed to flush queued message: ' + (e as Error).message);
      }
    }
  }

  send(type: MessageType | string, payload: Record<string, unknown> = {}): void {
    this.sendRaw({
      type,
      project_id: this.config.project_id,
      app_id: this.config.app_id,
      payload,
    });
  }

  private sendHandshake(): void {
    this.sendRaw({
      type: MessageTypes.HANDSHAKE,
      project_id: this.config.project_id,
      app_id: this.config.app_id,
      origin: this.config.origin,
      url: window.location.href,
      path: window.location.pathname,
      app_info: this.config.app_info,
      paths: this.config.paths,
    });
  }

  private handleMessage(message: { type: string; connection_id?: string; command?: string; command_id?: string; params?: Record<string, unknown>; payload?: Record<string, unknown> }): void {
    const { type } = message;

    if (type === MessageTypes.HANDSHAKE_ACK) {
      this.connectionId = message.connection_id || null;
      this.log('Handshake complete: ' + this.connectionId);

      try {
        this.initializeTrackers();
      } catch (e) {
        this.log('Failed to initialize trackers: ' + (e as Error).message);
      }

      try {
        this.networkObserver?.start();
      } catch (e) {
        this.log('Failed to start network observer: ' + (e as Error).message);
      }

      try {
        this.componentTracker?.init();
      } catch (e) {
        this.log('Failed to init component tracker: ' + (e as Error).message);
      }

      this.flushMessageQueue();

      // Auto-broadcast storage disks on connection
      this.broadcastStorageDisks();
    }

    if (type === MessageTypes.COMMAND) {
      this.executeCommand(message);
    }

    this.dispatch(type, message);
    this.dispatch('*', message);
  }

  on(type: string, callback: EventCallback): this {
    if (!this.eventHandlers.has(type)) {
      this.eventHandlers.set(type, []);
    }
    this.eventHandlers.get(type)!.push(callback);
    return this;
  }

  off(type: string, callback: EventCallback): this {
    const handlers = this.eventHandlers.get(type);
    if (handlers) {
      const index = handlers.indexOf(callback);
      if (index > -1) handlers.splice(index, 1);
    }
    return this;
  }

  private dispatch(type: string, data: unknown): void {
    const handlers = this.eventHandlers.get(type) || [];
    handlers.forEach((cb) => cb(data));
  }

  sendNavigation(action: string): void {
    this.log(`sendNavigation called: ${action}`);

    const isSpaNavigation = [MessageTypes.NAV_PUSHSTATE, MessageTypes.NAV_POPSTATE].includes(action as typeof MessageTypes.NAV_PUSHSTATE);

    if (isSpaNavigation) {
      this.handleNavigation();
    }

    this.send(MessageTypes.NAVIGATION, {
      action,
      url: window.location.href,
      path: window.location.pathname,
      title: document.title || '(untitled)',
      timestamp: new Date().toISOString(),
    });
  }

  private handleNavigation(): void {
    if (!this._trackersInitialized) return;

    this.log('Handling SPA navigation - resetting trackers...');
    this.componentTracker?.reset();

    if (this.domObserver) {
      this.domObserver.stop();
      setTimeout(() => this.domObserver?.start(), 100);
    }

    setTimeout(() => this.componentTracker?.init(), 150);
  }

  sendVisibility(visible: boolean): void {
    this.send(MessageTypes.VISIBILITY, {
      visible,
      url: window.location.href,
      timestamp: new Date().toISOString(),
    });
  }

  registerCommand(name: string, handler: CommandHandler): this {
    this.commandHandlers.set(name, handler);
    return this;
  }

  private async executeCommand(message: { command?: string; command_id?: string; params?: Record<string, unknown>; payload?: Record<string, unknown> }): Promise<void> {
    const { command, command_id, params = {}, payload = {} } = message;
    const commandParams = params || payload;
    const cmd = command || '';

    this.log('Received command: ' + cmd);

    const handler = this.commandHandlers.get(cmd);
    if (handler) {
      try {
        const result = await handler(commandParams);
        this.sendCommandResponse(command_id || '', cmd, true, result);
      } catch (e) {
        this.sendCommandResponse(command_id || '', cmd, false, null, (e as Error).message);
      }
    } else {
      this.log('Forwarding to PHP backend: ' + cmd);
      await this.forwardCommandToPhp(command_id || '', cmd, commandParams);
    }
  }

  private async forwardCommandToPhp(commandId: string, command: string, params: Record<string, unknown>): Promise<void> {
    try {
      const response = await fetch('/_agent/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ command, command_id: commandId, params }),
      });

      const result = await response.json();
      this.sendCommandResponse(commandId, command, result.success, result.data);
    } catch (e) {
      this.sendCommandResponse(commandId, command, false, null, (e as Error).message);
    }
  }

  private sendCommandResponse(commandId: string, command: string, success: boolean, result: unknown = null, error: string | null = null): void {
    this.sendRaw({
      type: MessageTypes.COMMAND_RESPONSE,
      command_id: commandId,
      command,
      success,
      data: result || (error ? { error } : {}),
      project_id: this.config.project_id,
      app_id: this.config.app_id,
    });
  }

  private registerBuiltinCommands(): void {
    this.registerCommand('highlight', ({ selector, color = 'rgba(255, 0, 0, 0.3)', duration = 2000 }) => {
      const element = document.querySelector(selector as string);
      if (!element) throw new Error('Element not found: ' + selector);
      this.highlightElement(element, color as string, duration as number);
      return { selector, found: true };
    });

    this.registerCommand('clear_highlight', () => {
      this.clearHighlight();
      return { cleared: true };
    });

    this.registerCommand('get_page_info', () => ({
      url: window.location.href,
      path: window.location.pathname,
      title: document.title,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      scroll: { x: window.scrollX, y: window.scrollY },
    }));

    this.registerCommand('reload_page', () => {
      window.location.reload();
      return { reloaded: true };
    });

    this.registerCommand('dom_start', () => {
      if (!this.domObserver) this.initializeTrackers();
      this.sendHandshake();
      this.domObserver!.start();
      return { started: true };
    });

    this.registerCommand('dom_stop', () => {
      this.domObserver?.stop();
      return { stopped: true };
    });

    this.registerCommand('dom_select', ({ nodeId }) => {
      if (!nodeId) throw new Error('No nodeId provided');
      if (!this.domObserver) return { highlighted: false, nodeId, error: 'DOM observer not initialized' };
      const success = this.domObserver.highlightNode(nodeId as number);
      return { highlighted: success, nodeId };
    });

    this.registerCommand('get_dom_info', ({ selector }) => {
      const element = document.querySelector(selector as string);
      if (!element) return { found: false };

      const rect = element.getBoundingClientRect();
      return {
        found: true,
        tagName: element.tagName.toLowerCase(),
        id: element.id || null,
        classes: Array.from(element.classList),
        rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
        text: element.textContent?.substring(0, 100),
      };
    });

    this.registerCommand('scroll_to', ({ selector }) => {
      const element = document.querySelector(selector as string);
      if (!element) throw new Error('Element not found: ' + selector);

      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return { scrolled: true };
    });

    this.registerCommand('dom_picker_start', () => {
      this.startDomPicker();
      return { picker: true };
    });

    this.registerCommand('dom_picker_stop', () => {
      this.stopDomPicker();
      return { picker: false };
    });

    this.registerCommand('navigate_to', ({ url }) => {
      window.location.href = url as string;
      return { navigating: true, url };
    });

    this.registerCommand('history_back', () => {
      window.history.back();
      return { success: true };
    });

    this.registerCommand('history_forward', () => {
      window.history.forward();
      return { success: true };
    });

    this.registerCommand('get_livewire_components', () => {
      const components: Array<{ id: string | null; tagName: string; classes: string[] }> = [];
      document.querySelectorAll('[wire\\:id]').forEach((el) => {
        components.push({
          id: el.getAttribute('wire:id'),
          tagName: el.tagName.toLowerCase(),
          classes: Array.from(el.classList),
        });
      });
      return { components };
    });

    if ((window as unknown as { AgentConfig?: { ui?: { enableEval?: boolean } } }).AgentConfig?.ui?.enableEval) {
      this.registerCommand('eval', ({ code }) => {
        if (!code) throw new Error('No code provided');
        // eslint-disable-next-line no-eval
        return { result: eval(code as string) };
      });

      this.registerCommand('repl:eval', async ({ code }) => {
        if (!code) throw new Error('No code provided');

        const logs: Array<{ level: string; args: unknown[] }> = [];

        const originalConsole: Record<string, (...args: unknown[]) => void> = {};
        (['log', 'warn', 'error', 'info', 'debug'] as const).forEach((level) => {
          originalConsole[level] = console[level];
          console[level] = (...args: unknown[]) => {
            logs.push({ level, args: args.map((arg) => this.serializeArg(arg)) });
            originalConsole[level].apply(console, args);
          };
        });

        let result: unknown;
        let resultType: string | undefined;
        let error: string | undefined;

        try {
          // Try expression mode first (auto-return the result)
          let expressionError: Error | null = null;
          try {
            const expressionCode = `(async () => { return (${code}); })()`;
            // eslint-disable-next-line no-eval
            result = await eval(expressionCode);
          } catch (e) {
            expressionError = e as Error;
          }

          // If expression mode failed with SyntaxError, try statement mode
          if (expressionError) {
            if (expressionError instanceof SyntaxError) {
              const statementCode = `(async () => { ${code} })()`;
              // eslint-disable-next-line no-eval
              result = await eval(statementCode);
            } else {
              throw expressionError;
            }
          }

          resultType = this.getResultType(result);
          result = this.serializeResult(result);
        } catch (e) {
          error = (e as Error).message;
        } finally {
          // Restore console methods
          Object.keys(originalConsole).forEach((level) => {
            (console as unknown as Record<string, (...args: unknown[]) => void>)[level] = originalConsole[level];
          });
        }

        return { result, resultType, logs, error };
      });
    }

    this.registerCommand('network_start', () => {
      if (!this.networkObserver) {
        this.initializeTrackers();
      }
      this.networkObserver!.start();
      return { started: true };
    });

    this.registerCommand('network_stop', () => {
      this.networkObserver?.stop();
      return { stopped: true };
    });

    this.registerCommand('component_list', () => {
      if (!this.componentTracker) return { components: [] };
      const components: Array<{
        stableId: string;
        componentType: string;
        componentName: string;
        runtimeId: string | null;
        mounted: boolean;
        stateCount: number;
      }> = [];
      this.componentTracker.components.forEach((info, stableId) => {
        components.push({
          stableId,
          componentType: info.componentType,
          componentName: info.componentName,
          runtimeId: info.runtimeId || null,
          mounted: !!info.element,
          stateCount: info.stateHistory?.length || 0,
        });
      });
      return { components };
    });

    this.registerCommand('component_state', ({ stableId }) => {
      if (!this.componentTracker) return { found: false };
      const info = this.componentTracker.components.get(stableId as string);
      if (!info) return { found: false };

      return {
        found: true,
        stableId,
        componentType: info.componentType,
        componentName: info.componentName,
        state: info.state,
        stateHistory: info.stateHistory?.slice(-20) || [],
      };
    });

    this.registerCommand('component_highlight', ({ stableId, color = 'rgba(59, 130, 246, 0.3)', duration = 2000 }) => {
      if (!this.componentTracker) return { found: false };
      const info = this.componentTracker.components.get(stableId as string);
      if (!info?.element) return { found: false };

      this.highlightElement(info.element, color as string, duration as number);
      return { found: true, stableId };
    });

    this.registerCommand('component_scroll_to', ({ stableId }) => {
      if (!this.componentTracker) return { found: false };
      const info = this.componentTracker.components.get(stableId as string);
      if (!info?.element) return { found: false };

      info.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return { found: true, scrolled: true };
    });

    this.registerCommand('time_travel', ({ stableId, targetState, targetSequence }) => {
      if (!stableId || !targetState) {
        return { success: false, error: 'Missing stableId or targetState' };
      }
      if (!this.componentTracker) {
        return { success: false, error: 'Component tracker not initialized' };
      }

      const result = this.componentTracker.handleTimeTravel({
        stableId: stableId as string,
        targetState: targetState as Record<string, unknown>,
        targetSequence: targetSequence as number | undefined,
      });

      return result;
    });

    this.registerCommand('component_debug', () => {
      const results = {
        trackerStatus: {
          initialized: this.componentTracker?.initialized || false,
          livewireInitialized: this.componentTracker?.livewireTracker?.initialized || false,
          alpineInitialized: this.componentTracker?.alpineTracker?.initialized || false,
          fluxInitialized: this.componentTracker?.fluxTracker?.initialized || false,
          bladeInitialized: this.componentTracker?.bladeTracker?.initialized || false,
        },
        frameworksDetected: {
          livewire: typeof (window as unknown as { Livewire?: unknown }).Livewire !== 'undefined',
          livewireVersion: (window as unknown as { Livewire?: { version?: string } }).Livewire?.version || null,
          alpine: typeof (window as unknown as { Alpine?: unknown }).Alpine !== 'undefined',
          alpineVersion: (window as unknown as { Alpine?: { version?: string } }).Alpine?.version || null,
        },
        componentCount: this.componentTracker?.components.size || 0,
      };

      return results;
    });

    this.registerCommand('components_refresh', () => {
      if (!this.componentTracker) {
        this.initializeTrackers();
      }
      this.componentTracker!.reset();
      this.componentTracker!.init();
      return {
        success: true,
        componentCount: this.componentTracker!.components.size,
      };
    });

    this.registerCommand('storage:disks', async () => {
      await this.broadcastStorageDisks();
      return { triggered: true };
    });

    this.registerCommand('storage:list', async ({ disk, path }) => {
      const result = await this.broadcastStorageList(disk as string, (path as string) || '');
      return { triggered: true, success: result.success };
    });

    this.registerCommand('storage:read', async ({ disk, path, offset, maxBytes }) => {
      return this.executePhpCommand('storage:read', { disk, path, offset, maxBytes });
    });

    this.registerCommand('storage:meta', async ({ disk, path }) => {
      return this.executePhpCommand('storage:meta', { disk, path });
    });

    this.registerCommand('query:run', async ({ sql, connection }) => {
      return this.executePhpCommand('query:run', { sql, connection });
    });

    this.registerCommand('query:explain', async ({ sql, connection }) => {
      return this.executePhpCommand('query:explain', { sql, connection });
    });

    // Preview commands are disabled until stable — remove this guard to re-enable
    if (false) {
    this.registerCommand('preview_start', () => {
      if (!this.screenshotCapture) {
        this.screenshotCapture = new ScreenshotCapture(this);
      }
      this.screenshotCapture.start();
      return { started: true };
    });

    this.registerCommand('preview_stop', () => {
      this.screenshotCapture?.stop();
      return { stopped: true };
    });

    // Track the last tapped element for follow-up input commands
    this.registerCommand('preview_tap', ({ x, y }) => {
      const pageX = x as number;
      const pageY = y as number;

      // Scroll so the target point is visible in the viewport
      // Use plain numeric args for iOS Safari compat (behavior: 'instant' unsupported < 15.4)
      const vpW = window.innerWidth;
      const vpH = window.innerHeight;
      window.scrollTo(Math.max(0, pageX - vpW / 2), Math.max(0, pageY - vpH / 2));

      // Convert page coords to viewport coords
      const vpX = pageX - window.scrollX;
      const vpY = pageY - window.scrollY;

      const element = document.elementFromPoint(vpX, vpY);
      if (!element) {
        return { found: false, x: pageX, y: pageY };
      }

      // Determine element type before dispatching events
      const tag = element.tagName.toLowerCase();
      const inputEl = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      const isInput = tag === 'input' || tag === 'textarea' || tag === 'select';
      const inputType = isInput && 'type' in inputEl ? (inputEl.type || 'text') : null;

      // Elements with native pickers — just focus, don't dispatch click which opens picker
      const pickerTypes = ['date', 'time', 'datetime-local', 'month', 'week', 'color'];
      const hasNativePicker = tag === 'select' ||
        (tag === 'input' && pickerTypes.includes(inputType as string));

      const eventOpts: MouseEventInit = {
        bubbles: true,
        cancelable: true,
        clientX: vpX,
        clientY: vpY,
        view: window,
      };

      if (hasNativePicker) {
        (element as HTMLElement).focus();
      } else {
        // Dispatch touch events for iOS compatibility (many iOS apps only listen for touch)
        const hasTouchEvents = typeof TouchEvent !== 'undefined' && typeof Touch !== 'undefined';
        if (hasTouchEvents) {
          try {
            const touch = new Touch({ identifier: 0, target: element, clientX: vpX, clientY: vpY, pageX, pageY });
            element.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [touch], targetTouches: [touch], changedTouches: [touch] }));
            element.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], targetTouches: [], changedTouches: [touch] }));
          } catch { /* Touch constructor not supported */ }
        }

        // Dispatch pointer events (guard for iOS < 13)
        if (typeof PointerEvent !== 'undefined') {
          element.dispatchEvent(new PointerEvent('pointerdown', { ...eventOpts, pointerId: 1 }));
          element.dispatchEvent(new PointerEvent('pointerup', { ...eventOpts, pointerId: 1 }));
        }

        // Mouse events + click (universally supported)
        element.dispatchEvent(new MouseEvent('mousedown', eventOpts));
        element.dispatchEvent(new MouseEvent('mouseup', eventOpts));
        element.dispatchEvent(new MouseEvent('click', eventOpts));
      }

      // Build response with element info
      const result: Record<string, unknown> = {
        found: true,
        tagName: tag,
        id: element.id || null,
        classes: Array.from(element.classList),
        text: element.textContent?.substring(0, 100) || null,
        isInput,
        inputType,
      };

      // For inputs, include current value and any options (for <select>)
      if (isInput) {
        result.value = 'value' in inputEl ? inputEl.value : null;
        result.placeholder = 'placeholder' in inputEl ? inputEl.placeholder : null;

        if (tag === 'select') {
          const selectEl = inputEl as HTMLSelectElement;
          result.options = Array.from(selectEl.options).map((opt) => ({
            value: opt.value,
            label: opt.text,
            selected: opt.selected,
          }));
          result.multiple = selectEl.multiple;
        }

        if (tag === 'input' && (inputType === 'checkbox' || inputType === 'radio')) {
          result.checked = (inputEl as HTMLInputElement).checked;
        }

        if (tag === 'input' && (inputType === 'range' || inputType === 'number')) {
          const inp = inputEl as HTMLInputElement;
          result.min = inp.min || null;
          result.max = inp.max || null;
          result.step = inp.step || null;
        }
      }

      // Store a CSS selector so preview_input can find this element again
      result.selector = this.buildUniqueSelector(element);

      return result;
    });

    this.registerCommand('preview_input', ({ selector, value }) => {
      const element = document.querySelector(selector as string);
      if (!element) {
        return { success: false, error: 'Element not found: ' + selector };
      }

      const tag = element.tagName.toLowerCase();
      const inputEl = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

      if (tag === 'select') {
        inputEl.value = value as string;
        inputEl.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (tag === 'input' || tag === 'textarea') {
        inputEl.focus();

        // Use native setter to bypass framework value traps
        const nativeSetter = Object.getOwnPropertyDescriptor(
          tag === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
          'value',
        )?.set;

        if (nativeSetter) {
          nativeSetter.call(inputEl, value as string);
        } else {
          inputEl.value = value as string;
        }

        // Dispatch events that frameworks listen for
        // InputEvent with options may throw on iOS < 14, fall back to plain Event
        try {
          inputEl.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value as string }));
        } catch {
          inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        }
        inputEl.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        return { success: false, error: 'Element is not an input: ' + tag };
      }

      return {
        success: true,
        selector,
        value: inputEl.value,
      };
    });

    this.registerCommand('preview_scroll', ({ deltaX, deltaY }) => {
      window.scrollBy({
        left: deltaX as number,
        top: deltaY as number,
      });
      return {
        scrollX: Math.round(window.scrollX),
        scrollY: Math.round(window.scrollY),
      };
    });

    this.registerCommand('preview_file_upload', ({ selector, base64, filename, mimeType }) => {
      const element = document.querySelector(selector as string) as HTMLInputElement;
      if (!element || element.type !== 'file') {
        return { success: false, error: 'File input not found' };
      }

      // Decode base64 to File
      const bstr = atob(base64 as string);
      const u8arr = new Uint8Array(bstr.length);
      for (let i = 0; i < bstr.length; i++) {
        u8arr[i] = bstr.charCodeAt(i);
      }
      const file = new File([u8arr], filename as string, { type: mimeType as string, lastModified: Date.now() });

      // Set via DataTransfer API
      const dt = new DataTransfer();
      dt.items.add(file);
      element.files = dt.files;

      // Dispatch events for framework detection (Livewire, Alpine)
      element.dispatchEvent(new Event('change', { bubbles: true }));
      element.dispatchEvent(new Event('input', { bubbles: true }));

      return { success: true, filename };
    });

    // Chunked file upload — for larger files sent in multiple messages
    const uploadBuffers = new Map<string, { chunks: string[]; filename: string; mimeType: string; selector: string }>();

    this.registerCommand('preview_file_start', ({ selector, filename, mimeType }) => {
      const element = document.querySelector(selector as string) as HTMLInputElement;
      if (!element || element.type !== 'file') {
        return { success: false, error: 'File input not found' };
      }
      const uploadId = Math.random().toString(36).substring(2, 10);
      uploadBuffers.set(uploadId, {
        chunks: [],
        filename: filename as string,
        mimeType: mimeType as string,
        selector: selector as string,
      });
      return { success: true, uploadId };
    });

    this.registerCommand('preview_file_chunk', ({ uploadId, data, index }) => {
      const buffer = uploadBuffers.get(uploadId as string);
      if (!buffer) return { success: false, error: 'Unknown upload' };
      buffer.chunks[index as number] = data as string;
      return { success: true, received: (index as number) + 1 };
    });

    this.registerCommand('preview_file_complete', ({ uploadId }) => {
      const buffer = uploadBuffers.get(uploadId as string);
      if (!buffer) return { success: false, error: 'Unknown upload' };
      uploadBuffers.delete(uploadId as string);

      const fullBase64 = buffer.chunks.join('');
      const bstr = atob(fullBase64);
      const u8arr = new Uint8Array(bstr.length);
      for (let i = 0; i < bstr.length; i++) u8arr[i] = bstr.charCodeAt(i);

      const file = new File([u8arr], buffer.filename, { type: buffer.mimeType, lastModified: Date.now() });
      const element = document.querySelector(buffer.selector) as HTMLInputElement;
      if (!element) return { success: false, error: 'Element gone' };

      const dt = new DataTransfer();
      dt.items.add(file);
      element.files = dt.files;
      element.dispatchEvent(new Event('change', { bubbles: true }));
      element.dispatchEvent(new Event('input', { bubbles: true }));

      return { success: true, filename: buffer.filename };
    });
    } // end preview disabled guard

    this.registerCommand('dom:properties', ({ nodeId }) => {
      if (!this.domObserver) return { success: false, error: 'DOM observer not initialized' };
      const element = this.domObserver.getNodeById(nodeId as number);
      if (!element) return { success: false, error: 'Node not found in tree' };
      if (element.nodeType !== Node.ELEMENT_NODE) {
        return { success: false, error: 'Node is not an element' };
      }

      const computed = window.getComputedStyle(element as Element);

      const layoutProps = {
        display: computed.display,
        position: computed.position,
        top: computed.top,
        right: computed.right,
        bottom: computed.bottom,
        left: computed.left,
        width: computed.width,
        height: computed.height,
        minWidth: computed.minWidth,
        minHeight: computed.minHeight,
        maxWidth: computed.maxWidth,
        maxHeight: computed.maxHeight,
        margin: computed.margin,
        marginTop: computed.marginTop,
        marginRight: computed.marginRight,
        marginBottom: computed.marginBottom,
        marginLeft: computed.marginLeft,
        padding: computed.padding,
        paddingTop: computed.paddingTop,
        paddingRight: computed.paddingRight,
        paddingBottom: computed.paddingBottom,
        paddingLeft: computed.paddingLeft,
        boxSizing: computed.boxSizing,
        overflow: computed.overflow,
        overflowX: computed.overflowX,
        overflowY: computed.overflowY,
      };

      const flexProps = {
        flexDirection: computed.flexDirection,
        flexWrap: computed.flexWrap,
        justifyContent: computed.justifyContent,
        alignItems: computed.alignItems,
        alignContent: computed.alignContent,
        gap: computed.gap,
        flex: computed.flex,
        flexGrow: computed.flexGrow,
        flexShrink: computed.flexShrink,
        flexBasis: computed.flexBasis,
        alignSelf: computed.alignSelf,
      };

      const gridProps = {
        gridTemplateColumns: computed.gridTemplateColumns,
        gridTemplateRows: computed.gridTemplateRows,
        gridTemplateAreas: computed.gridTemplateAreas,
        gridAutoColumns: computed.gridAutoColumns,
        gridAutoRows: computed.gridAutoRows,
        gridAutoFlow: computed.gridAutoFlow,
        gridColumn: computed.gridColumn,
        gridRow: computed.gridRow,
      };

      const typographyProps = {
        fontFamily: computed.fontFamily,
        fontSize: computed.fontSize,
        fontWeight: computed.fontWeight,
        fontStyle: computed.fontStyle,
        lineHeight: computed.lineHeight,
        letterSpacing: computed.letterSpacing,
        textAlign: computed.textAlign,
        textDecoration: computed.textDecoration,
        textTransform: computed.textTransform,
        whiteSpace: computed.whiteSpace,
        wordBreak: computed.wordBreak,
      };

      const colorProps = {
        color: computed.color,
        backgroundColor: computed.backgroundColor,
        backgroundImage: computed.backgroundImage,
        backgroundSize: computed.backgroundSize,
        backgroundPosition: computed.backgroundPosition,
        backgroundRepeat: computed.backgroundRepeat,
        opacity: computed.opacity,
      };

      const borderProps = {
        border: computed.border,
        borderTop: computed.borderTop,
        borderRight: computed.borderRight,
        borderBottom: computed.borderBottom,
        borderLeft: computed.borderLeft,
        borderRadius: computed.borderRadius,
        borderColor: computed.borderColor,
        borderWidth: computed.borderWidth,
        borderStyle: computed.borderStyle,
      };

      const transformProps = {
        transform: computed.transform,
        transformOrigin: computed.transformOrigin,
        transition: computed.transition,
        animation: computed.animation,
      };

      const attributes: Record<string, string> = {};
      Array.from((element as Element).attributes).forEach((attr) => {
        attributes[attr.name] = attr.value;
      });

      const rect = (element as Element).getBoundingClientRect();

      return {
        success: true,
        nodeId,
        tag: (element as Element).tagName.toLowerCase(),
        classes: Array.from((element as Element).classList),
        attributes,
        computedStyles: {
          layout: layoutProps,
          flexbox: flexProps,
          grid: gridProps,
          typography: typographyProps,
          colors: colorProps,
          borders: borderProps,
          transforms: transformProps,
        },
        boundingRect: {
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          x: rect.x,
          y: rect.y,
        },
      };
    });
  }

  private buildUniqueSelector(element: Element): string {
    // Use ID if available
    if (element.id) return `#${element.id}`;

    // Build a path from the element to the root
    const parts: string[] = [];
    let current: Element | null = element;

    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();

      if (current.id) {
        parts.unshift(`#${current.id}`);
        break;
      }

      // Add nth-child for disambiguation
      const parent: Element | null = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((s: Element) => s.tagName === current!.tagName);
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += `:nth-of-type(${index})`;
        }
      }

      parts.unshift(selector);
      current = parent;
    }

    return parts.join(' > ');
  }

  highlightElement(element: Element, color: string, duration: number): void {
    this.clearHighlight();

    const rect = element.getBoundingClientRect();
    this.highlightOverlay = document.createElement('div');
    this.highlightOverlay.setAttribute('data-agent-ignore', 'true');
    Object.assign(this.highlightOverlay.style, {
      position: 'fixed',
      top: rect.top + 'px',
      left: rect.left + 'px',
      width: rect.width + 'px',
      height: rect.height + 'px',
      backgroundColor: color,
      border: '2px solid rgba(59, 130, 246, 0.8)',
      pointerEvents: 'none',
      zIndex: '2147483646',
      transition: 'opacity 0.3s ease',
    });
    document.body.appendChild(this.highlightOverlay);

    setTimeout(() => this.clearHighlight(), duration);
  }

  clearHighlight(): void {
    if (this.highlightOverlay) {
      this.highlightOverlay.remove();
      this.highlightOverlay = null;
    }
  }

  private interceptConsole(): void {
    const levels = ['log', 'info', 'warn', 'error', 'debug'] as const;

    for (const level of levels) {
      this.originalConsole[level] = console[level].bind(console);
      console[level] = (...args: unknown[]) => {
        this.originalConsole[level](...args);
        this.bufferConsoleMessage(level, args);
      };
    }
  }

  private bufferConsoleMessage(level: string, args: unknown[]): void {
    this.consoleBuffer.push({
      level,
      args: args.map((arg) => this.serializeArg(arg)),
      timestamp: Date.now(),
    });

    if (this.consoleBuffer.length >= this.consoleBufferMaxSize) {
      this.flushConsoleBuffer();
    } else if (!this.consoleFlushTimeout) {
      this.consoleFlushTimeout = setTimeout(() => this.flushConsoleBuffer(), this.consoleFlushInterval);
    }
  }

  private flushConsoleBuffer(): void {
    if (this.consoleFlushTimeout) {
      clearTimeout(this.consoleFlushTimeout);
      this.consoleFlushTimeout = null;
    }

    if (this.consoleBuffer.length === 0) return;

    const messages = this.consoleBuffer.splice(0);
    this.send(MessageTypes.CONSOLE_BATCH, { messages });
  }

  private serializeArg(arg: unknown): unknown {
    return serializeForTransport(arg, 10000);
  }

  log(message: string): void {
    if (this.originalConsole.log) {
      this.originalConsole.log('[Agent] ' + message);
    }
  }

  private async executePhpCommand(command: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    try {
      const response = await fetch('/_agent/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          command,
          command_id: 'js_' + Math.random().toString(36).substring(2, 10),
          params,
        }),
      });
      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}` };
      }
      const result = await response.json();
      return result.data || result;
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  }

  private async broadcastStorageDisks(): Promise<void> {
    try {
      this.log('Fetching storage disks...');
      const result = await this.executePhpCommand('storage:disks', {});
      if (result.success && result.disks) {
        this.log('Broadcasting storage disks: ' + (result.disks as unknown[]).length);
        this.sendRaw({
          type: 'storage_disks_info',
          disks: result.disks,
          project_id: this.config.project_id,
          app_id: this.config.app_id,
          timestamp: new Date().toISOString(),
        });
      } else {
        this.log('No storage disks available: ' + (result.error || 'empty'));
      }
    } catch (e) {
      this.log('Failed to fetch storage disks: ' + (e as Error).message);
    }
  }

  private async broadcastStorageList(disk: string, path: string = ''): Promise<Record<string, unknown>> {
    try {
      const result = await this.executePhpCommand('storage:list', { disk, path });
      if (result.success) {
        this.sendRaw({
          type: 'storage_list_result',
          disk,
          path,
          items: result.items,
          project_id: this.config.project_id,
          app_id: this.config.app_id,
          timestamp: new Date().toISOString(),
        });
      }
      return result;
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  }

  serializeResult(value: unknown, depth = 0): unknown {
    if (depth > 3) return '[Max depth]';
    if (value === undefined) return 'undefined';
    if (value === null) return 'null';
    if (value instanceof Error) return `Error: ${value.message}`;
    if (value instanceof HTMLElement) {
      const id = value.id ? `#${value.id}` : '';
      const classes = value.className ? `.${value.className.split(' ').join('.')}` : '';
      return `<${value.tagName.toLowerCase()}${id}${classes}>`;
    }
    if (value instanceof NodeList || value instanceof HTMLCollection) {
      return `NodeList(${value.length})`;
    }
    if (typeof value === 'function') {
      return `ƒ ${(value as { name?: string }).name || 'anonymous'}()`;
    }
    if (value instanceof Promise) {
      return 'Promise { <pending> }';
    }
    if (Array.isArray(value) || typeof value === 'object') {
      try {
        const seen = new WeakSet();
        return JSON.stringify(value, (_key, val) => {
          if (typeof val === 'object' && val !== null) {
            if (seen.has(val)) return '[Circular]';
            seen.add(val);
          }
          if (val instanceof HTMLElement) {
            return `<${val.tagName.toLowerCase()}>`;
          }
          if (typeof val === 'function') {
            return `ƒ ${val.name || 'anonymous'}()`;
          }
          return val;
        });
      } catch {
        return String(value);
      }
    }
    if (typeof value === 'string') {
      return `"${value}"`;
    }
    return String(value);
  }

  getResultType(value: unknown): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (Array.isArray(value)) return 'array';
    if (value instanceof HTMLElement) return 'element';
    if (value instanceof NodeList || value instanceof HTMLCollection) return 'nodelist';
    if (value instanceof Error) return 'error';
    if (value instanceof Promise) return 'promise';
    if (typeof value === 'function') return 'function';
    return typeof value;
  }

  startDomPicker(): void {
    if (this.pickerActive) return;
    this.pickerActive = true;
    this.pickerOverlay = null;

    this.pickerMoveHandler = (e: MouseEvent) => {
      const target = document.elementFromPoint(e.clientX, e.clientY);
      if (!target || target === this.pickerOverlay) return;

      this.clearPickerHighlight();
      const rect = target.getBoundingClientRect();
      this.pickerOverlay = document.createElement('div');
      this.pickerOverlay.setAttribute('data-agent-ignore', 'true');
      this.pickerOverlay.style.cssText = `
        position: fixed;
        top: ${rect.top}px;
        left: ${rect.left}px;
        width: ${rect.width}px;
        height: ${rect.height}px;
        background: rgba(59, 130, 246, 0.2);
        border: 2px solid rgba(59, 130, 246, 0.8);
        pointer-events: none;
        z-index: 999999;
      `;
      document.body.appendChild(this.pickerOverlay);
      this.pickerTarget = target;
    };

    this.pickerClickHandler = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (this.pickerTarget && this.domObserver) {
        const x = e.clientX;
        const y = e.clientY;
        this.domObserver.selectNode(x, y);
      }

      this.stopDomPicker();
    };

    document.addEventListener('mousemove', this.pickerMoveHandler, true);
    document.addEventListener('click', this.pickerClickHandler, true);
    this.log('DOM picker started');
  }

  stopDomPicker(): void {
    if (!this.pickerActive) return;
    this.pickerActive = false;

    if (this.pickerMoveHandler) {
      document.removeEventListener('mousemove', this.pickerMoveHandler, true);
    }
    if (this.pickerClickHandler) {
      document.removeEventListener('click', this.pickerClickHandler, true);
    }

    this.clearPickerHighlight();
    this.pickerTarget = null;
    this.log('DOM picker stopped');
  }

  clearPickerHighlight(): void {
    if (this.pickerOverlay) {
      this.pickerOverlay.remove();
      this.pickerOverlay = null;
    }
  }
}
