import { MessageTypes } from '../types/messages';
import { serializeForTransport } from '../utils/serialize';
import type { ComponentTracker } from './ComponentTracker';
import type { AgentConnector } from '../core/AgentConnector';

interface SnapshotEntry {
  sequence: number;
  snapshot: string;
  effects: unknown;
  updates: unknown;
  initial: boolean;
  timestamp: number;
}

interface MethodCall {
  method: string;
  params: unknown;
  path: string;
  callIndex: number;
  _traceId?: string;
}

interface LivewireComponent {
  id: string;
  name: string;
  $el?: HTMLElement;
  el?: HTMLElement;
  $wire?: LivewireWire;
  snapshot?: { data: Record<string, unknown>; memo?: { id: string; name: string; path: string } };
  snapshotEncoded?: string;
  mergeNewSnapshot?: (snapshot: string, effects: unknown, updates: unknown) => void;
  processEffects?: (effects: unknown) => void;
  effects?: unknown;
}

interface LivewireWire {
  $set?: (key: string, value: unknown, skipCommit: boolean) => void;
  $commit?: () => void;
  __instance?: { snapshot?: { data: Record<string, unknown> } };
  [key: string]: unknown;
}

declare global {
  interface Window {
    Livewire?: {
      hook: (name: string, callback: (...args: never[]) => void) => void;
      find?: (id: string) => LivewireComponent | undefined;
      all?: () => LivewireComponent[];
      components?: { componentsById?: Record<string, LivewireComponent> };
    };
  }
}

export class LivewireTracker {
  private componentTracker: ComponentTracker;
  private connector: AgentConnector;
  private livewireIdToStableId = new Map<string, string>();
  private snapshotHistory = new Map<string, SnapshotEntry[]>();
  private methodCallTimers = new Map<string, number>();
  private traceCounter = 0;
  private maxSnapshotHistorySize = 50;
  initialized = false;

  constructor(componentTracker: ComponentTracker) {
    this.componentTracker = componentTracker;
    this.connector = componentTracker.connector;
  }

  private generateTraceId(): string {
    return `lw_call_${Date.now()}_${++this.traceCounter}`;
  }

  private sendMethodCall(data: Record<string, unknown>): void {
    if (!this.connector?.isConnected()) {
      this.log('Cannot send method call - not connected');
      return;
    }

    this.log(`Sending METHOD_CALL: ${data.action} ${data.method}`);
    this.connector.send(MessageTypes.METHOD_CALL, {
      ...data,
      timestamp: new Date().toISOString(),
    });
  }

  private serializeValue(value: unknown): unknown {
    return serializeForTransport(value);
  }

  private extractMethodCalls(commit: { calls?: Array<{ method: string; params?: unknown[]; path?: string }>; updates?: Array<{ type: string; payload?: { method?: string; params?: unknown[]; path?: string } }> }): MethodCall[] {
    const calls: MethodCall[] = [];

    if (commit?.calls && Array.isArray(commit.calls)) {
      commit.calls.forEach((call, index) => {
        calls.push({
          method: call.method,
          params: this.serializeValue(call.params || []),
          path: call.path || '',
          callIndex: index,
        });
      });
    } else if (commit?.updates && Array.isArray(commit.updates)) {
      commit.updates.forEach((update, index) => {
        if (update.type === 'callMethod') {
          calls.push({
            method: update.payload?.method || '',
            params: this.serializeValue(update.payload?.params || []),
            path: update.payload?.path || '',
            callIndex: index,
          });
        }
      });
    }

    if (calls.length > 0) {
      this.log(`Extracted ${calls.length} method call(s): ${calls.map((c) => c.method).join(', ')}`);
    }

    return calls;
  }

  init(): void {
    if (this.initialized) return;

    if (typeof window.Livewire === 'undefined') {
      this.log('Livewire not found, skipping tracker initialization');
      return;
    }

    this.initialized = true;
    this.log('Initializing Livewire tracker');

    this.discoverExistingComponents();
    this.registerHooks();
  }

  reset(): void {
    this.livewireIdToStableId.clear();
    this.snapshotHistory.clear();
    this.initialized = false;
  }

