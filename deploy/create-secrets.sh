#!/bin/sh
# Runs ON THE VPS. Reads sensitive inputs from stdin-provided env (piped by
# the operator), generates the rest, never echoes a value.
set -eu
KC="kubectl -n hrcopilot"
gen() { openssl rand -hex 32; }
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml

APP_PW=$($KC get secret postgres-credentials -o jsonpath='{.data.app-password}' | base64 -d)
PAY_PW=$($KC get secret postgres-credentials -o jsonpath='{.data.payment-password}' | base64 -d)
NOTIF_PW=$($KC get secret postgres-credentials -o jsonpath='{.data.notification-password}' | base64 -d)

SECRET_TOKEN=${SECRET_TOKEN:-$(gen)}
INTERNAL_SERVICE_TOKEN=${INTERNAL_SERVICE_TOKEN:-$(gen)}
PAYMENT_TOKEN=${PAYMENT_TOKEN:-$(gen)}
NOTIFICATION_TOKEN=${NOTIFICATION_TOKEN:-$(gen)}
LOOKUP_TOKEN=${LOOKUP_TOKEN:-$(gen)}
MOCK_WEBHOOK=${MOCK_WEBHOOK:-$(gen)}

$KC delete secret backend-secrets ai-secrets payment-secrets notification-secrets --ignore-not-found >/dev/null

$KC create secret generic backend-secrets \
  --from-literal=DATABASE_URL="postgresql://hrcopilot_app:${APP_PW}@postgres:5432/hr_copilot" \
  --from-literal=SECRET_TOKEN="$SECRET_TOKEN" \
  --from-literal=INTERNAL_SERVICE_TOKEN="$INTERNAL_SERVICE_TOKEN" \
  --from-literal=PAYMENT_SERVICE_INTERNAL_TOKEN="$PAYMENT_TOKEN" \
  --from-literal=NOTIFICATION_SERVICE_INTERNAL_TOKEN="$NOTIFICATION_TOKEN" \
  --from-literal=NOTIFICATION_USER_LOOKUP_TOKEN="$LOOKUP_TOKEN" \
  --from-literal=EXCHANGE_RATE_API_KEY="${EXCHANGE_RATE_API_KEY:?missing}"

$KC create secret generic ai-secrets \
  --from-literal=GEMINI_API_KEY="${GEMINI_API_KEY:?missing}" \
  --from-literal=INTERNAL_SERVICE_TOKEN="$INTERNAL_SERVICE_TOKEN"

$KC create secret generic payment-secrets \
  --from-literal=PAYMENT_DB_PASSWORD="$PAY_PW" \
  --from-literal=PAYMENT_INTERNAL_TOKEN="$PAYMENT_TOKEN" \
  --from-literal=PAYMENT_MOCK_WEBHOOK_SECRET="$MOCK_WEBHOOK" \
  --from-literal=TOSS_PAYMENTS_CLIENT_KEY="${TOSS_CLIENT_KEY:?missing}" \
  --from-literal=TOSS_PAYMENTS_SECRET_KEY="${TOSS_SECRET_KEY:?missing}"

$KC create secret generic notification-secrets \
  --from-literal=NOTIFICATION_DB_PASSWORD="$NOTIF_PW" \
  --from-literal=NOTIFICATION_INTERNAL_TOKEN="$NOTIFICATION_TOKEN" \
  --from-literal=BACKEND_INTERNAL_TOKEN="$LOOKUP_TOKEN" \
  --from-literal=PAYMENT_INTERNAL_TOKEN="$PAYMENT_TOKEN" \
  --from-literal=SMTP_USERNAME="" \
  --from-literal=SMTP_PASSWORD=""

echo "secrets created: backend-secrets ai-secrets payment-secrets notification-secrets"
