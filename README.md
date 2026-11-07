# 推敲帖（短歌アンチパターン検出システム）

推敲版を保存するたびに短歌のアンチパターンを検出し、前の版から何が解消・継続・新規になったかを作者に返す。
AIは短歌を作らず、指摘だけを行う。

- 設計書：「短歌アンチパターン検出システム 設計書」
- 画面：「短歌推敲チェッカー 画面デザイン」

## 構成

```
backend/    Cloud Run（Python / FastAPI）。1つのイメージを API とワーカーの2サービスで使う
  app/preprocess/   前処理（正規化・文体推定・形態素解析・モーラ計算・句分け）
  app/checkers/     同期ルール（A1, A4, B7, C2, C3, C5）・履歴ルール（E3）・LLM判定・追跡
  app/patterns/     アンチパターンのマスタ（anti_patterns.yaml）
  app/prompts/      LLMのプロンプト（llm_check.yaml）
  app/repository/   Firestore / メモリ
frontend/   React + Vite。読み取りは Firestore を直接リスナーで読み、書き込みは API を通す
firestore.rules     クライアントは自分の短歌の読み取りだけ。書き込みはサービスアカウントのみ
```

## 展開（dev / prd）

`main` へのマージで dev に、`release` へのプッシュで prd に、GitHub Actions が展開する。
初期設定と手順は [deploy/README.md](deploy/README.md) を参照。

## ローカルで動かす

### バックエンドだけ（メモリ上のDB・LLMなし）

```bash
cd backend
uv venv .venv && uv pip install --python .venv/bin/python -r requirements-dev.txt
.venv/bin/python -m pytest
.venv/bin/uvicorn app.main:get_app --factory --port 8080
```

Firestore 実装は、エミュレータに対してリポジトリ層の契約テスト（メモリ実装と同じテスト）を流して確かめる。
firebase-tools と Java が必要。

```bash
backend/scripts/test_firestore.sh
```

既定は `REPOSITORY=memory`、`AUTH_MODE=dev`（`Authorization: Bearer dev:<uid>` を受け付ける）、`LLM_PROVIDER=none`。

### 画面まで（Firebase Emulator を使う）

Java と firebase-tools が必要。

```bash
firebase emulators:start --only auth,firestore --project demo-tanka-suiko
```

```bash
cd backend
FIRESTORE_EMULATOR_HOST=localhost:8081 FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 \
GOOGLE_CLOUD_PROJECT=demo-tanka-suiko REPOSITORY=firestore AUTH_MODE=dev TASKS_MODE=inline \
.venv/bin/uvicorn app.main:get_app --factory --port 8080
```

```bash
cd frontend
npm install --legacy-peer-deps
VITE_USE_EMULATORS=true VITE_FIREBASE_PROJECT_ID=demo-tanka-suiko npm run dev
```

ログインは「Googleアカウントで続ける」を押すと、Auth Emulator の仮のGoogleログイン画面が開く（実際のアカウントは不要）。

## 環境変数（バックエンド）

| 変数 | 既定 | 内容 |
|---|---|---|
| `APP_ROLE` | `all` | `api` / `worker` / `all` |
| `REPOSITORY` | `memory` | `firestore` / `memory` |
| `AUTH_MODE` | `dev` | 本番は `firebase` |
| `FIREBASE_PROJECT_ID` | — | IDトークンの検証に使う |
| `TASKS_MODE` | `inline` | 本番は `cloudtasks` |
| `CLOUD_TASKS_QUEUE` | — | `projects/<p>/locations/<l>/queues/<q>` |
| `WORKER_URL` | — | ワーカーのサービスのURL（`https://<worker>`）。パスはタスクの種類で決める |
| `TASKS_SERVICE_ACCOUNT` | — | Cloud Tasks が OIDC トークンに使うサービスアカウント |
| `WORKER_AUDIENCE` | `WORKER_URL` | OIDC トークンの audience |
| `ASYNC_DELAY_SECONDS` | `5` | 連続保存のとき最後の版だけをLLMにかけるための遅延 |
| `ASYNC_DAILY_LIMIT` | `100` | 作者ごとの1日の非同期チェック回数 |
| `LLM_PROVIDER` | `none` | `anthropic` / `vertex` / `none` |
| `LLM_MODEL` | `claude-sonnet-5-5` | |
| `LLM_EFFORT` | — | `low` / `medium` / `high`（未指定はモデルの既定） |
| `VERTEX_PROJECT` / `VERTEX_REGION` | — / `global` | Vertex AI 経由のとき |
| `LITERARY_UNIDIC_DIR` | — | 文語用 UniDic のディレクトリ（未指定なら文語も SudachiPy で解析） |

`ANTHROPIC_API_KEY` は Anthropic API を使う場合に Secret Manager などから渡す。

## ワーカーのエンドポイント

| パス | 呼び出し元 | 内容 |
|---|---|---|
| `POST /internal/async-check` | Cloud Tasks | 非同期チェック |
| `POST /internal/purge-tanka` | Cloud Tasks | 短歌の削除の再試行 |
| `POST /internal/cleanup-deleted` | Cloud Scheduler（例：1時間ごと） | `deletedAt` が立ったまま残った短歌を消し直す |

いずれも `TASKS_SERVICE_ACCOUNT` の OIDC トークンで認証する。

## 画面

幅 1024px 以上ではPC版のレイアウト（左に短歌のリスト、右に読み・指摘）、それ未満ではスマホ版を出す。
PC版は書く画面で読みと句分けを同時に表示するため、スマホ版の「読みと句分けの確認」画面はない。

## パターンを変えたとき

`backend/app/patterns/anti_patterns.yaml` を編集したら、画面用のJSONを作り直す。

```bash
cd backend && .venv/bin/python scripts/export_patterns.py ../frontend/src/generated/patterns.json
```

## 設計書から変えた点

- **LLMの temperature 0 と強制ツール呼び出し**：現行の Claude モデルは sampling パラメータ（temperature）と
  `tool_choice` の強制を受け付けないため、構造化出力（`output_config.format` の JSON Schema）で JSON を受け取る。
  ばらつき対策は、前回の指摘を渡して「該当箇所が変わっていなければ同じ判定を維持する」指示で行う。
- **非同期の比較相手**：親の版の非同期チェックが飛ばされた（`skipped`）場合は、さらに前の版の結果と比べる。
- checkRuns の `status` に `limited`（1日の上限超過）と、`trigger`（`save` / `recheck`）を加えた。
- feedback に、どの稿のチェック結果で設定したか（`revisionNo`）を加えた（画面の「第N稿で設定」の表示用）。
- 「意図的」「誤検出」にした指摘は、設定した稿のチェック結果でもすぐ折りたたむ（設計書は「次の版から」）。
- A1 の重大度は設計書どおり、字足らずを「高」、字余りを「中」とする（画面デザインは字余りも「高」）。