  private discoverExistingComponents(): void {
    document.querySelectorAll('[wire\\:id]').forEach((el) => {
      const wireId = el.getAttribute('wire:id');
      const stableId = this.findStableId(el as HTMLElement);

      if (stableId && wireId) {
        this.livewireIdToStableId.set(wireId, stableId);

        const component = this.getLivewireComponent(wireId);
        if (component) {
          const sequence = this.storeSnapshot(stableId, {
            snapshot: component.snapshotEncoded || '',
            effects: {
              returns: [],
              html: (el as HTMLElement).outerHTML,
            },
            updates: null,
            initial: true,
          });

          this.componentTracker.handleMount(stableId, el as HTMLElement, {
            componentType: 'livewire',
            componentName: component.name,
            runtimeId: wireId,
            state: this.getComponentState(component),
            snapshotSequence: sequence,
          });
        }
      }
    });
  }

  private storeSnapshot(stableId: string, commit: { snapshot: string; effects: unknown; updates: unknown; initial?: boolean }): number {
    if (!this.snapshotHistory.has(stableId)) {
      this.snapshotHistory.set(stableId, []);
    }

    const history = this.snapshotHistory.get(stableId)!;
    const sequence = history.length;

    history.push({
      sequence,
      snapshot: commit.snapshot,
      effects: commit.effects,
      updates: commit.updates,
      initial: commit.initial || false,
      timestamp: Date.now(),
    });

    if (history.length > this.maxSnapshotHistorySize) {
      history.splice(0, history.length - this.maxSnapshotHistorySize);
    }

    this.log(`Stored snapshot ${sequence} for ${stableId}`);
    return sequence;
  }

  private getSnapshot(stableId: string, sequence: number): SnapshotEntry | null {
    const history = this.snapshotHistory.get(stableId);
    if (!history) return null;
    return history.find((s) => s.sequence === sequence) || null;
  }

  private registerHooks(): void {
    const Livewire = window.Livewire!;

    Livewire.hook('component.init', ({ component, cleanup }: { component: LivewireComponent; cleanup: (cb: () => void) => void }) => {
      const el = component.$el || component.el;
      const stableId = this.findStableId(el!);
      const wireId = component.id;

      if (!stableId) {
        this.log(`Component ${wireId} has no stable ID`);
        return;
      }

      this.livewireIdToStableId.set(wireId, stableId);

      let sequence = 0;
      if (!this.snapshotHistory.has(stableId)) {
        sequence = this.storeSnapshot(stableId, {
          snapshot: component.snapshotEncoded || '',
          effects: {
            returns: [],
            html: el?.outerHTML || '',
          },
          updates: null,
          initial: true,
        });
      } else {
        const history = this.snapshotHistory.get(stableId)!;
        sequence = history.length - 1;
      }

      this.componentTracker.handleMount(stableId, el!, {
        componentType: 'livewire',
        componentName: component.name,
        runtimeId: wireId,
        state: this.getComponentState(component),
        snapshotSequence: sequence,
      });

      cleanup(() => {
        this.componentTracker.handleUnmount(stableId);
        this.livewireIdToStableId.delete(wireId);
      });
    });

    Livewire.hook('effect', ({ component, effects }: { component: LivewireComponent; effects: unknown }) => {
      const wireId = component.id;
      const stableId = this.livewireIdToStableId.get(wireId);

      if (!stableId) return;

      this.componentTracker.handleStateChange(stableId, this.getComponentState(component) || {}, {
        trigger: 'effect',
        triggerDetail: this.formatEffects(effects),
      });
    });

    Livewire.hook('commit', ({ component, commit, succeed, fail }: { component: LivewireComponent; commit: { calls?: Array<{ method: string; params?: unknown[]; path?: string }>; updates?: Array<{ type: string; payload?: { method?: string; params?: unknown[]; path?: string } }> }; succeed: (cb: (result: { snapshot: string; effects: unknown }) => void) => void; fail: (cb: () => void) => void }) => {
      const wireId = component.id;
      const stableId = this.livewireIdToStableId.get(wireId);

      if (!stableId) return;

      const methodCalls = this.extractMethodCalls(commit);
      methodCalls.forEach((call) => {
        const traceId = this.generateTraceId();
        this.methodCallTimers.set(traceId, Date.now());
        call._traceId = traceId;

        this.sendMethodCall({
          action: 'start',
          framework: 'livewire',
          stable_id: stableId,
          runtime_id: wireId,
          method: call.method,
          params: call.params,
          trace_id: traceId,
          trigger_source: 'livewire_commit',
        });
      });

      succeed(({ snapshot, effects }) => {
        methodCalls.forEach((call) => {
          const startTime = this.methodCallTimers.get(call._traceId!);
          const duration = startTime ? Date.now() - startTime : null;

          this.sendMethodCall({
            action: 'end',
            framework: 'livewire',
            stable_id: stableId,
            runtime_id: wireId,
            method: call.method,
            trace_id: call._traceId,
            duration_ms: duration,
            return_value: null,
          });
          this.methodCallTimers.delete(call._traceId!);
        });

        const sequence = this.storeSnapshot(stableId, {
          snapshot: snapshot,
          effects: effects,
          updates: commit.updates,
          initial: false,
        });

        this.componentTracker.handleStateChange(stableId, this.extractSnapshotData(snapshot) || {}, {
          trigger: 'commit',
          triggerDetail: methodCalls.length > 0 ? `call: ${methodCalls.map((c) => c.method).join(', ')}` : 'server_response',
          snapshotSequence: sequence,
        });
      });

      fail(() => {
        methodCalls.forEach((call) => {
          const startTime = this.methodCallTimers.get(call._traceId!);
          const duration = startTime ? Date.now() - startTime : null;

          this.sendMethodCall({
            action: 'end',
            framework: 'livewire',
            stable_id: stableId,
            runtime_id: wireId,
            method: call.method,
            trace_id: call._traceId,
            duration_ms: duration,
            return_value: { error: 'Commit failed' },
          });
          this.methodCallTimers.delete(call._traceId!);
        });
      });
    });

    this.log('Livewire hooks registered');
  }

