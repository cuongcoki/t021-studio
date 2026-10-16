import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import {
  ArrowRight,
  BadgeCheck,
  Boxes,
  ClipboardList,
  FolderKanban,
  LayoutDashboard,
  Link2,
  Loader2,
  ShieldAlert,
  Users,
  Wrench,
} from "lucide-react";
import { api, type DashboardData, type TaskStatus } from "@/lib/api";
import { useAuth } from "@/lib/useAuth";
import { HANDOFF_LABEL, ROLE_LABEL, STATUS_LABEL, fmtDate } from "@/lib/labels";
import { PageHeader, StatCard, StatusBadge } from "@/components/common";

const TODO_TITLE = {
  admin: "Task chưa giao đủ người",
  annotator: "Việc của bạn: đang gán / cần sửa",
  reviewer: "Việc của bạn: chờ QC",
};

const STATUS_BAR: Record<TaskStatus, string> = {
  annotating: "bg-sky-500",
  in_review: "bg-violet-500",
  needs_fix: "bg-amber-500",
  done: "bg-emerald-500",
};

export default function DashboardPage() {
  const { user } = useAuth();
  const { data, isLoading } = useQuery({ queryKey: ["dashboard"], queryFn: () => api<DashboardData>("dashboard") });

  if (isLoading || !data) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="animate-spin" />
      </div>
    );
  }
  const total = Math.max(1, data.tasks);

  return (
    <div className="mx-auto max-w-7xl p-5">
      <PageHeader
        icon={LayoutDashboard}
        title={`Xin chào, ${user?.full_name || user?.username}`}
        subtitle={`${user && ROLE_LABEL[user.role]} · Reviewer QC → Annotator sửa → Reviewer xác nhận`}
        actions={
          <Link to="/tasks" className="primary-action">
            <ClipboardList size={15} /> Mở danh sách task
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={FolderKanban} label="Project" value={data.projects} hint={`${data.tasks} task`} />
        <StatCard icon={ClipboardList} label="Task" value={data.tasks} hint={`${data.from_cvat} lấy từ CVAT · ${data.mine} của bạn`} tone="sky" />
        <StatCard icon={Boxes} label="Bounding box" value={data.boxes.toLocaleString("vi-VN")} hint={`${data.frames.toLocaleString("vi-VN")} frame`} tone="violet" />
        <StatCard
          icon={ShieldAlert}
          label="Lỗi QC đang mở"
          value={data.qc.needs_fix + data.qc.fixed}
          hint={`${data.qc.needs_fix} cần sửa · ${data.qc.fixed} chờ xác nhận`}
          tone="amber"
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <section className="surface p-5 lg:col-span-2">
          <h2 className="text-sm font-semibold">Tiến độ task</h2>
          <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-muted">
            {(Object.keys(STATUS_LABEL) as TaskStatus[]).map((s) =>
              data.by_status[s] ? (
                <div key={s} className={STATUS_BAR[s]} style={{ width: `${(100 * data.by_status[s]) / total}%` }} title={`${STATUS_LABEL[s]}: ${data.by_status[s]}`} />
              ) : null,
            )}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(Object.keys(STATUS_LABEL) as TaskStatus[]).map((s) => (
              <Link key={s} to={`/tasks?status=${s}`} className="rounded-xl border border-border px-3 py-2 hover:bg-muted/60">
                <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className={`h-2 w-2 rounded-full ${STATUS_BAR[s]}`} /> {STATUS_LABEL[s]}
                </p>
                <p className="text-lg font-semibold">{data.by_status[s] ?? 0}</p>
              </Link>
            ))}
          </div>

          <h2 className="mt-5 text-sm font-semibold">Luồng QC (lỗi Reviewer gửi)</h2>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(
              [
                ["needs_fix", Wrench, "text-amber-500"],
                ["fixed", ArrowRight, "text-violet-500"],
                ["verified", BadgeCheck, "text-emerald-500"],
                ["false_positive", ShieldAlert, "text-muted-foreground"],
              ] as const
            ).map(([k, Icon, color]) => (
              <div key={k} className="rounded-xl border border-border px-3 py-2">
                <p className={`flex items-center gap-1.5 text-[11px] ${color}`}>
                  <Icon size={12} /> {HANDOFF_LABEL[k]}
                </p>
                <p className="text-lg font-semibold">{data.qc[k] ?? 0}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="surface p-5">
          <h2 className="text-sm font-semibold">{user ? TODO_TITLE[user.role] : "Việc cần làm"}</h2>
          <p className="text-[11px] text-muted-foreground">{data.todo_count} task</p>
          <div className="mt-3 space-y-1.5">
            {data.todo.length === 0 && <p className="py-6 text-center text-xs text-muted-foreground">Không có việc nào đang chờ 🎉</p>}
            {data.todo.map((t) => (
              <Link key={t.id} to={user?.role === "admin" ? `/tasks?focus=${t.id}` : `/tasks/${t.id}`} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 hover:bg-muted/60">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{t.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {t.annotator ?? "chưa có annotator"} · {t.reviewer ?? "chưa có reviewer"}
                  </p>
                </div>
                <StatusBadge status={t.status} />
              </Link>
            ))}
          </div>
          {data.users && (
            <div className="mt-4 rounded-xl bg-muted/50 p-3 text-xs">
              <p className="flex items-center gap-1.5 font-semibold">
                <Users size={13} /> Tài khoản
              </p>
              <p className="mt-1 text-muted-foreground">
                {data.users.admin} admin · {data.users.annotator} annotator · {data.users.reviewer} reviewer
                {data.users_inactive ? ` · ${data.users_inactive} đang khoá` : ""}
              </p>
              <Link to="/users" className="mt-1 inline-flex items-center gap-1 text-primary hover:underline">
                Quản lý tài khoản <ArrowRight size={12} />
              </Link>
            </div>
          )}
        </section>
      </div>

      <section className="surface mt-4 p-5">
        <h2 className="text-sm font-semibold">Task cập nhật gần đây</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase text-muted-foreground">
              <tr>
                <th className="py-2 pr-3 font-medium">Task</th>
                <th className="py-2 pr-3 font-medium">Trạng thái</th>
                <th className="py-2 pr-3 font-medium">Annotator</th>
                <th className="py-2 pr-3 font-medium">Reviewer</th>
                <th className="py-2 pr-3 font-medium">Box</th>
                <th className="py-2 font-medium">Cập nhật</th>
              </tr>
            </thead>
            <tbody>
              {data.recent.map((t) => (
                <tr key={t.id} className="border-t border-border">
                  <td className="py-2 pr-3">
                    <Link to={`/tasks/${t.id}`} className="font-medium hover:text-primary">
                      {t.name}
                    </Link>
                    {t.cvat && (
                      <span className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                        <Link2 size={10} /> CVAT job {t.cvat.job_id}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    <StatusBadge status={t.status} />
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">{t.annotator ?? "—"}</td>
                  <td className="py-2 pr-3 text-muted-foreground">{t.reviewer ?? "—"}</td>
                  <td className="py-2 pr-3 tabular-nums">{t.box_count.toLocaleString("vi-VN")}</td>
                  <td className="py-2 text-muted-foreground">{fmtDate(t.updated_at)}</td>
                </tr>
              ))}
              {data.recent.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-xs text-muted-foreground">
                    Chưa có task. Vào trang Task để tạo task mới (từ CVAT hoặc từ file).
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
