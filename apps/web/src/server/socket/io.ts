import type { Server as SocketServer } from "socket.io";

type GlobalWithSocket = typeof globalThis & {
  __touhouSocketServer?: SocketServer | null;
};

const globalWithSocket = globalThis as GlobalWithSocket;

export function setSocketServer(server: SocketServer): void {
  globalWithSocket.__touhouSocketServer = server;
}

export function getSocketServer(): SocketServer | null {
  return globalWithSocket.__touhouSocketServer ?? null;
}
