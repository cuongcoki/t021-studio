import { useState } from "react";
import { Check, CornerUpLeft, Crosshair, Flag, Loader2, ScanSearch, Send, ShieldCheck, Wand2, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Handoff, HandoffStatus, Issue, ScanResult } from "@/lib/api";
import { mergeIssues } from "@/lib/issues";
import { FIX_LABEL, HANDOFF_LABEL, ISSUE_LABEL, fmtDate } from "@/lib/labels";
import { inputClass } from "@/components/common";
import { cn } from "@/lib/utils";

const SEV_STYLE = {
  high: "border-l-red-500",
  medium: "border-l-amber-500",
  low: "border-l-sky-500",
} as const;

const FILTERS: [string, string][] = [
  ["open", "Cần xử lý"],
  ["all", "Tất cả"],
  ["needs_fix", "Cần Annotator sửa"],
  ["fixed", "Chờ Reviewer xác nhận"],
  ["high", "Mức cao"],
  ["Gap Frame", "Đứt quãng"],
  ["Box Jump", "Box nhảy"],
  ["ID Switch Candidate", "Nghi đổi ID"],
  ["Duplicate Track/Frame", "Trùng ID"],
  ["Duplicate Object Candidate", "Nghi trùng vật"],
  ["Class Change", "Đổi class"],
  ["Invalid Box", "Box lỗi"],
  ["Empty Frame Candidate", "Frame trống"],
];

const HEADING: Record<HandoffStatus, string> = {
  needs_fix: "Gửi lỗi cho Annotator",
  fixed: "Báo đã sửa · gửi lại QC",
  verified: "Xác nhận đã sửa xong",
  false_positive: "Đánh dấu không phải lỗi",
};

