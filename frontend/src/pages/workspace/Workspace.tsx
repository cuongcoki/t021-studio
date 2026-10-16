import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  ArrowLeft,
  CloudUpload,
  Download,
  FileUp,
  Film,
  Keyboard,
  Loader2,
  Maximize,
  MousePointer2,
  MoreHorizontal,
  Redo2,
  Save,
  Send,
  ShieldCheck,
  Square,
  Undo2,
  BadgeCheck,
  FlaskConical,
  Target,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  api,
  errorText,
  type Box,
  type Handoff,
  type HandoffStatus,
  type Issue,
  type Media,
  type ScanResult,
  type TaskDetail,
  type TaskMeta,
} from "@/lib/api";
import { usePermissions } from "@/lib/useAuth";
import { ISSUE_LABEL } from "@/lib/labels";
import { StatusBadge } from "@/components/common";
import BoxCanvas, {
  type BoxCanvasHandle,
  type CanvasTool,
  type Rect,
} from "./BoxCanvas";
import Timeline from "./Timeline";
import IssuesPanel, { HandoffDialog } from "./IssuesPanel";
import { ObjectsPanel, TracksPanel, type TrackInfo } from "./ObjectsPanel";
import {
  invalidateTasks,
  parseAnnotationFile,
  uploadMedia,
} from "@/lib/queries";
import { mergeIssues } from "@/lib/issues";
import { PushCvatDialog } from "../tasks/TaskDialogs";
import { BenchmarkDialog, MakeBenchmarkDialog } from "./BenchmarkDialogs";

export interface WorkspaceData {
  boxes: Box[];
  meta: TaskMeta;
  media: Media;
  sourceName: string;
  videoStart?: number;
  videoStep?: number;
  frame?: number;
  session?: string;
}

const UNDO_LIMIT = 30;

function frameUrl(
  task: TaskDetail | undefined,
  media: Media,
  meta: TaskMeta,
  frame: number,
  videoStart: number,
  videoStep: number,
): string | null {
  const base = meta.frame_base ?? 0;
  if (media.kind === "cvat" && task)
    return `/api/cvat/frame/${task.id}/${frame}`;
  if (media.kind === "video" && media.token)
    return `/api/video/${encodeURIComponent(media.token)}/frame/${videoStart + (frame - base) * videoStep}`;
  if (media.kind === "zip" && media.token)
    return `/api/media/${encodeURIComponent(media.token)}/${frame - base}`;
  return null;
}

/**
 * The annotation / QC workspace. `task` = a stored task (save, QC handoffs, push); without it the
 * workspace is a read-only file preview (scan only).
 */
