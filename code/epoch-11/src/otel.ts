// OpenTelemetry bootstrap. In production, load BEFORE anything else:
//   node --import ./src/otel.ts src/server.ts
// so auto-instrumentation can patch http/fastify/pg/ioredis at require time.
// Gated on OTEL_EXPORTER_OTLP_ENDPOINT so dev/test run clean without a backend
// (Jaeger, Tempo, Honeycomb, Datadog — the code doesn't care which).
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";

if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  const sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME ?? "trellis-api",
    instrumentations: [
      getNodeAutoInstrumentations({
        // fs instrumentation is noisy for little insight in a web service
        "@opentelemetry/instrumentation-fs": { enabled: false },
      }),
    ],
  });
  sdk.start();

  process.on("SIGTERM", () => {
    void sdk.shutdown(); // flush spans before the process dies
  });
}
