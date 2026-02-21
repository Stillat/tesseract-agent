import type { ComponentTracker } from './ComponentTracker';
import type { AgentConnector } from '../core/AgentConnector';

export interface TrackedComponentInfo {
  element: Element;
  componentName: string;
  state: Record<string, unknown>;
}

export abstract class MarkerBasedTracker {
  protected componentTracker: ComponentTracker;
  protected connector: AgentConnector;
  protected trackedComponents = new Map<string, TrackedComponentInfo>();
  private observer: MutationObserver | null = null;
  private markerPattern: RegExp;
  initialized = false;

  constructor(
    componentTracker: ComponentTracker,
    protected readonly prefix: string,
    protected readonly componentType: string,
    protected readonly logTag: string
  ) {
    this.componentTracker = componentTracker;
    this.connector = componentTracker.connector;
    const escapedPrefix = this.prefix.replace(':', '\\:');
    this.markerPattern = new RegExp(`\\[agent:start\\s+.*?id="${escapedPrefix}`);
  }

  init(): void {
    if (this.initialized) return;

    this.initialized = true;
    this.log(`Initializing ${this.logTag} tracker`);

    this.discoverExistingComponents();
    this.setupMutationObserver();
  }

  reset(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.trackedComponents.clear();
    this.initialized = false;
  }

  private discoverExistingComponents(): void {
    const markers = this.componentTracker.findAgentMarkers();

    for (const marker of markers) {
      if (marker.stableId.startsWith(this.prefix)) {
        this.trackComponent(marker.element, marker.stableId, marker.meta);
      }
    }
  }

  private trackComponent(el: Element, stableId: string, meta: Record<string, string> = {}): void {
    if (!stableId || this.trackedComponents.has(stableId)) return;

    const componentName = meta.name || this.getNameFromStableId(stableId);
    const state = this.extractComponentState(el);

    this.trackedComponents.set(stableId, {
      element: el,
      componentName,
      state,
    });

    this.componentTracker.handleMount(stableId, el, {
      componentType: this.componentType,
      componentName,
      sourceFile: meta.file || null,
      sourceLine: meta.line ? parseInt(meta.line, 10) : null,
      state,
    });

    this.log(`Discovered ${this.componentType} component: ${stableId}`);
  }

  private setupMutationObserver(): void {
    this.observer = new MutationObserver((mutations) => {
      if (this.componentTracker.mutationsPaused) return;

      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.COMMENT_NODE) {
            if (node.textContent?.match(this.markerPattern)) {
              this.discoverExistingComponents();
              break;
            }
          }

          if (node.nodeType === Node.ELEMENT_NODE && (node as Element).childNodes) {
            if (this.hasMarkerInTree(node as Element)) {
              this.discoverExistingComponents();
              break;
            }
          }
        }

        for (const node of mutation.removedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;

          const stableId = this.componentTracker.findStableIdFromComments(node as Element);
          if (stableId?.startsWith(this.prefix)) {
            this.handleRemoval(stableId);
          }

          for (const [trackedId, info] of this.trackedComponents.entries()) {
            if (info.element && (node as Element).contains?.(info.element)) {
              this.handleRemoval(trackedId);
            }
          }
        }

        if (mutation.type === 'attributes' && mutation.target) {
          const stableId = this.componentTracker.findStableIdFromComments(mutation.target as Element);
          if (stableId?.startsWith(this.prefix)) {
            this.handleAttributeChange(mutation.target as Element, stableId);
          }
        }
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: this.getTrackedAttributes(),
    });
  }

  private hasMarkerInTree(node: Element): boolean {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_COMMENT, null);

    let comment: Comment | null;
    while ((comment = walker.nextNode() as Comment | null)) {
      if (comment.textContent?.match(this.markerPattern)) {
        return true;
      }
    }
    return false;
  }

  private handleRemoval(stableId: string): void {
    if (this.trackedComponents.has(stableId)) {
      this.componentTracker.handleUnmount(stableId);
      this.trackedComponents.delete(stableId);
      this.log(`${this.componentType} component removed: ${stableId}`);
    }
  }

  private handleAttributeChange(el: Element, stableId: string): void {
    const info = this.trackedComponents.get(stableId);
    if (!info) return;

    const newState = this.extractComponentState(el);
    info.state = newState;

    this.componentTracker.handleStateChange(stableId, newState, {
      trigger: 'attribute',
    });
  }

  private getNameFromStableId(stableId: string): string {
    const parts = stableId.split(':');
    return parts[1] || 'unknown';
  }

  destroy(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.trackedComponents.clear();
    this.initialized = false;
  }

  protected log(message: string): void {
    this.connector?.log?.(`[${this.logTag}] ` + message);
  }

  protected extractSlots(el: Element): Record<string, { hasContent: boolean; preview: string }> {
    const slots: Record<string, { hasContent: boolean; preview: string }> = {};

    el.querySelectorAll(':scope > [x-slot]').forEach((slotEl) => {
      const slotName = slotEl.getAttribute('x-slot') || 'default';
      slots[slotName] = {
        hasContent: slotEl.innerHTML.trim().length > 0,
        preview: slotEl.textContent?.substring(0, 50) || '',
      };
    });

    if (!slots.default && el.innerHTML.trim()) {
      const directContent = Array.from(el.childNodes)
        .filter(
          (n) =>
            n.nodeType === Node.TEXT_NODE ||
            (n.nodeType === Node.ELEMENT_NODE && !(n as Element).hasAttribute?.('x-slot'))
        )
        .map((n) => n.textContent || '')
        .join('')
        .trim();

      if (directContent) {
        slots.default = {
          hasContent: true,
          preview: directContent.substring(0, 50),
        };
      }
    }

    return slots;
  }

  abstract extractComponentState(el: Element): Record<string, unknown>;
  abstract getTrackedAttributes(): string[];
  abstract restoreState(stableId: string, targetState: Record<string, unknown>): boolean;
}
