# Payment Service

The billing authority for HR Copilot AI candidate plans (FREE / PRO / MAX).

Java 21 · Spring Boot 3.5 · PostgreSQL (Flyway) · Kafka (transactional
outbox) · Testcontainers.

## What it owns

- `CustomerBillingAccount` / `Subscription` / `Payment` — billing state,
  authoritative in THIS service's PostgreSQL database.
- `GET /internal/entitlements/{userId}` — the contract the NestJS backend
  reads plans through (service-token authenticated, fail-closed).
- `POST /internal/dev/plan-switch` — dev/test profiles ONLY; the bean does
  not exist in production.
- `POST /internal/checkout` (+ `Idempotency-Key`), `POST /internal/toss/confirm`.
- `POST /webhooks/mock`, `POST /webhooks/toss`, `POST /internal/subscriptions/{userId}/{downgrade|cancel}`.
- Transactional outbox → `billing.payment-events.v1`,
  `billing.subscription-events.v1`, `billing.entitlement-events.v1`.

## Run locally

```bash
# database (uses the shared dev postgres container):
docker exec hrcopilot-postgres psql -U postgres -c 'CREATE DATABASE hr_copilot_payments'

./gradlew bootRun --args='--spring.profiles.active=dev'
# optional Kafka for the outbox publisher:
docker compose -f docker-compose.dev.yml up -d
PAYMENT_OUTBOX_PUBLISH_ENABLED=true ./gradlew bootRun --args='--spring.profiles.active=dev'
```

Dev profile defaults: port 8081, provider `MOCK`, internal token
`dev-internal-token`, webhook secret `dev-webhook-secret`, Kafka publishing
OFF (rows wait in the outbox, visible as `outbox_pending_total`).

Toss sandbox is opt-in:

```bash
PAYMENT_PROVIDER=TOSS \
TOSS_PAYMENTS_CLIENT_KEY= \
TOSS_PAYMENTS_SECRET_KEY= \
TOSS_PAYMENTS_SUCCESS_URL=https://your-public-host/callbacks/toss/success \
TOSS_PAYMENTS_FAIL_URL=https://your-public-host/callbacks/toss/fail \
./gradlew bootRun --args='--spring.profiles.active=dev'
```

### Currency / pricing decision (resolved 2026-08-25)

The product prices are USD (`PRO=$7`, `MAX=$12`). Per current official Toss
docs, **USD is supported only via `FOREIGN_EASY_PAY`**, and **PayPal via
Toss supports USD only** (KRW explicitly not supported for PayPal) — so the
chosen method (`FOREIGN_EASY_PAY`/`PAYPAL`, pinned by `validateForUse()`)
matches the USD prices exactly. No FX conversion exists and none may be
added silently. Constraints from the docs: PayPal needs an additional Toss
merchant contract, and sandbox testing needs a PayPal Sandbox account
alongside Toss `test_ck_`/`test_sk_` keys. Domestic Toss methods are
KRW-only; do not switch to one without an explicit KRW pricing decision.

### Toss environment (all required when `PAYMENT_PROVIDER=TOSS`)

| Variable | Meaning |
| --- | --- |
| `TOSS_PAYMENTS_CLIENT_KEY` / `TOSS_PAYMENTS_SECRET_KEY` | API-individual-integration key pair (`test_ck_`/`test_sk_` in sandbox) |
| `TOSS_PAYMENTS_SUCCESS_URL` / `TOSS_PAYMENTS_FAIL_URL` | Public URLs registered with Toss, pointing at THIS service's `/callbacks/toss/success|fail` |
| `TOSS_PAYMENTS_BROWSER_SUCCESS_URL` / `TOSS_PAYMENTS_BROWSER_FAIL_URL` | Frontend pages the callbacks 302 the browser to afterwards |

Webhook endpoint to register with Toss: `POST /webhooks/toss`
(`PAYMENT_STATUS_CHANGED`). Payment webhooks carry no signature per current
Toss docs; the handler therefore treats them as notifications only and
re-fetches payment truth over the authenticated API before any transition.

## Kafka topology (local)

`docker-compose.dev.yml` runs one KRaft broker with two client listeners:

- `HOST` — advertised `localhost:9092` → host NestJS and host-run Java.
- `DOCKER` — advertised `kafka:29092` → containers on the
  `hrcopilot-payment_default` network (a containerized payment service
  sets `KAFKA_BOOTSTRAP_SERVERS=kafka:29092` and joins that network).

Neither side is ever advertised an address it cannot reach; deployment
environments should reproduce the same rule (advertise per network).

## Tests

```bash
./gradlew test   # Testcontainers PostgreSQL + embedded Kafka; needs Docker
```

## Production notes

- `payment.internal-token` unset ⇒ every /internal route answers 401.
- The dev plan switch does not exist outside the dev/test profiles.
- Plans change in production through provider-confirmed payment events only:
  redirect/internal confirmation or authenticated webhook reconciliation. No
  real provider credential is configured in this repository.
