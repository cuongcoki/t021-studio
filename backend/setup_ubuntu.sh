#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
python3 -m venv .venv
printf 'Da tao .venv. Khong can pip install: ung dung chi dung Python standard library.\n'
