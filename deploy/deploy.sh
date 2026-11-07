#!/usr/bin/env bash
# 1つの環境に展開する。GitHub Actions から呼ぶ（手元から呼んでもよい）。
#
# 必要な環境変数：
#   GCP_PROJECT_ID, GCP_REGION
#   FIREBASE_API_KEY, FIREBASE_APP_ID（Firebase コンソールのウェブアプリの設定値）
#   LLM_PROVIDER（anthropic / vertex / none）
# 任意：
#   LLM_MODEL, LLM_EFFORT, ASYNC_DAILY_LIMIT, EXTRA_CORS_ORIGINS（独自ドメインなど。カンマ区切り）
#   IMAGE_TAG（既定は git のコミット）
set -euo pipefail

: "${GCP_PROJECT_ID:?}" "${GCP_REGION:?}" "${FIREBASE_API_KEY:?}" "${FIREBASE_APP_ID:?}" "${LLM_PROVIDER:?}"
PROJECT="$GCP_PROJECT_ID"
REGION="$GCP_REGION"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TAG="${IMAGE_TAG:-$(git -C "$ROOT" rev-parse --short HEAD)}"
IMAGE="$REGION-docker.pkg.dev/$PROJECT/tanka/backend:$TAG"
API_SA="tanka-api@$PROJECT.iam.gserviceaccount.com"
WORKER_SA="tanka-worker@$PROJECT.iam.gserviceaccount.com"
INVOKER_SA="tanka-invoker@$PROJECT.iam.gserviceaccount.com"
QUEUE="projects/$PROJECT/locations/$REGION/queues/tanka-tasks"
PROJECT_NUMBER="${GCP_PROJECT_NUMBER:-$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')}"
# Cloud Run のURLは決まった形なので、展開前に分かる（ワーカーは起動時に自分のURLが要る）
WORKER_URL="https://tanka-worker-$PROJECT_NUMBER.$REGION.run.app"
ORIGINS="https://$PROJECT.web.app,https://$PROJECT.firebaseapp.com${EXTRA_CORS_ORIGINS:+,$EXTRA_CORS_ORIGINS}"

say() { printf '\n== %s\n' "$*"; }

say "イメージを作って登録する ($IMAGE)"
gcloud auth configure-docker "$REGION-docker.pkg.dev" --quiet
docker build -t "$IMAGE" "$ROOT/backend"
docker push "$IMAGE"

# 環境変数はYAMLのファイルで渡す（--set-env-vars はカンマで区切るので、CORS_ORIGINS のようにカンマを含む値を渡せない）
ENV_DIR="$(mktemp -d)"
trap 'rm -rf "$ENV_DIR"' EXIT
write_env() {
  local role="$1" file="$ENV_DIR/$1.yaml"
  {
    printf 'APP_ROLE: "%s"\n' "$role"
    printf 'REPOSITORY: "firestore"\n'
    printf 'AUTH_MODE: "firebase"\n'
    printf 'FIREBASE_PROJECT_ID: "%s"\n' "$PROJECT"
    printf 'TASKS_MODE: "cloudtasks"\n'
    printf 'CLOUD_TASKS_QUEUE: "%s"\n' "$QUEUE"
    printf 'TASKS_SERVICE_ACCOUNT: "%s"\n' "$INVOKER_SA"
    printf 'WORKER_URL: "%s"\n' "$WORKER_URL"
    printf 'WORKER_AUDIENCE: "%s"\n' "$WORKER_URL"
    printf 'CORS_ORIGINS: "%s"\n' "$ORIGINS"
    printf 'LLM_PROVIDER: "%s"\n' "$LLM_PROVIDER"
    printf 'LLM_MODEL: "%s"\n' "${LLM_MODEL:-claude-sonnet-5-5}"
    printf 'VERTEX_PROJECT: "%s"\n' "$PROJECT"
    printf 'ASYNC_DAILY_LIMIT: "%s"\n' "${ASYNC_DAILY_LIMIT:-100}"
    if [ -n "${LLM_EFFORT:-}" ]; then printf 'LLM_EFFORT: "%s"\n' "$LLM_EFFORT"; fi
  } >"$file"
  echo "$file"
}

