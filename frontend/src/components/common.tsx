import { useState, type ReactNode } from "react";
import { Loader2, type LucideIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { TaskStatus } from "@/lib/api";
import { STATUS_LABEL, STATUS_STYLE } from "@/lib/labels";

export function PageHeader({ icon: Icon, title, subtitle, actions }: { icon: LucideIcon; title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <span className="icon-tile">
          <Icon size={18} />
        </span>
        <div>
          <h1 className="text-lg font-semibold">{title}</h1>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[status] ?? ""}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-60";

export function Empty({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-14 text-center text-muted-foreground">
      <Icon size={30} className="opacity-60" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      {children && <div className="max-w-md text-xs">{children}</div>}
    </div>
  );
}

/** Yes/no dialog; with `typeToConfirm` the button unlocks only after typing that word. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  danger,
  typeToConfirm,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  typeToConfirm?: string;
  onConfirm: () => Promise<unknown> | void;
  children?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState("");
  const locked = !!typeToConfirm && typed.trim() !== typeToConfirm;
  const run = async () => {
    setBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
      setTyped("");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && (onOpenChange(o), setTyped(""))}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className={danger ? "text-destructive" : ""}>{title}</DialogTitle>
          {description && <DialogDescription asChild><div>{description}</div></DialogDescription>}
        </DialogHeader>
        {children}
        {typeToConfirm && (
          <Field label={`Gõ "${typeToConfirm}" để xác nhận`}>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} className={inputClass} autoFocus />
          </Field>
        )}
        <DialogFooter>
          <button type="button" className="secondary-action" disabled={busy} onClick={() => onOpenChange(false)}>
            Huỷ
          </button>
          <button
            type="button"
            disabled={busy || locked}
            onClick={() => void run()}
            className={
              danger
                ? "inline-flex items-center gap-2 rounded-lg bg-destructive px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                : "primary-action disabled:opacity-50"
            }
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            {confirmLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function StatCard({ icon: Icon, label, value, hint, tone = "primary" }: { icon: LucideIcon; label: string; value: ReactNode; hint?: string; tone?: "primary" | "amber" | "emerald" | "violet" | "sky" }) {
  const tones = {
    primary: "bg-primary/12 text-primary",
    amber: "bg-amber-500/12 text-amber-500",
    emerald: "bg-emerald-500/12 text-emerald-500",
    violet: "bg-violet-500/12 text-violet-500",
    sky: "bg-sky-500/12 text-sky-500",
  };
  return (
    <div className="surface flex items-center gap-3 p-4">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tones[tone]}`}>
        <Icon size={18} />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="text-xl font-semibold leading-tight">{value}</p>
        {hint && <p className="truncate text-[11px] text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
}
