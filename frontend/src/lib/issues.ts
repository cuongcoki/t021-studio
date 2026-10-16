import type { Handoff, Issue, ScanResult } from "./api";

/** Merges scan issues with stored handoffs (a fixed issue may no longer show up in the scan). */
export function mergeIssues(scan: ScanResult | null, handoffs: Record<string, Handoff>): Issue[] {
  const list = [...(scan?.issues ?? [])];
  const seen = new Set(list.map((i) => i.id));
  for (const [id, t] of Object.entries(handoffs)) {
    if (!seen.has(id)) {
      list.push({ id, type: t.type, frame: t.frame, track_id: t.track_id ?? -1, message: t.message || "Lỗi đã hết sau khi sửa — chờ Reviewer xác nhận", severity: "low", suggestion: "review", fix_data: {}, archived: true });
    }
  }
  return list;
}
