import { MessageTypes } from '../types/messages';
import type { AgentConnector } from './AgentConnector';

interface Position {
  right: number;
  bottom: number;
}

export class AgentDebugButton {
  private connector: AgentConnector | null;
  private button: HTMLElement | null = null;
  private isDragging = false;
  private dragOffset = { x: 0, y: 0 };
  private dragStartPos = { x: 0, y: 0 };
  isEnabled: boolean;
  private statusInterval: ReturnType<typeof setInterval> | null = null;
  private defaultPosition: Position;
  private buttonZIndex: number;

  constructor(connector: AgentConnector | null) {
    this.connector = connector;
    this.isEnabled = this.loadState();

    const ui = window.AgentConfig?.ui || {};
    this.defaultPosition = ui.defaultPosition || { right: 20, bottom: 20 };
    this.buttonZIndex = ui.buttonZIndex || 2147483647;

    this.createButton();
    this.bindEvents();
    this.updateStatus();
  }

  setConnector(connector: AgentConnector): void {
    this.connector = connector;

    if (connector) {
      connector.on(MessageTypes.HANDSHAKE_ACK, () => this.updateStatus());
      connector.on('disconnect', () => this.updateStatus());
    }

    this.updateStatus();
  }

  private createButton(): void {
    this.button = document.createElement('div');
    this.button.id = 'agent-debug-btn';
    this.button.setAttribute('data-agent-ignore', 'true');
    this.button.innerHTML = `
      <div class="agent-btn-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2L2 7l10 5 10-5-10-5z"/>
          <path d="M2 17l10 5 10-5"/>
          <path d="M2 12l10 5 10-5"/>
        </svg>
      </div>
      <div class="agent-btn-status"></div>
    `;

    const style = document.createElement('style');
    style.setAttribute('data-agent-ignore', 'true');
    style.textContent = `
      #agent-debug-btn {
        position: fixed;
        z-index: ${this.buttonZIndex};
        width: 48px;
        height: 48px;
        right: calc(${this.defaultPosition.right}px + env(safe-area-inset-right, 0px));
        bottom: calc(${this.defaultPosition.bottom}px + env(safe-area-inset-bottom, 0px));
        left: auto;
        top: auto;
        border-radius: 50%;
        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
        border: 2px solid #0f3460;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.1) inset;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: transform 0.15s ease, box-shadow 0.15s ease;
        user-select: none;
        touch-action: none;
      }
      #agent-debug-btn:hover {
        transform: scale(1.08);
        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.15) inset;
      }
      #agent-debug-btn.dragging {
        transform: scale(1.12);
        cursor: grabbing;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
      }
      #agent-debug-btn.connected {
        border-color: #10b981;
        box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.1) inset;
      }
      #agent-debug-btn.disabled {
        opacity: 0.5;
        border-color: #4b5563;
      }
      .agent-btn-icon {
        width: 24px;
        height: 24px;
        color: #e5e7eb;
        transition: color 0.15s ease;
      }
      #agent-debug-btn.connected .agent-btn-icon {
        color: #10b981;
      }
      #agent-debug-btn.disabled .agent-btn-icon {
        color: #6b7280;
      }
      .agent-btn-status {
        position: absolute;
        top: 2px;
        right: 2px;
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: #6b7280;
        border: 2px solid #1a1a2e;
      }
      #agent-debug-btn.connected .agent-btn-status {
        background: #10b981;
        animation: agent-pulse 2s infinite;
      }
      #agent-debug-btn.disabled .agent-btn-status {
        background: #4b5563;
      }
      @keyframes agent-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }
    `;
    document.head.appendChild(style);

    const pos = this.loadPosition();
    this.button.style.right = pos.right + 'px';
    this.button.style.bottom = pos.bottom + 'px';

    document.body.appendChild(this.button);
  }

  private bindEvents(): void {
    if (!this.button) return;

    this.button.addEventListener('click', () => {
      if (!this.isDragging) {
        this.toggle();
      }
    });

    this.button.addEventListener('mousedown', (e) => this.startDrag(e));
    this.button.addEventListener('touchstart', (e) => this.startDrag(e.touches[0] as unknown as MouseEvent), { passive: false });

    document.addEventListener('mousemove', (e) => this.onDrag(e));
    document.addEventListener('touchmove', (e) => this.onDrag(e.touches[0] as unknown as MouseEvent), { passive: false });

    document.addEventListener('mouseup', () => this.endDrag());
    document.addEventListener('touchend', () => this.endDrag());

    if (this.connector) {
      this.connector.on(MessageTypes.HANDSHAKE_ACK, () => this.updateStatus());
      this.connector.on('disconnect', () => this.updateStatus());
    }

    this.statusInterval = setInterval(() => this.updateStatus(), 1000);
  }

