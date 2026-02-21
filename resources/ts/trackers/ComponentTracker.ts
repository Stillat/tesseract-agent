import { MessageTypes } from '../types/messages';
import { safeSerialize as sharedSafeSerialize } from '../utils/serialize';
import type { AgentConnector } from '../core/AgentConnector';
import type { LivewireTracker } from './LivewireTracker';
import type { AlpineTracker } from './AlpineTracker';
import type { FluxTracker } from './FluxTracker';
import type { BladeTracker } from './BladeTracker';

export interface ComponentInfo {
  stableId: string;
  element: Element | null;
  componentType: string;
  componentName: string;
  runtimeId: string | null;
  sourceFile: string | null;
  sourceLine: number | null;
  state: Record<string, unknown> | null;
  stateHistory: StateHistoryEntry[];
  mountedAt: number;
  unmountedAt?: number;
}

export interface StateHistoryEntry {
  sequence: number;
  trigger: string;
  triggerDetail?: string | null;
  state: unknown;
  diff?: StateDiff;
  timestamp: number;
}

export interface StateDiff {
  added: Record<string, unknown>;
  removed: Record<string, unknown>;
  changed: Record<string, { from: unknown; to: unknown }>;
}

export interface MarkerInfo {
  stableId: string;
  meta: Record<string, string>;
  element: Element;
  startComment: Comment;
}

export interface MountOptions {
  componentType?: string;
  componentName?: string;
  runtimeId?: string | null;
  sourceFile?: string | null;
  sourceLine?: number | null;
  state?: Record<string, unknown> | null;
  parentStableId?: string | null;
  snapshotSequence?: number | null;
}

export interface StateChangeOptions {
  trigger?: string;
  triggerDetail?: string | null;
  snapshotSequence?: number | null;
}

export interface TimeTravelResult {
  success: boolean;
  stableId: string;
  targetSequence?: number;
  error?: string;
}

declare global {
  interface Element {
    __agentStableId?: string;
  }
}

export class ComponentTracker {
  readonly connector: AgentConnector;
  components = new Map<string, ComponentInfo>();
  private markerCache = new Map<string, MarkerInfo>();
  private debounceTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  private debounceDelay = 10;
  private maxStateHistorySize = 50;
  mutationsPaused = false;

  livewireTracker: LivewireTracker | null = null;
  alpineTracker: AlpineTracker | null = null;
  fluxTracker: FluxTracker | null = null;
  bladeTracker: BladeTracker | null = null;

  initialized = false;

  constructor(connector: AgentConnector) {
    this.connector = connector;

    connector.on(MessageTypes.TIME_TRAVEL_REQUEST, (message) => {
      this.handleTimeTravel(message as { payload?: { stableId: string; targetState: unknown; targetSequence: number } });
    });
  }

  init(): void {
    if (this.initialized) return;
    this.initialized = true;

    this.log('Initializing component tracking...');

    try {
      this.discoverFromComments();
    } catch (e) {
      this.log('Failed to discover from comments: ' + (e as Error).message);
    }

    if (this.livewireTracker) {
      try {
        this.livewireTracker.init();
      } catch (e) {
        this.log('Failed to init Livewire tracker: ' + (e as Error).message);
      }
    }
    if (this.alpineTracker) {
      try {
        this.alpineTracker.init();
      } catch (e) {
        this.log('Failed to init Alpine tracker: ' + (e as Error).message);
      }
    }
    if (this.fluxTracker) {
      try {
        this.fluxTracker.init();
      } catch (e) {
        this.log('Failed to init Flux tracker: ' + (e as Error).message);
      }
    }

    this.log(`Component tracking initialized. Found ${this.components.size} components via comment markers.`);
  }

