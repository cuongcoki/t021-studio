# T021 Studio v2.3 - Video Fix

### Đã sửa

- FFmpeg: bỏ `-fps_mode vfr` để hỗ trợ Ubuntu có FFmpeg 4.4; sử dụng `-vsync 0`.
- Upload: chỉ chấp nhận video sau khi backend giải mã thành công frame đầu.
- Frame Inspector: khi lỗi hiển thị HTTP status và lỗi FFmpeg thật; thêm nút thử lại frame.
- Video-first: nhập XML sau video không còn làm mất liên kết video.
- Diagnostics: `GET /api/video/diagnostics` kiểm tra phiên bản FFmpeg.
- Project: có `migrate_storage.sh` bảo toàn dự án/media cũ sang thư mục mới mà không ghi đè.

### Kiểm thử

- 63/63 test Python đạt.
- HTTP upload+decode MP4 mẫu: frame 0 và 4 trả ảnh JPEG hợp lệ.
- JavaScript syntax: `node --check` đạt.
- Browser E2E chưa xác nhận: môi trường kiểm thử chặn điều hướng Chromium tới 127.0.0.1.

### Chưa được kiểm chứng

- File video thực tế của người dùng chưa được cung cấp, nên chưa thể kết luận lỗi codec hoặc đặc tính riêng của video đã hết.
- Lấy frame N bằng giải mã từ đầu có thể chậm khi video rất dài. Dùng frames.zip cho video dài/đã subsample để kiểm tra chính xác.
