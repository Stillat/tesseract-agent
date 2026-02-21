import { MessageTypes } from './types/messages';
import { AgentConnector } from './core/AgentConnector';
import { AgentDebugButton } from './core/AgentDebugButton';
import { DomObserver } from './observers/DomObserver';
import { NetworkObserver } from './observers/NetworkObserver';
import { ComponentTracker } from './trackers/ComponentTracker';
import { LivewireTracker } from './trackers/LivewireTracker';
import { AlpineTracker } from './trackers/AlpineTracker';
import { FluxTracker } from './trackers/FluxTracker';
import { BladeTracker } from './trackers/BladeTracker';
import { PerformanceCollector } from './collectors/PerformanceCollector';

export type { AgentConfig, UIConfig } from './types/config';
export type {
  MessageType,
  BaseMessage,
  HandshakeMessage,
  ConsoleEntry,
  NetworkRequest,
  NetworkResponse,
  DomNode,
  DomMutation
} from './types/messages';

window.Agent = {
  MessageTypes,
  AgentConnector,
  AgentDebugButton,
  DomObserver,
  NetworkObserver,
  ComponentTracker,
  LivewireTracker,
  AlpineTracker,
  FluxTracker,
  BladeTracker,
  PerformanceCollector,
};

if (window.AgentConfig) {
  const initButton = (): void => {
    window.AgentButton = new AgentDebugButton(null);

    const deferInit = window.requestIdleCallback || ((cb: () => void) => setTimeout(cb, 0));

    deferInit(() => {
      const agent = new AgentConnector(window.AgentConfig!);
      window.Agent.instance = agent;

      window.AgentButton!.setConnector(agent);

      setupNavigationTracking(agent);

      if (window.AgentButton!.isEnabled) {
        agent.connect();
      }
    });
  };

  if (document.body) {
    initButton();
  } else {
    document.addEventListener('DOMContentLoaded', initButton);
  }
}

function setupNavigationTracking(agent: AgentConnector): void {
  agent.on(MessageTypes.HANDSHAKE_ACK, () => {
    agent.sendNavigation(MessageTypes.NAV_PAGE_LOAD);
  });

  const origPushState = history.pushState;
  const origReplaceState = history.replaceState;

  history.pushState = function (...args: Parameters<typeof history.pushState>): void {
    origPushState.apply(this, args);
    agent.sendNavigation(MessageTypes.NAV_PUSHSTATE);
  };

  history.replaceState = function (...args: Parameters<typeof history.replaceState>): void {
    origReplaceState.apply(this, args);
    agent.sendNavigation(MessageTypes.NAV_REPLACESTATE);
  };

  window.addEventListener('popstate', () => {
    agent.sendNavigation(MessageTypes.NAV_POPSTATE);
  });

  document.addEventListener('visibilitychange', () => {
    agent.sendVisibility(!document.hidden);
  });

  window.addEventListener('beforeunload', () => {
    agent.sendNavigation(MessageTypes.NAV_UNLOAD);
  });
}
