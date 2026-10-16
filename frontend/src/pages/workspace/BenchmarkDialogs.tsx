import { useState } from "react";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  CheckCircle2,
  FlaskConical,
  Loader2,
  Target,
  XCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, errorText } from "@/lib/api";
import { ISSUE_LABEL } from "@/lib/labels";
import { invalidateTasks, parseAnnotationFile } from "@/lib/queries";
import { Field, inputClass } from "@/components/common";
import { cn } from "@/lib/utils";

interface GtEvent {
  type: string;
  frame: number;
  track_id: number;
  planted?: string;
  message?: string;
}
interface GtDoc {
  ground_truth: GtEvent[];
  baseline?: GtEvent[];
  tolerance?: number;
}
interface Score {
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
}
interface BenchResult extends Score {
  target_met: boolean;
  tolerance: number;
  by_type: Record<string, Score>;
  predicted: number;
  ground_truth: number;
  baseline_ignored: number;
  missed: GtEvent[];
  false_alarms: GtEvent[];
  absent_in_data: GtEvent[];
  note: string;
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const download = (name: string, data: unknown) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 1)], { type: "application/json" }),
  );
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
};

/** Annotator: copy this task with planted errors (the ground truth) — the source is not changed. */
export function MakeBenchmarkDialog({
  taskId,
  taskName,
  onOpenChange,
}: {
  taskId: string;
  taskName: string;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [counts, setCounts] = useState({ id_switch: 3, gap: 3, jump: 3 });
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const r = await api<{
        task_id: string;
        ground_truth: GtDoc & { seed: number };
      }>("benchmark/make", { id: taskId, ...counts });
      download(
        `gt_${taskName.replace(/[^\w-]+/g, "_").slice(0, 40)}_${r.ground_truth.seed}.json`,
        r.ground_truth,
      );
      invalidateTasks(qc);
      toast.success(
        `Đã tạo bộ thử với ${r.ground_truth.ground_truth.length} lỗi cấy vào — file GT đã tải về máy`,
        { duration: 7000 },
      );
      onOpenChange(false);
      navigate(`/tasks/${r.task_id}`);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const row = (k: keyof typeof counts, label: string, hint: string) => (
    <Field label={label} hint={hint}>
      <input
        type="number"
        min={0}
        max={20}
        value={counts[k]}
        onChange={(e) =>
          setCounts((c) => ({
            ...c,
            [k]: Math.max(0, Math.min(20, Number(e.target.value))),
          }))
        }
        className={inputClass}
      />
    </Field>
  );
  return (
    <Dialog open onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical size={18} className="text-primary" /> Tạo bộ thử (cấy
            lỗi)
          </DialogTitle>
          <DialogDescription>
            Tạo <b>bản sao</b> của task này rồi cấy lỗi đã biết vào bản sao. Lỗi
            cấy vào chính là đáp án (GT) — file GT tự tải về. Task gốc không bị
            đổi; bản sao không đẩy được lên CVAT.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-3">
          {row("id_switch", "Đổi ID", "Track đổi sang ID mới giữa chừng")}
          {row("gap", "Đứt quãng", "Xoá 2–3 frame liên tiếp")}
          {row("jump", "Box nhảy", "Đẩy 1 frame lệch ~3 lần cỡ box")}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Mỗi lỗi cấy vào một track khác nhau (cần track ≥ 12 frame liên tục).
          Lỗi có sẵn trong dữ liệu gốc được ghi thành “baseline” và không bị
          tính là báo nhầm.
        </p>
        <DialogFooter>
          <button
            type="button"
            className="secondary-action"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Huỷ
          </button>
          <button
            type="button"
            className="primary-action disabled:opacity-50"
            disabled={busy || counts.id_switch + counts.gap + counts.jump === 0}
            onClick={() => void run()}
          >
            {busy ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <FlaskConical size={15} />
            )}{" "}
            Tạo bộ thử
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Any role: score the stored task's QC issues against a ground-truth file. */
export function BenchmarkDialog({
  taskId,
  dirty,
  onJump,
  onOpenChange,
}: {
  taskId: string;
  dirty: boolean;
  onJump: (frame: number, track: number) => void;
  onOpenChange: (o: boolean) => void;
}) {
  const [doc, setDoc] = useState<GtDoc | null>(null);
  const [fileName, setFileName] = useState("");
  const [tolerance, setTolerance] = useState(2);
  const [onlyGtTypes, setOnlyGtTypes] = useState(true);
  const [result, setResult] = useState<BenchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [clean, setClean] = useState<{ name: string; boxes: unknown[] } | null>(
    null,
  );

  const loadClean = async (file: File) => {
    try {
      const p = await parseAnnotationFile(file);
      setClean({ name: file.name, boxes: p.boxes });
      setResult(null);
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const load = async (file: File) => {
    try {
      const raw = JSON.parse(await file.text());
      const d: GtDoc = Array.isArray(raw) ? { ground_truth: raw } : raw;
      if (!Array.isArray(d.ground_truth) || !d.ground_truth.length)
        throw new Error(
          "File GT cần mảng [{type, frame, track_id}] hoặc [{type, a, b, frame}] (truth.json)",
        );
      setDoc(d);
      setFileName(file.name);
      if (d.tolerance != null) setTolerance(d.tolerance);
      setResult(null);
    } catch (e) {
      toast.error(errorText(e));
    }
  };
  const run = async () => {
    if (!doc) return;
    setBusy(true);
    try {
      setResult(
        await api<BenchResult>("benchmark/evaluate", {
          id: taskId,
          ground_truth: doc.ground_truth,
          baseline: doc.baseline ?? [],
          baseline_boxes: clean?.boxes,
          tolerance,
          only_gt_types: onlyGtTypes,
        }),
      );
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const passP = (result?.precision ?? 0) >= 0.85;
  const passR = (result?.recall ?? 0) >= 0.8;
  const list = (title: string, items: GtEvent[], tone: string) =>
    items.length > 0 && (
      <div>
        <p className={cn("mb-1 text-xs font-semibold", tone)}>
          {title} ({items.length})
        </p>
        <div className="max-h-32 space-y-1 overflow-y-auto">
          {items.map((e, i) => (
            <button
              key={i}
              type="button"
              onClick={() => {
                onJump(e.frame, e.track_id);
                onOpenChange(false);
              }}
              className="flex w-full items-center gap-2 rounded-md border border-border px-2 py-1 text-left text-[11px] hover:bg-muted/60"
            >
              <span className="font-medium">
                {ISSUE_LABEL[e.type] ?? e.type}
              </span>
              <span className="text-muted-foreground">
                frame {e.frame} · track #{e.track_id}
                {e.planted && ` · cấy: ${e.planted}`}
              </span>
            </button>
          ))}
        </div>
      </div>
    );

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Target size={18} className="text-primary" /> Benchmark với Ground
            Truth
          </DialogTitle>
          <DialogDescription>
            So các lỗi tool tự quét được trên task (bản đã lưu) với danh sách
            lỗi thật. Khớp 1–1: cùng loại lỗi, cùng track (hoặc track đối ứng),
            lệch tối đa ±{tolerance} frame. Mục tiêu T021: Precision ≥ 85%,
            Recall ≥ 80%.
          </DialogDescription>
        </DialogHeader>
        {dirty && (
          <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-300">
            Có thay đổi chưa lưu — benchmark chạy trên bản đã lưu. Hãy Lưu
            trước.
          </p>
        )}
        <div className="grid grid-cols-[1fr_auto] items-end gap-3">
          <Field
            label="File GT (.json)"
            hint={
              fileName
                ? `${fileName}: ${doc?.ground_truth.length} lỗi thật${doc?.baseline?.length ? `, ${doc.baseline.length} lỗi baseline bỏ qua` : ""}`
                : "File do “Tạo bộ thử” xuất ra, hoặc truth.json của nhóm ({type, a, b, frame})"
            }
          >
            <input
              type="file"
              accept=".json"
              onChange={(e) =>
                e.target.files?.[0] && void load(e.target.files[0])
              }
              className={inputClass}
            />
          </Field>
          <Field label="Lệch cho phép" hint="± frame, nên để 2">
            <input
              type="number"
              min={0}
              max={10}
              value={tolerance}
              onChange={(e) => setTolerance(Number(e.target.value))}
              className={cn(inputClass, "w-20")}
            />
          </Field>
        </div>
        <Field
          label="Nhãn sạch của cùng video (tuỳ chọn, nên có)"
          hint={
            clean
              ? `${clean.name}: ${clean.boxes.length.toLocaleString("vi-VN")} box — cảnh báo tool cũng báo trên nhãn sạch sẽ không bị tính là báo nhầm`
              : "Ví dụ <video>.zip (bản chưa chèn lỗi). Không có thì mọi cảnh báo có sẵn trong nhãn gốc đều bị tính là báo nhầm (FP)."
          }
        >
          <input
            type="file"
            accept=".zip,.xml,.json,.txt,.csv"
            onChange={(e) =>
              e.target.files?.[0] && void loadClean(e.target.files[0])
            }
            className={inputClass}
          />
        </Field>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={onlyGtTypes}
            onChange={(e) => setOnlyGtTypes(e.target.checked)}
          />{" "}
          Chỉ tính các loại lỗi có trong GT (bỏ qua cảnh báo loại khác, ví dụ
          frame trống)
        </label>

        {result && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ["Precision", result.precision, passP, "báo đúng / tổng báo"],
                  ["Recall", result.recall, passR, "bắt được / tổng lỗi thật"],
                  ["F1", result.f1, passP && passR, ""],
                ] as const
              ).map(([label, v, ok, hint]) => (
                <div
                  key={label}
                  className={cn(
                    "rounded-xl border px-3 py-2",
                    ok
                      ? "border-emerald-500/40 bg-emerald-500/10"
                      : "border-amber-500/40 bg-amber-500/10",
                  )}
                >
                  <p className="text-[11px] text-muted-foreground">{label}</p>
                  <p className="text-xl font-semibold">{pct(v)}</p>
                  {hint && (
                    <p className="text-[10px] text-muted-foreground">{hint}</p>
                  )}
                </div>
              ))}
            </div>
            <p
              className={cn(
                "flex items-center gap-1.5 text-sm font-semibold",
                result.target_met ? "text-emerald-500" : "text-amber-500",
              )}
            >
              {result.target_met ? (
                <CheckCircle2 size={16} />
              ) : (
                <XCircle size={16} />
              )}
              {result.target_met
                ? "Đạt mục tiêu T021"
                : "Chưa đạt mục tiêu T021"}{" "}
              · TP {result.tp} · FP {result.fp} · FN {result.fn}
              <span className="font-normal text-muted-foreground">
                ({result.predicted} cảnh báo được tính
                {result.baseline_ignored
                  ? `, ${result.baseline_ignored} baseline bỏ qua`
                  : ""}
                )
              </span>
            </p>
            <table className="w-full text-xs">
              <thead className="text-left text-[10px] uppercase text-muted-foreground">
                <tr>
                  <th className="py-1">Loại lỗi</th>
                  <th>TP</th>
                  <th>FP</th>
                  <th>FN</th>
                  <th>Precision</th>
                  <th>Recall</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(result.by_type).map(([t, s]) => (
                  <tr key={t} className="border-t border-border">
                    <td className="py-1 font-medium">{ISSUE_LABEL[t] ?? t}</td>
                    <td>{s.tp}</td>
                    <td>{s.fp}</td>
                    <td>{s.fn}</td>
                    <td>{s.tp + s.fp ? pct(s.precision) : "—"}</td>
                    <td>{s.tp + s.fn ? pct(s.recall) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="grid gap-3 sm:grid-cols-2">
              {list(
                "Bỏ sót (FN) — bấm để xem",
                result.missed,
                "text-amber-600 dark:text-amber-300",
              )}
              {list(
                "Báo nhầm (FP) — bấm để xem",
                result.false_alarms,
                "text-red-500",
              )}
            </div>
            {result.absent_in_data.length > 0 && (
              <div className="rounded-lg bg-muted/60 px-3 py-2 text-[11px]">
                <p className="font-semibold">
                  GT ghi lỗi nhưng dữ liệu không có (
                  {result.absent_in_data.length}) — không tính vào điểm
                </p>
                <p className="text-muted-foreground">
                  {result.absent_in_data
                    .map(
                      (e) =>
                        `${e.planted ?? ISSUE_LABEL[e.type] ?? e.type} @ frame ${e.frame}`,
                    )
                    .join(" · ")}
                  . Track này chỉ có một class trong file — CVAT XML dạng track
                  giữ một nhãn cho cả track, nên lỗi đổi class không được ghi
                  vào file.
                </p>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          {result && (
            <button
              type="button"
              className="secondary-action"
              onClick={() => download("benchmark_result.json", result)}
            >
              Tải kết quả JSON
            </button>
          )}
          <button
            type="button"
            className="primary-action disabled:opacity-50"
            disabled={!doc || busy}
            onClick={() => void run()}
          >
            {busy ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Target size={15} />
            )}{" "}
            Chạy benchmark
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
