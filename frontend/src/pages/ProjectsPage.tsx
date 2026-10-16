import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { FolderKanban, FolderPlus, Loader2, Pencil, Search, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, errorText, type Group, type TaskStatus } from "@/lib/api";
import { usePermissions } from "@/lib/useAuth";
import { useGroups } from "@/lib/queries";
import { STATUS_LABEL, fmtDate } from "@/lib/labels";
import { ConfirmDialog, Empty, Field, PageHeader, inputClass } from "@/components/common";
import { cn } from "@/lib/utils";

function GroupDialog({ group, open, onOpenChange }: { group?: Group; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(group?.name ?? "");
  const [description, setDescription] = useState(group?.description ?? "");
  const save = useMutation({
    mutationFn: () => (group ? api("groups/update", { id: group.id, name, description }) : api("groups/create", { name, description })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["groups"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(group ? "Đã lưu Project" : `Đã tạo Project "${name}"`);
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorText(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{group ? "Đổi tên Project" : "Tạo Project"}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Field label="Tên Project">
            <input autoFocus required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="Ví dụ: Dashcam tháng 10" />
          </Field>
          <Field label="Mô tả" hint="Nguồn dữ liệu, lớp cần gán, ghi chú cho cả nhóm (không bắt buộc)">
            <textarea rows={3} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} />
          </Field>
          <DialogFooter>
            <button type="button" className="secondary-action" onClick={() => onOpenChange(false)}>
              Huỷ
            </button>
            <button type="submit" disabled={save.isPending || !name.trim()} className="primary-action disabled:opacity-50">
              {save.isPending && <Loader2 size={14} className="animate-spin" />}
              {group ? "Lưu" : "Tạo Project"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function ProjectsPage() {
  const qc = useQueryClient();
  const { canManageProjects } = usePermissions();
  const { data: groups = [], isLoading } = useGroups();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Group | null | "new">(null);
  const [deleting, setDeleting] = useState<Group | null>(null);
  const shown = groups.filter((g) => (g.name + " " + g.description).toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="mx-auto max-w-7xl p-5">
      <PageHeader
        icon={FolderKanban}
        title="Project"
        subtitle="Mỗi Project gom nhiều task (mỗi task = 1 video / sequence cần gán và QC)"
        actions={
          canManageProjects && (
            <button type="button" className="primary-action" onClick={() => setEditing("new")}>
              <FolderPlus size={15} /> Tạo Project
            </button>
          )
        }
      />
      <div className="relative mb-4 max-w-sm">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm Project…" className={cn(inputClass, "pl-9")} />
      </div>

      {isLoading && <Loader2 className="mx-auto mt-10 animate-spin text-muted-foreground" />}
      {!isLoading && shown.length === 0 && (
        <div className="surface">
          <Empty icon={FolderKanban} title={groups.length ? "Không có Project khớp" : "Chưa có Project nào"}>
            {canManageProjects ? "Bấm Tạo Project, rồi thêm task vào Project ở trang Task." : "Annotator hoặc Admin sẽ tạo Project."}
          </Empty>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((g) => (
          <div key={g.id} className="surface workflow-card flex flex-col p-4">
            <div className="flex items-start gap-3">
              <span className="icon-tile">
                <FolderKanban size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <Link to={`/tasks?project=${g.id}`} className="block truncate font-semibold hover:text-primary">
                  {g.name}
                </Link>
                <p className="text-[11px] text-muted-foreground">
                  {g.created_by} · {fmtDate(g.updated_at)}
                </p>
              </div>
              {canManageProjects && (
                <div className="flex gap-1">
                  <button type="button" onClick={() => setEditing(g)} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="Đổi tên">
                    <Pencil size={14} />
                  </button>
                  <button type="button" onClick={() => setDeleting(g)} className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Xoá Project">
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </div>
            {g.description && <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{g.description}</p>}
            <div className="mt-auto pt-3">
              <div className="flex flex-wrap gap-1.5 text-[11px]">
                <span className="rounded-full bg-muted px-2 py-0.5 font-medium">{g.task_count} task</span>
                {(Object.entries(g.status_counts) as [TaskStatus, number][]).map(([s, n]) => (
                  <span key={s} className="rounded-full border border-border px-2 py-0.5 text-muted-foreground">
                    {STATUS_LABEL[s]} {n}
                  </span>
                ))}
              </div>
              <Link to={`/tasks?project=${g.id}`} className="secondary-action mt-3 h-8 w-full justify-center text-xs">
                Xem task của Project
              </Link>
            </div>
          </div>
        ))}
      </div>

      {editing && <GroupDialog key={editing === "new" ? "new" : editing.id} group={editing === "new" ? undefined : editing} open onOpenChange={(o) => !o && setEditing(null)} />}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        danger
        title={`Xoá Project "${deleting?.name}"?`}
        description={`${deleting?.task_count ?? 0} task bên trong KHÔNG bị xoá — chúng chuyển sang "Chưa thuộc Project".`}
        confirmLabel="Xoá Project"
        onConfirm={async () => {
          try {
            const r = await api<{ tasks_ungrouped: number }>("groups/delete", { id: deleting!.id });
            toast.success(`Đã xoá Project (${r.tasks_ungrouped} task chuyển ra ngoài)`);
            void qc.invalidateQueries({ queryKey: ["groups"] });
            void qc.invalidateQueries({ queryKey: ["tasks"] });
          } catch (e) {
            toast.error(errorText(e));
            throw e;
          }
        }}
      />
    </div>
  );
}
