import { MarkerBasedTracker } from './MarkerBasedTracker';
import type { ComponentTracker } from './ComponentTracker';

export class BladeTracker extends MarkerBasedTracker {
  constructor(componentTracker: ComponentTracker) {
    super(componentTracker, 'blade:', 'blade', 'BladeTracker');
  }

  extractComponentState(el: Element): Record<string, unknown> {
    const state: Record<string, unknown> = {
      _attributes: {} as Record<string, string>,
      _data: {} as Record<string, string>,
    };

    for (const attr of el.attributes) {
      const name = attr.name;

      if (name.startsWith('data-agent')) continue;
      if (name.startsWith('wire:')) continue;
      if (name.startsWith('x-')) continue;
      if (name === 'class' || name === 'style') continue;

      if (name.startsWith('data-')) {
        const dataKey = name.substring(5);
        (state._data as Record<string, string>)[dataKey] = attr.value;
      } else {
        (state._attributes as Record<string, string>)[name] = attr.value;
      }
    }

    const slots = this.extractSlots(el);
    if (Object.keys(slots).length > 0) {
      state._slots = slots;
    }

    return state;
  }

  protected override extractSlots(el: Element): Record<string, { hasContent: boolean; preview: string }> {
    const slots = super.extractSlots(el);

    el.querySelectorAll(':scope > [slot]').forEach((slotEl) => {
      const slotName = slotEl.getAttribute('slot') || 'default';
      if (!slots[slotName]) {
        slots[slotName] = {
          hasContent: slotEl.innerHTML.trim().length > 0,
          preview: slotEl.textContent?.substring(0, 50) || '',
        };
      }
    });

    // Re-check the default slot considering [slot] attribute
    if (!slots.default && el.innerHTML.trim()) {
      const directContent = Array.from(el.childNodes)
        .filter(
          (n) =>
            n.nodeType === Node.TEXT_NODE ||
            (n.nodeType === Node.ELEMENT_NODE &&
              !(n as Element).hasAttribute?.('x-slot') &&
              !(n as Element).hasAttribute?.('slot'))
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

  getTrackedAttributes(): string[] {
    return [
      'disabled',
      'readonly',
      'checked',
      'selected',
      'open',
      'hidden',
      'value',
      'placeholder',
      'href',
      'src',
      'alt',
      'title',
      'aria-expanded',
      'aria-selected',
      'aria-checked',
      'aria-hidden',
      'aria-label',
      'data-state',
      'data-active',
      'data-selected',
      'data-value',
    ];
  }

  restoreState(stableId: string, targetState: Record<string, unknown>): boolean {
    const info = this.trackedComponents.get(stableId);
    if (!info || !info.element) return false;

    const el = info.element;

    try {
      if (targetState._attributes) {
        for (const [key, value] of Object.entries(targetState._attributes as Record<string, string | null>)) {
          if (value === null || value === undefined) {
            el.removeAttribute(key);
          } else {
            el.setAttribute(key, value);
          }
        }
      }

      if (targetState._data) {
        for (const [key, value] of Object.entries(targetState._data as Record<string, string | null>)) {
          const attrName = `data-${key}`;
          if (value === null || value === undefined) {
            el.removeAttribute(attrName);
          } else {
            el.setAttribute(attrName, value);
          }
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
