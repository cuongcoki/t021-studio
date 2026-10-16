import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ClipboardList, CloudUpload, Eye, FileSearch, Link2, Loader2, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { api, errorText, type TaskStatus, type TaskSummary } from "@/lib/api";
import { usePermissions } from "@/lib/useAuth";
import { STATUS_LABEL, fmtDate } from "@/lib/labels";
import { ConfirmDialog, Empty, PageHeader, StatusBadge, inputClass } from "@/components/common";
import { cn } from "@/lib/utils";
import { invalidateTasks, useGroups, usePeople, useTasks } from "@/lib/queries";
import CreateTaskDialog from "./tasks/CreateTaskDialog";
import { EditTaskDialog, PushCvatDialog } from "./tasks/TaskDialogs";

export default function TasksPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { isAdmin, canEdit, canReview, canCreateTask, canManageProjects } = usePermissions();
  const [params, setParams] = useSearchParams();
  const { data: tasks = [], isLoading } = useTasks();
  const { data: groups = [] } = useGroups();
  const { data: people = [] } = usePeople();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TaskSummary | null>(null);
  const [pushing, setPushing] = useState<TaskSummary | null>(null);
  const [deleting, setDeleting] = useState<TaskSummary | null>(null);

  const f = {
    q: params.get("q") ?? "",
    project: params.get("project") ?? "",
    status: params.get("status") ?? "",
    annotator: params.get("annotator") ?? "",
    reviewer: params.get("reviewer") ?? "",
    source: params.get("source") ?? "",
  };
  const setF = (k: keyof typeof f, v: string) =>
    setParams(
      (p) => {
        if (v) p.set(k, v);
        else p.delete(k);
        return p;
      },
      { replace: true },
    );
  const groupName = useMemo(() => Object.fromEntries(groups.map((g) => [g.id, g.name])), [groups]);
  const shown = tasks.filter((t) => {
    const text = `${t.name} ${t.source_name} ${t.annotator ?? ""} ${t.reviewer ?? ""} ${t.cvat ? `job ${t.cvat.job_id} ${t.cvat.task_name ?? ""}` : ""}`.toLowerCase();
    return (
      (!f.q || text.includes(f.q.toLowerCase())) &&
      (!f.project || (f.project === "none" ? !t.group_id : t.group_id === f.project)) &&
      (!f.status || t.status === f.status) &&
      (!f.annotator || (f.annotator === "none" ? !t.annotator : t.annotator === f.annotator)) &&
      (!f.reviewer || (f.reviewer === "none" ? !t.reviewer : t.reviewer === f.reviewer)) &&
      (!f.source || (f.source === "cvat" ? !!t.cvat : !t.cvat))
    );
  });
  const filtered = Object.values(f).some(Boolean);

  const select = (k: keyof typeof f, label: string, options: [string, string][]) => (
    <select value={f[k]} onChange={(e) => setF(k, e.target.value)} className={cn(inputClass, "w-auto min-w-36 py-1.5")} aria-label={label}>
      <option value="">{label}</option>
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );

  return (
    <div className="mx-auto max-w-[1400px] p-5">
      <PageHeader
        icon={ClipboardList}
        title={isAdmin ? "Quản lý task" : "Task"}
        subtitle={isAdmin ? "Tạo task, giao Annotator / Reviewer, theo dõi trạng thái" : "Mở task để gán nhãn (Annotator) hoặc QC (Reviewer)"}
        actions={
          <>
            <Link to="/preview" className="secondary-action" title="Mở một file CVAT / MOT / JSON / ZIP để xem và quét lỗi — không lưu">
              <FileSearch size={15} /> Xem nhanh file
            </Link>
            {canCreateTask && (
              <button type="button" className="primary-action" onClick={() => setCreating(true)}>
                <Plus size={15} /> Tạo task
              </button>
            )}
          </>
        }
      />

      <div className="surface mb-3 flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-56 flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={f.q} onChange={(e) => setF("q", e.target.value)} placeholder="Tìm theo tên task, file, người, job CVAT…" className={cn(inputClass, "py-1.5 pl-9")} />
        </div>
        {select("project", "Mọi Project", [...groups.map((g) => [g.id, g.name] as [string, string]), ["none", "— Chưa thuộc Project"]])}
        {select("status", "Mọi trạng thái", Object.entries(STATUS_LABEL) as [string, string][])}
        {select("annotator", "Mọi Annotator", [...people.filter((p) => p.role === "annotator").map((p) => [p.username, p.username] as [string, string]), ["none", "— Chưa giao"]])}
        {select("reviewer", "Mọi Reviewer", [...people.filter((p) => p.role === "reviewer").map((p) => [p.username, p.username] as [string, string]), ["none", "— Chưa giao"]])}
        {select("source", "Mọi nguồn", [
          ["cvat", "Từ CVAT"],
          ["file", "Từ file"],
        ])}
        {filtered && (
          <button type="button" onClick={() => setParams({}, { replace: true })} className="secondary-action h-8 px-2.5 text-xs">
            <X size={13} /> Bỏ lọc
          </button>
        )}
      </div>

      <div className="surface overflow-x-auto">
        {isLoading ? (
          <Loader2 className="mx-auto my-10 animate-spin text-muted-foreground" />
        ) : shown.length === 0 ? (
          <Empty icon={ClipboardList} title={tasks.length ? "Không có task khớp bộ lọc" : "Chưa có task"}>
            {canCreateTask ? "Bấm Tạo task để lấy một job từ CVAT hoặc tải file annotation." : "Annotator / Admin sẽ tạo task và giao cho bạn."}
          </Empty>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-[11px] uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Task</th>
                <th className="px-3 py-2.5 font-medium">Project</th>
                <th className="px-3 py-2.5 font-medium">Trạng thái</th>
                <th className="px-3 py-2.5 font-medium">Annotator</th>
                <th className="px-3 py-2.5 font-medium">Reviewer</th>
                <th className="px-3 py-2.5 font-medium">QC</th>
                <th className="px-3 py-2.5 font-medium">Box</th>
                <th className="px-3 py-2.5 font-medium">Cập nhật</th>
                <th className="px-3 py-2.5 text-right font-medium">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => (
                <tr key={t.id} className={`border-b border-border last:border-0 hover:bg-muted/40 ${params.get("focus") === t.id ? "bg-primary/10" : ""}`}>
                  <td className="max-w-72 px-4 py-2.5">
                    <Link to={`/tasks/${t.id}`} className="block truncate font-medium hover:text-primary">
                      {t.name}
                    </Link>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {t.cvat ? (
                        <span className="inline-flex items-center gap-0.5">
                          <Link2 size={10} /> CVAT job #{t.cvat.job_id}
                          {t.cvat.pushed_at && ` · đẩy lên ${fmtDate(t.cvat.pushed_at)}`}
                        </span>
                      ) : (
                        t.source_name || "chưa có nhãn"
                      )}
                    </p>
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">{t.group_id ? groupName[t.group_id] ?? "—" : "—"}</td>
                  <td className="px-3 py-2.5">
                    <StatusBadge status={t.status as TaskStatus} />
                  </td>
                  <td className="px-3 py-2.5">{t.annotator ?? <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-3 py-2.5">{t.reviewer ?? <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-3 py-2.5 text-[11px]">
                    {t.qc.needs_fix ? <span className="mr-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-600 dark:text-amber-300">{t.qc.needs_fix} cần sửa</span> : null}
                    {t.qc.fixed ? <span className="mr-1 rounded bg-violet-500/15 px-1.5 py-0.5 text-violet-600 dark:text-violet-300">{t.qc.fixed} chờ QC</span> : null}
                    {t.qc.verified ? <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-600 dark:text-emerald-300">{t.qc.verified} ✓</span> : null}
                    {!t.qc.needs_fix && !t.qc.fixed && !t.qc.verified && <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">{t.box_count.toLocaleString("vi-VN")}</td>
                  <td className="px-3 py-2.5 text-[11px] text-muted-foreground">{fmtDate(t.updated_at)}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex justify-end gap-1">
                      <button type="button" onClick={() => navigate(`/tasks/${t.id}`)} className="secondary-action h-7 px-2 text-xs" title={canEdit ? "Mở để gán / sửa" : canReview ? "Mở để QC" : "Xem"}>
                        <Eye size={13} /> {canEdit ? "Gán" : canReview ? "QC" : "Xem"}
                      </button>
                      {canEdit && t.cvat && (
                        <button type="button" onClick={() => setPushing(t)} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="Đẩy nhãn về job CVAT">
                          <CloudUpload size={14} />
                        </button>
                      )}
                      <button type="button" onClick={() => setEditing(t)} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title={isAdmin ? "Sửa / giao người" : "Sửa / đổi trạng thái"}>
                        <Pencil size={14} />
                      </button>
                      {canManageProjects && (
                        <button type="button" onClick={() => setDeleting(t)} className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Xoá task">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        {shown.length}/{tasks.length} task
      </p>

      {creating && <CreateTaskDialog open onOpenChange={setCreating} defaultGroup={f.project && f.project !== "none" ? f.project : undefined} />}
      {editing && <EditTaskDialog task={editing} onOpenChange={(o) => !o && setEditing(null)} />}
      {pushing && <PushCvatDialog task={pushing} onOpenChange={(o) => !o && setPushing(null)} />}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        danger
        title={`Xoá task "${deleting?.name}"?`}
        description="Xoá nhãn, lịch sử QC của task trên T021. Job CVAT (nếu có) không bị ảnh hưởng."
        confirmLabel="Xoá task"
        typeToConfirm="xoa"
        onConfirm={async () => {
          try {
            await api("projects/delete", { id: deleting!.id });
            toast.success("Đã xoá task");
            invalidateTasks(qc);
          } catch (e) {
            toast.error(errorText(e));
            throw e;
          }
        }}
      />
    </div>
  );
}
