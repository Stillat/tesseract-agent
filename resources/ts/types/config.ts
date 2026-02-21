import type { AppInfo, AgentPaths } from './messages';

export interface AgentConfig {
  ws_url: string;
  project_id: string;
  app_id: string;
  origin: string;
  app_info: AppInfo;
  paths: AgentPaths;
  script_url?: string;
  ui?: UIConfig;
}

export interface UIConfig {
  defaultPosition?: {
    right: number;
    bottom: number;
  };
  buttonZIndex?: number;
  enableEval?: boolean;
}
