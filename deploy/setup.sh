#!/usr/bin/env bash
# 環境（dev / prd）ごとに一度だけ実行する初期設定。Cloud Shell で、プロジェクトのオーナー権限で実行する。
#
#   deploy/setup.sh dev <GCPプロジェクトID>
#   deploy/setup.sh prd <GCPプロジェクトID>
#
# 何度実行してもよい（作成済みのものはそのまま）。
# 終わりに、GitHub の Environment に登録する変数を表示する。
set -euo pipefail

ENV_NAME="${1:?dev か prd を指定してください}"
PROJECT_ID="${2:?GCPプロジェクトIDを指定してください}"
REGION="${REGION:-asia-northeast1}"
GITHUB_REPO="${GITHUB_REPO:-issssey/tanka-suiko}"

case "$ENV_NAME" in
  dev) BRANCH="main" ;;
  prd) BRANCH="release" ;;
  *) echo "環境名は dev か prd です" >&2; exit 1 ;;
esac

say() { printf '\n== %s\n' "$*"; }
gcloud config set project "$PROJECT_ID" >/dev/null
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"

say "APIを有効にする"
gcloud services enable \
  run.googleapis.com artifactregistry.googleapis.com firestore.googleapis.com \
  cloudtasks.googleapis.com cloudscheduler.googleapis.com secretmanager.googleapis.com \
  iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com \
  identitytoolkit.googleapis.com firebase.googleapis.com firebasehosting.googleapis.com \
  firebaserules.googleapis.com aiplatform.googleapis.com cloudresourcemanager.googleapis.com

say "Firestore（Nativeモード）"
if ! gcloud firestore databases describe --database='(default)' >/dev/null 2>&1; then
  gcloud firestore databases create --location="$REGION" --type=firestore-native
fi

say "Artifact Registry（コンテナイメージの置き場）"
if ! gcloud artifacts repositories describe tanka --location="$REGION" >/dev/null 2>&1; then
  gcloud artifacts repositories create tanka --location="$REGION" --repository-format=docker
fi

say "Cloud Tasks のキュー"
if ! gcloud tasks queues describe tanka-tasks --location="$REGION" >/dev/null 2>&1; then
  gcloud tasks queues create tanka-tasks --location="$REGION" \
    --max-concurrent-dispatches=10 --max-attempts=5 --min-backoff=10s --max-backoff=300s
fi

say "サービスアカウント"
sa() {
  local name="$1" display="$2"
  if ! gcloud iam service-accounts describe "$name@$PROJECT_ID.iam.gserviceaccount.com" >/dev/null 2>&1; then
    gcloud iam service-accounts create "$name" --display-name="$display"
  fi
  echo "$name@$PROJECT_ID.iam.gserviceaccount.com"
}
API_SA="$(sa tanka-api 'tanka API (Cloud Run)')"
WORKER_SA="$(sa tanka-worker 'tanka worker (Cloud Run)')"
INVOKER_SA="$(sa tanka-invoker 'Cloud Tasks / Scheduler -> worker')"
DEPLOYER_SA="$(sa tanka-deployer 'GitHub Actions deployer')"

bind() { gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$1" --role="$2" --condition=None >/dev/null; }

# API：Firestore の読み書き、タスクの登録（OIDC トークンは tanka-invoker で付ける）、Firebase のユーザー削除
bind "$API_SA" roles/datastore.user
bind "$API_SA" roles/cloudtasks.enqueuer
bind "$API_SA" roles/firebaseauth.admin
gcloud iam service-accounts add-iam-policy-binding "$INVOKER_SA" \
  --member="serviceAccount:$API_SA" --role=roles/iam.serviceAccountUser >/dev/null
# ワーカー：Firestore の読み書き、LLM（Vertex AI または Secret Manager のキー）
bind "$WORKER_SA" roles/datastore.user
bind "$WORKER_SA" roles/aiplatform.user
bind "$WORKER_SA" roles/cloudtasks.enqueuer
gcloud iam service-accounts add-iam-policy-binding "$INVOKER_SA" \
  --member="serviceAccount:$WORKER_SA" --role=roles/iam.serviceAccountUser >/dev/null
# 展開用（GitHub Actions）
for role in roles/run.admin roles/artifactregistry.writer roles/firebasehosting.admin \
  roles/firebaserules.admin roles/datastore.indexAdmin roles/cloudscheduler.admin \
  roles/serviceusage.serviceUsageConsumer roles/firebase.viewer roles/browser; do
  bind "$DEPLOYER_SA" "$role"
done
for target in "$API_SA" "$WORKER_SA" "$INVOKER_SA"; do
  gcloud iam service-accounts add-iam-policy-binding "$target" \
    --member="serviceAccount:$DEPLOYER_SA" --role=roles/iam.serviceAccountUser >/dev/null
done

say "Secret Manager（Anthropic API キーの置き場）"
if ! gcloud secrets describe anthropic-api-key >/dev/null 2>&1; then
  gcloud secrets create anthropic-api-key --replication-policy=automatic
  echo "キーの値はまだ入っていません。Anthropic API を使う場合は、次で登録してください（入力は画面に出ません）:"
  echo "  read -rs KEY && printf %s \"\$KEY\" | gcloud secrets versions add anthropic-api-key --data-file=- && unset KEY"
fi
gcloud secrets add-iam-policy-binding anthropic-api-key \
  --member="serviceAccount:$WORKER_SA" --role=roles/secretmanager.secretAccessor >/dev/null

say "GitHub Actions との連携（Workload Identity Federation。鍵は作らない）"
if ! gcloud iam workload-identity-pools describe github --location=global >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create github --location=global --display-name="GitHub Actions"
fi
# このプロジェクトには、指定のリポジトリの指定のブランチからしか展開できない
CONDITION="assertion.repository == '$GITHUB_REPO' && assertion.ref == 'refs/heads/$BRANCH'"
if ! gcloud iam workload-identity-pools providers describe github --location=global --workload-identity-pool=github >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers create-oidc github --location=global --workload-identity-pool=github \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
    --attribute-condition="$CONDITION"
else
  gcloud iam workload-identity-pools providers update-oidc github --location=global --workload-identity-pool=github \
    --attribute-condition="$CONDITION" >/dev/null
fi
gcloud iam service-accounts add-iam-policy-binding "$DEPLOYER_SA" --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/$GITHUB_REPO" >/dev/null

cat <<EOF

==================================================================
初期設定が終わりました（$ENV_NAME / $PROJECT_ID / 展開するブランチ: $BRANCH）

GitHub のリポジトリの Settings > Environments に「$ENV_NAME」を作り、
次の Variables を登録してください（どれも秘密情報ではありません）。

  GCP_PROJECT_ID        $PROJECT_ID
  GCP_PROJECT_NUMBER    $PROJECT_NUMBER
  GCP_REGION            $REGION
  GCP_WIF_PROVIDER      projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/providers/github
  GCP_DEPLOYER_SA       $DEPLOYER_SA

あわせて、Firebase コンソールのウェブアプリの設定値と、LLM の設定も登録してください
（deploy/README.md の「GitHub の Environment 変数」を参照）。
==================================================================
EOF
