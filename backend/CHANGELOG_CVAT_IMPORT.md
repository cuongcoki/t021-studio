# v2.5 – CVAT Import, RBAC read-only

- Fix: Reviewer được thấy và bấm Import annotation, labels.txt.
- Giữ HTTP 403 trên /api/fix, /api/projects/save/create, /api/export với reviewer.
- Bổ sung parse COCO và Datumaro JSON (không dựng track_id giả); ZIP annotation từ CVAT.
- Parser và ZIP bảo vệ kích thước input; không giải nén file xuống ổ cứng.
- Import ở reviewer chỉ là preview tạm. Muốn bàn giao QC cần Project do Annotator tạo và lưu.
