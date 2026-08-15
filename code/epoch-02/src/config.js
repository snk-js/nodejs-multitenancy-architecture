// ALL environment access lives here — validated at boot, frozen forever.
// A missing value must kill the process at startup with a named error,
// not surface hours later as a cryptic failure mid-request.

export const config = Object.freeze({
  env: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 3000),
});

if (Number.isNaN(config.port)) {
  throw new Error("PORT must be a number");
}
