import type { AgentConfig } from './config';
import type { MessageTypes } from './messages';
import type { AgentConnector } from '../core/AgentConnector';
import type { AgentDebugButton } from '../core/AgentDebugButton';
import type { DomObserver } from '../observers/DomObserver';
import type { NetworkObserver } from '../observers/NetworkObserver';
import type { ComponentTracker } from '../trackers/ComponentTracker';
import type { LivewireTracker } from '../trackers/LivewireTracker';
import type { AlpineTracker } from '../trackers/AlpineTracker';
import type { FluxTracker } from '../trackers/FluxTracker';
import type { BladeTracker } from '../trackers/BladeTracker';
import type { PerformanceCollector } from '../collectors/PerformanceCollector';

export interface AgentNamespace {
  MessageTypes: typeof MessageTypes;
  AgentConnector: typeof AgentConnector;
  AgentDebugButton: typeof AgentDebugButton;
  DomObserver: typeof DomObserver;
  NetworkObserver: typeof NetworkObserver;
  ComponentTracker: typeof ComponentTracker;
  LivewireTracker: typeof LivewireTracker;
  AlpineTracker: typeof AlpineTracker;
  FluxTracker: typeof FluxTracker;
  BladeTracker: typeof BladeTracker;
  PerformanceCollector: typeof PerformanceCollector;
  instance?: AgentConnector;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCallback = (...args: any[]) => void;

export interface LivewireGlobal {
  hook: (name: string, callback: AnyCallback) => void;
  find: (id: string) => LivewireComponent | undefined;
  all: () => LivewireComponent[];
  on: (event: string, callback: AnyCallback) => void;
}

export interface LivewireComponent {
  id: string;
  name: string;
  el: HTMLElement;
  $wire: Record<string, unknown>;
  getState: () => Record<string, unknown>;
  snapshot?: {
    data: Record<string, unknown>;
    memo: {
      name: string;
      path: string;
    };
  };
}

export interface AlpineGlobal {
  version: string;
  start: () => void;
  data: (name: string, callback: () => Record<string, unknown>) => void;
  store: (name: string, value?: unknown) => unknown;
  directive: (name: string, callback: AnyCallback) => void;
  $data: (el: HTMLElement) => Record<string, unknown>;
  onElAdded: (callback: AnyCallback) => void;
  onElRemoved: (callback: AnyCallback) => void;
}

declare global {
  interface Window {
    Agent: AgentNamespace;
    AgentConfig?: AgentConfig;
    AgentButton?: AgentDebugButton;
    Livewire?: LivewireGlobal;
    Alpine?: AlpineGlobal;
  }
}

export {};