say "ワーカーを展開する（公開しない。Cloud Tasks と Scheduler からだけ呼ぶ）"
WORKER_SECRETS=()
[ "$LLM_PROVIDER" = "anthropic" ] && WORKER_SECRETS=(--set-secrets "ANTHROPIC_API_KEY=anthropic-api-key:latest")
gcloud run deploy tanka-worker --project "$PROJECT" --region "$REGION" --image "$IMAGE" \
  --service-account "$WORKER_SA" --no-allow-unauthenticated \
  --env-vars-file "$(write_env worker)" "${WORKER_SECRETS[@]}" \
  --memory 1Gi --cpu 1 --min-instances 0 --max-instances 5 --concurrency 4 --timeout 120 --quiet
ACTUAL="$(gcloud run services describe tanka-worker --project "$PROJECT" --region "$REGION" --format='value(status.url)')"
if [ "$ACTUAL" != "$WORKER_URL" ]; then
  # 古い形式のURLだった場合も、決まった形のURLで呼べる（両方が有効）
  echo "参考: ワーカーの表示上のURLは $ACTUAL"
fi
gcloud run services add-iam-policy-binding tanka-worker --project "$PROJECT" --region "$REGION" \
  --member "serviceAccount:$INVOKER_SA" --role roles/run.invoker --quiet >/dev/null

say "APIを展開する（ブラウザから呼ぶので公開。認証は Firebase の IDトークン）"
gcloud run deploy tanka-api --project "$PROJECT" --region "$REGION" --image "$IMAGE" \
  --service-account "$API_SA" --allow-unauthenticated \
  --env-vars-file "$(write_env api)" \
  --memory 1Gi --cpu 1 --min-instances 0 --max-instances 10 --timeout 30 --quiet
API_URL="https://tanka-api-$PROJECT_NUMBER.$REGION.run.app"

say "消し残しを消し直す定期ジョブ（1時間ごと）"
SCHED=(--location "$REGION" --schedule "17 * * * *" --time-zone "Asia/Tokyo"
  --uri "$WORKER_URL/internal/cleanup-deleted" --http-method POST
  --oidc-service-account-email "$INVOKER_SA" --oidc-token-audience "$WORKER_URL")
if gcloud scheduler jobs describe tanka-cleanup --project "$PROJECT" --location "$REGION" >/dev/null 2>&1; then
  gcloud scheduler jobs update http tanka-cleanup --project "$PROJECT" "${SCHED[@]}" --quiet >/dev/null
else
  gcloud scheduler jobs create http tanka-cleanup --project "$PROJECT" "${SCHED[@]}" --quiet >/dev/null
fi

say "画面を作る（API: ${API_URL}）"
(
  cd "$ROOT/frontend"
  npm ci --legacy-peer-deps
  VITE_FIREBASE_API_KEY="$FIREBASE_API_KEY" \
  VITE_FIREBASE_AUTH_DOMAIN="${FIREBASE_AUTH_DOMAIN:-$PROJECT.firebaseapp.com}" \
  VITE_FIREBASE_PROJECT_ID="$PROJECT" \
  VITE_FIREBASE_APP_ID="$FIREBASE_APP_ID" \
  VITE_API_BASE_URL="$API_URL" \
  npm run build
)

say "Firestore のルールとインデックス、Hosting を展開する"
(cd "$ROOT" && npx --yes firebase-tools@15 deploy --project "$PROJECT" --only firestore:rules,firestore:indexes,hosting --non-interactive)

say "疎通確認"
# 新しいリビジョンが立ち上がるまで少し待つことがある。失敗したら展開を失敗にする
for i in 1 2 3 4 5; do
  if curl -fsS --max-time 20 "$API_URL/health"; then echo; break; fi
  if [ "$i" = 5 ]; then echo "API が応答しません: $API_URL/health" >&2; exit 1; fi
  sleep 10
done

cat <<EOF

展開しました（${PROJECT}）
  画面: https://$PROJECT.web.app
  API:  $API_URL
EOF
