import { MarkerBasedTracker } from './MarkerBasedTracker';
import type { ComponentTracker } from './ComponentTracker';

export class FluxTracker extends MarkerBasedTracker {
  constructor(componentTracker: ComponentTracker) {
    super(componentTracker, 'flux:', 'flux', 'FluxTracker');
  }

  extractComponentState(el: Element): Record<string, unknown> {
    const state: Record<string, unknown> = {};

    for (const attr of el.attributes) {
      const name = attr.name;

      if (name.startsWith('data-agent')) continue;
      if (name.startsWith('wire:')) continue;
      if (name.startsWith('x-')) continue;
      if (name === 'class' || name === 'style') continue;

      state[name] = attr.value;
    }

    const slots = this.extractSlots(el);
    if (Object.keys(slots).length > 0) {
      state._slots = slots;
    }

    return state;
  }

  getTrackedAttributes(): string[] {
    return [
      'disabled',
      'readonly',
      'checked',
      'selected',
      'open',
      'hidden',
      'aria-expanded',
      'aria-selected',
      'aria-checked',
      'aria-hidden',
      'data-state',
      'data-active',
      'data-selected',
    ];
  }

  restoreState(stableId: string, targetState: Record<string, unknown>): boolean {
    const info = this.trackedComponents.get(stableId);
    if (!info || !info.element) return false;

    const el = info.element;

    try {
      for (const [key, value] of Object.entries(targetState)) {
        if (key.startsWith('_')) continue;

        if (value === null || value === undefined) {
          el.removeAttribute(key);
        } else {
          el.setAttribute(key, String(value));
        }
      }

      this.log(`Restored state for ${stableId}`);
      return true;
    } catch (e) {
      this.log(`Failed to restore state for ${stableId}: ${(e as Error).message}`);
      return false;
    }
  }
}
