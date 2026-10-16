import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type Ref } from "react";
import { ImageOff, Loader2 } from "lucide-react";
import type { Box } from "@/lib/api";
import { trackColor } from "@/lib/labels";

export type Rect = { x: number; y: number; w: number; h: number };
export type CanvasTool = "select" | "draw";
export interface BoxCanvasHandle {
  fit: () => void;
  focus: (r: Rect) => void;
}

const MIN_SCALE = 0.05;
const MAX_SCALE = 12;
const MIN_BOX = 2;
const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
type Handle = (typeof HANDLES)[number];
const CURSOR: Record<Handle, string> = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize" };

type Drag =
  | { kind: "pan"; startX: number; startY: number; origin: { x: number; y: number }; moved: boolean }
  | { kind: "move" | Handle; uid: string; start: { x: number; y: number }; origin: Rect }
  | { kind: "draw"; start: { x: number; y: number } };

function resize(o: Rect, h: Handle, dx: number, dy: number): Rect {
  let { x, y, w, h: hh } = o;
  if (h.includes("w")) {
    x += dx;
    w -= dx;
  }
  if (h.includes("e")) w += dx;
  if (h.includes("n")) {
    y += dy;
    hh -= dy;
  }
  if (h.includes("s")) hh += dy;
  // dragging past the opposite edge flips the box instead of inverting it
  if (w < 0) {
    x += w;
    w = -w;
  }
  if (hh < 0) {
    y += hh;
    hh = -hh;
  }
  return { x, y, w, h: hh };
}

function clamp(r: Rect, W: number, H: number): Rect {
  const x = Math.max(0, Math.min(r.x, W - MIN_BOX));
  const y = Math.max(0, Math.min(r.y, H - MIN_BOX));
  return { x, y, w: Math.max(MIN_BOX, Math.min(r.w, W - x)), h: Math.max(MIN_BOX, Math.min(r.h, H - y)) };
}

const handlePoint = (r: Rect, h: Handle) => ({
  x: h.includes("w") ? r.x : h.includes("e") ? r.x + r.w : r.x + r.w / 2,
  y: h.includes("n") ? r.y : h.includes("s") ? r.y + r.h : r.y + r.h / 2,
});

/**
 * Frame + boxes, CVAT-like: wheel zooms on the cursor, drag empty space to pan, click a box to select,
 * drag it to move, drag a handle to resize, draw tool drags out a new box. Edits are reported on
 * release (one change per gesture) so the caller can validate them on the server.
 */
