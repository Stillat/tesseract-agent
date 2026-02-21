import { MessageTypes } from '../types/messages';
import { serializeForTransport } from '../utils/serialize';
import type { ComponentTracker } from './ComponentTracker';
import type { AgentConnector } from '../core/AgentConnector';

interface AlpineElement extends HTMLElement {
  _x_marker?: number;
  _x_dataStack?: Array<Record<string, unknown>>;
  __x?: { getUnobservedData?: () => Record<string, unknown> };
}

declare global {
  interface Window {
    Alpine?: {
      version?: string;
      start?: () => void;
      interceptInit?: (callback: (el: HTMLElement) => void) => void;
      onElRemoved?: (callback: (el: HTMLElement) => void) => void;
      effect?: (callback: () => void) => void;
      skipDuringClone?: <T extends (...args: never[]) => void>(callback: T) => T;
      $data?: (el: HTMLElement) => Record<string, unknown>;
    };
  }
}

export class AlpineTracker {
  private componentTracker: ComponentTracker;
  private connector: AgentConnector;
  private markerToStableId = new Map<number, string>();
  private previousValues = new Map<string, Record<string, unknown>>();
  private traceCounter = 0;
  initialized = false;

  constructor(componentTracker: ComponentTracker) {
    this.componentTracker = componentTracker;
    this.connector = componentTracker.connector;
  }

  init(): void {
    if (this.initialized) return;

    if (typeof window.Alpine === 'undefined') {
      this.log('Alpine not found, setting up detection for async loading');
      this.setupAlpineDetection();
      return;
    }

    this.initializeWithAlpine();
  }

  private setupAlpineDetection(): void {
    let attempts = 0;
    const maxAttempts = 20;

    const checkInterval = setInterval(() => {
      attempts++;

      if (typeof window.Alpine !== 'undefined') {
        clearInterval(checkInterval);
        this.initializeWithAlpine();
        return;
      }

      if (attempts >= maxAttempts) {
        clearInterval(checkInterval);
      }
    }, 500);

    document.addEventListener('alpine:init', () => {
      if (!this.initialized && typeof window.Alpine !== 'undefined') {
        this.initializeWithAlpine();
      }
    }, { once: true });

    document.addEventListener('alpine:initialized', () => {
      if (!this.initialized && typeof window.Alpine !== 'undefined') {
        this.initializeWithAlpine();
      }
    }, { once: true });
  }

  private initializeWithAlpine(): void {
    if (this.initialized) return;

    this.initialized = true;
    this.log('Initializing Alpine tracker');

    const Alpine = window.Alpine!;
    if (Alpine.version || document.querySelectorAll('[x-data]').length > 0) {
      this.discoverExistingComponents();
    }

    this.registerHooks();
  }

  reset(): void {
    this.markerToStableId.clear();
    this.previousValues.clear();
    this.initialized = false;
  }

  private generateTraceId(): string {
    return `alpine_call_${Date.now()}_${++this.traceCounter}`;
  }

  private discoverExistingComponents(): void {
    document.querySelectorAll('[x-data]').forEach((el) => {
      const alpineEl = el as AlpineElement;
      const stableId = this.findStableId(alpineEl);
      if (!stableId) return;

      const data = this.getAlpineData(alpineEl);
      if (!data) return;

      const marker = alpineEl._x_marker;
      if (marker !== undefined) {
        this.markerToStableId.set(marker, stableId);
      }

      this.componentTracker.handleMount(stableId, alpineEl, {
        componentType: 'alpine',
        componentName: this.componentTracker.getComponentName(alpineEl),
        runtimeId: marker?.toString() || null,
        state: this.componentTracker.safeSerialize(data) as Record<string, unknown>,
      });

      this.wrapMethods(alpineEl, stableId, data);
      this.trackStateChanges(alpineEl, stableId, data);
    });
  }

  private registerHooks(): void {
    const Alpine = window.Alpine!;

    if (Alpine.interceptInit && Alpine.skipDuringClone) {
      Alpine.interceptInit(Alpine.skipDuringClone((el: HTMLElement) => {
        if (!el.hasAttribute('x-data')) return;

        const alpineEl = el as AlpineElement;
        const stableId = this.findStableId(alpineEl);
        if (!stableId) return;

        queueMicrotask(() => {
          const data = this.getAlpineData(alpineEl);
          if (!data) return;

          const marker = alpineEl._x_marker;
          if (marker !== undefined) {
            this.markerToStableId.set(marker, stableId);
          }

          this.componentTracker.handleMount(stableId, alpineEl, {
            componentType: 'alpine',
            componentName: this.componentTracker.getComponentName(alpineEl),
            runtimeId: marker?.toString() || null,
            state: this.componentTracker.safeSerialize(data) as Record<string, unknown>,
          });

          this.wrapMethods(alpineEl, stableId, data);
          this.trackStateChanges(alpineEl, stableId, data);
        });
      }));
    }

    if (Alpine.onElRemoved) {
      Alpine.onElRemoved((el: HTMLElement) => {
        if (!el.hasAttribute('x-data')) return;

        const alpineEl = el as AlpineElement;
        const stableId = this.findStableId(alpineEl);
        if (stableId) {
          this.componentTracker.handleUnmount(stableId);
          this.previousValues.delete(stableId);
        }

        const marker = alpineEl._x_marker;
        if (marker !== undefined) {
          this.markerToStableId.delete(marker);
        }
      });
    }

    this.log('Alpine hooks registered');
  }

