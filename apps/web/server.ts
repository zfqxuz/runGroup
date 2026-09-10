import { createServer } from "node:http";
import next from "next";
import { Server as SocketServer } from "socket.io";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOST ?? "localhost";
const port = Number(process.env.PORT ?? 3000);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

async function main(): Promise<void> {
  await app.prepare();

  const httpServer = createServer((req, res) => {
    void handle(req, res);
  });

  const io = new SocketServer(httpServer, {
    path: "/api/socket",
    serveClient: false
  });

  io.on("connection", (socket) => {
    socket.on("system:ping", (ack?: (payload: { ok: true; at: number }) => void) => {
      ack?.({ ok: true, at: Date.now() });
    });
  });

  httpServer.listen(port, () => {
    console.log(`> ready on http://${hostname}:${port}`);
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