  private findStableId(el: HTMLElement | null): string | null {
    return this.componentTracker.findStableIdForTracker(el, 'livewire:');
  }

  private getLivewireComponent(wireId: string): LivewireComponent | null {
    if (typeof window.Livewire === 'undefined') return null;

    if (typeof window.Livewire.all === 'function') {
      const components = window.Livewire.all();
      const component = components.find((c) => {
        if (c.snapshot?.memo?.id === wireId) return true;
        if (c.id === wireId) return true;
        return false;
      });
      if (component) return component;
    }

    if (window.Livewire.find) {
      return window.Livewire.find(wireId) || null;
    }

    if (window.Livewire.components?.componentsById) {
      return window.Livewire.components.componentsById[wireId] || null;
    }

    return null;
  }

  private getComponentState(component: LivewireComponent | null): Record<string, unknown> | null {
    if (!component) return null;

    if (component.snapshot?.data) {
      return { ...component.snapshot.data };
    }

    if (component.$wire) {
      return this.extractWireState(component.$wire);
    }

    return null;
  }

  private extractSnapshotData(snapshot: string | { data?: Record<string, unknown> }): Record<string, unknown> | null {
    if (!snapshot) return null;

    let parsed: { data?: Record<string, unknown> };
    if (typeof snapshot === 'string') {
      try {
        parsed = JSON.parse(snapshot);
      } catch {
        return null;
      }
    } else {
      parsed = snapshot;
    }

    return parsed.data || null;
  }

  private extractWireState($wire: LivewireWire): Record<string, unknown> | null {
    if (!$wire) return null;

    if ($wire.__instance?.snapshot?.data) {
      return { ...$wire.__instance.snapshot.data };
    }

    const state: Record<string, unknown> = {};
    for (const key of Object.keys($wire)) {
      if (!key.startsWith('$') && !key.startsWith('_')) {
        try {
          state[key] = $wire[key];
        } catch { }
      }
    }

    return Object.keys(state).length > 0 ? state : null;
  }

  private formatEffects(effects: unknown): string | null {
    if (!effects) return null;

    if (Array.isArray(effects)) {
      return effects.slice(0, 5).join(', ');
    }

    if (typeof effects === 'object') {
      return Object.keys(effects as object).slice(0, 5).join(', ');
    }

    return String(effects);
  }

