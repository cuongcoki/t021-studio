import { useState } from "react";
import { ArrowLeftRight, Eye, EyeOff, Flag, Link2, Save, Trash2 } from "lucide-react";
import type { Box } from "@/lib/api";
import { trackColor } from "@/lib/labels";
import { inputClass } from "@/components/common";
import { cn } from "@/lib/utils";

export interface TrackInfo {
  id: number;
  class_name: string;
  first: number;
  last: number;
  count: number;
}

/** Boxes on the current frame + the selected box's fields and ID tools. */
export function ObjectsPanel({
  frameBoxes,
  selected,
  labels,
  editable,
  canReport,
  onSelect,
  onUpdate,
  onDelete,
  onStitch,
  onSwap,
  onReport,
}: {
  frameBoxes: Box[];
  selected: Box | null;
  labels: string[];
  editable: boolean;
  canReport: boolean;
  onSelect: (uid: string) => void;
  onUpdate: (fields: Partial<Box>) => void;
  onDelete: () => void;
  onStitch: (target: number) => void;
  onSwap: (other: number) => void;
  onReport: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
        <p className="mb-1.5 text-[11px] font-semibold uppercase text-muted-foreground">Trong frame này ({frameBoxes.length})</p>
        {frameBoxes.length === 0 && <p className="py-4 text-center text-xs text-muted-foreground">Frame không có box.{editable && " Chọn công cụ Vẽ box (N) để thêm."}</p>}
        <div className="space-y-1">
          {frameBoxes.map((b) => (
            <button
              key={b.uid}
              type="button"
              onClick={() => onSelect(b.uid)}
              className={`flex w-full items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-xs ${selected?.uid === b.uid ? "border-primary bg-primary/10" : "border-border hover:bg-muted/60"}`}
            >
              <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: trackColor(b.track_id) }} />
              <span className="font-mono font-semibold">{b.track_id < 0 ? "—" : `#${b.track_id}`}</span>
              <span className="truncate">{b.class_name}</span>
              <span className="ml-auto text-[10px] text-muted-foreground">
                {Math.round(b.w)}×{Math.round(b.h)}
                {b.keyframe === false && " · nội suy"}
                {b.occluded && " · che"}
              </span>
            </button>
          ))}
        </div>
      </div>
      {selected && (
        <Inspector
          key={`${selected.uid}:${selected.x}:${selected.y}:${selected.w}:${selected.h}:${selected.track_id}:${selected.class_name}:${selected.occluded}`}
          selected={selected}
          labels={labels}
          editable={editable}
          canReport={canReport}
          onUpdate={onUpdate}
          onDelete={onDelete}
          onStitch={onStitch}
          onSwap={onSwap}
          onReport={onReport}
        />
      )}
    </div>
  );
}

