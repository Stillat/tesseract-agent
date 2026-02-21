import { MessageTypes } from '../types/messages';
import type { AgentConnector } from '../core/AgentConnector';
import type { DomNode } from '../types/messages';

interface SerializedNode {
  id: number;
  tag: string;
  attrs?: Record<string, string>;
  children?: SerializedNode[];
  text?: string;
}

interface ChildListMutation {
  type: 'childList';
  targetId: number;
  added: Array<{ node: SerializedNode; beforeId: number | null }>;
  removed: number[];
}

interface AttributeMutation {
  type: 'attributes';
  targetId: number;
  attr: string | null;
  value: string | null;
}

interface CharacterDataMutation {
  type: 'characterData';
  targetId: number;
  text: string;
}

type PendingMutation = ChildListMutation | AttributeMutation | CharacterDataMutation;

export class DomObserver {
  private connector: AgentConnector;
  private nodeMap = new WeakMap<Node, number>();
  private idMap = new Map<number, Node>();
  private nextId = 1;
  private observer: MutationObserver | null = null;
  private pendingMutations: PendingMutation[] = [];
  private flushTimeout: ReturnType<typeof setTimeout> | null = null;
  private enabled = false;
  private batchInterval = 50;
  private initialMaxDepth = 15;
  private expandedMaxDepth = 50;

  constructor(connector: AgentConnector) {
    this.connector = connector;
  }

  private assignId(node: Node): number {
    const existing = this.nodeMap.get(node);
    if (existing !== undefined) {
      return existing;
    }
    const id = this.nextId++;
    this.nodeMap.set(node, id);
    this.idMap.set(id, node);
    return id;
  }

  private getId(node: Node): number | null {
    return this.nodeMap.get(node) ?? null;
  }

  getNodeById(id: number): Node | null {
    return this.idMap.get(id) ?? null;
  }

  private removeId(node: Node): void {
    const id = this.nodeMap.get(node);
    if (id !== undefined) {
      this.nodeMap.delete(node);
      this.idMap.delete(id);
    }
  }

