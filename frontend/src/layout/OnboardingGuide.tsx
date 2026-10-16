import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import {
  BadgeCheck,
  ClipboardList,
  CloudDownload,
  CloudUpload,
  Flag,
  FolderKanban,
  Keyboard,
  MousePointer2,
  ScanSearch,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Role } from "@/lib/api";
import { ROLE_LABEL } from "@/lib/labels";
import { cn } from "@/lib/utils";

interface Step {
  icon: LucideIcon;
  title: string;
  body: ReactNode;
  /** a page this step happens on — "Mở trang" button */
  to?: string;
}

const intro = (what: ReactNode): Step => ({
  icon: Sparkles,
  title: "Chào mừng đến T021 Track ID QA",
  body: (
    <>
      <p>
        Công cụ kiểm tra chất lượng nhãn <b>tracking 2D</b>: tìm box đứt quãng,
        box nhảy, nghi đổi ID, box trùng… rồi sửa và QC theo vòng
        <b> Annotator → Reviewer</b>.
      </p>
      <p className="mt-2">{what}</p>
      <div className="mt-3 grid grid-cols-4 gap-1.5 text-center text-[11px]">
        {["Đang gán nhãn", "Chờ QC", "Cần sửa", "Hoàn tất"].map((s, i) => (
          <div
            key={s}
            className="rounded-lg border border-border bg-muted/40 px-1 py-2"
          >
            <span className="block text-[10px] text-muted-foreground">
              Bước {i + 1}
            </span>
            {s}
          </div>
        ))}
      </div>
    </>
  ),
});

