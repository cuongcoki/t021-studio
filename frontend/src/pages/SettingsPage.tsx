import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { CheckCircle2, Link2, Loader2, PlugZap, Settings, Unplug } from "lucide-react";
import { api, errorText } from "@/lib/api";
import { useAuth } from "@/lib/useAuth";
import { Field, PageHeader, inputClass } from "@/components/common";

interface AccountStatus {
  configured: boolean;
  url?: string;
  cvat_user?: string;
  saved_at?: string;
}

export default function SettingsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const status = useQuery({ queryKey: ["cvat-account"], queryFn: () => api<AccountStatus>("cvat/account") });
  const [url, setUrl] = useState("http://localhost:8080");
  const [mode, setMode] = useState<"password" | "token">("password");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["cvat-account"] });
    void qc.invalidateQueries({ queryKey: ["cvat-jobs"] });
  };

  const save = useMutation({
    mutationFn: () => api<{ cvat_user: string; cvat_version: string }>("cvat/account/save", mode === "token" ? { url, token } : { url, username, password }),
    onSuccess: (r) => {
      setPassword("");
      setToken("");
      refresh();
      toast.success(`Đã kết nối CVAT ${r.cvat_version ?? ""} với tài khoản ${r.cvat_user}`);
    },
    onError: (e) => toast.error(errorText(e), { duration: 7000 }),
  });
  const test = useMutation({
    mutationFn: () => api<{ cvat_user: string; cvat_version: string }>("cvat/account/test"),
    onSuccess: (r) => toast.success(`Kết nối tốt: CVAT ${r.cvat_version}, tài khoản ${r.cvat_user}`),
    onError: (e) => toast.error(errorText(e), { duration: 7000 }),
  });
  const remove = useMutation({
    mutationFn: () => api("cvat/account/delete"),
    onSuccess: () => {
      refresh();
      toast.success("Đã gỡ kết nối CVAT của bạn");
    },
  });
  const s = status.data;

  return (
    <div className="mx-auto max-w-3xl p-5">
      <PageHeader icon={Settings} title="Cài đặt" subtitle={`Kết nối CVAT riêng cho tài khoản ${user?.username}`} />

      <section className="surface p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Link2 size={16} className="text-primary" /> Kết nối CVAT
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Mỗi người dùng nhập tài khoản CVAT của chính mình — dùng để lấy job về tạo task, xem ảnh frame và đẩy nhãn đã sửa lên CVAT. Mật khẩu chỉ dùng một
          lần để lấy token; máy chủ T021 chỉ lưu token và không bao giờ gửi nó xuống trình duyệt.
        </p>

        {s?.configured && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm">
            <CheckCircle2 size={18} className="text-emerald-500" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">Đã kết nối {s.url}</p>
              <p className="text-xs text-muted-foreground">Tài khoản CVAT: {s.cvat_user}</p>
            </div>
            <button type="button" disabled={test.isPending} onClick={() => test.mutate()} className="secondary-action h-8 px-3 text-xs">
              {test.isPending ? <Loader2 size={13} className="animate-spin" /> : <PlugZap size={13} />} Kiểm tra
            </button>
            <button type="button" onClick={() => remove.mutate()} className="secondary-action h-8 px-3 text-xs text-destructive">
              <Unplug size={13} /> Gỡ kết nối
            </button>
          </div>
        )}

        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Field label="Địa chỉ CVAT" hint="CVAT local thường là http://localhost:8080">
            <input required value={url} onChange={(e) => setUrl(e.target.value)} className={inputClass} />
          </Field>
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 text-sm">
            {(
              [
                ["password", "Tài khoản + mật khẩu"],
                ["token", "Token (Personal access token)"],
              ] as const
            ).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setMode(k)} className={`rounded-md py-1.5 ${mode === k ? "bg-card font-medium shadow-sm" : "text-muted-foreground"}`}>
                {label}
              </button>
            ))}
          </div>
          {mode === "password" ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Tài khoản CVAT">
                <input required autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} className={inputClass} />
              </Field>
              <Field label="Mật khẩu CVAT">
                <input required type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
              </Field>
            </div>
          ) : (
            <Field label="Token">
              <input required autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} className={inputClass} />
            </Field>
          )}
          <button type="submit" disabled={save.isPending} className="primary-action disabled:opacity-50">
            {save.isPending ? <Loader2 size={14} className="animate-spin" /> : <PlugZap size={15} />}
            {s?.configured ? "Lưu kết nối mới" : "Kết nối CVAT"}
          </button>
        </form>
      </section>
    </div>
  );
}
