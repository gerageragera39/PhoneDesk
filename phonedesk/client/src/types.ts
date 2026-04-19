export type AppPlatform = "windows" | "linux" | "both";

export interface AppEntry {
  id: string;
  name: string;
  icon: string;
  executablePath: string;
  args?: string[];
  workingDirectory?: string;
  category?: string;
  sortOrder: number;
  platform: AppPlatform;
}

export interface AppDraft {
  name: string;
  icon: string;
  executablePath: string;
  args?: string[];
  workingDirectory?: string;
  category?: string;
  sortOrder?: number;
  platform?: AppPlatform;
}

export interface LaunchResult {
  success: boolean;
  action: "launched" | "focused" | "focus_failed" | "already_running" | "error";
  message: string;
  pid?: number;
}

export interface AppStatusSnapshot {
  [appId: string]: boolean;
}

export interface ApiErrorResponse {
  message: string;
  code?: string;
  details?: {
    retryAfterSeconds?: number;
    [key: string]: unknown;
  };
}