const STEPS: Record<Role, Step[]> = {
  admin: [
    intro(
      "Bạn là Admin: quản lý tài khoản, tổ chức Project / Task và giao việc. Admin không sửa nhãn và không QC.",
    ),
    {
      icon: Users,
      title: "1. Tạo tài khoản cho nhóm",
      to: "/users",
      body: (
        <ul>
          <li>
            Trang <b>Tài khoản</b> → <b>Tạo tài khoản</b>, chọn vai trò
            Annotator hoặc Reviewer.
          </li>
          <li>
            Tìm kiếm, lọc theo vai trò / trạng thái; khoá tài khoản thay vì xoá
            nếu chỉ tạm nghỉ.
          </li>
          <li>
            Đặt lại mật khẩu cho người quên — người đó phải đăng nhập lại.
          </li>
        </ul>
      ),
    },
    {
      icon: FolderKanban,
      title: "2. Tạo Project",
      to: "/projects",
      body: (
        <ul>
          <li>Project là nhóm nhiều Task (ví dụ “Dashcam tháng 10”).</li>
          <li>
            Đổi tên / xoá ở trang Project. Xoá Project <b>không xoá task</b>,
            task chỉ bị bỏ nhóm.
          </li>
        </ul>
      ),
    },
    {
      icon: ClipboardList,
      title: "3. Tạo Task và giao việc",
      to: "/tasks",
      body: (
        <ul>
          <li>
            <b>Tạo task</b> → tab <b>Từ CVAT</b> (lấy job đang có trên CVAT)
            hoặc <b>Từ file</b> (MOT/JSON + ảnh frame).
          </li>
          <li>
            Chọn Annotator và Reviewer phụ trách. Bấm biểu tượng sửa trên dòng
            task để giao lại.
          </li>
          <li>
            Lọc theo Project, trạng thái, người làm; trang Tổng quan cho biết
            task nào đang kẹt.
          </li>
        </ul>
      ),
    },
    {
      icon: Settings,
      title: "4. Kết nối CVAT (nếu dùng)",
      to: "/settings",
      body: (
        <p>
          Mỗi người tự nhập tài khoản CVAT của mình ở <b>Cài đặt · CVAT</b>. Hệ
          thống chỉ giữ token, không lưu mật khẩu. Reviewer chưa kết nối vẫn xem
          được frame qua tài khoản của người đã kéo task.
        </p>
      ),
    },
  ],
  annotator: [
    intro(
      "Bạn là Annotator: tạo task, nhập dữ liệu, sửa box / ID, gửi QC, xuất annotation và đẩy nhãn về CVAT.",
    ),
    {
      icon: CloudDownload,
      title: "1. Kết nối CVAT và tạo task",
      to: "/tasks",
      body: (
        <ul>
          <li>
            Vào <b>Cài đặt · CVAT</b> nhập URL (ví dụ http://localhost:8080),
            tài khoản, mật khẩu → <b>Kết nối CVAT</b>.
          </li>
          <li>
            Trang Task → <b>Tạo task</b> → <b>Từ CVAT</b> chọn job, hoặc{" "}
            <b>Từ file</b> tải annotation (MOT / JSON) kèm ảnh frame (zip).
          </li>
        </ul>
      ),
    },
    {
      icon: ScanSearch,
      title: "2. Quét lỗi và sửa",
      body: (
        <ul>
          <li>
            Mở task → bấm <b>Quét lỗi</b> ở cột phải. Bấm một lỗi để nhảy tới
            đúng frame và box.
          </li>
          <li>
            Lỗi có nút sửa nhanh: <b>Nối ID</b>, <b>Nội suy frame thiếu</b>,{" "}
            <b>Xoá box trùng</b>, <b>Thống nhất class</b>. Sửa xong bấm{" "}
            <b>Quét lại</b>.
          </li>
          <li>
            Sửa tay: kéo box để di chuyển, kéo 8 tay nắm để đổi cỡ, phím N để vẽ
            box mới; đổi ID / class ở bảng Đối tượng.
          </li>
        </ul>
      ),
    },
    {
      icon: Keyboard,
      title: "3. Phím tắt hay dùng",
      body: (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          {[
            ["Ctrl + S", "Lưu"],
            ["Ctrl + Z / Ctrl + Y", "Hoàn tác / làm lại"],
            ["V", "Chọn / kéo box"],
            ["N", "Vẽ box mới"],
            ["F", "Vừa khung hình"],
            ["Delete", "Xoá box đang chọn"],
            ["Esc", "Bỏ chọn"],
            ["?", "Xem tất cả phím tắt"],
          ].map(([k, v]) => (
            <div
              key={k}
              className="flex items-center justify-between gap-2 border-b border-border/60 py-1"
            >
              <kbd className="rounded border border-border bg-muted px-1.5 font-mono text-[11px]">
                {k}
              </kbd>
              <span className="text-muted-foreground">{v}</span>
            </div>
          ))}
        </div>
      ),
    },
    {
      icon: Send,
      title: "4. Gửi QC và xử lý phản hồi",
      body: (
        <ul>
          <li>
            Lưu xong bấm <b>Gửi QC</b>: task chuyển sang <b>Chờ QC</b> cho
            Reviewer.
          </li>
          <li>
            Reviewer trả lỗi → task thành <b>Cần sửa</b>. Mở mục lỗi, sửa, rồi
            bấm <b>Đã sửa · gửi lại QC</b> (ghi rõ đã sửa gì).
          </li>
        </ul>
      ),
    },
    {
      icon: CloudUpload,
      title: "5. Xuất annotation và đẩy về CVAT",
      body: (
        <ul>
          <li>
            Menu <b>…</b> trong task → <b>Xuất annotation</b> (CVAT XML / MOT /
            JSON).
          </li>
          <li>
            Task lấy từ CVAT có nút <b>Đẩy CVAT</b>: <b>ghi đè</b> toàn bộ nhãn
            của job đã liên kết (hệ thống tự sao lưu bản cũ trước). Gõ số job để
            xác nhận.
          </li>
        </ul>
      ),
    },
  ],
  reviewer: [
    intro(
      "Bạn là Reviewer: mở task để QC và gửi lỗi cho Annotator. Reviewer không sửa được nhãn — chỉ xem, đánh dấu và duyệt.",
    ),
    {
      icon: ClipboardList,
      title: "1. Tìm task cần QC",
      to: "/tasks",
      body: (
        <ul>
          <li>
            Trang <b>Tổng quan</b> liệt kê việc của bạn; trang Task lọc trạng
            thái <b>Chờ QC</b>.
          </li>
          <li>
            Muốn xem nhanh một file không cần tạo task: dùng{" "}
            <b>Xem nhanh file</b>.
          </li>
        </ul>
      ),
    },
    {
      icon: ScanSearch,
      title: "2. Quét và kiểm tra",
      body: (
        <ul>
          <li>
            Bấm <b>Quét lỗi</b>. Bấm từng lỗi để xem đúng frame; dùng thanh thời
            gian (timeline) để tua.
          </li>
          <li>
            Lỗi thật → <b>Gửi Annotator</b> kèm mô tả cần sửa gì. Tool báo nhầm
            → <b>Không phải lỗi</b>.
          </li>
          <li>
            Lỗi tool không tự thấy: chọn box →{" "}
            <b>Báo lỗi box này cho Annotator</b>.
          </li>
        </ul>
      ),
    },
    {
      icon: Flag,
      title: "3. Kiểm tra lại phần đã sửa",
      body: (
        <p>
          Khi Annotator báo <b>Đã sửa · chờ QC</b>, mở lại lỗi đó: đúng thì{" "}
          <b>Xác nhận đã sửa xong</b>, chưa đúng thì <b>Yêu cầu sửa tiếp</b>.
        </p>
      ),
    },
    {
      icon: ShieldCheck,
      title: "4. Quality Gate và duyệt xong",
      body: (
        <ul>
          <li>
            <b>Quality Gate</b> đạt khi: không còn lỗi cấu trúc, không còn lỗi
            mức cao chưa xử lý, không còn yêu cầu sửa đang mở.
          </li>
          <li>
            Đạt thì bấm <b>Duyệt xong</b> → task thành <b>Hoàn tất</b>.
          </li>
          <li>
            Cần số liệu: menu <b>…</b> → <b>Benchmark với GT</b> để đo Precision
            / Recall với file đáp án.
          </li>
        </ul>
      ),
    },
  ],
};

const seenKey = (username: string) => `t021-guide-seen:${username}`;

function guideSeen(username: string) {
  try {
    return localStorage.getItem(seenKey(username)) === "1";
  } catch {
    return true; // storage blocked: don't pop the guide on every page load
  }
}

/** Opens by itself the first time each account signs in; the sidebar "Hướng dẫn" button reopens it. */
export function OnboardingGuide({
  role,
  username,
  open,
  onClose,
}: {
  role: Role;
  username: string;
  open: boolean;
  onClose: () => void;
}) {
  const [auto, setAuto] = useState(() => !guideSeen(username));
  if (!open && !auto) return null;
  return (
    <GuideDialog
      role={role}
      username={username}
      onClose={() => {
        setAuto(false);
        onClose();
      }}
    />
  );
}

function GuideDialog({
  role,
  username,
  onClose,
}: {
  role: Role;
  username: string;
  onClose: () => void;
}) {
  const steps = STEPS[role];
  const [i, setI] = useState(0);
  const navigate = useNavigate();
  const step = steps[i];
  const last = i === steps.length - 1;
  const close = () => {
    try {
      localStorage.setItem(seenKey(username), "1");
    } catch {
      /* not remembered: it opens again next time */
    }
    onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-primary">
            Hướng dẫn cho {ROLE_LABEL[role]} · {i + 1}/{steps.length}
          </p>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <step.icon size={17} />
            </span>
            {step.title}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Hướng dẫn sử dụng theo vai trò
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-44 text-sm leading-relaxed [&_li]:ml-4 [&_li]:list-disc [&_li]:py-0.5">
          {step.body}
        </div>
        <div className="flex justify-center gap-1.5">
          {steps.map((_, k) => (
            <button
              key={k}
              type="button"
              aria-label={`Bước ${k + 1}`}
              onClick={() => setI(k)}
              className={cn(
                "h-1.5 rounded-full transition-all",
                k === i ? "w-6 bg-primary" : "w-1.5 bg-muted-foreground/30",
              )}
            />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={close}
          >
            Bỏ qua
          </button>
          <div className="flex-1" />
          {step.to && (
            <button
              type="button"
              className="secondary-action h-8 px-3 text-xs"
              onClick={() => {
                navigate(step.to!);
                close();
              }}
            >
              <MousePointer2 size={13} /> Mở trang này
            </button>
          )}
          {i > 0 && (
            <button
              type="button"
              className="secondary-action h-8 px-3 text-xs"
              onClick={() => setI(i - 1)}
            >
              Trước
            </button>
          )}
          <button
            type="button"
            className="primary-action h-8 px-4 text-xs"
            onClick={() => (last ? close() : setI(i + 1))}
          >
            {last ? (
              <>
                <BadgeCheck size={14} /> Bắt đầu dùng
              </>
            ) : (
              "Tiếp"
            )}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
