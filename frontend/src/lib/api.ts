/** Thin client for the T021 Python backend: JSON POST to /api/<path>, session in an HttpOnly cookie. */

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T = unknown>(path: string, body: unknown = {}): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `Lỗi HTTP ${res.status}`, res.status);
  return data as T;
}

/** Binary upload (video, frames.zip, annotation ZIP) — the backend reads the raw body. */
export async function upload<T = unknown>(path: string, file: File, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "X-T021-Filename": encodeURIComponent(file.name), ...headers },
    body: file,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `Tải lên lỗi HTTP ${res.status}`, res.status);
  return data as T;
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ── domain types (mirror backend/*.py) ───────────────────────────────────────

export type Role = "admin" | "annotator" | "reviewer";
export type TaskStatus = "annotating" | "in_review" | "needs_fix" | "done";
export type HandoffStatus = "needs_fix" | "fixed" | "verified" | "false_positive";

export interface User {
  username: string;
  role: Role;
  full_name?: string;
  email?: string;
  active?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface Group {
  id: string;
  name: string;
  description: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  task_count: number;
  status_counts: Partial<Record<TaskStatus, number>>;
}

export interface CvatLink {
  url: string;
  job_id: number;
  task_id: number;
  task_name?: string;
  start_frame: number;
  stop_frame: number;
  imported_at?: string;
  imported_by?: string;
  pushed_at?: string | null;
  pushed_by?: string;
  pushed_revision?: number;
}

/** A task (the backend calls it a "project"): one annotated video / sequence. */
export interface TaskSummary {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  source_name: string;
  box_count: number;
  media_kind: "none" | "video" | "zip" | "images" | "cvat";
  frame_count: number;
  group_id: string | null;
  annotator: string | null;
  reviewer: string | null;
  status: TaskStatus;
  created_by: string | null;
  cvat: CvatLink | null;
  revision: number;
  qc: Partial<Record<HandoffStatus, number>>;
}

export interface Box {
  uid: string;
  frame_id: number;
  track_id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  class_name: string;
  occluded?: boolean;
  keyframe?: boolean;
}

export interface TaskMeta {
  format?: string;
  mode?: "video" | "images";
  frame_base?: number;
  width?: number | null;
  height?: number | null;
  total_frames?: number | null;
  labels?: string[];
}

export interface Media {
  kind: TaskSummary["media_kind"];
  token?: string;
  job_id?: number;
}

export interface Handoff {
  issue_id: string;
  status: HandoffStatus;
  type: string;
  frame: number;
  track_id: number | null;
  message: string;
  note: string;
  updated_by: string;
  updated_at: string;
  history: { from: HandoffStatus | null; to: HandoffStatus; by: string; note: string; at: string }[];
}

export interface TaskDetail extends TaskSummary {
  state: {
    boxes?: Box[];
    meta?: TaskMeta;
    media?: Media;
    frame?: number;
    fps?: number;
    video_start?: number;
    video_step?: number;
    image_mapping?: string;
    source_name?: string;
  };
  tasks: Record<string, Handoff>;
  session: string;
}

export interface Issue {
  id: string;
  type: string;
  frame: number;
  track_id: number;
  message: string;
  severity: "high" | "medium" | "low";
  suggestion: string;
  fix_data: Record<string, unknown>;
  confidence?: number;
  /** Synthesised in the UI for handoffs whose issue no longer shows up after a fix. */
  archived?: boolean;
}

export interface ScanResult {
  issues: Issue[];
  counts: Record<string, number>;
  count: number;
  stats: { boxes: number; tracks: number; annotated_frames: number; first_frame: number; last_frame: number; high: number; medium: number; low: number };
  notes: string[];
}

export interface ParsedAnnotation {
  boxes: Box[];
  format: string;
  mode: "video" | "images";
  frame_base: number;
  width: number | null;
  height: number | null;
  total_frames: number | null;
  labels: string[];
  warnings?: string[];
  session?: string;
  source_name?: string;
}

export interface CvatJob {
  job_id: number;
  task_id: number;
  task_name: string;
  project_id: number | null;
  start_frame: number;
  stop_frame: number;
  frames: number;
  dimension: string;
  mode: string;
  state: string;
  stage: string;
  assignee: string | null;
  linked_tasks: { id: string; name: string }[];
}

export interface DashboardData {
  projects: number;
  tasks: number;
  by_status: Record<TaskStatus, number>;
  qc: Record<HandoffStatus, number>;
  boxes: number;
  frames: number;
  from_cvat: number;
  mine: number;
  todo: TaskSummary[];
  todo_count: number;
  recent: TaskSummary[];
  users?: Record<Role, number>;
  users_inactive?: number;
}
