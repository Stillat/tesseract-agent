export const MessageTypes = {
  // Connection
  HANDSHAKE: 'handshake',
  HANDSHAKE_ACK: 'handshake_ack',
  PING: 'ping',
  PONG: 'pong',

  // Events
  NAVIGATION: 'navigation',
  VISIBILITY: 'visibility',
  CONSOLE: 'console',
  CONSOLE_BATCH: 'console_batch',

  // DOM streaming (JS -> Agent)
  DOM_SNAPSHOT: 'dom_snapshot',
  DOM_MUTATIONS: 'dom_mutations',
  DOM_SELECTED: 'dom_selected',

  // Network requests (JS -> Agent)
  NETWORK_REQUEST: 'network_request',
  NETWORK_RESPONSE: 'network_response',
  NETWORK_ERROR: 'network_error',

  // Commands
  COMMAND: 'command',
  COMMAND_RESPONSE: 'command_response',

  // Navigation actions
  NAV_PAGE_LOAD: 'page_load',
  NAV_PUSHSTATE: 'pushstate',
  NAV_REPLACESTATE: 'replacestate',
  NAV_POPSTATE: 'popstate',
  NAV_UNLOAD: 'unload',

  // Component lifecycle (JS -> Agent)
  COMPONENT_DISCOVERED: 'component:discovered',
  COMPONENT_MOUNTED: 'component:mounted',
  COMPONENT_UNMOUNTED: 'component:unmounted',

  // Component state changes (JS -> Agent)
  STATE_CHANGED: 'state:changed',
  STATE_SNAPSHOT: 'state:snapshot',

  // Time travel (Agent -> JS)
  TIME_TRAVEL_REQUEST: 'time_travel:request',
  TIME_TRAVEL_RESPONSE: 'time_travel:response',

  // Storage browser (JS -> Agent -> Dashboard)
  STORAGE_DISKS_INFO: 'storage_disks_info',
  STORAGE_LIST_RESULT: 'storage_list_result',
  STORAGE_FILE_RESULT: 'storage_file_result',

  // Performance metrics (JS -> Agent)
  PERFORMANCE_METRICS: 'performance_metrics',

  // Method calls and property changes (JS -> Agent)
  METHOD_CALL: 'method_call',
  PROPERTY_CHANGE: 'property_change',

  // Preview frame (JS -> Agent -> Dashboard)
  PREVIEW_FRAME: 'preview_frame',
} as const;

export type MessageType = (typeof MessageTypes)[keyof typeof MessageTypes];

export interface BaseMessage {
  type: MessageType;
  project_id: string;
  app_id: string;
  payload?: Record<string, unknown>;
}

export interface HandshakeMessage extends Omit<BaseMessage, 'payload'> {
  type: typeof MessageTypes.HANDSHAKE;
  origin: string;
  url: string;
  path: string;
  app_info: AppInfo;
  paths: AgentPaths;
}

export interface HandshakeAckMessage extends BaseMessage {
  type: typeof MessageTypes.HANDSHAKE_ACK;
  connection_id: string;
}

export interface CommandMessage extends BaseMessage {
  type: typeof MessageTypes.COMMAND;
  payload: {
    command: string;
    args?: Record<string, unknown>;
    request_id?: string;
  };
}

export interface AppInfo {
  name: string;
  version: string;
  environment: string;
  debug: boolean;
  laravel_version?: string;
  php_version?: string;
}

export interface AgentPaths {
  base: string;
  storage?: string;
  resources?: string;
  views?: string;
}

export interface ConsoleEntry {
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  args: unknown[];
  timestamp: number;
  stack?: string;
}

export interface NetworkRequest {
  id: string;
  method: string;
  url: string;
  startTime: number;
  headers?: Record<string, string>;
  body?: string;
}

export interface NetworkResponse {
  id: string;
  status: number;
  statusText: string;
  endTime: number;
  duration: number;
  headers?: Record<string, string>;
  body?: string;
  size?: number;
}

export interface DomNode {
  id: number;
  tag: string;
  attrs?: Record<string, string>;
  children?: DomNode[];
  text?: string;
}

export interface DomMutation {
  type: 'added' | 'removed' | 'attribute' | 'text';
  targetId: number;
  node?: DomNode;
  attributeName?: string;
  attributeValue?: string;
  oldValue?: string;
  text?: string;
}
