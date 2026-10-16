#!/usr/bin/env bash
set -euo pipefail
if [[ $# -ne 1 || ! -d "$1/storage" ]]; then
  echo "Cách dùng: bash migrate_storage.sh /duong/dan/T021_Track_ID_QA_Studio_v2_2" >&2
  exit 1
fi
NEW="$(cd "$(dirname "$0")" && pwd)"
OLD="$(cd "$1" && pwd)"
if [[ "$NEW" == "$OLD" ]]; then
  echo "Thư mục nguồn và đích phải khác nhau" >&2; exit 1
fi
mkdir -p "$NEW/storage"
cp -an "$OLD/storage/." "$NEW/storage/"
echo "Đã sao chép (không ghi đè) storage cũ sang: $NEW/storage"
echo "Kiểm tra Projects sau khi chạy tool. Giữ bản sao storage cũ để dự phòng."