  reset(): void {
    this.log('Resetting component tracking...');

    for (const timeout of this.debounceTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.debounceTimeouts.clear();
    this.components.clear();
    this.markerCache.clear();

    this.livewireTracker?.reset?.();
    this.alpineTracker?.reset?.();
    this.fluxTracker?.reset?.();
    this.bladeTracker?.reset?.();

    this.initialized = false;
    this.log('Component tracking reset complete');
  }

  log(message: string): void {
    this.connector?.log?.('[ComponentTracker] ' + message);
  }

  private discoverFromComments(): void {
    const markers = this.findAgentMarkers();

    for (const marker of markers) {
      const { stableId, meta, element } = marker;

      if (stableId && element && !this.components.has(stableId)) {
        this.markerCache.set(stableId, marker);

        this.registerComponent(stableId, element, {
          componentType: meta.type,
          componentName: meta.name,
          sourceFile: meta.file,
          sourceLine: meta.line ? parseInt(meta.line, 10) : null,
        });
      }
    }
  }

  findAgentMarkers(): MarkerInfo[] {
    const results: MarkerInfo[] = [];
    const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_COMMENT, null);

    let node: Comment | null;
    while ((node = walker.nextNode() as Comment | null)) {
      const text = node.textContent?.trim() || '';
      const match = text.match(/^\s*\[agent:start\s+(.+?)\]\s*$/);
      if (!match) continue;

      const meta = this.parseCommentAttrs(match[1]);
      if (!meta.id) continue;

      const element = this.findAssociatedElement(node);
      if (element) {
        results.push({
          stableId: meta.id,
          meta,
          element,
          startComment: node,
        });
      }
    }

    return results;
  }

  private findAssociatedElement(startComment: Comment): Element | null {
    let sibling: Node | null = startComment.nextSibling;
    while (sibling) {
      if (sibling.nodeType === Node.ELEMENT_NODE) {
        return sibling as Element;
      }
      if (sibling.nodeType === Node.TEXT_NODE && sibling.textContent?.trim() === '') {
        sibling = sibling.nextSibling;
        continue;
      }
      break;
    }

    const parent = startComment.parentElement;
    if (parent && this.isFirstContentChild(startComment, parent)) {
      return parent;
    }

    return null;
  }