  serializeNode(node: Node, depth = 0, maxDepth = 50): SerializedNode | null {
    if (depth > maxDepth) return null;

    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      if (el.getAttribute?.('data-agent-ignore') === 'true') {
        return null;
      }
    }

    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim();
      if (!text) return null;
      return {
        id: this.assignId(node),
        tag: '#text',
        text: text.substring(0, 200),
      };
    }

    if (node.nodeType === Node.COMMENT_NODE) {
      return {
        id: this.assignId(node),
        tag: '#comment',
        text: node.textContent?.substring(0, 100) ?? '',
      };
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return null;

    const el = node as Element;
    const tag = el.tagName.toLowerCase();

    if (tag === 'script' || tag === 'style') {
      return {
        id: this.assignId(node),
        tag,
        attrs: this.serializeAttrs(el),
        children: [],
      };
    }

    const attrs = this.serializeAttrs(el);
    const children: SerializedNode[] = [];

    for (const child of el.childNodes) {
      const serialized = this.serializeNode(child, depth + 1, maxDepth);
      if (serialized) children.push(serialized);
    }

    return {
      id: this.assignId(node),
      tag,
      attrs,
      children,
    };
  }

  serializeAttrs(el: Element): Record<string, string> {
    const attrs: Record<string, string> = {};
    for (const attr of el.attributes) {
      if (attr.value.length > 500) {
        attrs[attr.name] = attr.value.substring(0, 500) + '...';
      } else {
        attrs[attr.name] = attr.value;
      }
    }
    return attrs;
  }

  private countNodes(node: SerializedNode | null): number {
    if (!node) return 0;
    let count = 1;
    if (node.children) {
      for (const child of node.children) {
        count += this.countNodes(child);
      }
    }
    return count;
  }

  start(): void {
    if (this.enabled) {
      this.stop();
    }
    this.enabled = true;

    this.nextId = 1;
    this.nodeMap = new WeakMap();
    this.idMap = new Map();
    this.pendingMutations = [];

    const root = this.serializeNode(document.documentElement, 0, this.initialMaxDepth);
    const nodeCount = this.countNodes(root);

    this.connector.send(MessageTypes.DOM_SNAPSHOT, {
      root,
      nodeCount,
      maxDepthUsed: this.initialMaxDepth,
      truncated: this.initialMaxDepth < this.expandedMaxDepth,
    });

    this.connector.log(`DOM snapshot sent: ${nodeCount} nodes (depth ${this.initialMaxDepth})`);

    this.observer = new MutationObserver((records) => this.handleMutations(records));
    this.observer.observe(document.documentElement, {
      childList: true,
      attributes: true,
      characterData: true,
      subtree: true,
      attributeOldValue: true,
    });
  }

  stop(): void {
    if (!this.enabled) return;
    this.enabled = false;

    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
      this.flushTimeout = null;
    }

    this.pendingMutations = [];
    this.connector.log('DOM observation stopped');
  }

  private handleMutations(records: MutationRecord[]): void {
    for (const record of records) {
      this.processMutation(record);
    }

    if (!this.flushTimeout && this.pendingMutations.length > 0) {
      this.flushTimeout = setTimeout(() => this.flushMutations(), this.batchInterval);
    }
  }

  private processMutation(record: MutationRecord): void {
    const targetId = this.getId(record.target);
    if (targetId === null) return;

    if (record.type === 'childList') {
      const removed: number[] = [];
      for (const node of record.removedNodes) {
        const id = this.getId(node);
        if (id !== null) {
          removed.push(id);
          this.cleanupRemovedNode(node);
        }
      }

      const added: Array<{ node: SerializedNode; beforeId: number | null }> = [];
      for (const node of record.addedNodes) {
        const serialized = this.serializeNode(node);
        if (serialized) {
          let beforeId: number | null = null;
          if (node.nextSibling) {
            beforeId = this.getId(node.nextSibling);
          }
          added.push({ node: serialized, beforeId });
        }
      }

      if (added.length > 0 || removed.length > 0) {
        this.pendingMutations.push({
          type: 'childList',
          targetId,
          added,
          removed,
        });
      }
    } else if (record.type === 'attributes') {
      this.pendingMutations.push({
        type: 'attributes',
        targetId,
        attr: record.attributeName,
        value: (record.target as Element).getAttribute(record.attributeName!),
      });
    } else if (record.type === 'characterData') {
      this.pendingMutations.push({
        type: 'characterData',
        targetId,
        text: record.target.textContent?.substring(0, 200) ?? '',
      });
    }
  }

  private cleanupRemovedNode(node: Node): void {
    this.removeId(node);
    if (node.childNodes) {
      for (const child of node.childNodes) {
        this.cleanupRemovedNode(child);
      }
    }
  }

  private flushMutations(): void {
    this.flushTimeout = null;

    if (this.pendingMutations.length === 0) return;

    const mutations = this.deduplicateMutations(this.pendingMutations);
    this.pendingMutations = [];

    if (mutations.length === 0) return;

    this.connector.send(MessageTypes.DOM_MUTATIONS, { mutations });
  }

  private deduplicateMutations(mutations: PendingMutation[]): PendingMutation[] {
    const addedIds = new Set<number>();
    const removedIds = new Set<number>();

    for (const m of mutations) {
      if (m.type === 'childList') {
        for (const a of m.added) {
          addedIds.add(a.node.id);
        }
        for (const r of m.removed) {
          removedIds.add(r);
        }
      }
    }

    const ephemeral = new Set([...addedIds].filter((id) => removedIds.has(id)));

    return mutations
      .map((m) => {
        if (m.type !== 'childList') return m;
        return {
          ...m,
          added: m.added.filter((a) => !ephemeral.has(a.node.id)),
          removed: m.removed.filter((id) => !ephemeral.has(id)),
        };
      })
      .filter((m) => {
        if (m.type !== 'childList') return true;
        return m.added.length > 0 || m.removed.length > 0;
      });
  }

  highlightNode(id: number): boolean {
    const node = this.getNodeById(id);
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;

    this.connector.highlightElement(node as Element, 'rgba(59, 130, 246, 0.3)', 2000);
    (node as Element).scrollIntoView({ behavior: 'smooth', block: 'center' });
    return true;
  }

  getNodeAtPoint(x: number, y: number): { id: number; tag: string; attrs: Record<string, string> } | null {
    const element = document.elementFromPoint(x, y);
    if (!element) return null;

    const id = this.getId(element) ?? this.assignId(element);
    return {
      id,
      tag: element.tagName.toLowerCase(),
      attrs: this.serializeAttrs(element),
    };
  }

  selectNode(x: number, y: number): void {
    const nodeInfo = this.getNodeAtPoint(x, y);
    if (!nodeInfo) return;

    const node = this.getNodeById(nodeInfo.id);
    if (node) {
      this.connector.highlightElement(node as Element, 'rgba(59, 130, 246, 0.3)', 2000);
    }

    this.connector.send(MessageTypes.DOM_SELECTED, nodeInfo);
  }
}
