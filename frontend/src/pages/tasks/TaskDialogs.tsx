import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { CloudUpload, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, errorText, type TaskStatus, type TaskSummary } from "@/lib/api";
import { usePermissions } from "@/lib/useAuth";
import { STATUS_BY_ROLE, invalidateTasks, useGroups, usePeople } from "@/lib/queries";
import { STATUS_LABEL, fmtDate } from "@/lib/labels";
import { ConfirmDialog, Field, inputClass } from "@/components/common";

/** Rename, move to a Project, assign people (admin), change status (by role). */
export function EditTaskDialog({ task, onOpenChange }: { task: TaskSummary; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { role, isAdmin, canManageProjects } = usePermissions();
  const { data: groups = [] } = useGroups();
  const { data: people = [] } = usePeople();
  const [name, setName] = useState(task.name);
  const [groupId, setGroupId] = useState(task.group_id ?? "");
  const [annotator, setAnnotator] = useState(task.annotator ?? "");
  const [reviewer, setReviewer] = useState(task.reviewer ?? "");
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const statuses = STATUS_BY_ROLE[role ?? ""] ?? [];
  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { id: task.id };
      if (canManageProjects) Object.assign(body, { name, group_id: groupId || null });
      if (isAdmin) Object.assign(body, { annotator: annotator || null, reviewer: reviewer || null });
      if (status !== task.status) body.status = status;
      return api("projects/update", body);
    },
    onSuccess: () => {
      invalidateTasks(qc);
      toast.success("Đã lưu task");
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorText(e)),
  });
  const option = (p: { username: string; full_name?: string }) => (
    <option key={p.username} value={p.username}>
      {p.full_name ? `${p.full_name} (${p.username})` : p.username}
    </option>
  );
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Chỉnh task</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Tên task">
            <input value={name} disabled={!canManageProjects} maxLength={100} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Project">
            <select value={groupId} disabled={!canManageProjects} onChange={(e) => setGroupId(e.target.value)} className={inputClass}>
              <option value="">— Chưa thuộc Project —</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Annotator" hint={isAdmin ? undefined : "Chỉ Admin giao người"}>
              <select value={annotator} disabled={!isAdmin} onChange={(e) => setAnnotator(e.target.value)} className={inputClass}>
                <option value="">— chưa giao —</option>
                {people.filter((p) => p.role === "annotator").map(option)}
              </select>
            </Field>
            <Field label="Reviewer">
              <select value={reviewer} disabled={!isAdmin} onChange={(e) => setReviewer(e.target.value)} className={inputClass}>
                <option value="">— chưa giao —</option>
                {people.filter((p) => p.role === "reviewer").map(option)}
              </select>
            </Field>
          </div>
          <Field label="Trạng thái" hint="Annotator: Đang gán ↔ Chờ QC · Reviewer: Cần sửa / Hoàn tất (khi không còn lỗi QC mở)">
            <select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)} className={inputClass}>
              {[task.status, ...statuses.filter((s) => s !== task.status)].map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <DialogFooter>
          <button type="button" className="secondary-action" onClick={() => onOpenChange(false)}>
            Huỷ
          </button>
          <button type="button" disabled={save.isPending} onClick={() => save.mutate()} className="primary-action disabled:opacity-50">
            {save.isPending && <Loader2 size={14} className="animate-spin" />} Lưu
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Replace the linked CVAT job's annotations with this task's (backup kept on the server). */
export function PushCvatDialog({ task, onOpenChange, beforePush }: { task: TaskSummary; onOpenChange: (o: boolean) => void; beforePush?: () => Promise<void> }) {
  const qc = useQueryClient();
  const job = task.cvat!.job_id;
  return (
    <ConfirmDialog
      open
      onOpenChange={onOpenChange}
      danger
      title={`Đẩy nhãn lên CVAT job #${job}?`}
      confirmLabel="Ghi đè nhãn trên CVAT"
      typeToConfirm={String(job)}
      description={
        <div className="space-y-1.5 text-sm">
          <p>
            Toàn bộ nhãn hiện có trên job <b>#{job}</b> ({task.cvat!.task_name ?? `task ${task.cvat!.task_id}`}) sẽ được <b>thay</b> bằng {task.box_count.toLocaleString("vi-VN")} box
            của task này.
          </p>
          <p className="text-xs text-muted-foreground">
            Nhãn cũ được lưu bản sao trên máy chủ T021 (storage/cvat_backups) trước khi ghi. Lần đẩy trước: {fmtDate(task.cvat!.pushed_at)}.
          </p>
        </div>
      }
      onConfirm={async () => {
        try {
          await beforePush?.();
          const r = await api<{ tracks: number; shapes: number; keyframes: number; backup: string; replaced: { tracks: number; shapes: number } }>("cvat/push", { id: task.id });
          toast.success(`Đã đẩy lên CVAT: ${r.tracks} track (${r.keyframes} keyframe), ${r.shapes} box rời. Bản sao nhãn cũ: ${r.backup}`, { duration: 8000, icon: <CloudUpload size={16} /> });
          invalidateTasks(qc);
        } catch (e) {
          toast.error(errorText(e), { duration: 8000 });
          throw e;
        }
      }}
    />
  );
}
