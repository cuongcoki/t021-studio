# T021 Track ID QA Studio v2.4 — VideoFix + Quy trình Reviewer/Annotator

## Cài đặt trên Ubuntu

```bash
sudo apt update
sudo apt install -y python3 python3-venv ffmpeg unzip
cd ~/Downloads
unzip T021_Track_ID_QA_Studio_v2_4_QC_Workflow.zip
cd T021_Track_ID_QA_Studio_v2_4_QC_Workflow
bash setup_ubuntu.sh
bash run_ubuntu.sh --port 8766 --no-browser
```

Mở <http://127.0.0.1:8766>. Nếu đã dùng cổng 8766, dừng server đó bằng `Ctrl+C` rồi chạy bản này; hoặc chọn `--port 8767`. Bản cũ ở 8765 không bị ảnh hưởng. Chỉ chạy một bản ở một cổng.

Python 3.10+ và FFmpeg/ffprobe là yêu cầu duy nhất; Python chạy trên môi trường `.venv` cục bộ, không cần Node/Docker/MySQL.

## Đăng nhập và phân quyền (bắt buộc)

Khi chạy lần đầu, tạo tài khoản **Admin** bằng form mở sẵn. Admin vào **Tài khoản** để tạo riêng:

- **Annotator**: tạo/mở/lưu Project, nạp annotation, chỉnh/thêm/xóa box, nối/đổi Track ID, xuất annotation; khi được gửi Issue thì sửa và báo `Đã sửa · Gửi lại QC`.
- **Reviewer**: mở Project để QC, xem video, timeline, issue, đánh dấu False Positive, gửi lỗi kèm ghi chú cho Annotator, kiểm lại và xác nhận. **Reviewer không có quyền sửa/lưu/export annotation.** Nút sửa được ẩn; API backend cũng trả HTTP 403 nếu Reviewer cố thực hiện.
- **Admin**: quản lý tài khoản và có thể đổi tên/xóa Project, không trực tiếp sửa annotation hay tự duyệt lỗi.

Đăng xuất tài khoản hiện tại bằng nút **Đăng xuất** ở góc trên, sau đó đăng nhập tài khoản khác. Login có hiệu lực 12 giờ hoặc đến khi server khởi động lại.

## Quy trình QC chuẩn

1. **Annotator** đăng nhập, nhấn `+ Tạo project`. Nhập XML/MOT và video hoặc frames.zip, kiểm tra mapping; nhấn `Lưu project`.
2. **Reviewer** đăng nhập, mở Project đó trong **Projects / Phiên làm việc**. Bấm `Quét lỗi`, chọn một Issue → `Gửi Annotator`; ghi rõ nội dung cần sửa. Nếu cảnh báo sai, chọn `Không phải lỗi`.
3. **Annotator** mở Project, lọc `Cần Annotator sửa`; sửa box/ID và **lưu project**, sau đó bấm `Đã sửa · Gửi lại QC` và ghi rõ đã sửa gì. Nếu chưa có thay đổi annotation được lưu kể từ yêu cầu QC, server từ chối chuyển trạng thái.
4. **Reviewer** mở lại Project hoặc refresh, lọc `Chờ Reviewer xác nhận`; kiểm lại frame/video rồi chọn `Xác nhận đã sửa` hoặc `Yêu cầu sửa tiếp`. Nếu annotation đã thay đổi sau khi Annotator báo sửa, server sẽ không cho xác nhận trên bản cũ.
5. **Quality Gate** dùng snapshot/project và các quyết định lưu trên server, không tin vào kết quả sửa/trạng thái do trình duyệt tự gửi. Báo cáo Precision/Recall chỉ đáng tin nếu có ground truth riêng.

Mỗi hành động bàn giao đều được ghi trong `tasks` và lịch sử `history` của Project. Mỗi vòng QC có người thao tác, thời gian, ghi chú và trạng thái.

## Video không hiển thị frame 0