  private trackStateChanges(el: AlpineElement, stableId: string, data: Record<string, unknown>): void {
    if (!data) return;

    const marker = el._x_marker;
    const runtimeId = marker?.toString() || null;

    if (!this.previousValues.has(stableId)) {
      this.previousValues.set(stableId, this.cloneProperties(data));
    }

    const Alpine = window.Alpine!;
    if (Alpine.effect) {
      Alpine.effect(() => {
        if (this.componentTracker.mutationsPaused) return;

        this.visitProperties(data, 10);

        const currentState = this.componentTracker.safeSerialize(data) as Record<string, unknown>;
        const previousState = this.previousValues.get(stableId) || {};

        this.detectPropertyChanges(stableId, runtimeId, previousState, data, '');

        this.previousValues.set(stableId, this.cloneProperties(data));

        this.componentTracker.handleStateChange(stableId, currentState, {
          trigger: 'reactive',
        });
      });
    }
  }

  private wrapMethods(el: AlpineElement, stableId: string, data: Record<string, unknown>): void {
    if (!data) return;

    const marker = el._x_marker;
    const runtimeId = marker?.toString() || null;
    const tracker = this;

    Object.keys(data).forEach((key) => {
      if (key.startsWith('$') || key.startsWith('_x') || key.startsWith('__')) {
        return;
      }

      if (typeof data[key] === 'function') {
        const original = data[key] as (...args: unknown[]) => unknown;

        data[key] = function (this: unknown, ...args: unknown[]): unknown {
          const traceId = tracker.generateTraceId();
          const startTime = performance.now();

          tracker.sendMethodCall({
            action: 'start',
            framework: 'alpine',
            stable_id: stableId,
            runtime_id: runtimeId,
            method: key,
            params: tracker.serializeValue(args),
            trace_id: traceId,
            trigger_source: 'alpine_call',
          });

          try {
            const result = original.apply(this, args);

            if (result instanceof Promise) {
              return result.then((value) => {
                const duration = performance.now() - startTime;
                tracker.sendMethodCall({
                  action: 'end',
                  framework: 'alpine',
                  stable_id: stableId,
                  runtime_id: runtimeId,
                  method: key,
                  trace_id: traceId,
                  return_value: tracker.serializeValue(value),
                  duration_ms: duration,
                });
                return value;
              }).catch((error: Error) => {
                const duration = performance.now() - startTime;
                tracker.sendMethodCall({
                  action: 'end',
                  framework: 'alpine',
                  stable_id: stableId,
                  runtime_id: runtimeId,
                  method: key,
                  trace_id: traceId,
                  return_value: { error: error.message },
                  duration_ms: duration,
                });
                throw error;
              });
            }

            const duration = performance.now() - startTime;
            tracker.sendMethodCall({
              action: 'end',
              framework: 'alpine',
              stable_id: stableId,
              runtime_id: runtimeId,
              method: key,
              trace_id: traceId,
              return_value: tracker.serializeValue(result),
              duration_ms: duration,
            });

            return result;
          } catch (error) {
            const duration = performance.now() - startTime;
            tracker.sendMethodCall({
              action: 'end',
              framework: 'alpine',
              stable_id: stableId,
              runtime_id: runtimeId,
              method: key,
              trace_id: traceId,
              return_value: { error: (error as Error).message },
              duration_ms: duration,
            });
            throw error;
          }
        };
      }
    });
  }

  private detectPropertyChanges(stableId: string, runtimeId: string | null, oldObj: Record<string, unknown>, newObj: Record<string, unknown>, path: string): void {
    if (!newObj || typeof newObj !== 'object') return;

    for (const key of Object.keys(newObj)) {
      if (key.startsWith('$') || key.startsWith('_x') || key.startsWith('__')) {
        continue;
      }
      if (typeof newObj[key] === 'function') {
        continue;
      }

      const propertyPath = path ? `${path}.${key}` : key;
      const oldValue = oldObj?.[key];
      const newValue = newObj[key];

      if (!this.valuesEqual(oldValue, newValue)) {
        this.sendPropertyChange({
          framework: 'alpine',
          stable_id: stableId,
          runtime_id: runtimeId,
          property_path: propertyPath,
          old_value: this.serializeValue(oldValue),
          new_value: this.serializeValue(newValue),
          change_source: 'reactive',
        });
      }

      if (newValue && typeof newValue === 'object' && !Array.isArray(newValue) && path.split('.').length < 5) {
        this.detectPropertyChanges(stableId, runtimeId, (oldValue as Record<string, unknown>) || {}, newValue as Record<string, unknown>, propertyPath);
      }
    }
  }

