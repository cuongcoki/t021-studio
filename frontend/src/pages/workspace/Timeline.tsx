import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Pause, Play } from "lucide-react";
import type { Issue } from "@/lib/api";

const SEV_COLOR = { high: "bg-red-500", medium: "bg-amber-500", low: "bg-sky-500" } as const;

/** Frame scrubber with issue markers; ← / → step, Shift ×10, P play. */
export default function Timeline({
  frame,
  start,
  end,
  issues,
  annotated,
  onFrame,
}: {
  frame: number;
  start: number;
  end: number;
  issues: Issue[];
  /** Frames that have at least one box (drawn as a faint coverage strip). */
  annotated: Set<number>;
  onFrame: (f: number) => void;
}) {
  const [playing, setPlaying] = useState(false);
  const [fps, setFps] = useState(5);
  const [typed, setTyped] = useState<string | null>(null);
  const span = Math.max(1, end - start);

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => onFrame(frame >= end ? start : frame + 1), 1000 / fps);
    return () => clearInterval(t);
  }, [playing, frame, start, end, fps, onFrame]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === "ArrowRight") onFrame(Math.min(end, frame + (e.shiftKey ? 10 : 1)));
      else if (e.key === "ArrowLeft") onFrame(Math.max(start, frame - (e.shiftKey ? 10 : 1)));
      else if (e.key.toLowerCase() === "p") setPlaying((p) => !p);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [frame, start, end, onFrame]);

  // Coverage strip: up to 400 buckets, filled when any frame inside has a box.
  const buckets = Math.min(400, span + 1);
  const filled = new Array(buckets).fill(false);
  for (const f of annotated) {
    if (f >= start && f <= end) filled[Math.min(buckets - 1, Math.floor(((f - start) / (span + 1)) * buckets))] = true;
  }

  const btn = "rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground";
  return (
    <div className="surface flex items-center gap-2 px-3 py-2">
      <button type="button" className={btn} onClick={() => onFrame(start)} title="Frame đầu">
        <ChevronsLeft size={15} />
      </button>
      <button type="button" className={btn} onClick={() => onFrame(Math.max(start, frame - 1))} title="Frame trước (←)">
        <ChevronLeft size={15} />
      </button>
      <button type="button" onClick={() => setPlaying((p) => !p)} className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground" title="Phát / dừng (P)">
        {playing ? <Pause size={14} /> : <Play size={14} />}
      </button>
      <button type="button" className={btn} onClick={() => onFrame(Math.min(end, frame + 1))} title="Frame sau (→)">
        <ChevronRight size={15} />
      </button>
      <button type="button" className={btn} onClick={() => onFrame(end)} title="Frame cuối">
        <ChevronsRight size={15} />
      </button>

      <div className="relative mx-2 h-9 min-w-0 flex-1">
        <div className="absolute inset-x-0 top-1 flex h-1.5 overflow-hidden rounded-full bg-muted">
          {filled.map((on, i) => (
            <div key={i} className={on ? "bg-primary/35" : ""} style={{ width: `${100 / buckets}%` }} />
          ))}
        </div>
        {issues.slice(0, 600).map((i) => (
          <button
            key={i.id}
            type="button"
            title={`${i.type} · frame ${i.frame} · track ${i.track_id}`}
            onClick={() => onFrame(i.frame)}
            className={`absolute top-3.5 h-3 w-1 -translate-x-1/2 rounded-sm ${SEV_COLOR[i.severity] ?? "bg-sky-500"} opacity-80 hover:opacity-100`}
            style={{ left: `${((i.frame - start) / span) * 100}%` }}
          />
        ))}
        <input
          type="range"
          min={start}
          max={end}
          value={frame}
          onChange={(e) => onFrame(Number(e.target.value))}
          className="absolute inset-x-0 bottom-0 w-full accent-[var(--primary)]"
          aria-label="Frame"
        />
      </div>

      <input
        value={typed ?? String(frame)}
        onFocus={() => setTyped(String(frame))}
        onChange={(e) => setTyped(e.target.value.replace(/\D/g, ""))}
        onBlur={() => setTyped(null)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && typed) {
            onFrame(Math.max(start, Math.min(end, Number(typed))));
            (e.target as HTMLInputElement).blur();
          }
        }}
        className="w-16 rounded-md border border-input bg-background px-2 py-1 text-center font-mono text-xs"
        aria-label="Đến frame"
      />
      <span className="font-mono text-[11px] text-muted-foreground">/ {end}</span>
      <select value={fps} onChange={(e) => setFps(Number(e.target.value))} className="rounded-md border border-input bg-background px-1.5 py-1 text-xs" aria-label="Tốc độ phát">
        {[2, 5, 10, 15, 30].map((v) => (
          <option key={v} value={v}>
            {v} fps
          </option>
        ))}
      </select>
    </div>
  );
}