  private isFirstContentChild(comment: Comment, parent: Element): boolean {
    for (const child of parent.childNodes) {
      if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim() === '') {
        continue;
      }
      return child === comment;
    }
    return false;
  }

  private parseCommentAttrs(content: string): Record<string, string> {
    const result: Record<string, string> = {};
    const regex = /(\w+)="([^"]*?)"/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content))) {
      result[match[1]] = match[2];
    }
    return result;
  }

  findStableIdFromComments(element: Element | null): string | null {
    if (!element) return null;

    if (element.__agentStableId) {
      return element.__agentStableId;
    }

    let sibling: Node | null = element.previousSibling;
    while (sibling) {
      if (sibling.nodeType === Node.COMMENT_NODE) {
        const match = sibling.textContent?.match(/\[agent:start\s+.*?id="([^"]+)"/);
        if (match) {
          element.__agentStableId = match[1];
          return match[1];
        }
      }
      if (sibling.nodeType === Node.TEXT_NODE && sibling.textContent?.trim() === '') {
        sibling = sibling.previousSibling;
        continue;
      }
      break;
    }

    for (const child of element.childNodes) {
      if (child.nodeType === Node.COMMENT_NODE) {
        const match = child.textContent?.match(/\[agent:start\s+.*?id="([^"]+)"/);
        if (match) {
          element.__agentStableId = match[1];
          return match[1];
        }
      }
      if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim() === '') {
        continue;
      }
      break;
    }

    return null;
  }

  registerComponent(stableId: string, element: Element, options: MountOptions = {}): ComponentInfo {
    const info: ComponentInfo = {
      stableId,
      element,
      componentType: options.componentType || this.getTypeFromStableId(stableId),
      componentName: options.componentName || this.getNameFromStableId(stableId),
      runtimeId: options.runtimeId || null,
      sourceFile: options.sourceFile || null,
      sourceLine: options.sourceLine || null,
      state: options.state || null,
      stateHistory: [],
      mountedAt: Date.now(),
    };

    this.components.set(stableId, info);

    this.connector.send(MessageTypes.COMPONENT_DISCOVERED, {
      stableId,
      componentType: info.componentType,
      componentName: info.componentName,
      runtimeId: info.runtimeId,
      elementPath: this.getElementPath(element),
      sourceFile: info.sourceFile,
      sourceLine: info.sourceLine,
      depth: this.getElementDepth(element),
    });

    return info;
  }

  handleMount(stableId: string, element: Element, options: MountOptions = {}): void {
    let info = this.components.get(stableId);

    if (!info) {
      info = this.registerComponent(stableId, element, options);
    } else {
      info.element = element;
      info.runtimeId = options.runtimeId || info.runtimeId;
    }

    if (options.state !== undefined) {
      info.state = options.state;
      info.stateHistory.push({
        sequence: info.stateHistory.length,
        trigger: 'mount',
        state: this.safeSerialize(options.state),
        timestamp: Date.now(),
      });
    }

    this.connector.send(MessageTypes.COMPONENT_MOUNTED, {
      stableId,
      componentType: info.componentType,
      componentName: info.componentName,
      runtimeId: info.runtimeId,
      elementPath: this.getElementPath(element),
      sourceFile: options.sourceFile || info.sourceFile,
      sourceLine: options.sourceLine || info.sourceLine,
      parentStableId: options.parentStableId || this.findParentStableId(element),
      state: options.state !== undefined ? this.safeSerialize(options.state) : null,
      depth: this.getElementDepth(element),
      snapshotSequence: options.snapshotSequence ?? null,
    });
  }

  handleUnmount(stableId: string): void {
    const info = this.components.get(stableId);
    if (!info) return;

    this.connector.send(MessageTypes.COMPONENT_UNMOUNTED, {
      stableId,
    });

    info.unmountedAt = Date.now();
    info.element = null;
  }

  handleStateChange(stableId: string, newState: Record<string, unknown>, options: StateChangeOptions = {}): void {
    if (this.mutationsPaused) return;

    const info = this.components.get(stableId);
    if (!info) return;

    const timeoutKey = stableId;
    if (this.debounceTimeouts.has(timeoutKey)) {
      clearTimeout(this.debounceTimeouts.get(timeoutKey)!);
    }

    this.debounceTimeouts.set(
      timeoutKey,
      setTimeout(() => {
        this.debounceTimeouts.delete(timeoutKey);
        this.sendStateChange(stableId, newState, options);
      }, this.debounceDelay)
    );
  }

  private sendStateChange(stableId: string, newState: Record<string, unknown>, options: StateChangeOptions = {}): void {
    const info = this.components.get(stableId);
    if (!info) return;

    const serializedState = this.safeSerialize(newState);
    const diff = this.calculateDiff(info.state, newState);

    info.state = newState;
    info.stateHistory.push({
      sequence: info.stateHistory.length,
      trigger: options.trigger || 'unknown',
      triggerDetail: options.triggerDetail || null,
      state: serializedState,
      diff,
      timestamp: Date.now(),
    });

    if (info.stateHistory.length > this.maxStateHistorySize) {
      info.stateHistory.splice(0, info.stateHistory.length - this.maxStateHistorySize);
    }

    this.connector.send(MessageTypes.STATE_CHANGED, {
      stableId,
      trigger: options.trigger || 'unknown',
      triggerDetail: options.triggerDetail || null,
      state: serializedState,
      diff,
      snapshotSequence: options.snapshotSequence ?? null,
    });
  }

  handleTimeTravel(message: { stableId?: string; targetState?: unknown; targetSequence?: number; payload?: { stableId: string; targetState: unknown; targetSequence: number } }): TimeTravelResult {
    const { stableId, targetState, targetSequence } = message.payload || (message as { stableId: string; targetState: unknown; targetSequence: number });

    const info = this.components.get(stableId);
    if (!info || !info.element) {
      return {
        success: false,
        stableId,
        targetSequence,
        error: 'Component not found or unmounted',
      };
    }

    this.pauseMutations();

    try {
      let success = false;

      if (info.componentType === 'livewire' && this.livewireTracker) {
        success = this.livewireTracker.restoreState(stableId, targetState as Record<string, unknown>, targetSequence);
      } else if (info.componentType === 'alpine' && this.alpineTracker) {
        success = this.alpineTracker.restoreState(stableId, targetState as Record<string, unknown>);
      } else if (info.componentType === 'flux' && this.fluxTracker) {
        success = this.fluxTracker.restoreState(stableId, targetState as Record<string, unknown>);
      }

      return {
        success,
        stableId,
        targetSequence,
      };
    } catch (e) {
      return {
        success: false,
        stableId,
        targetSequence,
        error: (e as Error).message,
      };
    } finally {
      setTimeout(() => this.resumeMutations(), 50);
    }
  }

  pauseMutations(): void {
    this.mutationsPaused = true;
  }

  resumeMutations(): void {
    this.mutationsPaused = false;
  }

  getTypeFromStableId(stableId: string): string {
    const parts = stableId.split(':');
    return parts[0] || 'unknown';
  }

  getNameFromStableId(stableId: string): string {
    const parts = stableId.split(':');
    return parts[1] || 'unknown';
  }

  getStableId(element: Element): string | null {
    return this.findStableIdFromComments(element);
  }

  findStableIdForTracker(el: Element | null, prefix: string): string | null {
    if (!el) return null;

    const stableId = this.findStableIdFromComments(el);
    if (stableId) return stableId;

    let parent: Element | null = el.parentElement;
    while (parent && parent !== document.body) {
      const parentStableId = this.findStableIdFromComments(parent);
      if (parentStableId && parentStableId.startsWith(prefix)) {
        return parentStableId;
      }
      parent = parent.parentElement;
    }

    return null;
  }

  findParentStableId(element: Element): string | null {
    if (!element?.parentElement) return null;

    let parent: Element | null = element.parentElement;
    while (parent && parent !== document.documentElement) {
      const stableId = this.findStableIdFromComments(parent);
      if (stableId) return stableId;
      parent = parent.parentElement;
    }
    return null;
  }

  getElementPath(element: Element | null): string | null {
    if (!element) return null;

    const path: string[] = [];
    let current: Element | null = element;

    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();

      if (current.id) {
        selector += `#${current.id}`;
        path.unshift(selector);
        break;
      }

      if (current.className && typeof current.className === 'string') {
        const classes = current.className.trim().split(/\s+/).slice(0, 2);
        if (classes.length) {
          selector += `.${classes.join('.')}`;
        }
      }

      const parent: Element | null = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((c: Element) => c.tagName === current!.tagName);
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += `:nth-of-type(${index})`;
        }
      }

      path.unshift(selector);
      current = parent;
    }

    return path.join(' > ');
  }

  getElementDepth(element: Element): number {
    let depth = 0;
    let current: Element | null = element;
    while (current && current !== document.body) {
      depth++;
      current = current.parentElement;
    }
    return depth;
  }

  calculateDiff(oldState: Record<string, unknown> | null, newState: Record<string, unknown>): StateDiff {
    if (!oldState) return { added: newState, removed: {}, changed: {} };

    const diff: StateDiff = { added: {}, removed: {}, changed: {} };
    const oldKeys = new Set(Object.keys(oldState || {}));
    const newKeys = new Set(Object.keys(newState || {}));

    for (const key of newKeys) {
      if (!oldKeys.has(key)) {
        diff.added[key] = newState[key];
      } else if (JSON.stringify(oldState[key]) !== JSON.stringify(newState[key])) {
        diff.changed[key] = { from: oldState[key], to: newState[key] };
      }
    }

    for (const key of oldKeys) {
      if (!newKeys.has(key)) {
        diff.removed[key] = oldState[key];
      }
    }

    return diff;
  }

  safeSerialize(value: unknown, seen = new WeakSet<object>(), depth = 0): unknown {
    return sharedSafeSerialize(value, {}, seen, depth);
  }

  getComponentName(element: Element): string {
    if (!element) return 'unknown';

    const nameAttrs = ['x-title', 'x-id', 'id', 'name', 'wire:id', 'aria-label', 'role'];

    for (const attr of nameAttrs) {
      const value = element.getAttribute(attr);
      if (value) return value;
    }

    const xData = element.getAttribute('x-data');
    if (xData) {
      const match = xData.match(/^(\w+)\s*\(/);
      if (match) return match[1];
    }

    return element.tagName.toLowerCase();
  }
}