export function HandoffDialog({
  issue,
  status,
  onOpenChange,
  onSubmit,
}: {
  issue: Pick<Issue, "type" | "frame" | "track_id" | "message">;
  status: HandoffStatus;
  onOpenChange: (o: boolean) => void;
  onSubmit: (note: string) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const required = status === "needs_fix" || status === "fixed";
  return (
    <Dialog open onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{HEADING[status]}</DialogTitle>
          <DialogDescription>
            {ISSUE_LABEL[issue.type] ?? issue.type} · frame {issue.frame} · track {issue.track_id < 0 ? "—" : `#${issue.track_id}`}
          </DialogDescription>
        </DialogHeader>
        {issue.message && <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs">{issue.message}</p>}
        <textarea
          autoFocus
          rows={4}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={status === "needs_fix" ? "Mô tả lỗi và cần sửa gì (bắt buộc)" : status === "fixed" ? "Đã sửa gì (bắt buộc)" : "Ghi chú (không bắt buộc)"}
          className={inputClass}
        />
        <DialogFooter>
          <button type="button" className="secondary-action" onClick={() => onOpenChange(false)}>
            Huỷ
          </button>
          <button
            type="button"
            disabled={busy || (required && !note.trim())}
            onClick={async () => {
              setBusy(true);
              try {
                await onSubmit(note.trim());
                onOpenChange(false);
              } finally {
                setBusy(false);
              }
            }}
            className="primary-action disabled:opacity-50"
          >
            {busy && <Loader2 size={14} className="animate-spin" />} {HEADING[status]}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function IssuesPanel({
  scan,
  handoffs,
  role,
  inTask,
  scanning,
  selectedIssue,
  onScan,
  onOpen,
  onFix,
  onHandoff,
  onQuality,
}: {
  scan: ScanResult | null;
  handoffs: Record<string, Handoff>;
  role: string | undefined;
  /** False in the file preview: QC can't be stored there. */
  inTask: boolean;
  scanning: boolean;
  selectedIssue: string | null;
  onScan: () => void;
  onOpen: (i: Issue) => void;
  onFix: (i: Issue) => void;
  onHandoff: (i: Issue, status: HandoffStatus) => void;
  onQuality: () => void;
}) {
  const [filter, setFilter] = useState("open");
  const all = mergeIssues(scan, handoffs);
  const list = all.filter((i) => {
    const st = handoffs[i.id]?.status;
    if (filter === "all") return true;
    if (filter === "open") return !st || st === "needs_fix" || st === "fixed";
    if (filter === "needs_fix" || filter === "fixed") return st === filter;
    if (filter === "high") return i.severity === "high";
    return i.type === filter;
  });
  const reviewer = role === "reviewer";
  const annotator = role === "annotator";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b border-border p-2.5">
        <div className="flex gap-1.5">
          <button type="button" onClick={onScan} disabled={scanning} className="primary-action h-8 flex-1 justify-center px-2 text-xs disabled:opacity-60">
            {scanning ? <Loader2 size={13} className="animate-spin" /> : <ScanSearch size={13} />} {scan ? "Quét lại" : "Quét lỗi"}
          </button>
          {inTask && (
            <button type="button" onClick={onQuality} className="secondary-action h-8 px-2 text-xs" title="Quality Gate: 0 lỗi cấu trúc, 0 lỗi cao chưa xử lý, không còn yêu cầu sửa mở">
              <ShieldCheck size={13} /> Gate
            </button>
          )}
        </div>
        {scan && (
          <p className="text-[11px] text-muted-foreground">
            {scan.count} cảnh báo · <span className="text-red-500">{scan.stats.high} cao</span> · <span className="text-amber-500">{scan.stats.medium} vừa</span> ·{" "}
            <span className="text-sky-500">{scan.stats.low} thấp</span> · {scan.stats.tracks} track
          </p>
        )}
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className={cn(inputClass, "py-1 text-xs")}>
          {FILTERS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        {!inTask && <p className="text-[11px] text-amber-600 dark:text-amber-300">Xem nhanh: quét được nhưng không lưu QC. Mở task để gửi lỗi.</p>}
      </div>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2.5">
        {!scan && Object.keys(handoffs).length === 0 && (
          <p className="py-8 text-center text-xs text-muted-foreground">
            Bấm <b>Quét lỗi</b> để tìm Gap, Box Jump, nghi đổi ID, trùng box, đổi class…
          </p>
        )}
        {scan && list.length === 0 && <p className="py-8 text-center text-xs text-muted-foreground">Không có cảnh báo phù hợp bộ lọc.</p>}
        {list.slice(0, 300).map((i) => {
          const h = handoffs[i.id];
          const st = h?.status;
          return (
            <div
              key={i.id}
              role="button"
              tabIndex={0}
              onClick={() => onOpen(i)}
              onKeyDown={(e) => e.key === "Enter" && onOpen(i)}
              className={`cursor-pointer rounded-lg border border-l-4 border-border ${SEV_STYLE[i.severity]} px-2.5 py-2 text-xs transition hover:bg-muted/60 ${
                selectedIssue === i.id ? "bg-primary/10 ring-1 ring-primary/40" : ""
              } ${st === "verified" || st === "false_positive" ? "opacity-60" : ""}`}
            >
              <p className="flex items-center gap-1.5 font-semibold">
                {ISSUE_LABEL[i.type] ?? i.type}
                <span className="ml-auto font-normal text-muted-foreground">f{i.frame}</span>
              </p>
              <p className="text-[11px] text-muted-foreground">
                {i.track_id < 0 ? "không có track" : `track #${i.track_id}`}
                {i.confidence != null && ` · tin cậy ${Math.round(i.confidence * 100)}%`}
              </p>
              <p className="mt-0.5 leading-4">{i.message}</p>
              {st && (
                <p className="mt-1 inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">
                  {HANDOFF_LABEL[st]} · {h.updated_by} {fmtDate(h.updated_at)}
                </p>
              )}
              {h?.note && <p className="mt-1 rounded bg-muted/60 px-1.5 py-1 text-[11px] italic">“{h.note}”</p>}
              <div className="mt-1.5 flex flex-wrap gap-1" onClick={(e) => e.stopPropagation()}>
                <button type="button" onClick={() => onOpen(i)} className="action-chip">
                  <Crosshair size={11} /> Xem
                </button>
                {annotator && FIX_LABEL[i.suggestion] && !i.archived && (
                  <button type="button" onClick={() => onFix(i)} className="action-chip text-primary">
                    <Wand2 size={11} /> {FIX_LABEL[i.suggestion]}
                  </button>
                )}
                {inTask && reviewer && (!st || st === "needs_fix") && !i.archived && (
                  <button type="button" onClick={() => onHandoff(i, "needs_fix")} className="action-chip text-amber-600 dark:text-amber-300">
                    <Send size={11} /> {st ? "Nhắc sửa" : "Gửi Annotator"}
                  </button>
                )}
                {inTask && reviewer && !st && (
                  <button type="button" onClick={() => onHandoff(i, "false_positive")} className="action-chip">
                    <X size={11} /> Không phải lỗi
                  </button>
                )}
                {inTask && reviewer && st === "fixed" && (
                  <>
                    <button type="button" onClick={() => onHandoff(i, "verified")} className="action-chip text-emerald-600 dark:text-emerald-400">
                      <Check size={11} /> Xác nhận đã sửa
                    </button>
                    <button type="button" onClick={() => onHandoff(i, "needs_fix")} className="action-chip text-amber-600 dark:text-amber-300">
                      <CornerUpLeft size={11} /> Yêu cầu sửa tiếp
                    </button>
                  </>
                )}
                {inTask && annotator && st === "needs_fix" && (
                  <button type="button" onClick={() => onHandoff(i, "fixed")} className="action-chip text-violet-600 dark:text-violet-300">
                    <Flag size={11} /> Đã sửa · gửi lại QC
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {list.length > 300 && <p className="text-center text-[11px] text-muted-foreground">Hiển thị 300/{list.length} — lọc để xem thêm</p>}
      </div>
    </div>
  );
}
