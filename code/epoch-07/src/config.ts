// ALL environment access lives here — validated at boot, frozen forever.
const required = (name: string): string => {
  const v = process.env[name];
  if (v === undefined || v === "") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
};

export const config = Object.freeze({
  env: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: required("DATABASE_URL"),
});

if (Number.isNaN(config.port)) {
  throw new Error("PORT must be a number");
}
