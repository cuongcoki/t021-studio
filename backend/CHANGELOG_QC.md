# T021 v2.4 — QC Handoff + Video FrameFix

- Giữ bộ giải mã FFmpeg tương thích Ubuntu: không sử dụng `-fps_mode`, giải mã `frame=0` ngay khi upload, hiển thị lỗi codec/video chi tiết và nút thử lại frame.
- Thiết lập tài khoản cục bộ (Admin/Annotator/Reviewer), mật khẩu PBKDF2-SHA256 và cookie phiên `HttpOnly, SameSite=Strict`.
- Server chặn Reviewer ở `/api/fix`, `/api/projects/save`, `/api/projects/create`, `/api/export` kể cả khi gọi API thủ công.
- Reviewer gửi `needs_fix` với ghi chú; Annotator sửa/lưu project mới có thể gửi `fixed`; Reviewer xác nhận `verified` hoặc yêu cầu sửa tiếp. Ghi chú, vai trò, người thao tác, thời gian và lịch sử được lưu lâu dài trong Project.
- `annotation_revision` được theo dõi qua `revision` Project: không cho báo sửa nếu chưa thay đổi annotation; không xác nhận một bản đã thay đổi tiếp sau khi gửi về QC.
- Quality Gate lấy snapshot và trạng thái Reviewer từ server; không chấp nhận decision tự khai trong JSON phía client.
- Sửa lỗi JS khởi tạo `tasks/user`, bảo đảm UI login và issue list an toàn, khóa các nút sửa khi đăng nhập Reviewer.
- Bảo tồn Project v2.2 qua script `migrate_storage.sh` (không ghi đè).
- 66 unit/integration tests Python, gồm HTTP 403, workflow và video FFmpeg. Chưa kiểm chứng bằng video gốc bị lỗi của người dùng.
