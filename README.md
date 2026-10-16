# T021 · Track ID QA Studio

Công cụ kiểm tra chất lượng nhãn **tracking 2D** của nhóm T021: tìm box đứt quãng, box nhảy, nghi đổi ID,
box trùng, đổi class… rồi sửa và QC theo vòng **Annotator → Reviewer**. Lõi kiểm tra là code Python của nhóm
(`backend/core`); giao diện mới viết bằng React (`frontend/`).

```
t021-studio/
├── backend/    Python 3.10+, KHÔNG cần cài thư viện nào (server.py + code của nhóm)
└── frontend/   React 19 + Vite + TypeScript; bản build sẵn nằm trong frontend/dist
```

---

## 1. Chạy nhanh (chỉ cần Python)

Repo đã kèm bản build giao diện (`frontend/dist`), nên **không cần cài Node** để chạy thử.

```bash
git clone https://github.com/cuongcoki/t021-studio.git
cd t021-studio/backend
```

| Hệ điều hành | Lệnh |
|---|---|
| Windows (PowerShell) | `py server.py --port 8781 --no-browser` |
| macOS / Linux | `python3 server.py --port 8781 --no-browser` |

Mở **http://localhost:8781**. Dừng server bằng `Ctrl+C`.

> Server chỉ nghe trên `127.0.0.1`: mỗi người chạy và test trên máy của mình.

### Lần đầu vào web
1. Màn hình đăng nhập sẽ yêu cầu **tạo tài khoản Admin** (tên + mật khẩu ≥ 8 ký tự).
2. Admin vào **Tài khoản → Tạo tài khoản** để tạo thêm Annotator và Reviewer cho người test.
3. Mỗi tài khoản khi đăng nhập lần đầu sẽ thấy **hướng dẫn từng bước theo vai trò**; xem lại bất cứ lúc nào ở nút
   **Hướng dẫn sử dụng** (thanh bên trái).

Dữ liệu (tài khoản, task, phiên đăng nhập) lưu trong `backend/storage/` trên máy bạn và **không** được đẩy lên git.
Muốn làm lại từ đầu: tắt server, xoá các file trong `backend/storage/` (giữ `.gitkeep`).

---

## 2. Vai trò

| | Admin | Annotator | Reviewer |
|---|:-:|:-:|:-:|
| Quản lý tài khoản (tạo / sửa / khoá / xoá, tìm, lọc) | ✅ | | |
| Tạo / đổi tên / xoá Project | ✅ | ✅ | |
| Tạo task (từ CVAT hoặc từ file) | ✅ | ✅ | |
| Giao Annotator / Reviewer cho task | ✅ | | |
| Sửa box / Track ID, lưu, xuất annotation | | ✅ | |
| Đẩy nhãn về job CVAT | | ✅ | |
| Tạo bộ thử cấy lỗi | | ✅ | |
| QC: gửi lỗi, “không phải lỗi”, xác nhận đã sửa, duyệt xong | | | ✅ |
| Benchmark với GT, xem nhanh file | ✅ | ✅ | ✅ |

Mọi quyền được kiểm tra ở backend; giao diện chỉ ẩn nút cho gọn.

## 3. Luồng làm việc

1. **Admin** tạo Project → tạo task → giao Annotator + Reviewer.
2. **Annotator** mở task → **Quét lỗi** → bấm gợi ý sửa nhanh (*Nối ID, Hoán đổi ID, Nội suy frame thiếu, Xoá box trùng,
   Thống nhất class*) hoặc sửa tay → **Lưu** → **Gửi QC**.
3. **Reviewer** mở task → **Quét lỗi** → **Gửi Annotator** (kèm ghi chú) hoặc **Không phải lỗi**. Lỗi tool không tự thấy:
   chọn box → **Báo lỗi box này cho Annotator**.
4. Annotator sửa → **Đã sửa · gửi lại QC** → Reviewer **Xác nhận đã sửa** → **Quality Gate** đạt → **Duyệt xong**.
5. Annotator **Đẩy CVAT** (ghi đè job đã liên kết, nhãn cũ tự sao lưu vào `backend/storage/cvat_backups/`)
   hoặc **Xuất annotation** (CVAT XML / MOT / JSON).

