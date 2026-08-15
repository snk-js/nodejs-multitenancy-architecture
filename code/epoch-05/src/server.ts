// The only file that touches the network.
import { buildApp } from "./app.ts";
import { config } from "./config.ts";
import { db } from "./db/client.ts";

const app = buildApp({ db });

try {
  await app.listen({ port: config.port, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
