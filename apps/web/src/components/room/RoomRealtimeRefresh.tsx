"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { io } from "socket.io-client";
import type { RoomRefresh } from "@/shared/socket";

interface Props {
  readonly roomId: string;
}

/**
 * 准备页等非跑团页面的实时刷新探针：
 * 订阅房间频道，只要房间内有可见状态变化就 router.refresh()。
 */
export default function RoomRealtimeRefresh({ roomId }: Props) {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    const socket = io({ path: "/api/socket", autoConnect: false, transports: ["websocket"] });

    async function bootstrap(): Promise<void> {
      const response = await fetch("/api/socket-ticket", { method: "POST" });
      const payload = (await response.json()) as { ok: boolean; ticket?: string };
      if (cancelled) return;
      if (payload.ok === false || payload.ticket === undefined) return;
      socket.auth = { ticket: payload.ticket };
      socket.connect();
    }

    function refresh(payload: { roomId?: string }): void {
      if (cancelled) return;
      if (payload.roomId === roomId) router.refresh();
    }

    socket.on("connect", () => {
      if (cancelled) return;
      socket.emit("room:join", roomId, () => undefined);
    });
    socket.on("room:refresh", (payload: RoomRefresh) => refresh(payload));
    socket.on("room:update", (payload: { roomId?: string }) => refresh(payload));
    socket.on("room:state:update", (payload: { roomId?: string }) => refresh(payload));
    socket.on("room:advancement:update", (payload: { roomId?: string }) => refresh(payload));
    socket.on("combat:started", (payload: { roomId?: string }) => refresh(payload));
    socket.on("combat:ended", (payload: { roomId?: string }) => refresh(payload));
    socket.on("scene:updated", (payload: { roomId?: string }) => refresh(payload));
    void bootstrap();

    return () => {
      cancelled = true;
      socket.removeAllListeners();
      socket.close();
    };
  }, [roomId, router]);

  return null;
}