Phím tắt trong màn hình task: `←/→` đổi frame (`Shift` = 10 frame) · `P` phát · `V` chọn · `N` vẽ box · `F` vừa khung ·
`Delete` xoá box · `Esc` bỏ chọn · lăn chuột để zoom · `Ctrl+Z / Ctrl+Y` · `Ctrl+S` lưu · `?` xem tất cả.

## 4. Đưa dữ liệu vào

**Cách A — từ CVAT (khuyên dùng):**
1. Trang **Cài đặt · CVAT**: nhập URL CVAT (ví dụ `http://localhost:8080`), tài khoản, mật khẩu → **Kết nối CVAT**.
   Server chỉ giữ token, không lưu mật khẩu.
2. **Task → Tạo task → Từ CVAT** → chọn job 2D. Ảnh frame lấy thẳng từ CVAT khi xem.

**Cách B — từ file:** **Task → Tạo task → Từ file**: annotation (CVAT XML / `.zip` export của CVAT, MOT, COCO, Datumaro)
kèm ảnh frame dạng `.zip`. File video (`.mp4`) chỉ dùng được khi máy chạy server có **FFmpeg**
(Windows: `winget install Gyan.FFmpeg`).

## 5. Test với bộ dữ liệu cấy lỗi của nhóm (`data_test/daytime`)

Mỗi thư mục `VideoN/` có:

| File | Là gì |
|---|---|
| `<video>-5fps.mp4` | Video gốc |
| `<video>.zip` | **Nhãn sạch** (chưa chèn lỗi) |
| `<video>_injected.zip` / `_injected_cvat.xml` | Nhãn **đã chèn lỗi** — file để test |
| `<video>.truth.json` | **GT lỗi**: danh sách lỗi đã chèn `{type, a, b, frame}` |

1. Tạo task CVAT từ video, nạp `_injected.zip` (định dạng **CVAT 1.1**), rồi kéo job đó vào T021 (*Cách A*).
2. Mở task → **Quét lỗi** để xem tool bắt được gì.
3. Menu **…** → **Benchmark với GT** → chọn `truth.json` + **nhãn sạch** `<video>.zip` → **Chạy benchmark**.
   Kết quả: Precision / Recall / F1, bảng theo loại lỗi, danh sách bỏ sót / báo nhầm (bấm để nhảy tới frame).

Lưu ý khi đọc kết quả:
- Các dòng `class_flip` trong `truth.json` hiện **không có trong file `_injected`** (CVAT XML dạng track giữ một nhãn cho
  cả track), nên tool liệt kê riêng ở mục “GT ghi lỗi nhưng dữ liệu không có” và không tính điểm.
- Không chọn nhãn sạch thì các chỗ hở có sẵn trong nhãn gốc sẽ bị tính là báo nhầm → Precision thấp hơn.
- Quy tắc đã được chỉnh khi xem Video1 / Video2, nên điểm trên hai video đó là điểm “đã chữa đề”.
  **Số liệu để báo cáo nên lấy trên video khác** (ví dụ Video3).

Mục tiêu T021: **Precision ≥ 85 %, Recall ≥ 80 %**.

---

## 6. Sửa giao diện (chỉ cho người phát triển)

Cần Node.js 22+.

```bash
cd backend && py server.py --port 8781 --no-browser      # cửa sổ 1
cd frontend && npm install && npm run dev                # cửa sổ 2 → http://localhost:5181 (/api chuyển sang 8781)
```

Sửa xong chạy `npm run build` để cập nhật `frontend/dist` (bản mà `server.py` phục vụ) rồi commit cả `dist`.

Kiểm thử backend: `cd backend && py -m unittest discover -s tests -t .`

## 7. Lỗi hay gặp

| Hiện tượng | Cách xử lý |
|---|---|
| `Python was not found` / mở Microsoft Store | Trên Windows dùng `py` thay cho `python` |
| `server.py is not recognized` | Thiếu `py` ở đầu lệnh: `py server.py --port 8781 --no-browser` |
| `Không mở được cổng 8781` | Cổng đang bị dùng: tắt server cũ, hoặc chạy `--port 8782` |
| Mở web thấy giao diện cũ | Thiếu `frontend/dist` → `git pull` lại, hoặc `cd frontend && npm install && npm run build` |
| Không xem được frame của task CVAT | Kiểm tra CVAT đang chạy và đã **Kết nối CVAT** ở trang Cài đặt |
| CVAT báo lỗi 406 / Bad Gateway | Kiểm tra lại CVAT (Docker) đã chạy đủ container chưa |