  private valuesEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a === null || b === null) return a === b;
    if (a === undefined || b === undefined) return a === b;

    if (Array.isArray(a) && Array.isArray(b)) {
      try {
        return JSON.stringify(a) === JSON.stringify(b);
      } catch {
        return false;
      }
    }

    if (typeof a === 'object' && typeof b === 'object') {
      try {
        return JSON.stringify(a) === JSON.stringify(b);
      } catch {
        return false;
      }
    }

    return false;
  }

  private cloneProperties(obj: Record<string, unknown>, depth = 0): Record<string, unknown> {
    if (depth > 5 || !obj || typeof obj !== 'object') {
      return obj;
    }

    if (Array.isArray(obj)) {
      return [...obj] as unknown as Record<string, unknown>;
    }

    const clone: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      if (key.startsWith('$') || key.startsWith('_x') || key.startsWith('__')) {
        continue;
      }
      if (typeof obj[key] === 'function') {
        continue;
      }

      const value = obj[key];
      if (value && typeof value === 'object') {
        clone[key] = this.cloneProperties(value as Record<string, unknown>, depth + 1);
      } else {
        clone[key] = value;
      }
    }
    return clone;
  }

  private sendMethodCall(data: Record<string, unknown>): void {
    if (!this.connector?.isConnected()) return;

    this.connector.send(MessageTypes.METHOD_CALL, {
      ...data,
      timestamp: new Date().toISOString(),
    });
  }

  private sendPropertyChange(data: Record<string, unknown>): void {
    if (!this.connector?.isConnected()) return;

    this.connector.send(MessageTypes.PROPERTY_CHANGE, {
      ...data,
      timestamp: new Date().toISOString(),
    });
  }

  private serializeValue(value: unknown): unknown {
    return serializeForTransport(value);
  }

  private visitProperties(obj: Record<string, unknown>, maxDepth: number, depth = 0): void {
    if (depth >= maxDepth) return;
    if (!obj || typeof obj !== 'object') return;

    for (const key of Object.keys(obj)) {
      if (key.startsWith('$') || key.startsWith('_x') || key.startsWith('__')) {
        continue;
      }

      try {
        void obj[key];

        if (Array.isArray(obj[key])) {
          void (obj[key] as unknown[]).length;
        }

        if (obj[key] && typeof obj[key] === 'object') {
          this.visitProperties(obj[key] as Record<string, unknown>, maxDepth, depth + 1);
        }
      } catch {
        // Skip inaccessible properties
      }
    }
  }

  private findStableId(el: AlpineElement | null): string | null {
    if (!el) return null;

    const stableId = this.componentTracker.findStableIdForTracker(el, 'alpine:');
    if (stableId) return stableId;

    // Dynamic fallback for Alpine components without comment markers
    const name = this.componentTracker.getComponentName(el);
    const marker = el._x_marker;
    if (marker !== undefined) {
      return `alpine:${name}:dynamic_${marker}`;
    }

    return null;
  }

  private getAlpineData(el: AlpineElement | null): Record<string, unknown> | null {
    if (!el) return null;

    if (el._x_dataStack && el._x_dataStack.length > 0) {
      return el._x_dataStack[0];
    }

    const Alpine = window.Alpine;
    if (Alpine?.$data) {
      try {
        return Alpine.$data(el);
      } catch {
        // Element may not be initialized yet
      }
    }

    if (el.__x?.getUnobservedData) {
      return el.__x.getUnobservedData();
    }

    return null;
  }

  restoreState(stableId: string, targetState: Record<string, unknown>): boolean {
    const info = this.componentTracker.components.get(stableId);
    if (!info || !info.element) return false;

    const el = info.element as AlpineElement;
    const data = this.getAlpineData(el);
    if (!data) return false;

    try {
      this.deepMerge(data, targetState);
      this.log(`Restored state for ${stableId}`);
      return true;
    } catch (e) {
      this.log(`Failed to restore state for ${stableId}: ${(e as Error).message}`);
      return false;
    }
  }

  private deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): void {
    if (!source || typeof source !== 'object') return;

    for (const [key, value] of Object.entries(source)) {
      if (key.startsWith('$') || key.startsWith('_x') || key.startsWith('__')) {
        continue;
      }

      if (value && typeof value === 'object' && !Array.isArray(value)) {
        if (!target[key] || typeof target[key] !== 'object') {
          target[key] = {};
        }
        this.deepMerge(target[key] as Record<string, unknown>, value as Record<string, unknown>);
      } else {
        target[key] = value;
      }
    }
  }

  private log(message: string): void {
    this.connector?.log?.('[AlpineTracker] ' + message);
  }
}