function Inspector({
  selected,
  labels,
  editable,
  canReport,
  onUpdate,
  onDelete,
  onStitch,
  onSwap,
  onReport,
}: {
  selected: Box;
  labels: string[];
  editable: boolean;
  canReport: boolean;
  onUpdate: (fields: Partial<Box>) => void;
  onDelete: () => void;
  onStitch: (target: number) => void;
  onSwap: (other: number) => void;
  onReport: () => void;
}) {
  const [form, setForm] = useState<Partial<Box>>({
    track_id: selected.track_id,
    class_name: selected.class_name,
    occluded: !!selected.occluded,
    x: selected.x,
    y: selected.y,
    w: selected.w,
    h: selected.h,
  });
  const [otherId, setOtherId] = useState("");
  const changed = (Object.keys(form) as (keyof Box)[]).some((k) => form[k] !== (k === "occluded" ? !!selected.occluded : selected[k]));
  const num = (k: "x" | "y" | "w" | "h" | "track_id") => (
    <label className="text-[10px] text-muted-foreground">
      {k === "track_id" ? "Track ID" : k.toUpperCase()}
      <input
        type="number"
        step={k === "track_id" ? 1 : 0.1}
        disabled={!editable}
        value={form[k] ?? ""}
        onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value === "" ? undefined : Number(e.target.value) }))}
        className={cn(inputClass, "px-2 py-1 text-xs")}
      />
    </label>
  );

  return (
        <div className="space-y-2 border-t border-border p-2.5">
          <p className="text-[11px] font-semibold uppercase text-muted-foreground">Box đang chọn</p>
          <div className="grid grid-cols-2 gap-1.5">
            {num("track_id")}
            <label className="text-[10px] text-muted-foreground">
              Class
              <input
                list="t021-labels"
                disabled={!editable}
                value={form.class_name ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, class_name: e.target.value }))}
                className={cn(inputClass, "px-2 py-1 text-xs")}
              />
              <datalist id="t021-labels">
                {labels.map((l) => (
                  <option key={l} value={l} />
                ))}
              </datalist>
            </label>
            {num("x")}
            {num("y")}
            {num("w")}
            {num("h")}
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" disabled={!editable} checked={!!form.occluded} onChange={(e) => setForm((f) => ({ ...f, occluded: e.target.checked }))} /> Bị che (occluded)
          </label>
          {editable ? (
            <>
              <div className="flex gap-1.5">
                <button type="button" disabled={!changed} onClick={() => onUpdate(form)} className="primary-action h-8 flex-1 justify-center px-2 text-xs disabled:opacity-40">
                  <Save size={13} /> Áp dụng
                </button>
                <button type="button" onClick={onDelete} className="secondary-action h-8 px-2 text-xs text-destructive" title="Xoá box (Delete)">
                  <Trash2 size={13} />
                </button>
              </div>
              {selected.track_id >= 0 && (
                <div className="rounded-lg bg-muted/50 p-2">
                  <p className="text-[10px] text-muted-foreground">Từ frame {selected.frame_id} trở đi, track #{selected.track_id} với ID:</p>
                  <div className="mt-1 flex gap-1">
                    <input
                      type="number"
                      value={otherId}
                      onChange={(e) => setOtherId(e.target.value)}
                      placeholder="ID khác"
                      className={cn(inputClass, "w-20 px-2 py-1 text-xs")}
                    />
                    <button type="button" disabled={!otherId} onClick={() => onStitch(Number(otherId))} className="secondary-action h-7 flex-1 px-1.5 text-[11px] disabled:opacity-40" title="Đổi ID của đoạn này thành ID kia (nối vào track kia)">
                      <Link2 size={12} /> Nối ID
                    </button>
                    <button type="button" disabled={!otherId} onClick={() => onSwap(Number(otherId))} className="secondary-action h-7 flex-1 px-1.5 text-[11px] disabled:opacity-40" title="Hoán đổi hai ID từ frame này">
                      <ArrowLeftRight size={12} /> Swap
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            canReport && (
              <button type="button" onClick={onReport} className="secondary-action h-8 w-full justify-center text-xs text-amber-600 dark:text-amber-300">
                <Flag size={13} /> Báo lỗi box này cho Annotator
              </button>
            )
          )}
        </div>
  );
}

export function TracksPanel({
  tracks,
  hidden,
  currentFrame,
  onToggle,
  onJump,
}: {
  tracks: TrackInfo[];
  hidden: Set<number>;
  currentFrame: number;
  onToggle: (id: number) => void;
  onJump: (t: TrackInfo) => void;
}) {
  const [q, setQ] = useState("");
  const shown = tracks.filter((t) => !q || String(t.id).includes(q) || t.class_name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border p-2.5">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm track ID / class…" className={cn(inputClass, "py-1 text-xs")} />
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2.5">
        {shown.map((t) => {
          const here = currentFrame >= t.first && currentFrame <= t.last;
          return (
            <div key={t.id} className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-xs ${here ? "border-primary/40" : "border-border"}`}>
              <button type="button" onClick={() => onToggle(t.id)} className="text-muted-foreground hover:text-foreground" title={hidden.has(t.id) ? "Hiện" : "Ẩn"}>
                {hidden.has(t.id) ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
              <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: trackColor(t.id) }} />
              <button type="button" onClick={() => onJump(t)} className="min-w-0 flex-1 text-left">
                <span className="font-mono font-semibold">{t.id < 0 ? "rời" : `#${t.id}`}</span> <span className="text-muted-foreground">{t.class_name}</span>
                <span className="block text-[10px] text-muted-foreground">
                  f{t.first}–{t.last} · {t.count} box
                </span>
              </button>
            </div>
          );
        })}
        {shown.length === 0 && <p className="py-6 text-center text-xs text-muted-foreground">Không có track.</p>}
      </div>
    </div>
  );
}