  restoreState(stableId: string, targetState: Record<string, unknown>, targetSequence: number | null = null): boolean {
    this.log(`restoreState called for ${stableId}, sequence: ${targetSequence}`);

    const info = this.componentTracker.components.get(stableId);
    if (!info) {
      this.log(`ERROR: Component not found in registry for ${stableId}`);
      return false;
    }
    if (!info.element) {
      this.log(`ERROR: Component has no element for ${stableId}`);
      return false;
    }

    const wireId = info.runtimeId;
    if (!wireId) {
      this.log(`ERROR: No runtimeId for ${stableId}`);
      return false;
    }

    const component = this.getLivewireComponent(wireId);
    if (!component) {
      this.log(`ERROR: Livewire.find(${wireId}) returned null`);
      return false;
    }

    try {
      const storedSnapshot = targetSequence !== null ? this.getSnapshot(stableId, targetSequence) : null;

      if (storedSnapshot && storedSnapshot.snapshot && storedSnapshot.effects) {
        return this.restoreFromSnapshot(component, storedSnapshot);
      } else {
        return this.restoreFromState(component, targetState);
      }
    } catch {
      return false;
    }
  }

  private restoreFromSnapshot(component: LivewireComponent, storedSnapshot: SnapshotEntry): boolean {
    const { snapshot, effects, updates } = storedSnapshot;
    const $wire = component.$wire;

    this.log(`Current state before restore: ${JSON.stringify(this.getComponentState(component))}`);

    if (typeof component.mergeNewSnapshot === 'function') {
      this.log(`Calling mergeNewSnapshot()`);
      component.mergeNewSnapshot(snapshot, effects, updates || {});
    } else {
      this.log(`WARNING: mergeNewSnapshot not available`);
    }

    let snapshotData: { data?: Record<string, unknown> };
    try {
      snapshotData = typeof snapshot === 'string' ? JSON.parse(snapshot) : snapshot;
    } catch (e) {
      this.log(`ERROR: Failed to parse snapshot: ${(e as Error).message}`);
      return false;
    }

    if (snapshotData?.data && $wire) {
      let keysUpdated = 0;
      for (const [key, value] of Object.entries(snapshotData.data)) {
        if (!key.startsWith('$') && !key.startsWith('_')) {
          if (typeof $wire.$set === 'function') {
            $wire.$set(key, value, false);
            keysUpdated++;
          }
        }
      }
      this.log(`Updated ${keysUpdated} keys via $wire.$set()`);
    }

    if (typeof component.processEffects === 'function' && component.effects) {
      this.log(`Calling processEffects()`);
      component.processEffects(component.effects);
    } else {
      this.log(`WARNING: processEffects not available or no effects`);
    }

    this.log(`State after restore: ${JSON.stringify(this.getComponentState(component))}`);
    return true;
  }

  private restoreFromState(component: LivewireComponent, targetState: Record<string, unknown>): boolean {
    const $wire = component.$wire;

    if (!$wire) {
      this.log(`ERROR: component.$wire is null/undefined`);
      return false;
    }

    this.log(`Current state before restore: ${JSON.stringify(this.getComponentState(component))}`);

    let keysUpdated = 0;
    for (const [key, value] of Object.entries(targetState)) {
      if (!key.startsWith('$') && !key.startsWith('_')) {
        if (typeof $wire.$set === 'function') {
          $wire.$set(key, value, false);
          keysUpdated++;
        } else {
          $wire[key] = value;
          keysUpdated++;
        }
      }
    }

    this.log(`Updated ${keysUpdated} keys via $wire.$set()`);
    this.log(`State after $set: ${JSON.stringify(this.getComponentState(component))}`);

    if (typeof $wire.$commit === 'function') {
      this.log(`Calling $commit() to sync state and update DOM`);
      $wire.$commit();
    } else {
      this.log(`WARNING: $commit not available, DOM may not update`);
    }

    this.log(`Restored state using fallback approach`);
    return true;
  }

  private log(message: string): void {
    this.connector?.log?.('[LivewireTracker] ' + message);
  }
}
