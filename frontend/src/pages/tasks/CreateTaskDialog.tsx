import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { CloudDownload, FileUp, Loader2, RefreshCw, Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, errorText, type CvatJob, type TaskDetail } from "@/lib/api";
import { parseAnnotationFile, uploadMedia, useGroups, usePeople } from "@/lib/queries";
import { usePermissions } from "@/lib/useAuth";
import { Field, inputClass } from "@/components/common";
import { cn } from "@/lib/utils";

function Assignees({ annotator, reviewer, onChange }: { annotator: string; reviewer: string; onChange: (a: string, r: string) => void }) {
  const { data: people = [] } = usePeople();
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Giao Annotator">
        <select value={annotator} onChange={(e) => onChange(e.target.value, reviewer)} className={inputClass}>
          <option value="">— chưa giao —</option>
          {people.filter((p) => p.role === "annotator").map((p) => (
            <option key={p.username} value={p.username}>
              {p.full_name ? `${p.full_name} (${p.username})` : p.username}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Giao Reviewer">
        <select value={reviewer} onChange={(e) => onChange(annotator, e.target.value)} className={inputClass}>
          <option value="">— chưa giao —</option>
          {people.filter((p) => p.role === "reviewer").map((p) => (
            <option key={p.username} value={p.username}>
              {p.full_name ? `${p.full_name} (${p.username})` : p.username}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
}

function FromCvat({ groupId, onDone }: { groupId: string; onDone: (taskId: string) => void }) {
  const { isAdmin } = usePermissions();
  const jobs = useQuery({ queryKey: ["cvat-jobs"], queryFn: () => api<{ url: string; jobs: CvatJob[] }>("cvat/jobs"), retry: false });
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<CvatJob | null>(null);
  const [name, setName] = useState("");
  const [annotator, setAnnotator] = useState("");
  const [reviewer, setReviewer] = useState("");
  const shown = useMemo(
    () =>
      (jobs.data?.jobs ?? []).filter((j) =>
        `${j.job_id} ${j.task_id} ${j.task_name} ${j.assignee ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()),
      ),
    [jobs.data, q],
  );
  const pull = useMutation({
    mutationFn: () =>
      api<{ project: TaskDetail; boxes: number; tracks: number }>("cvat/import", {
        job_id: picked!.job_id,
        group_id: groupId || null,
        name: name.trim() || undefined,
        ...(isAdmin ? { annotator: annotator || null, reviewer: reviewer || null } : {}),
      }),
    onSuccess: (r) => {
      toast.success(`Đã tạo task từ CVAT job ${picked!.job_id}: ${r.tracks} track, ${r.boxes.toLocaleString("vi-VN")} box`);
      onDone(r.project.id);
    },
    onError: (e) => toast.error(errorText(e)),
  });

  if (jobs.isError) {
    return (
      <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
        <p className="font-medium text-amber-600 dark:text-amber-300">{errorText(jobs.error)}</p>
        <Link to="/settings" className="mt-2 inline-block text-primary hover:underline">
          → Vào Cài đặt để kết nối tài khoản CVAT của bạn
        </Link>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm job theo số, tên task CVAT, người được giao…" className={cn(inputClass, "pl-9")} />
        </div>
        <button type="button" onClick={() => void jobs.refetch()} className="secondary-action h-9 px-3" title="Tải lại danh sách từ CVAT">
          <RefreshCw size={14} className={jobs.isFetching ? "animate-spin" : ""} />
        </button>
      </div>
      <div className="max-h-64 overflow-y-auto rounded-xl border border-border">
        {jobs.isLoading && <Loader2 className="mx-auto my-6 animate-spin text-muted-foreground" />}
        {shown.map((j) => (
          <button
            key={j.job_id}
            type="button"
            disabled={j.dimension !== "2d"}
            onClick={() => {
              setPicked(j);
              setName(`${j.task_name} · job ${j.job_id}`.slice(0, 100));
            }}
            className={`flex w-full items-center gap-3 border-b border-border px-3 py-2 text-left text-sm last:border-0 disabled:opacity-40 ${
              picked?.job_id === j.job_id ? "bg-primary/10" : "hover:bg-muted/60"
            }`}
          >
            <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">#{j.job_id}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{j.task_name}</span>
              <span className="text-[11px] text-muted-foreground">
                task {j.task_id} · {j.frames} frame · {j.dimension.toUpperCase()} · {j.state}
                {j.assignee && ` · ${j.assignee}`}
              </span>
            </span>
            {j.linked_tasks.length > 0 && <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px]">đã có {j.linked_tasks.length} task</span>}
          </button>
        ))}
        {!jobs.isLoading && shown.length === 0 && <p className="py-6 text-center text-xs text-muted-foreground">Không có job nào.</p>}
      </div>
      {picked && (
        <div className="space-y-3 rounded-xl bg-muted/40 p-3">
          <Field label="Tên task">
            <input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </Field>
          {isAdmin && <Assignees annotator={annotator} reviewer={reviewer} onChange={(a, r) => (setAnnotator(a), setReviewer(r))} />}
          {picked.linked_tasks.length > 0 && (
            <p className="text-[11px] text-amber-600 dark:text-amber-300">
              Job này đã được lấy về thành: {picked.linked_tasks.map((t) => t.name).join(", ")}. Lấy thêm sẽ tạo một task riêng.
            </p>
          )}
        </div>
      )}
      <DialogFooter>
        <button type="button" disabled={!picked || pull.isPending} onClick={() => pull.mutate()} className="primary-action disabled:opacity-50">
          {pull.isPending ? <Loader2 size={14} className="animate-spin" /> : <CloudDownload size={15} />}
          {pull.isPending ? "Đang lấy nhãn từ CVAT…" : "Tạo task từ job này"}
        </button>
      </DialogFooter>
    </div>
  );
}

const frameSpan = (boxes: { frame_id: number }[]) => {
  if (!boxes.length) return null;
  const frames = boxes.map((b) => b.frame_id);
  return Math.max(...frames) - Math.min(...frames) + 1;
};

function FromFile({ groupId, onDone }: { groupId: string; onDone: (taskId: string) => void }) {
  const { isAdmin, canEdit } = usePermissions();
  const [name, setName] = useState("");
  const [annotation, setAnnotation] = useState<File | null>(null);
  const [media, setMedia] = useState<File | null>(null);
  const [annotator, setAnnotator] = useState("");
  const [reviewer, setReviewer] = useState("");
  const create = useMutation({
    mutationFn: async () => {
      const r = await api<{ project: TaskDetail }>("projects/create", {
        name: name.trim() || annotation?.name || "Task mới",
        group_id: groupId || null,
        ...(isAdmin ? { annotator: annotator || null, reviewer: reviewer || null } : {}),
      });
      // Only annotators write annotation state; an admin creates the empty task and assigns it.
      if (canEdit && annotation) {
        const parsed = await parseAnnotationFile(annotation);
        const m = media ? await uploadMedia(media, parsed.total_frames) : null;
        await api("projects/save", {
          id: r.project.id,
          state: {
            boxes: parsed.boxes,
            source_name: annotation.name,
            frame: parsed.frame_base ?? 0,
            meta: {
              format: parsed.format,
              mode: parsed.mode,
              frame_base: parsed.frame_base,
              width: parsed.width,
              height: parsed.height,
              total_frames: parsed.total_frames ?? frameSpan(parsed.boxes),
              labels: parsed.labels,
            },
            media: m?.media ?? { kind: "none" },
          },
        });
        [...(parsed.warnings ?? []), ...(m?.warnings ?? [])].forEach((w) => toast(w, { icon: "⚠️" }));
        return { id: r.project.id, note: `${parsed.boxes.length.toLocaleString("vi-VN")} box${m ? ` · ${m.note}` : ""}` };
      }
      return { id: r.project.id, note: "task trống" };
    },
    onSuccess: (r) => {
      toast.success(`Đã tạo task (${r.note})`);
      onDone(r.id);
    },
    onError: (e) => toast.error(errorText(e)),
  });

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <Field label="Tên task">
        <input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder={annotation?.name ?? "Ví dụ: Video 01 — ngã tư"} className={inputClass} />
      </Field>
      {canEdit && (
        <>
          <Field label="File annotation" hint="CVAT XML (video/ảnh), MOT TXT/CSV, COCO / Datumaro JSON, .t021.json, hoặc ZIP chứa các file đó">
            <input type="file" accept=".xml,.txt,.csv,.mot,.json,.zip" onChange={(e) => setAnnotation(e.target.files?.[0] ?? null)} className={inputClass} />
          </Field>
          <Field label="Ảnh / video để đối chiếu (không bắt buộc)" hint="frames.zip (JPG/PNG theo thứ tự frame) hoặc video MP4/MOV… — video cần FFmpeg trên máy chạy server">
            <input type="file" accept=".zip,video/*,.mkv,.avi" onChange={(e) => setMedia(e.target.files?.[0] ?? null)} className={inputClass} />
          </Field>
        </>
      )}
      {isAdmin && (
        <>
          <p className="rounded-lg bg-muted/50 px-3 py-2 text-[11px] text-muted-foreground">
            Admin tạo task trống và giao người — Annotator được giao sẽ import nhãn trong workspace (Admin không sửa annotation).
          </p>
          <Assignees annotator={annotator} reviewer={reviewer} onChange={(a, r) => (setAnnotator(a), setReviewer(r))} />
        </>
      )}
      <DialogFooter>
        <button type="submit" disabled={create.isPending || (canEdit && !annotation)} className="primary-action disabled:opacity-50">
          {create.isPending ? <Loader2 size={14} className="animate-spin" /> : <FileUp size={15} />}
          {create.isPending ? "Đang tạo…" : "Tạo task"}
        </button>
      </DialogFooter>
    </form>
  );
}

export default function CreateTaskDialog({ open, onOpenChange, defaultGroup }: { open: boolean; onOpenChange: (o: boolean) => void; defaultGroup?: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { isAdmin } = usePermissions();
  const { data: groups = [] } = useGroups();
  const [tab, setTab] = useState<"cvat" | "file">("cvat");
  const [groupId, setGroupId] = useState(defaultGroup ?? "");
  const done = (taskId: string) => {
    void qc.invalidateQueries({ queryKey: ["tasks"] });
    void qc.invalidateQueries({ queryKey: ["groups"] });
    void qc.invalidateQueries({ queryKey: ["dashboard"] });
    onOpenChange(false);
    if (!isAdmin) navigate(`/tasks/${taskId}`);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Tạo task</DialogTitle>
          <DialogDescription>Lấy một job từ CVAT (nhãn + ảnh), hoặc tạo từ file annotation.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 text-sm">
          {(
            [
              ["cvat", "Từ CVAT", CloudDownload],
              ["file", "Từ file", FileUp],
            ] as const
          ).map(([k, label, Icon]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={`flex items-center justify-center gap-1.5 rounded-md py-1.5 ${tab === k ? "bg-card font-medium shadow-sm" : "text-muted-foreground"}`}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
        <Field label="Thuộc Project">
          <select value={groupId} onChange={(e) => setGroupId(e.target.value)} className={inputClass}>
            <option value="">— Chưa thuộc Project —</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </Field>
        {tab === "cvat" ? <FromCvat groupId={groupId} onDone={done} /> : <FromFile groupId={groupId} onDone={done} />}
      </DialogContent>
    </Dialog>
  );
}