  private startDrag(e: MouseEvent): void {
    if (!this.button) return;
    const rect = this.button.getBoundingClientRect();
    this.dragOffset = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
    this.dragStartPos = { x: e.clientX, y: e.clientY };
    this.isDragging = false;
    this.button.classList.add('dragging');
  }

  private onDrag(e: MouseEvent): void {
    if (!this.button?.classList.contains('dragging')) return;

    const dx = Math.abs(e.clientX - this.dragStartPos.x);
    const dy = Math.abs(e.clientY - this.dragStartPos.y);
    if (dx > 5 || dy > 5) {
      this.isDragging = true;
    }

    if (this.isDragging) {
      e.preventDefault();

      const x = e.clientX - this.dragOffset.x;
      const y = e.clientY - this.dragOffset.y;

      const right = window.innerWidth - x - this.button.offsetWidth;
      const bottom = window.innerHeight - y - this.button.offsetHeight;

      const clampedRight = Math.max(8, Math.min(right, window.innerWidth - this.button.offsetWidth - 8));
      const clampedBottom = Math.max(8, Math.min(bottom, window.innerHeight - this.button.offsetHeight - 8));

      this.button.style.right = clampedRight + 'px';
      this.button.style.bottom = clampedBottom + 'px';
      this.button.style.left = 'auto';
      this.button.style.top = 'auto';
    }
  }

  private endDrag(): void {
    if (!this.button?.classList.contains('dragging')) return;

    this.button.classList.remove('dragging');

    if (this.isDragging) {
      this.savePosition({
        right: parseInt(this.button.style.right),
        bottom: parseInt(this.button.style.bottom),
      });
    }

    setTimeout(() => {
      this.isDragging = false;
    }, 50);
  }

  private toggle(): void {
    if (!this.connector) {
      this.isEnabled = !this.isEnabled;
      this.saveState(this.isEnabled);
      this.updateStatus();
      return;
    }

    if (this.isEnabled && !this.connector.isConnected()) {
      this.forceReconnect();
      return;
    }

    this.isEnabled = !this.isEnabled;
    this.saveState(this.isEnabled);

    if (this.isEnabled) {
      this.connector.connect();
    } else {
      this.connector.disconnect();
    }

    this.updateStatus();
  }

  private forceReconnect(): void {
    if (!this.connector) return;

    this.connector.retryDelay = 1000;
    this.connector.disconnect();
    this.connector.connect();
    this.updateStatus();
  }

  private updateStatus(): void {
    if (!this.button) return;

    const connected = this.connector?.isConnected() ?? false;

    this.button.classList.toggle('connected', connected && this.isEnabled);
    this.button.classList.toggle('disabled', !this.isEnabled);

    if (!this.connector) {
      this.button.title = 'Agent: Initializing...';
    } else if (!this.isEnabled) {
      this.button.title = 'Agent: Disabled (click to enable)';
    } else if (connected) {
      this.button.title = 'Agent: Connected (click to disconnect)';
    } else {
      this.button.title = 'Agent: Disconnected (click to reconnect)';
    }
  }

  private loadPosition(): Position {
    try {
      const saved = localStorage.getItem('agent_btn_pos');
      if (saved) {
        const pos = JSON.parse(saved);
        const maxRight = window.innerWidth - 56;
        const maxBottom = window.innerHeight - 56;
        return {
          right: Math.max(8, Math.min(pos.right || this.defaultPosition.right, maxRight)),
          bottom: Math.max(8, Math.min(pos.bottom || this.defaultPosition.bottom, maxBottom)),
        };
      }
    } catch { }
    return this.defaultPosition;
  }

  private savePosition(pos: Position): void {
    try {
      localStorage.setItem('agent_btn_pos', JSON.stringify(pos));
    } catch { }
  }

  private loadState(): boolean {
    try {
      const saved = localStorage.getItem('agent_enabled');
      return saved !== 'false';
    } catch { }
    return true;
  }

  private saveState(enabled: boolean): void {
    try {
      localStorage.setItem('agent_enabled', enabled.toString());
    } catch { }
  }

  destroy(): void {
    if (this.statusInterval) {
      clearInterval(this.statusInterval);
      this.statusInterval = null;
    }
    if (this.button) {
      this.button.remove();
      this.button = null;
    }
  }
}
