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
  app/checkers/     rules.py（A1,A4,A5,A6,B7,C2,C3,C5 と履歴の E3）、llm.py（残り21項目）、runner.py（解消/継続/新規）
  app/patterns/anti_patterns.yaml   30パターンのマスタ（定義・判定の目安・例・根拠。LLMのプロンプトと画面の両方で使う。根拠はLLMに渡さない）
  app/prompts/llm_check.yaml        LLMの指示文
  app/repository/   firestore.py と memory.py（同じインターフェース。契約テストで両方を確かめる）
  app/appreciation.py と prompts/appreciation.yaml   鑑賞（頼まれた稿をLLMが1回読む。評価・改作案なし）
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

- 字余り・字足らず（2026-11-09 の見直し）：A1 は字足らずだけ（高）。字余りは三句・結句が A5（中）、初句・二句・四句が A6（低）。句の途中に母音の連続・長音・撥音があれば「読むと定型に近く聞こえる」と添える（重大度は変えない）
- 見直し前に保存した A1（字余り）は runner.current_fingerprint で A5・A6 に読み替えて比べ、作者の判断は次の保存（再チェック）で A5・A6 に写す（元の判断は残す）。一括の移行スクリプトは持たない
- 「意図的」「誤検出」は、設定した稿でもすぐ折りたたむ。feedback に設定した稿の revisionNo を持つ
- ログインは Google のみ。DB には uid 以外の個人情報を書かない
- 推敲メモは LLM に渡さない（意図は作者が「意図的」で示す、という設計書の方針）
- E系が同じ変更を重ねて指摘する傾向は、今は直さない（評価セットで判断する）
- LLM の既定は `claude-sonnet-5-5`（環境変数 `LLM_MODEL` で変更）。temperature とツール強制は現行モデルで使えないので構造化出力
- 短歌として読み取れない入力（同じ文字の連続など）は、チェックせずに 422 で断る。基準は極端なものだけ
- 1日の意味のチェックの上限：作者ごと100回、サービス全体3,000回
- 昔の稿を正にするのは「この稿に戻す」：同じ内容の稿をその稿を親にして新しく作り、いまの稿にする（`restoredFromRevisionId`）。意味のチェックは親の結果を再利用し、LLMを呼ばない
- 推敲履歴は枝分かれできる。E3（行ったり来たり）は親をたどった祖先の稿とだけ比べ、捨てた系統の稿は数えない
- 連作と発表（設計書「連作と発表」）：短歌に確定の状態は持たせず、発表記録を事実上の確定とする。発表済み・連作の表示は tankas.publishedCount・sequenceIds から出し、別のフラグは持たない。どちらも連作・記録の書き込みと同じトランザクションで更新する
- 連作は変えたらすぐ保存する（保存ボタンなし）。保存されたことを題の下に出し（「自動で保存しました · 時刻」）、「この連作を出す」は控えめなボタンにする（主なボタンにすると「作って出す」一続きの手順に見えるため）。題は空でもよく「無題の連作」と出す。スマホ版にも「外す」を置く
- PC版：ヘッダーで「短歌・連作・発表記録・設定」を切り替える。短歌の一覧の画面は持たず、「/」は最近推敲した歌のチェック結果を開く（左の列に一覧と検索）。発表記録は左に一覧、右に詳細で、出し先・出した日・メモはその場で直して自動で保存する。発表を記録は何首かまとめて1件にできる（スマホは1首か連作）
- 一覧のカード（短歌・連作・発表記録）は本文が主役。短歌のカードに重大度や「解消」の札は出さない（ユーザー確認済み）。札は名前入りの状態（「発表：みなと新聞 歌壇」「連作：駅の灯」、複数なら新しい1件に「ほか N件」）で、枠線だけの灰色にそろえる。名前は発表記録・連作から画面側で引く（lib/publishing.ts）
- パターン一覧は名前と重大度だけ。開くと定義・判定の目安・指摘される例、指摘されない例はB・Dだけ。即時／後から・根拠・注意書きは出さない
- 削除の確認ポップアップで消えるもの・残るものを伝え、詳細ページの削除ボタンには注記を付けない。設定の入口はヘッダー右端の歯車だけ（PCは「設定」の文字を添え、アカウントのアイコンは置かない）
- 詳細ページ（短歌＝チェック結果・連作・発表記録）は設計書「詳細ページの構造」の順の区画：見出しと情報 → 中身 → つながり → 履歴 → 操作 → 削除（いちばん下）。部品は components/detail.tsx。「出した後に変更があります」は画面側で計算し保存しない。連作から外した直後は5秒保存を遅らせて「元に戻す」を出す
- users/{uid} は1日の回数（asyncChecks・appreciations）と出し先の候補（destinations）を持つ。回数を数えるときはそのフィールドだけを置き換える（文書ごと置き換えると候補が消える）
- 鑑賞（設計書「鑑賞」）：作者が稿ごとに頼んだときだけ動かす（1人1日10回、`APPRECIATION_DAILY_LIMIT`）。tankas/{id}/appreciations/{revisionId} に1稿1件。読み手は「短歌を読み慣れた人」1人に固定。LLMには本文・読み・句分け・文体だけを渡し、指摘・前の稿の鑑賞・作者のメモは渡さない。失敗したものだけ頼み直せる。チェック結果では指摘の下（つながりの前）に欄を置く
- PWA（設計書「PWA」）：目的はホーム画面から開けることだけ。サービスワーカー・オフラインのキャッシュ・プッシュ通知は持たない。アイコンはデザイン案C2で `frontend/scripts/make-icons.cjs` から作る（`NODE_PATH=$(npm root -g) node scripts/make-icons.cjs`）。ホーム画面から開いたときは Google ログインを redirect にし、authDomain は画面と同じ `<プロジェクトID>.web.app`（OAuth クライアントのリダイレクト URI の追加が環境ごとに要る。deploy/README.md）

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
- iPhone の Safari：16px 未満の入力欄はフォーカスで拡大される（入力欄は 16px）。`input[type=date]` は独自の見た目で幅がはみ出るので appearance を外す。viewport の user-scalable=no は無視されるので、ピンチは main.tsx でジェスチャーのイベントを止めている。この環境に WebKit はないので Safari の見た目は実機で確かめる
- iPhone のホーム画面から開いたアプリ版（standalone）では、ステータスバーが画面に重なり、iOS の上端のぼかしがステータスバーより下（約80pt）まで伸びる。上の safe-area に地の色の帯（body::before）を置き、standalone のときだけ `--top-extra`（20px）を足して見出しをぼかしの外に出している。Safari ではぼかしの範囲が狭いので足さない。Chromium では display-mode を再現できないので実機で確かめる
- CSS の `.pc` は PC版の画面全体の入れ物（縦並び・画面の高さ）。部品の修飾子に `pc` という class 名を付けると巻き込まれる（`lib-tabs-pc` のように別名にする）

## 検証のしかた

- 画面の変更は Playwright で実際に動かして確かめてきた（Firebase Emulator＋API＋Vite を起動）。
  クラウドセッションでは apis.google.com に出られずログインのポップアップが開かない。ページ内で `/src/lib/auth.tsx` が読む firebase_auth を import し、`signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify({sub, email, email_verified: true})))` で Auth Emulator に直接ログインする
  スマホは 390×844、PCは 1440×900。Playwright はこの環境に入っている
- 本物の LLM の確認は `backend/scripts/llm_smoke.py`（APIキーが要る。キーはチャットに貼らない）
