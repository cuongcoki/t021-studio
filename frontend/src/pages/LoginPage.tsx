import { useState, type FormEvent } from "react";
import { Loader2, LogIn, ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/useAuth";
import { errorText } from "@/lib/api";
import { ROLE_HINT, ROLE_LABEL } from "@/lib/labels";

export default function LoginPage() {
  const { login, needsSetup } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="neon-grid flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-sm font-black text-primary-foreground">T21</div>
          <div>
            <h1 className="text-xl font-bold">Track ID QA Studio</h1>
            <p className="text-xs text-muted-foreground">Kiểm tra liên tục Track ID · QC Reviewer ↔ Annotator</p>
          </div>
        </div>
        <form onSubmit={submit} className="surface space-y-4 p-6">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold">
              {needsSetup ? <ShieldCheck size={18} className="text-primary" /> : <LogIn size={18} className="text-primary" />}
              {needsSetup ? "Khởi tạo tài khoản Admin" : "Đăng nhập"}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {needsSetup
                ? "Lần chạy đầu: tạo tài khoản quản trị. Sau đó Admin tạo tài khoản Annotator / Reviewer ở trang Tài khoản."
                : "Dùng tài khoản do Admin cấp."}
            </p>
          </div>
          <label className="block space-y-1 text-sm">
            <span className="font-medium">Tên tài khoản</span>
            <input
              autoFocus
              required
              minLength={3}
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 outline-none focus:border-primary"
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span className="font-medium">Mật khẩu {needsSetup && <span className="text-muted-foreground">(ít nhất 8 ký tự)</span>}</span>
            <input
              required
              type="password"
              minLength={needsSetup ? 8 : 1}
              autoComplete={needsSetup ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 outline-none focus:border-primary"
            />
          </label>
          {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
          <button type="submit" disabled={busy} className="primary-action w-full justify-center disabled:opacity-60">
            {busy && <Loader2 size={15} className="animate-spin" />}
            {needsSetup ? "Tạo Admin & đăng nhập" : "Đăng nhập"}
          </button>
        </form>
        <div className="mt-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
          {(["admin", "annotator", "reviewer"] as const).map((r) => (
            <div key={r} className="rounded-lg border border-border bg-card/60 px-3 py-2">
              <b className="text-foreground">{ROLE_LABEL[r]}</b>
              <p className="mt-0.5 leading-4">{ROLE_HINT[r]}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
