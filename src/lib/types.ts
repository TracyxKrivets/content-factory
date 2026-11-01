// Shared domain types. UI, pipeline and providers all speak these.

export type Capability = "llm" | "voice" | "image" | "music" | "captions";

export const STEPS = [
  "script",
  "script_check",
  "scenes",
  "voice",
  "visuals",
  "music",
  "captions",
  "assemble",
  "final_check",
] as const;
export type StepName = (typeof STEPS)[number];

export type StepStatus = "waiting" | "working" | "done" | "error" | "skipped";

/** The five friendly "workers" shown in the UI. Each groups pipeline steps. */
export type WorkerName = "writer" | "voice" | "visuals" | "captions" | "editor";
export const WORKER_STEPS: Record<WorkerName, StepName[]> = {
  writer: ["script", "script_check", "scenes"],
  voice: ["voice"],
  visuals: ["visuals"],
  captions: ["captions"],
  editor: ["music", "assemble", "final_check"],
};

export type ErrorCode =
  | "missing_key"
  | "auth"
  | "rate_limit"
  | "quota"
  | "timeout"
  | "network"
  | "bad_output"
  | "content_blocked"
  | "render_failed"
  | "missing_asset"
  | "quality_failed"
  | "unknown";

export interface FriendlyError {
  code: ErrorCode;
  message: string; // plain English, short
  suggestion: string;
  technical: string; // hidden under "Advanced"
  canSkip: boolean;
  canBackup: boolean;
  provider?: string;
  at: string;
}

export interface StepState {
  status: StepStatus;
  attempts: number;
  provider?: string;
  output?: any;
  error?: FriendlyError;
  cost?: number;
  updatedAt?: string;
  /** set by "Use backup": skip this provider next run */
  avoidProviders?: string[];
  /** bumped on "regenerate" so cached results are bypassed */
  seed?: number;
}

export interface Script {
  title: string;
  hook: string;
  lines: string[]; // narration, one beat per line; first line is the hook
  caption: string; // social caption
  hashtags: string[];
}

export interface Scene {
  text: string;
  visual: string; // image prompt
  search: string; // 2-4 keywords for stock search
}

export type CaptionStyle = "bold-yellow" | "clean-white" | "horror-red" | "glitch";

export interface Format {
  id: string;
  userId: string;
  name: string;
  emoji: string;
  description: string;
  hookStyle: string;
  structure: string;
  visualStyle: string;
  voiceStyle: string;
  captionStyle: CaptionStyle;
  musicStyle: "none" | "dark-drone" | "tense-pulse" | "eerie-tone";
  lengthSec: number;
  isDefault: boolean;
  isStarter: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSettings {
  count: number;
  lengthSec: number;
  language: string;
  providers?: Partial<Record<Capability, string>>;
  /** providers the user switched away from with "Use backup" */
  avoidProviders?: string[];
}

export type ProjectStatus = "planning" | "generating" | "done" | "needs_attention";

export interface Project {
  id: string;
  userId: string;
  title: string;
  request: string;
  formatId: string | null;
  format: Format; // snapshot so later edits to the format don't break the project
  settings: ProjectSettings;
  status: ProjectStatus;
  ideas: { title: string; angle: string }[];
  ideaError?: FriendlyError;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type VideoStatus = "queued" | "working" | "done" | "needs_attention";

export interface Video {
  id: string;
  projectId: string;
  userId: string;
  index: number;
  title: string;
  idea: string;
  angle?: string;
  status: VideoStatus;
  steps: Record<StepName, StepState>;
  createdAt: string;
  updatedAt: string;
}

export type JobStatus = "queued" | "running" | "done" | "error";
export interface Job {
  id: string;
  userId: string;
  projectId: string;
  videoId: string | null;
  kind: "ideas" | "video";
  status: JobStatus;
  attempts: number;
  lockedAt: string | null;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ErrorLog {
  id: string;
  userId: string;
  projectId: string | null;
  videoId: string | null;
  step: StepName | "ideas" | "system" | null;
  error: FriendlyError;
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UsageRow {
  id: string;
  userId: string;
  projectId: string | null;
  videoId: string | null;
  capability: Capability | "render";
  provider: string;
  model?: string;
  units: number; // tokens, characters, images, seconds
  cost: number; // USD estimate
  cached: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface HistoryRow {
  id: string;
  userId: string;
  projectId: string;
  videoId: string | null;
  event: string; // "created", "step_done", "regenerated", "edited", ...
  detail?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CacheRow {
  id: string; // hash key
  userId: string;
  value: any;
  createdAt: string;
  updatedAt: string;
}

export interface SettingsRow {
  id: string; // "app"
  userId: string;
  providerOrder: Partial<Record<Capability, string[]>>;
  createdAt: string;
  updatedAt: string;
}

export interface TableMap {
  projects: Project;
  videos: Video;
  formats: Format;
  jobs: Job;
  errors: ErrorLog;
  usage: UsageRow;
  history: HistoryRow;
  cache: CacheRow;
  settings: SettingsRow;
}
export type TableName = keyof TableMap;
