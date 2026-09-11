import { createServer } from "node:http";
import next from "next";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOST ?? "localhost";
const port = Number(process.env.PORT ?? 3000);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

async function main(): Promise<void> {
  const { createSocketServer } = await import("./src/server/socket");
  const { setSocketServer } = await import("./src/server/socket/io");

  await app.prepare();

  const httpServer = createServer((req, res) => {
    void handle(req, res);
  });

  const io = createSocketServer(httpServer);
  setSocketServer(io);

  httpServer.listen(port, () => {
    console.log("> ready on http://" + hostname + ":" + port);
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
