# Warikan API

`warikan-api` is the commercial-core skeleton for scaling Warikan-kun beyond the LIFF + n8n + Google Sheets MVP.

It exists to keep the product promise in the root README: LINE stays as the fastest entry surface, while transaction logic moves into a reliable core.

## Responsibilities
- Own proposal, application, order, payment, notification, user-contact, and audit behavior.
- Treat PostgreSQL as the future source of truth. The draft schema is in `db/schema.sql`.
- Require `idempotencyKey` on write APIs so LINE retries, payment webhooks, and user double taps do not double-count.
- Track first use in user profiles so first proposal and first application behavior can be measured.
- Keep LINE as the entry surface while moving transaction logic out of n8n workflows.

## Product flow

```text
LIFF proposal/create
↓
proposal + LINE group post
↓
LINE group card
↓
line/webhook postback
↓
application upsert + audit + application_applied event
↓
payment request
↓
DM notification / add friend fallback
↓
payment webhook + reconciliation
```

## Boundary

- `line-liff/` owns the screen and LIFF runtime.
- `warikan-api/` owns state changes, idempotency, audit, and future payment correctness.
- `n8n-mvp/` is only for MVP glue, operations, and manual workflow support.
- PostgreSQL is the intended production ledger. In-memory storage is for local verification only.

## Run
```sh
npm test
npm start
```

Default local URL:

```text
http://localhost:8787
```

Required for real LINE group posting:

```text
LINE_CHANNEL_ACCESS_TOKEN=...
```

Optional for AI product count inference:

```text
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-5.4-nano
```

## Implemented endpoints
- `GET /healthz`
- `GET /api/admin/metrics`
- `POST /api/liff/profile/bootstrap`
- `POST /api/liff/proposal/create`
- `GET /api/liff/proposal/:managementId`
- `POST /api/liff/proposal/:managementId/post`
- `POST /api/liff/products/infer-count`
- `POST /api/liff/application/upsert`
- `POST /api/line/webhook`
- `POST /api/payments/request`
- `POST /api/payments/webhook`
- `POST /api/payments/reconcile`

## Production replacement points
- Replace the in-memory store with PostgreSQL repositories following `db/schema.sql`.
- Move `store.events` to Redis, Pub/Sub, or SQS workers.
- LINE group proposal push uses Messaging API when `LINE_CHANNEL_ACCESS_TOKEN` is set.
- Replace dry LINE reply payloads with Messaging API reply clients.
- Product count inference currently uses in-memory cache; move it to `product_inference_cache` in PostgreSQL for production.
- Replace `paypay_p2p_instruction` with PayPay Web Payment or PSP order payments after PMF.
