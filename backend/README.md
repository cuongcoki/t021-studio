# T021 – Track ID QA Studio v2.4

Tool local chạy bằng Python + Web UI cho kiểm tra liên tục Track ID, Gap, Box Jump, ID Switch Candidate và các lỗi cấu trúc. Có project persistence, video FFmpeg frame extraction, QA report, CVAT XML / MOT export và workflow kiểm duyệt.

**Hai nguyên tắc bắt buộc:** Reviewer chỉ QC, không thay đổi annotation; Annotator là người duy nhất sửa annotation. Kết quả phát hiện tự động là cảnh báo, không thay thế người kiểm duyệt.

## Chạy nhanh Ubuntu

```bash
sudo apt install -y python3 python3-venv ffmpeg
bash setup_ubuntu.sh
bash run_ubuntu.sh --port 8766 --no-browser
```

Truy cập http://127.0.0.1:8766 và khởi tạo tài khoản Admin ở lần chạy đầu. Dùng Admin tạo tài khoản Annotator và Reviewer riêng. Chi tiết xem [HUONG_DAN_UBUNTU.md](HUONG_DAN_UBUNTU.md).

## Kiến trúc

- **Presentation**: `static/index.html`, `app.js`, `style.css`.
- **Backend/API**: `server.py`, `backend/auth.py`, `backend/projects.py`, `backend/workflow.py`.
- **Data & Media**: `core/parsers.py`, `backend/video.py`, `backend/media.py`.
- **Detection**: `core/validators/`.
- **Correction**: `core/fixing/`, kiểm tra role ở backend.
- **Storage/Report**: `storage/`, `core/exporters.py`, `core/evaluation/metrics.py`.

## Phân quyền

| Hành động | Admin | Annotator | Reviewer |
|---|---|---|---|
| Tạo tài khoản | Có | Không | Không |
| Mở Project và xem dữ liệu | Có | Có | Có |
| Tạo/lưu Project annotation | Không | Có | Không |
| Chỉnh box / ID / xuất annotation | Không | Có | Không |
| Gửi lỗi cần sửa / đánh dấu FP | Không | Không | Có |
| Báo đã sửa, gửi lại QC | Không | Có | Không |
| Xác nhận sửa hoàn tất | Không | Không | Có |

## Kiểm thử

`python3 -m unittest discover -s tests -q`

Bộ tests sử dụng dữ liệu tổng hợp, không đảm bảo Precision/Recall ≥ 0.85/0.80 trên video thật. Sử dụng trên localhost, không expose ra Internet.


## Bản v2.5: CVAT annotation import cho Reviewer

- Khôi phục nút **Import CVAT / MOT / JSON / ZIP** cho cả Annotator và Reviewer. Import là thao tác đọc dữ liệu tạm, không sửa Project.
- Hỗ trợ: **CVAT tracking/image XML**, **MOT TXT/CSV**, **COCO instances JSON**, **Datumaro JSON**, **T021 session JSON**, ZIP annotation có các file trên.
- Reviewer chỉ đọc/quét/QC; **không** được sửa, lưu lại annotation, xuất annotation hoặc ghi đè Project. Backend vẫn trả HTTP 403 với các API sửa.
- Trên JSON COCO/Datumaro không chứa `track_id`, tool cấp ID âm tạm **riêng từng box**, không tạo track continuity giả. Muốn kiểm tra ID switch, hãy xuất XML video có track ID thật.
- ZIP chỉ lấy nhãn; ảnh/video đi kèm vẫn nên tải bằng nút media riêng. ZIP dạng `frames.zip` phải tải tại nút **Tải frames.zip**.
- Với Project đã được Annotator tạo, Reviewer nên mở Project thay vì nhập lại annotation để có thể lưu QC và chuyển lỗi.
