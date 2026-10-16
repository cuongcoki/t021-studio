import { useQuery, type QueryClient } from "@tanstack/react-query";
import { api, upload, type Group, type ParsedAnnotation, type TaskStatus, type TaskSummary, type User } from "./api";

export const useGroups = () =>
  useQuery({ queryKey: ["groups"], queryFn: () => api<{ groups: Group[] }>("groups/list").then((r) => r.groups) });

export const useTasks = () =>
  useQuery({ queryKey: ["tasks"], queryFn: () => api<{ projects: TaskSummary[] }>("projects/list").then((r) => r.projects) });

/** Active accounts that can be assigned (any signed-in user may read this). */
export const usePeople = () =>
  useQuery({ queryKey: ["people"], queryFn: () => api<{ users: User[] }>("auth/people").then((r) => r.users) });

export function invalidateTasks(qc: QueryClient) {
  for (const key of ["tasks", "groups", "dashboard", "task"]) void qc.invalidateQueries({ queryKey: [key] });
}

/** Which statuses each role may move a task to (mirrors backend projects.update_meta). */
export const STATUS_BY_ROLE: Record<string, TaskStatus[]> = {
  admin: ["annotating", "in_review", "needs_fix", "done"],
  annotator: ["annotating", "in_review"],
  reviewer: ["needs_fix", "done"],
};

/** Annotation file -> parsed boxes (a ZIP goes through the archive importer). */
export async function parseAnnotationFile(file: File): Promise<ParsedAnnotation> {
  if (file.name.toLowerCase().endsWith(".zip")) return upload<ParsedAnnotation>("annotation/import", file, { "Content-Type": "application/zip" });
  return api<ParsedAnnotation>("parse", { filename: file.name, content: await file.text() });
}

/** Optional media for a file task: frames.zip or a video (decoded by FFmpeg on the server). */
export async function uploadMedia(file: File, frameCount?: number | null) {
  if (file.name.toLowerCase().endsWith(".zip")) {
    const r = await upload<{ token: string; count: number; warnings: string[] }>("media/upload-zip", file, {
      "Content-Type": "application/zip",
      "X-T021-Frame-Count": frameCount ? String(frameCount) : "",
    });
    return { media: { kind: "zip" as const, token: r.token }, note: `${r.count} ảnh`, warnings: r.warnings };
  }
  const r = await upload<{ token: string; frame_count: number; width: number; height: number }>("video/upload", file, {
    "Content-Type": "application/octet-stream",
  });
  return { media: { kind: "video" as const, token: r.token }, note: `${r.frame_count} frame ${r.width}×${r.height}`, warnings: [] as string[] };
}
