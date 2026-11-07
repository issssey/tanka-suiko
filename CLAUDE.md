# CLAUDE.md

推敲帖（短歌アンチパターン検出システム）。推敲版を保存するたびに短歌のつまずきを指摘し、
前の版から何が解消・継続・新規になったかを返す。AIは歌を作らず、改作案も出さず、良し悪しも判定しない。

## 仕様の出どころ

- 設計書（Claude Docs）：https://claude.ai/artifact/59SEATdnt4UgeKuHPJDVj2
- 画面デザイン（Design キャンバス、スマホ版1〜16とPC版）：https://claude.ai/artifact/SwCQHxfFduXTnrCcFVY9yM
- **設計書が正**。デザインと食い違ったら設計書に合わせ、それでも決まらないことはユーザーに聞く。
- 実装を変えたら、設計書とデザインも追従させる（ユーザーの方針）。

## 構成

```
backend/   Python 3.13 / FastAPI。1つのイメージを Cloud Run の tanka-api と tanka-worker で使う（APP_ROLE）
  app/preprocess/   正規化・文体推定・形態素解析（SudachiPy）・モーラ・句分け（DP）・入力の門番（readable.py）
  app/checkers/     rules.py（A1,A4,B7,C2,C3,C5 と履歴の E3）、llm.py（残り20項目）、runner.py（解消/継続/新規）
  app/patterns/anti_patterns.yaml   27パターンのマスタ（定義・判定の目安・例。LLMのプロンプトと画面の両方で使う）
  app/prompts/llm_check.yaml        LLMの指示文
  app/repository/   firestore.py と memory.py（同じインターフェース。契約テストで両方を確かめる）
  app/service.py    ユースケース。app/main.py はAPIとワーカーのルート
frontend/  React + Vite + TypeScript。幅1024px以上で PC版（src/pages/pc/*）、未満でスマホ版（src/pages/*）
  src/generated/patterns.json   anti_patterns.yaml から生成（手で編集しない）
deploy/    setup.sh（環境ごとの初期設定）・deploy.sh（展開）・README.md（手順書）
.github/workflows/  ci.yml（テスト）・deploy.yml（main→dev、release→prd）
```

## よく使うコマンド

```bash
scripts/setup-dev.sh                       # 依存関係を入れる（新しいセッションの最初に）
cd backend && .venv/bin/python -m pytest -q   # バックエンドのテスト（メモリ実装）
backend/scripts/test_firestore.sh          # Firestore エミュレータでリポジトリの契約テスト（firebase-tools と Java が必要）
cd frontend && npx tsc -b && npx vitest run   # 型チェックとテスト
cd backend && .venv/bin/python scripts/export_patterns.py ../frontend/src/generated/patterns.json   # パターンを変えたら
```

ローカルで画面まで動かす手順（Firebase Emulator）は README.md。

## ブランチと展開

- `main` へのプッシュ（マージ）で dev（GCP: tanka-suiko-dev）に自動展開。`release` へのプッシュで prd。
- 展開の状況は GitHub Actions の deploy ワークフローで確認する。dev の画面：https://tanka-suiko-dev.web.app
- このリポジトリでは、作業ブランチで直したら `main` にも反映して dev で確かめる流れでやってきた。
- コミットメッセージは日本語。1行目に何をしたか、本文に理由。

## これまでに決めたこと（覆すならユーザーに確認）

- A1 の重大度：字足らず＝高、字余り＝中（設計書どおり。旧デザインは字余りも高だった）
- 「意図的」「誤検出」は、設定した稿でもすぐ折りたたむ。feedback に設定した稿の revisionNo を持つ
- ログインは Google のみ。DB には uid 以外の個人情報を書かない
- 推敲メモは LLM に渡さない（意図は作者が「意図的」で示す、という設計書の方針）
- E系が同じ変更を重ねて指摘する傾向は、今は直さない（評価セットで判断する）
- LLM の既定は `claude-sonnet-5-5`（環境変数 `LLM_MODEL` で変更）。temperature とツール強制は現行モデルで使えないので構造化出力
- 短歌として読み取れない入力（同じ文字の連続など）は、チェックせずに 422 で断る。基準は極端なものだけ
- 1日の意味のチェックの上限：作者ごと100回、サービス全体3,000回

## ハマりどころ（実際に踏んだもの）

- **メモリ実装のテストだけでは Firestore の不具合を見逃す**。リポジトリや Firestore の書き方を変えたら `backend/scripts/test_firestore.sh` も流す（FieldPath の import、予約IDで実際に壊れた）
- Firestore は `__` で始まり `__` で終わるドキュメントIDを予約している（書き込みが InvalidArgument）
- SudachiPy の Tokenizer はスレッドセーフでない（FastAPI はスレッドプールで動く）。スレッドごとに作っている
- Cloud Run は `z` で終わるパス（`/healthz`）を予約している。疎通確認は `/health`
- `gcloud run deploy --set-env-vars` は値のカンマで区切る。環境変数は YAML ファイル（`--env-vars-file`）で渡す
- macOS の bash 3.2 では `$VAR）` のように変数の直後に全角文字があると変数名に取り込まれる。`${VAR}` と書く
- Claude Code のクラウドセッションでは `ANTHROPIC_BASE_URL` がセッション用に入っている。本物の API を呼ぶときは外す（`scripts/llm_smoke.py` がやっている）
- `anti_patterns.yaml` を変えたら `export_patterns.py` で `patterns.json` を作り直す（テスト `test_generated.py` が検出する）。例の文面を変えると LLM の判定も変わる（promptVersion が変わる）
- iPhone の Safari はノッチ部分の色を html・body の背景から取る。スマホ幅では body を地の色（#FAFAF7）にしている

## 検証のしかた

- 画面の変更は Playwright で実際に動かして確かめてきた（Firebase Emulator＋API＋Vite を起動）。
  スマホは 390×844、PCは 1440×900。Playwright はこの環境に入っている
- 本物の LLM の確認は `backend/scripts/llm_smoke.py`（APIキーが要る。キーはチャットに貼らない）
