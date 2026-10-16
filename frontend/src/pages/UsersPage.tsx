import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { KeyRound, Loader2, Lock, Pencil, Search, Trash2, Unlock, UserPlus, Users, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, errorText, type Role, type User } from "@/lib/api";
import { useAuth } from "@/lib/useAuth";
import { ROLE_HINT, ROLE_LABEL, fmtDate } from "@/lib/labels";
import { ConfirmDialog, Empty, Field, PageHeader, inputClass } from "@/components/common";
import { cn } from "@/lib/utils";

const ROLE_STYLE: Record<Role, string> = {
  admin: "bg-rose-500/15 text-rose-600 dark:text-rose-300",
  annotator: "bg-sky-500/15 text-sky-600 dark:text-sky-300",
  reviewer: "bg-violet-500/15 text-violet-600 dark:text-violet-300",
};

function UserDialog({ user, onOpenChange }: { user?: User; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const editing = !!user;
  const [username, setUsername] = useState(user?.username ?? "");
  const [fullName, setFullName] = useState(user?.full_name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [role, setRole] = useState<Role>(user?.role ?? "annotator");
  const [password, setPassword] = useState("");
  const [active, setActive] = useState(user?.active ?? true);
  const save = useMutation({
    mutationFn: () =>
      editing
        ? api("auth/update-user", { username, full_name: fullName, email, role, active, ...(password ? { password } : {}) })
        : api("auth/create-user", { username, full_name: fullName, email, role, password }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["users"] });
      void qc.invalidateQueries({ queryKey: ["people"] });
      toast.success(editing ? `Đã lưu ${username}` : `Đã tạo tài khoản ${username} (${ROLE_LABEL[role]})`);
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorText(e)),
  });
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? `Sửa tài khoản ${user.username}` : "Tạo tài khoản"}</DialogTitle>
          <DialogDescription>{ROLE_HINT[role]}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tên đăng nhập" hint={editing ? "Không đổi được" : "3–50 ký tự: chữ, số, _ - ."}>
              <input required disabled={editing} minLength={3} maxLength={50} pattern="[A-Za-z0-9_.\-]+" value={username} onChange={(e) => setUsername(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Vai trò">
              <select value={role} onChange={(e) => setRole(e.target.value as Role)} className={inputClass}>
                {(["annotator", "reviewer", "admin"] as const).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Họ tên">
            <input maxLength={100} value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Email">
            <input type="email" maxLength={120} value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
          </Field>
          <Field label={editing ? "Đặt lại mật khẩu" : "Mật khẩu"} hint={editing ? "Để trống nếu không đổi. Người dùng sẽ phải đăng nhập lại." : "Ít nhất 8 ký tự"}>
            <input type="password" required={!editing} minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
          </Field>
          {editing && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Đang hoạt động (bỏ chọn để khoá tài khoản)
            </label>
          )}
          <DialogFooter>
            <button type="button" className="secondary-action" onClick={() => onOpenChange(false)}>
              Huỷ
            </button>
            <button type="submit" disabled={save.isPending} className="primary-action disabled:opacity-50">
              {save.isPending && <Loader2 size={14} className="animate-spin" />}
              {editing ? "Lưu" : "Tạo tài khoản"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function UsersPage() {
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const [q, setQ] = useState("");
  const [role, setRole] = useState<"" | Role>("");
  const [state, setState] = useState<"" | "active" | "locked">("");
  const [editing, setEditing] = useState<User | null | "new">(null);
  const [deleting, setDeleting] = useState<User | null>(null);
  const { data: users = [], isLoading } = useQuery({ queryKey: ["users"], queryFn: () => api<{ users: User[] }>("auth/users").then((r) => r.users) });

  const toggleLock = useMutation({
    mutationFn: (u: User) => api("auth/update-user", { username: u.username, active: !u.active }),
    onSuccess: (_r, u) => {
      void qc.invalidateQueries({ queryKey: ["users"] });
      toast.success(u.active ? `Đã khoá ${u.username}` : `Đã mở khoá ${u.username}`);
    },
    onError: (e) => toast.error(errorText(e)),
  });

  const text = q.trim().toLowerCase();
  const shown = users.filter(
    (u) =>
      (!text || `${u.username} ${u.full_name} ${u.email}`.toLowerCase().includes(text)) &&
      (!role || u.role === role) &&
      (!state || (state === "active" ? u.active : !u.active)),
  );
  const count = (r: Role) => users.filter((u) => u.role === r).length;

  return (
    <div className="mx-auto max-w-6xl p-5">
      <PageHeader
        icon={Users}
        title="Tài khoản"
        subtitle={`${users.length} tài khoản · ${count("admin")} admin · ${count("annotator")} annotator · ${count("reviewer")} reviewer`}
        actions={
          <button type="button" className="primary-action" onClick={() => setEditing("new")}>
            <UserPlus size={15} /> Tạo tài khoản
          </button>
        }
      />
      <div className="surface mb-3 flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-56 flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm theo tên đăng nhập, họ tên, email…" className={cn(inputClass, "py-1.5 pl-9")} />
        </div>
        <select value={role} onChange={(e) => setRole(e.target.value as Role | "")} className={cn(inputClass, "w-auto py-1.5")}>
          <option value="">Mọi vai trò</option>
          {(["admin", "annotator", "reviewer"] as const).map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
        <select value={state} onChange={(e) => setState(e.target.value as typeof state)} className={cn(inputClass, "w-auto py-1.5")}>
          <option value="">Mọi trạng thái</option>
          <option value="active">Đang hoạt động</option>
          <option value="locked">Đang khoá</option>
        </select>
        {(q || role || state) && (
          <button type="button" onClick={() => (setQ(""), setRole(""), setState(""))} className="secondary-action h-8 px-2.5 text-xs">
            <X size={13} /> Bỏ lọc
          </button>
        )}
      </div>
      <div className="surface overflow-x-auto">
        {isLoading ? (
          <Loader2 className="mx-auto my-10 animate-spin text-muted-foreground" />
        ) : shown.length === 0 ? (
          <Empty icon={Users} title="Không có tài khoản khớp" />
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-[11px] uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Tài khoản</th>
                <th className="px-3 py-2.5 font-medium">Vai trò</th>
                <th className="px-3 py-2.5 font-medium">Email</th>
                <th className="px-3 py-2.5 font-medium">Trạng thái</th>
                <th className="px-3 py-2.5 font-medium">Tạo lúc</th>
                <th className="px-3 py-2.5 text-right font-medium">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((u) => (
                <tr key={u.username} className="border-b border-border last:border-0 hover:bg-muted/40">
                  <td className="px-4 py-2.5">
                    <p className="font-medium">
                      {u.full_name || u.username}
                      {u.username === me?.username && <span className="ml-1.5 text-[10px] text-muted-foreground">(bạn)</span>}
                    </p>
                    <p className="font-mono text-[11px] text-muted-foreground">{u.username}</p>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${ROLE_STYLE[u.role]}`}>{ROLE_LABEL[u.role]}</span>
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">{u.email || "—"}</td>
                  <td className="px-3 py-2.5">
                    {u.active ? (
                      <span className="text-[11px] text-emerald-600 dark:text-emerald-400">● Hoạt động</span>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">● Đang khoá</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-[11px] text-muted-foreground">{fmtDate(u.created_at)}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex justify-end gap-1">
                      <button type="button" onClick={() => setEditing(u)} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="Sửa / đặt lại mật khẩu">
                        <Pencil size={14} />
                      </button>
                      {u.username !== me?.username && (
                        <>
                          <button
                            type="button"
                            onClick={() => toggleLock.mutate(u)}
                            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                            title={u.active ? "Khoá tài khoản" : "Mở khoá"}
                          >
                            {u.active ? <Lock size={14} /> : <Unlock size={14} />}
                          </button>
                          <button type="button" onClick={() => setDeleting(u)} className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Xoá tài khoản">
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
        <KeyRound size={11} /> Mật khẩu lưu dạng băm PBKDF2; đổi vai trò, khoá hoặc đặt lại mật khẩu sẽ đăng xuất người đó ngay.
      </p>

      {editing && <UserDialog key={editing === "new" ? "new" : editing.username} user={editing === "new" ? undefined : editing} onOpenChange={(o) => !o && setEditing(null)} />}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        danger
        title={`Xoá tài khoản ${deleting?.username}?`}
        description="Người này bị đăng xuất ngay. Task đã giao cho họ vẫn giữ tên — Admin nên giao lại cho người khác."
        confirmLabel="Xoá tài khoản"
        typeToConfirm={deleting?.username}
        onConfirm={async () => {
          try {
            await api("auth/delete-user", { username: deleting!.username });
            toast.success(`Đã xoá ${deleting!.username}`);
            void qc.invalidateQueries({ queryKey: ["users"] });
            void qc.invalidateQueries({ queryKey: ["people"] });
          } catch (e) {
            toast.error(errorText(e));
            throw e;
          }
        }}
      />
    </div>
  );
}
