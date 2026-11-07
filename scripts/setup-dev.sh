#!/usr/bin/env bash
# 開発に必要な依存関係を入れる（新しいセッションの最初に一度）。何度実行してもよい。
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== backend（Python の仮想環境）"
if command -v uv >/dev/null 2>&1; then
  [ -d backend/.venv ] || uv venv -q backend/.venv
  uv pip install -q --python backend/.venv/bin/python -r backend/requirements-dev.txt
else
  [ -d backend/.venv ] || python3 -m venv backend/.venv
  backend/.venv/bin/pip install -q -r backend/requirements-dev.txt
fi

echo "== frontend（npm）"
(cd frontend && npm ci --legacy-peer-deps --no-audit --no-fund)

echo "== 確認"
(cd backend && .venv/bin/python -m pytest -q 2>&1 | tail -1)
(cd frontend && npx tsc -b && npx vitest run 2>&1 | grep -E "Tests")

cat <<'MSG'
準備できました。
- Firestore エミュレータでのテスト：backend/scripts/test_firestore.sh（firebase-tools と Java が必要）
- 画面まで動かす手順：README.md の「ローカルで動かす」
MSG
