#!/usr/bin/env bash
# Firestore エミュレータを起動し、リポジトリ層の契約テストを Firestore 実装にも流す。
# 必要なもの：firebase-tools（firebase コマンド）と Java。
set -euo pipefail
cd "$(dirname "$0")/../.."
firebase emulators:exec --only firestore --project demo-tanka-suiko \
  "cd backend && GOOGLE_CLOUD_PROJECT=demo-tanka-suiko .venv/bin/python -m pytest -q tests/test_repository_contract.py $*"