export default function BoxCanvas({
  imageUrl,
  width,
  height,
  boxes,
  selectedUid,
  editable,
  tool,
  hiddenTracks,
  highlightTracks,
  onSelect,
  onChange,
  onCreate,
  onImageSize,
  ref,
}: {
  imageUrl: string | null;
  width: number;
  height: number;
  boxes: Box[];
  selectedUid: string | null;
  editable: boolean;
  tool: CanvasTool;
  hiddenTracks?: Set<number>;
  /** Tracks involved in the selected issue — drawn emphasised. */
  highlightTracks?: Set<number>;
  onSelect: (uid: string | null) => void;
  onChange: (uid: string, rect: Rect) => void;
  onCreate: (rect: Rect) => void;
  /** Natural size of each decoded frame (lets a task without width/height learn it). */
  onImageSize?: (width: number, height: number) => void;
  ref?: Ref<BoxCanvasHandle>;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  useLayoutEffect(() => {
    viewRef.current = view;
  }, [view]);
  const drag = useRef<Drag | null>(null);
  const [draft, setDraft] = useState<{ uid: string | null; rect: Rect } | null>(null);
  // Last decoded frame: kept on screen until the next one has loaded (no flicker while scrubbing).
  const [decoded, setDecoded] = useState<{ url: string; ok: boolean; error?: string } | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  useEffect(() => {
    if (!imageUrl) return;
    const img = new Image();
    img.onload = () => {
      setDecoded({ url: imageUrl, ok: true });
      onImageSize?.(img.naturalWidth, img.naturalHeight);
    };
    img.onerror = () => {
      setDecoded({ url: imageUrl, ok: false });
      // The backend explains why (no CVAT login, media missing…) in a JSON body — show that.
      fetch(imageUrl, { credentials: "same-origin" })
        .then((r) => r.json())
        .then((b: { error?: string }) => b.error && setDecoded((d) => (d?.url === imageUrl ? { ...d, error: b.error } : d)))
        .catch(() => undefined);
    };
    img.src = imageUrl;
    return () => {
      img.onload = img.onerror = null;
    };
  }, [imageUrl, onImageSize]);
  const shownUrl = imageUrl && decoded?.ok ? decoded.url : null;
  const imgState = !imageUrl ? "none" : decoded?.url !== imageUrl ? "loading" : decoded.ok ? "ok" : "error";

  const fit = useCallback(() => {
    const el = wrapRef.current;
    if (!el || !width || !height) return;
    const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.min((el.clientWidth - 24) / width, (el.clientHeight - 24) / height)));
    setView({ scale, x: (el.clientWidth - width * scale) / 2, y: (el.clientHeight - height * scale) / 2 });
  }, [width, height]);

  const focus = useCallback((r: Rect) => {
    const el = wrapRef.current;
    if (!el) return;
    const v = viewRef.current;
    // Zoom in on small boxes, but never past 2.5x the fit-to-frame zoom: keep the surroundings visible.
    const fitScale = Math.min((el.clientWidth - 24) / width, (el.clientHeight - 24) / height);
    const want = Math.min(Math.max(v.scale, Math.min(el.clientWidth / (r.w * 6), el.clientHeight / (r.h * 6))), fitScale * 2.5);
    setView({ scale: want, x: el.clientWidth / 2 - (r.x + r.w / 2) * want, y: el.clientHeight / 2 - (r.y + r.h / 2) * want });
  }, [width, height]);

  useImperativeHandle(ref, () => ({ fit, focus }), [fit, focus]);
  useEffect(() => fit(), [fit]);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  // Native, non-passive wheel listener: zoom on the cursor without scrolling the page.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const cx = e.clientX - r.left;
      const cy = e.clientY - r.top;
      setView((v) => {
        const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, v.scale * Math.exp(-e.deltaY * 0.0015)));
        return { scale, x: cx - ((cx - v.x) * scale) / v.scale, y: cy - ((cy - v.y) * scale) / v.scale };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => e.code === "Space" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) && setSpaceHeld(true);
    const up = (e: KeyboardEvent) => e.code === "Space" && setSpaceHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const toImage = (clientX: number, clientY: number) => {
    const r = wrapRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - r.left - v.x) / v.scale, y: (clientY - r.top - v.y) / v.scale };
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const target = e.target as Element;
    const p = toImage(e.clientX, e.clientY);
    const handle = target.getAttribute("data-handle") as Handle | null;
    const uid = target.closest("[data-uid]")?.getAttribute("data-uid") ?? null;
    if (e.button === 1 || spaceHeld) {
      drag.current = { kind: "pan", startX: e.clientX, startY: e.clientY, origin: { x: view.x, y: view.y }, moved: true };
      return;
    }
    if (editable && handle && selectedUid) {
      const b = boxes.find((x) => x.uid === selectedUid)!;
      drag.current = { kind: handle, uid: selectedUid, start: p, origin: { x: b.x, y: b.y, w: b.w, h: b.h } };
      return;
    }
    if (editable && tool === "draw") {
      drag.current = { kind: "draw", start: p };
      setDraft({ uid: null, rect: { x: p.x, y: p.y, w: 0, h: 0 } });
      return;
    }
    if (uid) {
      onSelect(uid);
      const b = boxes.find((x) => x.uid === uid);
      if (editable && b) drag.current = { kind: "move", uid, start: p, origin: { x: b.x, y: b.y, w: b.w, h: b.h } };
      return;
    }
    drag.current = { kind: "pan", startX: e.clientX, startY: e.clientY, origin: { x: view.x, y: view.y }, moved: false };
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (d.kind === "pan") {
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
      setView((v) => ({ ...v, x: d.origin.x + dx, y: d.origin.y + dy }));
      return;
    }
    const p = toImage(e.clientX, e.clientY);
    if (d.kind === "draw") {
      setDraft({ uid: null, rect: clamp({ x: Math.min(d.start.x, p.x), y: Math.min(d.start.y, p.y), w: Math.abs(p.x - d.start.x), h: Math.abs(p.y - d.start.y) }, width, height) });
      return;
    }
    const dx = p.x - d.start.x;
    const dy = p.y - d.start.y;
    const rect = d.kind === "move" ? { ...d.origin, x: d.origin.x + dx, y: d.origin.y + dy } : resize(d.origin, d.kind, dx, dy);
    setDraft({ uid: d.uid, rect: clamp(rect, width, height) });
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    const result = draft;
    setDraft(null);
    if (!d) return;
    if (d.kind === "pan") {
      if (!d.moved) onSelect(null);
      return;
    }
    if (!result) return;
    if (d.kind === "draw") {
      if (result.rect.w >= 4 && result.rect.h >= 4) onCreate(result.rect);
      return;
    }
    const o = d.origin;
    const r = result.rect;
    if (Math.abs(r.x - o.x) + Math.abs(r.y - o.y) + Math.abs(r.w - o.w) + Math.abs(r.h - o.h) > 0.5) onChange(d.uid, r);
  };

  const stroke = 2 / view.scale;
  const font = 12 / view.scale;
  const hs = 7 / view.scale;
  const selected = boxes.find((b) => b.uid === selectedUid);
  const selectedRect = selected ? (draft?.uid === selected.uid ? draft.rect : selected) : null;
  const cursor = spaceHeld ? "grab" : editable && tool === "draw" ? "crosshair" : "default";

  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full touch-none select-none overflow-hidden rounded-xl bg-[#0b0a17]"
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={(e) => e.target === wrapRef.current && fit()}
    >
      <div className="absolute left-0 top-0 origin-top-left" style={{ width, height, transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
        {shownUrl ? (
          <img src={shownUrl} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full" />
        ) : (
          <div className="absolute inset-0 bg-[repeating-linear-gradient(45deg,#14112a,#14112a_20px,#100e22_20px,#100e22_40px)]" />
        )}
        <svg className="absolute inset-0 overflow-visible" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
          {boxes.map((b) => {
            if (hiddenTracks?.has(b.track_id)) return null;
            const r = draft?.uid === b.uid ? draft.rect : b;
            const color = trackColor(b.track_id);
            const isSel = b.uid === selectedUid;
            const emph = highlightTracks?.has(b.track_id);
            const label = `${b.track_id < 0 ? "untracked" : `#${b.track_id}`} ${b.class_name}`;
            return (
              <g key={b.uid} data-uid={b.uid} style={{ cursor: editable && tool === "select" ? "move" : "pointer" }}>
                <rect
                  x={r.x}
                  y={r.y}
                  width={r.w}
                  height={r.h}
                  fill={isSel ? `${color}33` : emph ? `${color}22` : "transparent"}
                  stroke={color}
                  strokeWidth={stroke * (isSel || emph ? 1.8 : 1)}
                  strokeDasharray={b.occluded ? `${6 / view.scale} ${4 / view.scale}` : undefined}
                  opacity={b.keyframe === false && !isSel ? 0.75 : 1}
                />
                <g transform={`translate(${r.x}, ${Math.max(0, r.y - font * 1.45)})`} pointerEvents="none">
                  <rect width={(label.length * font * 0.58 + font * 0.8) || 0} height={font * 1.35} rx={font * 0.25} fill={color} />
                  <text x={font * 0.4} y={font * 1.02} fontSize={font} fontWeight={600} fill="#08121f">
                    {label}
                  </text>
                </g>
              </g>
            );
          })}
          {draft && draft.uid === null && (
            <rect x={draft.rect.x} y={draft.rect.y} width={draft.rect.w} height={draft.rect.h} fill="#a596ff22" stroke="#a596ff" strokeWidth={stroke} strokeDasharray={`${6 / view.scale} ${4 / view.scale}`} />
          )}
          {editable && selectedRect &&
            HANDLES.map((h) => {
              const p = handlePoint(selectedRect, h);
              return (
                <rect
                  key={h}
                  data-handle={h}
                  x={p.x - hs / 2}
                  y={p.y - hs / 2}
                  width={hs}
                  height={hs}
                  fill="#ffffff"
                  stroke="#0f172a"
                  strokeWidth={stroke * 0.6}
                  style={{ cursor: CURSOR[h] }}
                />
              );
            })}
        </svg>
      </div>
      {imgState === "loading" && (
        <div className="pointer-events-none absolute right-3 top-3 flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-1 text-[11px] text-white">
          <Loader2 size={12} className="animate-spin" /> Đang tải frame…
        </div>
      )}
      {imgState === "error" && (
        <div className="pointer-events-none absolute right-3 top-3 flex max-w-[70%] items-center gap-1.5 rounded-md bg-red-600/80 px-2 py-1 text-[11px] text-white">
          <ImageOff size={12} /> {decoded?.error ?? "Không tải được ảnh frame (kiểm tra media / tài khoản CVAT)"}
        </div>
      )}
      <div className="pointer-events-none absolute bottom-2 right-3 rounded bg-black/50 px-1.5 py-0.5 font-mono text-[10px] text-white/80">{Math.round(view.scale * 100)}%</div>
    </div>
  );
}
