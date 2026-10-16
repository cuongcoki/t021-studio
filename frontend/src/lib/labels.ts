import type { HandoffStatus, Role, TaskStatus } from "./api";

export const ROLE_LABEL: Record<Role, string> = { admin: "Admin", annotator: "Annotator", reviewer: "Reviewer" };

export const ROLE_HINT: Record<Role, string> = {
  admin: "Quản lý tài khoản, Project và giao task",
  annotator: "Tạo task, sửa box / Track ID, xuất và đẩy lên CVAT",
  reviewer: "QC, gửi lỗi cho Annotator, xác nhận — không sửa nhãn",
};

export const STATUS_LABEL: Record<TaskStatus, string> = {
  annotating: "Đang gán",
  in_review: "Chờ QC",
  needs_fix: "Cần sửa",
  done: "Hoàn tất",
};

export const STATUS_STYLE: Record<TaskStatus, string> = {
  annotating: "bg-sky-500/15 text-sky-600 dark:text-sky-300 border-sky-500/30",
  in_review: "bg-violet-500/15 text-violet-600 dark:text-violet-300 border-violet-500/30",
  needs_fix: "bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/30",
  done: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/30",
};

export const HANDOFF_LABEL: Record<HandoffStatus, string> = {
  needs_fix: "Cần Annotator sửa",
  fixed: "Đã sửa · chờ QC",
  verified: "Reviewer đã xác nhận",
  false_positive: "Không phải lỗi",
};

export const ISSUE_LABEL: Record<string, string> = {
  "Gap Frame": "Đứt quãng (Gap)",
  "Box Jump": "Box nhảy",
  "ID Switch Candidate": "Nghi đổi ID",
  "Invalid Box": "Box không hợp lệ",
  "Duplicate Track/Frame": "Trùng ID trong frame",
  "Duplicate Object Candidate": "Nghi trùng vật",
  "Class Change": "Track đổi class",
  "Empty Frame Candidate": "Frame trống",
  Manual: "Reviewer báo thủ công",
};

export const FIX_LABEL: Record<string, string> = {
  stitch_ids: "Nối ID",
  swap_ids: "Hoán đổi ID",
  remove_exact_duplicates: "Xoá box trùng",
  set_class: "Thống nhất class",
  interpolate_gap: "Nội suy frame thiếu",
};

export const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" }) : "—";

/** Stable, readable color per track id. */
export const trackColor = (t: number) => {
  const palette = ["#3b9eff", "#20c9a6", "#f6b445", "#d97cf6", "#6fd35a", "#f87171", "#8b9cff", "#f472b6", "#2dd4bf", "#facc15"];
  return t < 0 ? "#94a3b8" : palette[(Math.abs(t) * 7) % palette.length];
};