export default function Workspace({
  task,
  initial,
}: {
  task?: TaskDetail;
  initial: WorkspaceData;
}) {
  const qc = useQueryClient();
  const { role, canEdit, canReview } = usePermissions();
  const inTask = !!task;
  const editable = canEdit && inTask;
  const canvas = useRef<BoxCanvasHandle>(null);

  const [boxes, setBoxes] = useState<Box[]>(initial.boxes);
  const [meta, setMeta] = useState<TaskMeta>(initial.meta);
  const [media, setMedia] = useState<Media>(initial.media);
  const [videoStart, setVideoStart] = useState(initial.videoStart ?? 0);
  const [videoStep, setVideoStep] = useState(initial.videoStep ?? 1);
  const [sourceName, setSourceName] = useState(initial.sourceName);
  const [undo, setUndo] = useState<Box[][]>([]);
  const [redo, setRedo] = useState<Box[][]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [tool, setTool] = useState<CanvasTool>("select");
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [handoffs, setHandoffs] = useState<Record<string, Handoff>>(
    task?.tasks ?? {},
  );
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const [side, setSide] = useState<"objects" | "issues" | "tracks">(
    canReview ? "issues" : "objects",
  );
  const [handoff, setHandoff] = useState<{
    issue: Issue;
    status: HandoffStatus;
  } | null>(null);
  const [gate, setGate] = useState<Record<string, unknown> | null>(null);
  const [pushing, setPushing] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const [bench, setBench] = useState<"run" | "make" | null>(null);
  const lastClass = useRef<string>(
    initial.meta.labels?.[0] ?? initial.boxes[0]?.class_name ?? "car",
  );

  // ── derived ──────────────────────────────────────────────────────────────
  const byFrame = useMemo(() => {
    const m = new Map<number, Box[]>();
    for (const b of boxes)
      (m.get(b.frame_id) ?? m.set(b.frame_id, []).get(b.frame_id)!).push(b);
    return m;
  }, [boxes]);
  const bounds = useMemo(() => {
    const base = meta.frame_base ?? 0;
    const frames = [...byFrame.keys()];
    const lo = Math.min(base, ...(frames.length ? frames : [base]));
    const hi = Math.max(
      meta.total_frames ? base + meta.total_frames - 1 : base,
      ...(frames.length ? frames : [base]),
    );
    return { start: lo, end: hi };
  }, [byFrame, meta.frame_base, meta.total_frames]);
  const [frame, setFrameState] = useState(
    () =>
      initial.frame ??
      (boxes.length
        ? Math.min(...boxes.map((b) => b.frame_id))
        : (meta.frame_base ?? 0)),
  );
  const setFrame = useCallback(
    (f: number) =>
      setFrameState(
        Math.max(bounds.start, Math.min(bounds.end, Math.round(f))),
      ),
    [bounds],
  );
  const width = meta.width || 1920;
  const height = meta.height || 1080;
  const frameBoxes = useMemo(
    () =>
      (byFrame.get(frame) ?? [])
        .slice()
        .sort((a, b) => a.track_id - b.track_id),
    [byFrame, frame],
  );
  const selected = boxes.find((b) => b.uid === selectedUid) ?? null;
  const tracks = useMemo<TrackInfo[]>(() => {
    const t = new Map<number, TrackInfo>();
    for (const b of boxes) {
      const cur = t.get(b.track_id);
      if (!cur)
        t.set(b.track_id, {
          id: b.track_id,
          class_name: b.class_name,
          first: b.frame_id,
          last: b.frame_id,
          count: 1,
        });
      else
        Object.assign(cur, {
          first: Math.min(cur.first, b.frame_id),
          last: Math.max(cur.last, b.frame_id),
          count: cur.count + 1,
        });
    }
    return [...t.values()].sort((a, b) => a.id - b.id);
  }, [boxes]);
  const labels = useMemo(
    () => [
      ...new Set([...(meta.labels ?? []), ...boxes.map((b) => b.class_name)]),
    ],
    [meta.labels, boxes],
  );
  const issues = useMemo(() => mergeIssues(scan, handoffs), [scan, handoffs]);
  const url = frameUrl(task, media, meta, frame, videoStart, videoStep);
  const highlight = useMemo(() => {
    if (!selectedIssue || selectedIssue.frame !== frame) return undefined;
    const pair = (selectedIssue.fix_data?.pair as number[] | undefined) ?? [];
    return new Set([selectedIssue.track_id, ...pair]);
  }, [selectedIssue, frame]);

  // MOT files carry no image size: take it from the first frame that loads (CVAT/XML tasks already have it).
  const needsSize = !meta.width || !meta.height;
  const learnSize = useCallback(
    (w: number, h: number) => {
      if (!needsSize) return;
      setMeta((m) => ({ ...m, width: w, height: h }));
      if (editable) setDirty(true);
    },
    [needsSize, editable],
  );

  // Prefetch the next frames so scrubbing / playing is smooth.
  useEffect(() => {
    for (let k = 1; k <= 3; k++) {
      const next = frameUrl(
        task,
        media,
        meta,
        frame + k,
        videoStart,
        videoStep,
      );
      if (next && frame + k <= bounds.end) new Image().src = next;
    }
  }, [task, media, meta, frame, videoStart, videoStep, bounds.end]);

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // ── edits (validated by the backend: conflicts, invalid geometry) ─────────
  const replaceBoxes = (next: Box[]) => {
    setUndo((u) => [...u.slice(-UNDO_LIMIT + 1), boxes]);
    setRedo([]);
    setBoxes(next);
    setDirty(true);
  };

  const fix = async (
    action: string,
    data: Record<string, unknown>,
    done?: string,
  ): Promise<Box[] | undefined> => {
    if (!editable) {
      toast.error("Chỉ Annotator được sửa annotation.");
      return undefined;
    }
    setBusy("fix");
    try {
      const r = await api<{ boxes: Box[] }>("fix", {
        boxes,
        action,
        data,
        session: task?.session,
      });
      replaceBoxes(r.boxes);
      if (done) toast.success(done);
      return r.boxes;
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const onChangeRect = (uid: string, r: Rect) =>
    void fix("update_box", {
      uid,
      x: round(r.x),
      y: round(r.y),
      w: round(r.w),
      h: round(r.h),
    });
  const onCreate = async (r: Rect) => {
    const nextId = Math.max(0, ...boxes.map((b) => b.track_id)) + 1;
    const next = await fix(
      "create_box",
      {
        frame_id: frame,
        track_id: nextId,
        x: round(r.x),
        y: round(r.y),
        w: round(r.w),
        h: round(r.h),
        class_name: lastClass.current,
      },
      `Đã thêm box track #${nextId}`,
    );
    const made = next?.find(
      (b) => b.frame_id === frame && b.track_id === nextId,
    );
    if (made) setSelectedUid(made.uid);
    setTool("select");
  };
  const onUpdate = (f: Partial<Box>) => {
    if (!selected) return;
    if (f.class_name) lastClass.current = f.class_name;
    void fix("update_box", { uid: selected.uid, ...f }, "Đã cập nhật box");
  };
  const onDelete = () => {
    if (!selected) return;
    void fix("delete_box", { uid: selected.uid }, "Đã xoá box");
    setSelectedUid(null);
  };

  const doUndo = () => {
    if (!undo.length) return;
    setRedo((r) => [...r, boxes]);
    setBoxes(undo[undo.length - 1]);
    setUndo((u) => u.slice(0, -1));
    setDirty(true);
  };
  const doRedo = () => {
    if (!redo.length) return;
    setUndo((u) => [...u, boxes]);
    setBoxes(redo[redo.length - 1]);
    setRedo((r) => r.slice(0, -1));
    setDirty(true);
  };

  // ── task actions ─────────────────────────────────────────────────────────
  const save = async (silent = false) => {
    if (!task || !editable) return;
    setBusy("save");
    try {
      await api("projects/save", {
        id: task.id,
        // MOT has no frame count: store the annotated range so lists / dashboard show it.
        state: {
          boxes,
          meta: {
            ...meta,
            total_frames: meta.total_frames ?? bounds.end - bounds.start + 1,
          },
          media,
          source_name: sourceName,
          frame,
          fps: 30,
          video_start: videoStart,
          video_step: videoStep,
          image_mapping: "sequence",
        },
      });
      setDirty(false);
      invalidateTasks(qc);
      if (!silent) toast.success("Đã lưu task");
    } catch (e) {
      toast.error(errorText(e));
      throw e;
    } finally {
      setBusy(null);
    }
  };

  const runScan = async () => {
    if (!boxes.length) return toast.error("Chưa có box để quét.");
    setBusy("scan");
    try {
      const r = await api<ScanResult>("validate", {
        boxes,
        width: meta.width,
        height: meta.height,
        mode: meta.mode ?? "video",
        total_frames: meta.total_frames,
        frame_base: meta.frame_base,
      });
      setScan(r);
      setSide("issues");
      toast.success(
        `Quét xong: ${r.count} cảnh báo trên ${r.stats.tracks} track`,
      );
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const openIssue = (i: Issue) => {
    setSelectedIssue(i);
    setFrame(i.frame);
    const b = (byFrame.get(i.frame) ?? []).find(
      (x) => x.track_id === i.track_id,
    );
    if (b) {
      setSelectedUid(b.uid);
      canvas.current?.focus(b);
    }
  };

  const applyIssueFix = (i: Issue) => {
    const p = i.fix_data ?? {};
    const data =
      i.suggestion === "remove_exact_duplicates"
        ? { frame_id: i.frame, track_id: i.track_id }
        : i.suggestion === "stitch_ids"
          ? { source: p.source, target: p.target, from_frame: p.from_frame }
          : i.suggestion === "swap_ids"
            ? { a: p.a, b: p.b, from_frame: p.from_frame }
            : i.suggestion === "set_class"
              ? { track_id: p.track_id, class_name: p.class_name }
              : {
                  track_id: p.track_id,
                  from_frame: p.from_frame,
                  to_frame: p.to_frame,
                };
    void fix(
      i.suggestion,
      data,
      `Đã áp dụng: ${ISSUE_LABEL[i.type] ?? i.type}. Bấm Quét lại để kiểm tra.`,
    );
  };

  const submitHandoff = async (
    i: Issue,
    status: HandoffStatus,
    note: string,
  ) => {
    if (!task) return;
    try {
      if (status === "fixed" && dirty) await save(true);
      const r = await api<{ tasks: Record<string, Handoff> }>(
        "workflow/transition",
        {
          project_id: task.id,
          issue_id: i.id,
          status,
          note,
          issue: {
            type: i.type,
            frame: i.frame,
            track_id: i.track_id,
            message: i.message,
          },
        },
      );
      setHandoffs(r.tasks);
      invalidateTasks(qc);
      toast.success(
        status === "needs_fix"
          ? "Đã gửi lỗi cho Annotator"
          : status === "fixed"
            ? "Đã báo sửa xong, chờ Reviewer"
            : "Đã lưu kết quả QC",
      );
    } catch (e) {
      toast.error(errorText(e));
      throw e;
    }
  };

  /** Reviewer: an error the rules didn't flag, reported on the selected box / current frame. */
  const reportManual = () => {
    const b = selected;
    setHandoff({
      status: "needs_fix",
      issue: {
        id: `manual:${frame}:${b?.track_id ?? -1}:${Date.now().toString(36)}`,
        type: "Manual",
        frame,
        track_id: b?.track_id ?? -1,
        message: b ? `Box ${b.class_name} #${b.track_id}` : "",
        severity: "medium",
        suggestion: "review",
        fix_data: {},
      },
    });
  };

  const setStatus = async (status: "in_review" | "done") => {
    if (!task) return;
    try {
      if (status === "in_review" && dirty) await save(true);
      await api("projects/update", { id: task.id, status });
      invalidateTasks(qc);
      toast.success(
        status === "in_review"
          ? "Đã gửi task sang QC"
          : "Đã duyệt task hoàn tất",
      );
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const quality = async () => {
    try {
      setGate(
        await api<Record<string, unknown>>(
          "quality",
          task ? { project_id: task.id } : { boxes, ...meta },
        ),
      );
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const exportAs = async (format: "cvat" | "mot" | "json") => {
    try {
      const r = await api<{
        filename: string;
        content?: string;
        data?: unknown;
        labels?: string;
      }>("export", { boxes, ...meta, labels, format });
      const text = r.content ?? JSON.stringify(r.data, null, 1);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(
        new Blob([text], { type: "text/plain;charset=utf-8" }),
      );
      a.download = r.filename;
      a.click();
      URL.revokeObjectURL(a.href);
      if (format === "mot" && r.labels)
        toast("labels.txt cho MOT: " + r.labels.trim().split("\n").join(", "));
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const fileInput = useRef<HTMLInputElement>(null);
  const mediaInput = useRef<HTMLInputElement>(null);
  const importAnnotation = async (file: File) => {
    setBusy("import");
    try {
      const p = await parseAnnotationFile(file);
      replaceBoxes(p.boxes);
      setMeta({
        format: p.format,
        mode: p.mode,
        frame_base: p.frame_base,
        width: p.width ?? meta.width,
        height: p.height ?? meta.height,
        total_frames: p.total_frames ?? meta.total_frames,
        labels: p.labels,
      });
      setSourceName(file.name);
      setScan(null);
      (p.warnings ?? []).forEach((w) => toast(w, { icon: "⚠️" }));
      toast.success(
        `Đã nạp ${p.boxes.length.toLocaleString("vi-VN")} box từ ${file.name} — nhớ Lưu`,
      );
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const attachMedia = async (file: File) => {
    setBusy("media");
    try {
      const m = await uploadMedia(file, meta.total_frames);
      setMedia(m.media);
      setDirty(true);
      m.warnings.forEach((w) => toast(w, { icon: "⚠️" }));
      toast.success(`Đã gắn ${m.note} — nhớ Lưu`);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  // ── keyboard ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      )
        return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === "s") {
        e.preventDefault();
        void save();
      } else if ((e.ctrlKey || e.metaKey) && k === "z") {
        e.preventDefault();
        if (e.shiftKey) doRedo();
        else doUndo();
      } else if ((e.ctrlKey || e.metaKey) && k === "y") {
        e.preventDefault();
        doRedo();
      } else if (k === "v") setTool("select");
      else if (k === "n" && editable) setTool("draw");
      else if (k === "f") canvas.current?.fit();
      else if (k === "escape") {
        setSelectedUid(null);
        setTool("select");
      } else if ((k === "delete" || k === "backspace") && editable && selected)
        onDelete();
      else if (k === "?") setShowKeys(true);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  const railBtn = (active: boolean) =>
    `flex h-9 w-9 items-center justify-center rounded-lg ${active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`;
  const statusKey = task?.status ?? "annotating";

  return (
    <div className="flex h-full flex-col gap-2 p-3">
      {/* top bar */}
      <div className="surface flex flex-wrap items-center gap-2 px-3 py-2">
        <Link
          to="/tasks"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
          title="Về danh sách task"
        >
          <ArrowLeft size={16} />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 truncate text-sm font-semibold">
            {task?.name ?? "Xem nhanh file"}{" "}
            {task && <StatusBadge status={statusKey} />}
            {dirty && (
              <span className="rounded bg-amber-500/15 px-1.5 text-[10px] font-medium text-amber-600 dark:text-amber-300">
                chưa lưu
              </span>
            )}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {sourceName || "chưa có nhãn"} ·{" "}
            {boxes.length.toLocaleString("vi-VN")} box ·{" "}
            {tracks.filter((t) => t.id >= 0).length} track · {width}×{height}
            {task?.cvat && ` · CVAT job #${task.cvat.job_id}`}
            {!editable &&
              (canReview
                ? " · Reviewer: chỉ QC, không sửa nhãn"
                : " · chỉ xem")}
          </p>
        </div>
        {busy && (
          <Loader2 size={15} className="animate-spin text-muted-foreground" />
        )}
        {editable && (
          <button
            type="button"
            onClick={() => void save()}
            disabled={!dirty || busy === "save"}
            className="primary-action h-8 px-3 text-xs disabled:opacity-50"
            title="Lưu (Ctrl+S)"
          >
            <Save size={14} /> Lưu
          </button>
        )}
        {inTask &&
          canEdit &&
          (statusKey === "annotating" || statusKey === "needs_fix") && (
            <button
              type="button"
              onClick={() => void setStatus("in_review")}
              className="secondary-action h-8 px-3 text-xs"
              title="Lưu và chuyển task sang Chờ QC"
            >
              <Send size={14} /> Gửi QC
            </button>
          )}
        {inTask && canReview && statusKey === "in_review" && (
          <button
            type="button"
            onClick={() => void setStatus("done")}
            className="secondary-action h-8 px-3 text-xs text-emerald-600 dark:text-emerald-400"
            title="Duyệt hoàn tất (khi không còn lỗi QC mở)"
          >
            <BadgeCheck size={14} /> Duyệt xong
          </button>
        )}
        {editable && task?.cvat && (
          <button
            type="button"
            onClick={() => setPushing(true)}
            className="secondary-action h-8 px-3 text-xs"
            title="Đẩy nhãn về job CVAT đã liên kết"
          >
            <CloudUpload size={14} /> Đẩy CVAT
          </button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="secondary-action h-8 px-2"
              aria-label="Thêm thao tác"
            >
              <MoreHorizontal size={15} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuItem onSelect={() => void quality()}>
              <ShieldCheck size={14} /> Quality Gate
            </DropdownMenuItem>
            {inTask && (
              <DropdownMenuItem onSelect={() => setBench("run")}>
                <Target size={14} /> Benchmark với GT (Precision / Recall)
              </DropdownMenuItem>
            )}
            {inTask && canEdit && (
              <DropdownMenuItem onSelect={() => setBench("make")}>
                <FlaskConical size={14} /> Tạo bộ thử cấy lỗi (ra file GT)
              </DropdownMenuItem>
            )}
            {canEdit && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-[11px]">
                  Xuất annotation
                </DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => void exportAs("cvat")}>
                  <Download size={14} /> CVAT for video XML
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void exportAs("mot")}>
                  <Download size={14} /> MOT TXT
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void exportAs("json")}>
                  <Download size={14} /> JSON
                </DropdownMenuItem>
              </>
            )}
            {editable && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => fileInput.current?.click()}>
                  <FileUp size={14} /> Import nhãn từ file (thay nhãn hiện tại)
                </DropdownMenuItem>
                {media.kind !== "cvat" && (
                  <DropdownMenuItem
                    onSelect={() => mediaInput.current?.click()}
                  >
                    <Film size={14} /> Gắn ảnh / video (frames.zip, MP4…)
                  </DropdownMenuItem>
                )}
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setShowKeys(true)}>
              <Keyboard size={14} /> Phím tắt
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <input
          ref={fileInput}
          type="file"
          hidden
          accept=".xml,.txt,.csv,.mot,.json,.zip"
          onChange={(e) =>
            e.target.files?.[0] && void importAnnotation(e.target.files[0])
          }
        />
        <input
          ref={mediaInput}
          type="file"
          hidden
          accept=".zip,video/*,.mkv,.avi"
          onChange={(e) =>
            e.target.files?.[0] && void attachMedia(e.target.files[0])
          }
        />
      </div>

      {media.kind === "video" && editable && (
        <div className="surface flex items-center gap-3 px-3 py-1.5 text-xs">
          <Film size={13} className="text-muted-foreground" /> Ghép frame video:
          <label className="flex items-center gap-1">
            start{" "}
            <input
              type="number"
              min={0}
              value={videoStart}
              onChange={(e) => (
                setVideoStart(Math.max(0, Number(e.target.value))),
                setDirty(true)
              )}
              className="w-16 rounded border border-input bg-background px-1.5 py-0.5"
            />
          </label>
          <label className="flex items-center gap-1">
            step{" "}
            <input
              type="number"
              min={1}
              value={videoStep}
              onChange={(e) => (
                setVideoStep(Math.max(1, Number(e.target.value))),
                setDirty(true)
              )}
              className="w-14 rounded border border-input bg-background px-1.5 py-0.5"
            />
          </label>
          <span className="text-muted-foreground">
            frame nguồn = start + (frame − {meta.frame_base ?? 0}) × step
          </span>
        </div>
      )}

      {/* canvas + side panel */}
      <div className="flex min-h-0 flex-1 gap-2">
        <div className="relative min-w-0 flex-1">
          <BoxCanvas
            ref={canvas}
            imageUrl={url}
            width={width}
            height={height}
            boxes={frameBoxes}
            selectedUid={selectedUid}
            editable={editable && busy !== "fix"}
            tool={tool}
            hiddenTracks={hidden}
            highlightTracks={highlight}
            onSelect={setSelectedUid}
            onChange={onChangeRect}
            onCreate={(r) => void onCreate(r)}
            onImageSize={learnSize}
          />
          <div className="surface absolute left-2 top-2 flex flex-col gap-1 p-1">
            <button
              type="button"
              className={railBtn(tool === "select")}
              onClick={() => setTool("select")}
              title="Chọn / di chuyển / kéo góc (V)"
            >
              <MousePointer2 size={16} />
            </button>
            {editable && (
              <button
                type="button"
                className={railBtn(tool === "draw")}
                onClick={() => setTool("draw")}
                title="Vẽ box mới (N)"
              >
                <Square size={16} />
              </button>
            )}
            <button
              type="button"
              className={railBtn(false)}
              onClick={() => canvas.current?.fit()}
              title="Vừa khung (F)"
            >
              <Maximize size={16} />
            </button>
            {editable && (
              <>
                <div className="mx-1 h-px bg-border" />
                <button
                  type="button"
                  className={`${railBtn(false)} disabled:opacity-30`}
                  disabled={!undo.length}
                  onClick={doUndo}
                  title="Hoàn tác (Ctrl+Z)"
                >
                  <Undo2 size={16} />
                </button>
                <button
                  type="button"
                  className={`${railBtn(false)} disabled:opacity-30`}
                  disabled={!redo.length}
                  onClick={doRedo}
                  title="Làm lại (Ctrl+Y)"
                >
                  <Redo2 size={16} />
                </button>
              </>
            )}
          </div>
          {selectedIssue && selectedIssue.frame === frame && (
            <div className="pointer-events-none absolute bottom-2 left-1/2 max-w-[70%] -translate-x-1/2 rounded-lg bg-black/70 px-3 py-1.5 text-center text-xs text-white">
              <b>{ISSUE_LABEL[selectedIssue.type] ?? selectedIssue.type}</b> —{" "}
              {selectedIssue.message}
            </div>
          )}
        </div>

        <aside className="surface flex w-80 shrink-0 flex-col overflow-hidden">
          <div className="grid grid-cols-3 gap-1 border-b border-border p-1.5 text-xs">
            {(
              [
                ["objects", `Box (${frameBoxes.length})`],
                [
                  "issues",
                  `Lỗi (${issues.filter((i) => !handoffs[i.id] || ["needs_fix", "fixed"].includes(handoffs[i.id].status)).length})`,
                ],
                ["tracks", `Track (${tracks.length})`],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setSide(k)}
                className={`rounded-md py-1.5 ${side === k ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1">
            {side === "objects" && (
              <ObjectsPanel
                frameBoxes={frameBoxes}
                selected={selected}
                labels={labels}
                editable={editable}
                canReport={inTask && canReview}
                onSelect={(uid) => {
                  setSelectedUid(uid);
                  const b = boxes.find((x) => x.uid === uid);
                  if (b) canvas.current?.focus(b);
                }}
                onUpdate={onUpdate}
                onDelete={onDelete}
                onStitch={(target) =>
                  selected &&
                  void fix(
                    "stitch_ids",
                    { source: selected.track_id, target, from_frame: frame },
                    `Đã nối track #${selected.track_id} → #${target} từ frame ${frame}`,
                  )
                }
                onSwap={(other) =>
                  selected &&
                  void fix(
                    "swap_ids",
                    { a: selected.track_id, b: other, from_frame: frame },
                    `Đã hoán đổi #${selected.track_id} ↔ #${other} từ frame ${frame}`,
                  )
                }
                onReport={reportManual}
              />
            )}
            {side === "issues" && (
              <IssuesPanel
                scan={scan}
                handoffs={handoffs}
                role={role}
                inTask={inTask}
                scanning={busy === "scan"}
                selectedIssue={selectedIssue?.id ?? null}
                onScan={() => void runScan()}
                onOpen={openIssue}
                onFix={applyIssueFix}
                onHandoff={(issue, status) => setHandoff({ issue, status })}
                onQuality={() => void quality()}
              />
            )}
            {side === "tracks" && (
              <TracksPanel
                tracks={tracks}
                hidden={hidden}
                currentFrame={frame}
                onToggle={(id) =>
                  setHidden((h) =>
                    h.has(id)
                      ? new Set([...h].filter((x) => x !== id))
                      : new Set([...h, id]),
                  )
                }
                onJump={(t) => {
                  setFrame(t.first);
                  const b = (byFrame.get(t.first) ?? []).find(
                    (x) => x.track_id === t.id,
                  );
                  if (b) setSelectedUid(b.uid);
                }}
              />
            )}
          </div>
        </aside>
      </div>

      <Timeline
        frame={frame}
        start={bounds.start}
        end={bounds.end}
        issues={issues}
        annotated={new Set(byFrame.keys())}
        onFrame={setFrame}
      />

      {handoff && (
        <HandoffDialog
          issue={handoff.issue}
          status={handoff.status}
          onOpenChange={(o) => !o && setHandoff(null)}
          onSubmit={(note) =>
            submitHandoff(handoff.issue, handoff.status, note)
          }
        />
      )}
      {pushing && task && (
        <PushCvatDialog
          task={{ ...task, box_count: boxes.length }}
          onOpenChange={setPushing}
          beforePush={dirty ? () => save(true) : undefined}
        />
      )}
      {bench === "run" && task && (
        <BenchmarkDialog
          taskId={task.id}
          dirty={dirty}
          onOpenChange={(o) => !o && setBench(null)}
          onJump={(f, t) => {
            setFrame(f);
            setSide("objects");
            const b = (byFrame.get(f) ?? []).find((x) => x.track_id === t);
            if (b) setSelectedUid(b.uid);
          }}
        />
      )}
      {bench === "make" && task && (
        <MakeBenchmarkDialog
          taskId={task.id}
          taskName={task.name}
          onOpenChange={(o) => !o && setBench(null)}
        />
      )}
      {gate && (
        <Dialog open onOpenChange={() => setGate(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle
                className={
                  gate.pass_gate ? "text-emerald-500" : "text-amber-500"
                }
              >
                {gate.pass_gate
                  ? "✓ Đạt Quality Gate"
                  : "Chưa đạt Quality Gate"}
              </DialogTitle>
            </DialogHeader>
            <ul className="space-y-1 text-sm">
              <li>
                Lỗi cấu trúc (box lỗi, trùng ID, đổi class):{" "}
                {(gate.structural_blockers as unknown[]).length}
              </li>
              <li>
                Lỗi mức cao chưa xử lý:{" "}
                {(gate.unresolved_high as unknown[]).length}
              </li>
              <li>
                Yêu cầu sửa còn mở:{" "}
                {(gate.pending_handoffs as unknown[]).length}
              </li>
              <li>
                Đã QC {String(gate.reviewed)} / {String(gate.total_issues)} cảnh
                báo
              </li>
            </ul>
            <p className="text-[11px] text-muted-foreground">
              {String(gate.disclaimer)}
            </p>
            <DialogFooter>
              <button
                type="button"
                className="primary-action"
                onClick={() => setGate(null)}
              >
                Đóng
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {showKeys && (
        <Dialog open onOpenChange={setShowKeys}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Phím tắt</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              {[
                ["← / →", "Frame trước / sau (Shift: 10 frame)"],
                ["P", "Phát / dừng"],
                [
                  "V",
                  "Chọn, kéo box để di chuyển, kéo ô vuông ở góc để đổi kích thước",
                ],
                ["N", "Vẽ box mới (Annotator)"],
                ["Delete", "Xoá box đang chọn"],
                ["Ctrl+Z / Ctrl+Y", "Hoàn tác / làm lại"],
                ["Ctrl+S", "Lưu"],
                [
                  "F",
                  "Vừa khung · lăn chuột để zoom · Space+kéo hoặc kéo nền để di chuyển",
                ],
                ["Esc", "Bỏ chọn"],
              ].map(([k, v]) => (
                <div key={k} className="contents">
                  <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-center font-mono text-xs">
                    {k}
                  </kbd>
                  <span className="text-muted-foreground">{v}</span>
                </div>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

const round = (v: number) => Math.round(v * 100) / 100;
