import { useState } from "react";
import { Link } from "react-router";
import toast from "react-hot-toast";
import { ArrowLeft, FileSearch, Loader2 } from "lucide-react";
import { errorText } from "@/lib/api";
import { Field, inputClass } from "@/components/common";
import { parseAnnotationFile, uploadMedia } from "@/lib/queries";
import Workspace, { type WorkspaceData } from "./Workspace";

/** Open an annotation file (any role) to look at it and scan it — nothing is stored. */
export default function PreviewPage() {
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [annotation, setAnnotation] = useState<File | null>(null);
  const [media, setMedia] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  if (data) return <Workspace key={data.sourceName} initial={data} />;

  const open = async () => {
    if (!annotation) return;
    setBusy(true);
    try {
      const p = await parseAnnotationFile(annotation);
      const m = media ? await uploadMedia(media, p.total_frames) : null;
      (p.warnings ?? []).forEach((w) => toast(w, { icon: "⚠️" }));
      setData({
        boxes: p.boxes,
        meta: { format: p.format, mode: p.mode, frame_base: p.frame_base, width: p.width, height: p.height, total_frames: p.total_frames, labels: p.labels },
        media: m?.media ?? { kind: "none" },
        sourceName: annotation.name,
        session: p.session,
      });
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl p-5">
      <Link to="/tasks" className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft size={13} /> Danh sách task
      </Link>
      <div className="surface space-y-4 p-5">
        <div className="flex items-center gap-3">
          <span className="icon-tile">
            <FileSearch size={18} />
          </span>
          <div>
            <h1 className="text-base font-semibold">Xem nhanh file annotation</h1>
            <p className="text-xs text-muted-foreground">Mở để xem và quét lỗi — không tạo task, không lưu. Muốn lưu QC, hãy mở task do Annotator tạo.</p>
          </div>
        </div>
        <Field label="File annotation" hint="CVAT XML, MOT TXT/CSV, COCO / Datumaro JSON, .t021.json hoặc ZIP">
          <input type="file" accept=".xml,.txt,.csv,.mot,.json,.zip" onChange={(e) => setAnnotation(e.target.files?.[0] ?? null)} className={inputClass} />
        </Field>
        <Field label="Ảnh / video (không bắt buộc)" hint="frames.zip hoặc video (cần FFmpeg trên máy chủ)">
          <input type="file" accept=".zip,video/*,.mkv,.avi" onChange={(e) => setMedia(e.target.files?.[0] ?? null)} className={inputClass} />
        </Field>
        <button type="button" disabled={!annotation || busy} onClick={() => void open()} className="primary-action disabled:opacity-50">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <FileSearch size={15} />} Mở để xem
        </button>
      </div>
    </div>
  );
}
