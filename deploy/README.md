# 展開の手順（dev / prd）

| 環境 | GCPプロジェクト | 展開のきっかけ |
|---|---|---|
| dev | 例：`tanka-suiko-dev` | `main` へのマージ（プッシュ） |
| prd | 例：`tanka-suiko-prd` | `release` へのプッシュ |

GitHub Actions（`.github/workflows/deploy.yml`）が、テストを通したあとに展開する。
GCP へは Workload Identity Federation で入り、鍵は使わない。dev のプロジェクトには `main` から、
prd のプロジェクトには `release` からしか入れない（`deploy/setup.sh` で設定する）。

## 構成

- 画面：Firebase Hosting（`https://<プロジェクトID>.web.app`）
- API：Cloud Run `tanka-api`（公開。Firebase の IDトークンで認証）
- ワーカー：Cloud Run `tanka-worker`（非公開。Cloud Tasks と Cloud Scheduler からだけ呼ぶ）
- Firestore（Nativeモード）、Cloud Tasks キュー `tanka-tasks`、Cloud Scheduler ジョブ `tanka-cleanup`（1時間ごと）
- Secret Manager `anthropic-api-key`（Anthropic API を使う場合）

## はじめに一度だけ（環境ごとに行う）

### 1. GCPプロジェクトと Firebase

1. GCP でプロジェクトを作り、課金を有効にする（dev と prd で2つ）
2. [Firebase コンソール](https://console.firebase.google.com/)で「プロジェクトを追加」から、そのGCPプロジェクトを選んで Firebase を追加する
3. プロジェクトの設定 > マイアプリ で、ウェブアプリを登録する。表示される `apiKey` と `appId` を控える
4. Authentication > ログイン方法 で「Google」だけを有効にする（メール/パスワードなどほかの方法は無効のままにする）
5. 独自ドメインを使う場合は、Authentication > 設定 > 承認済みドメイン に追加する

### 2. 初期設定スクリプト（Cloud Shell で、プロジェクトのオーナーが実行）

```bash
git clone https://github.com/issssey/tanka-suiko.git && cd tanka-suiko
```

```bash
deploy/setup.sh dev <devのプロジェクトID>
```

```bash
deploy/setup.sh prd <prdのプロジェクトID>
```

API の有効化、Firestore、Artifact Registry、Cloud Tasks のキュー、サービスアカウントと権限、
Secret Manager、GitHub 連携をまとめて作る。何度実行してもよい。最後に GitHub に登録する値が表示される。
リージョンの既定は東京（`asia-northeast1`）。変える場合は `REGION=... deploy/setup.sh ...` とする。

### 3. LLM

- **Anthropic API を使う場合**：環境ごとにキーを Secret Manager に登録する。キーはチャットやファイルに書かない。

  ```bash
  read -rs KEY && printf %s "$KEY" | gcloud secrets versions add anthropic-api-key --project <プロジェクトID> --data-file=- && unset KEY
  ```

- **Vertex AI を使う場合**：Model Garden で使う Claude のモデルを有効にする（キーは不要）。

### 4. GitHub の Environment 変数

リポジトリの Settings > Environments に `dev` と `prd` を作り、それぞれに Variables を登録する（秘密情報はない）。

| 変数 | 内容 |
|---|---|
| `GCP_PROJECT_ID` | setup.sh が表示した値 |
| `GCP_PROJECT_NUMBER` | 同上 |
| `GCP_REGION` | 同上 |
| `GCP_WIF_PROVIDER` | 同上 |
| `GCP_DEPLOYER_SA` | 同上 |
| `FIREBASE_API_KEY` | Firebase のウェブアプリの `apiKey` |
| `FIREBASE_APP_ID` | Firebase のウェブアプリの `appId` |
| `FIREBASE_AUTH_DOMAIN` | 任意。既定は `<プロジェクトID>.firebaseapp.com` |
| `LLM_PROVIDER` | `anthropic` か `vertex`（`none` にするとLLMの判定をしない） |
| `LLM_MODEL` | 任意。既定は `claude-haiku-5-5` |
| `LLM_EFFORT` | 任意。`low` / `medium` / `high` |
| `ASYNC_DAILY_LIMIT` | 任意。作者1人あたりの1日の意味のチェックの回数。既定は 100 |
| `EXTRA_CORS_ORIGINS` | 任意。独自ドメインを使う場合、そのURL（例：`https://suiko.example.com`） |

`prd` の Environment には、次も設定しておくとよい。

- Deployment branches：`release` だけを許可する
- Required reviewers：展開前に承認を求める

### 5. release ブランチ

```bash
git switch main && git pull && git switch -c release && git push -u origin release
```

### 6. 予算アラート

設計書の方針どおり、GCP と LLM の両方に予算アラートを設定する。

- GCP：お支払い > 予算とアラート で、プロジェクトごとに作る
- Anthropic API：Console の Limits で月の上限とアラートを設定する

## ふだんの流れ

1. 作業ブランチからプルリクエストを出す（テストが自動で走る）
2. `main` にマージすると dev に展開される
3. dev で確かめたら、`main` を `release` に反映して prd に展開する

```bash
git switch release && git pull && git merge --ff-only origin/main && git push
```

## 戻したいとき

- API・ワーカー：Cloud Run のコンソールで、前のリビジョンにトラフィックを戻す。または前のコミットで `release` を作り直してプッシュする
- 画面：Firebase コンソールの Hosting > リリース履歴 から、前のリリースに戻す
- Firestore のルール・インデックス：前のコミットで再展開する

## 手元から展開する場合

GitHub Actions を使わずに展開するときは、gcloud・docker・Node.js が入った環境で、
プロジェクトの権限を持つアカウントでログインしてから、上の変数を環境変数にして実行する。

```bash
GCP_PROJECT_ID=... GCP_REGION=asia-northeast1 FIREBASE_API_KEY=... FIREBASE_APP_ID=... LLM_PROVIDER=anthropic deploy/deploy.sh
```
