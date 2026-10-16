import { useParams, Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { api, errorText, type TaskDetail } from "@/lib/api";
import Workspace from "./Workspace";

export default function WorkspacePage() {
  const { taskId } = useParams();
  const { data, error, isLoading } = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => api<{ project: TaskDetail }>("projects/open", { id: taskId }).then((r) => r.project),
    // The workspace keeps its own edited copy; don't overwrite it in the background.
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="animate-spin" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="p-8 text-center text-sm">
        <p className="text-destructive">{errorText(error)}</p>
        <Link to="/tasks" className="mt-2 inline-block text-primary hover:underline">
          ← Về danh sách task
        </Link>
      </div>
    );
  }
  const s = data.state ?? {};
  return (
    <Workspace
      key={data.id}
      task={data}
      initial={{
        boxes: s.boxes ?? [],
        meta: s.meta ?? { frame_base: data.cvat?.start_frame ?? 0 },
        media: s.media ?? { kind: "none" },
        sourceName: s.source_name ?? data.source_name ?? "",
        videoStart: s.video_start,
        videoStep: s.video_step,
        frame: s.frame,
        session: data.session,
      }}
    />
  );
}