Ứng dụng **kiểm tra giải mã frame 0 ngay khi upload**: nếu FFmpeg/codec lỗi, server trả lý do cụ thể, không âm thầm hiển thị ô đen. Bản mới loại bỏ tùy chọn `-fps_mode` không tương thích FFmpeg 4.4 trên Ubuntu, sử dụng `-vsync 0` với bộ lọc frame theo index.

```bash
ffmpeg -version
ffprobe -version
curl http://127.0.0.1:8766/api/health
```

Trong trang web, nút `↻ Thử lại frame` tải lại ảnh, dòng thông tin bên dưới Frame Inspector sẽ hiện nguyên nhân từ API nếu thất bại. Nếu lỗi vẫn xảy ra, gửi **video gốc** hoặc nguyên văn lỗi hiện ở Frame Inspector/Terminal để phân tích codec cụ thể. Ảnh `frames.zip` cùng XML vẫn hỗ trợ làm phương án thay thế.

Nếu XML được trích mẫu từ video dài, nhập `Video start` và `Step` để ghép frame. Nếu lấy mẫu **không đều**, hai trường này không đủ; ưu tiên `frames.zip` theo đúng danh sách ảnh CVAT, hoặc bổ sung mapping tường minh.

## Chuyển từ bản v2.2/v2.3 mà không mất Project

Giữ lại thư mục bản cũ và sao lưu `storage/` trước. Trong thư mục bản v2.4 chạy:

```bash
bash migrate_storage.sh /duong/dan/T021_Track_ID_QA_Studio_v2_2
```

Script sao chép `storage/` theo chế độ **không ghi đè**. Project cũ không có tài khoản/nhật ký workflow vẫn mở được. Bản mới dùng tài khoản mới; không có cách khôi phục mật khẩu admin từ mật khẩu của bản cũ (vì bản cũ không có đăng nhập).

**Lưu ý:** Sao lưu `storage/` trước khi xóa thư mục cũ. Project/video/cache không được đưa vào ZIP phát hành; test scripts cũng không được cung cấp với dữ liệu thật.

## Kiểm thử

```bash
python3 -m unittest discover -s tests -q
node --check static/app.js  # tùy chọn, chỉ khi có Node.js
```

Các module chính: `backend/auth.py` (tài khoản), `backend/workflow.py` (bàn giao QC), `backend/projects.py` (Project và revision), `backend/video.py` (FFmpeg decoder), `server.py` (API RBAC), `static/app.js` (UI), `core/validators` và `core/fixing` (kiểm tra và sửa annotation).

**Giới hạn:** Role là cơ chế quản lý QC cục bộ trên máy chủ localhost, không phải giải pháp bảo mật multi-tenant cho Internet công khai. Không mở trực tiếp cổng ứng dụng ra Internet. Bộ nhận diện vẫn dùng nhiều heuristic hình học; Smooth ID Switch / Drift và các trường hợp che khuất phức tạp chưa có Re-ID hoàn chỉnh.


## v2.5 – Khôi phục Import CVAT cho Reviewer

1. Mở `http://localhost:8766`, đăng nhập Reviewer. Trong QA Workspace có nút **Import CVAT / MOT / JSON / ZIP**.
2. Chọn XML CVAT for video, JSON COCO/Datumaro, MOT TXT/CSV hoặc ZIP chứa annotation. Sau khi import, tải video hay `frames.zip` để đối chiếu.
3. Reviewer được nạp và xem dữ liệu tạm, quét lỗi, nhưng không sửa bounding box/Track ID và không lưu đè dữ liệu. Annotator phải tạo/lưu Project, sau đó Reviewer mở Project đó để gửi Issue sửa và lưu quyết định QC.
4. Nếu dùng `frames.zip` chỉ chứa ảnh, hãy chọn nút **Tải frames.zip** riêng; ZIP annotation chọn nút **Import CVAT / MOT / JSON / ZIP**.
5. Nếu chưa thấy nút sau khi nâng cấp: dừng bản chạy ở 8766 (`Ctrl+C`), chạy bản mới rồi bấm `Ctrl+Shift+R` để tải lại giao diện.
