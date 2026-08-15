# Snapshot — Epoch 10: Observability

Companion code for [`epochs/epoch-10-observability.md`](../../epochs/epoch-10-observability.md).

```bash
cp .env.example .env
docker compose up -d
npm install && npm run migrate
npm run typecheck && npm test
npm run dev
# every log line now carries reqId + tenantId + userId automatically,
# and cookie/password/token/email fields are centrally redacted.

# to see traces, point OTLP at any backend, e.g. a local Jaeger:
#   docker run --rm -p 16686:16686 -p 4318:4318 jaegertracing/all-in-one
#   OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 npm run dev
```

What changed vs epoch-09: `diff -ru ../epoch-09 .`
— `src/logging.ts` (pino + AsyncLocalStorage mixin + central redaction) becomes the
app's `loggerInstance`, and `src/otel.ts` bootstraps OpenTelemetry auto-instrumentation
(http, fastify, pg, ioredis) gated on `OTEL_EXPORTER_OTLP_ENDPOINT`.
