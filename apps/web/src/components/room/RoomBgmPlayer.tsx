"use client";

import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import { bgmDisplayTitle, bgmProviderLabel, type RoomBgmView } from "@/shared/bgm";
import type { RoomBgmJoinAck, RoomBgmUpdate } from "@/shared/socket";

interface Props {
  readonly roomId: string;
  readonly initialBgm: RoomBgmView | null;
}

/** 房间 BGM 播放器。房间页与战斗页都会挂载，保证战斗页也能继续装载同一个播放器。 */
export default function RoomBgmPlayer(props: Props) {
  const [bgm, setBgm] = useState<RoomBgmView | null>(props.initialBgm);

  useEffect(() => {
    setBgm(props.initialBgm);
  }, [props.initialBgm]);

  useEffect(() => {
    let cancelled = false;
    const socket = io({ path: "/api/socket", autoConnect: false, transports: ["websocket"] });

    async function bootstrap(): Promise<void> {
      try {
        const response = await fetch("/api/socket-ticket", { method: "POST" });
        const payload = (await response.json()) as { ok: boolean; ticket?: string };
        if (cancelled || payload.ok === false || payload.ticket === undefined) return;
        socket.auth = { ticket: payload.ticket };
        socket.connect();
      } catch {
        // 没有 Socket 连接时仍显示服务端首屏带下来的 BGM。
      }
    }

    socket.on("connect", () => {
      if (cancelled) return;
      socket.emit("room:bgm:join", props.roomId, (result: RoomBgmJoinAck) => {
        if (cancelled) return;
        if (result.bgm !== undefined) setBgm(result.bgm);
      });
    });

    socket.on("room:bgm:update", (payload: RoomBgmUpdate) => {
      if (cancelled) return;
      if (payload.roomId === props.roomId) setBgm(payload.bgm);
    });

    void bootstrap();

    return () => {
      cancelled = true;
      socket.removeAllListeners();
      socket.close();
    };
  }, [props.roomId]);

  if (bgm === null) return null;

  return (
    <section className="rounded-xl border border-spirit-400/25 bg-spirit-400/5 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 truncate text-xs text-spirit-200">
          BGM · {bgmProviderLabel(bgm.provider)} · {bgmDisplayTitle(bgm)}
        </p>
        <a
          href={bgm.pageUrl}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 text-[10px] text-spirit-300 transition hover:text-spirit-200"
        >
          打开原曲
        </a>
      </div>
      <iframe
        key={bgm.embedUrl}
        title="房间 BGM 播放器"
        src={bgm.embedUrl}
        className="mt-2 h-[86px] w-full rounded border-0 bg-ink-900"
        allow="autoplay; encrypted-media"
        loading="lazy"
      />
      <p className="mt-1 text-[10px] text-white/35">
        若播放器没有自动开始，请点击播放按钮。
      </p>
    </section>
  );
}
