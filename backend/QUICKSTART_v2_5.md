# T021 Studio v2.5 – Khôi phục Import annotation CVAT / JSON / MOT / ZIP

## Nguyên nhân mất nút Import trong v2.4
Trong `static/app.js`, `updateRoleUI()` đặt `fileAnnotation.disabled=!edit` và ẩn label với Reviewer. Đã sửa thành quyền đọc dữ liệu chung cho Reviewer và Annotator, vẫn chặn sửa ở API.

## Các định dạng
- `annotations.xml`: CVAT for video / CVAT for images.
- `.txt`, `.csv`, `.mot`: MOT chuẩn.
- `.json`: COCO instances JSON, Datumaro annotations JSON, hoặc phiên `.t021.json`.
- `.zip`: ZIP annotation có các file trên; `frames.zip` chỉ có ảnh cần chọn ở nút Tải frames.zip.

**Lưu ý:** COCO/Datumaro không có track_id thì tool không tự dựng track liên tục; chỉ đánh giá box/cấu trúc. CVAT video tracking xuất `CVAT for video 1.1` XML để giữ Track ID.

## Chạy
```bash
sudo apt install -y python3 python3-venv ffmpeg
bash setup_ubuntu.sh
bash run_ubuntu.sh --port 8766 --no-browser
```
Mở http://localhost:8766 và nhấn Ctrl+Shift+R.

## Giữ dữ liệu Project cũ
Tắt server v2.4. Chép thư mục `storage/` từ v2.4 sang v2.5 (không ghi đè khi chưa sao lưu); `storage/` bản ZIP sạch có `.gitkeep`.

## Phân quyền
- Reviewer: import file tạm để xem/QC, quét, gửi yêu cầu trong Project do Annotator tạo. Không sửa Box / Track ID, không lưu ghi đè Project, không xuất annotation. Backend vẫn chặn HTTP 403.
- Annotator: import, tạo Project, sửa annotation, lưu, gửi lại QC.

**Lưu ý**: Import file mới trong Reviewer chỉ là preview tạm. Để lưu QC, người Annotator tạo và lưu Project trước, sau đó Reviewer vào Projects để mở và QC trên Project đó.

## Test
```bash
python3 -m unittest discover -s tests -p 'test*.py' -q
```
