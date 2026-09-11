"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { io, type Socket } from "socket.io-client";
import type { Ack } from "@/shared/socket";
import type { SceneTokenUpdate, SceneTokenView, SceneUpdated, SceneView } from "@/shared/scene";

interface Props {
  readonly roomId: string;
  readonly isKP: boolean;
  readonly currentUserId: string;
  readonly readOnly: boolean;
  readonly scene: SceneView;
}

interface DragState {
  readonly tokenId: string;
  readonly pointerId: number;
}

const TIME_LABELS: Record<string, string> = {
  DAWN: "黎明",
  DAY: "白天",
  DUSK: "黄昏",
  NIGHT: "夜晚",
  MIDNIGHT: "午夜"
};

const WEATHER_LABELS: Record<string, string> = {
  NONE: "无",
  RAIN: "雨",
  SNOW: "雪",
  FOG: "雾",
  STORM: "暴风雨",
  SAKURA: "樱吹雪",
  PETALS: "花瓣"
};

export default function SceneBoard(props: Props) {
  const router = useRouter();
  const mapRef = useRef<HTMLDivElement | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const [tokens, setTokens] = useState<SceneTokenView[]>(() => [...(props.scene.map?.tokens ?? [])]);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTokens([...(props.scene.map?.tokens ?? [])]);
  }, [props.scene.id, props.scene.map?.tokens]);

  useEffect(() => {
    let cancelled = false;
    const socket = io({ path: "/api/socket", autoConnect: false, transports: ["websocket"] });
    socketRef.current = socket;

    async function bootstrap(): Promise<void> {
      const response = await fetch("/api/socket-ticket", { method: "POST" });
      const payload = (await response.json()) as { ok: boolean; ticket?: string };
      if (cancelled) return;
      if (payload.ok === false || payload.ticket === undefined) return;
      socket.auth = { ticket: payload.ticket };
      socket.connect();
    }

    socket.on("connect", () => {
      if (cancelled) return;
      socket.emit("room:join", props.roomId, () => undefined);
    });
    socket.on("scene:token:updated", (update: SceneTokenUpdate) => {
      if (cancelled || update.roomId !== props.roomId) return;
      setTokens((prev) => {
        const exists = prev.some((token) => token.id === update.token.id);
        return exists
          ? prev.map((token) => (token.id === update.token.id ? update.token : token))
          : [...prev, update.token];
      });
    });
    socket.on("scene:updated", (update: SceneUpdated) => {
      if (cancelled || update.roomId !== props.roomId) return;
      router.refresh();
    });
    socket.on("disconnect", () => undefined);
    socket.on("connect_error", () => undefined);
    void bootstrap();

    return () => {
      cancelled = true;
      socket.removeAllListeners();
      socket.close();
    };
  }, [props.roomId, router]);

  const map = props.scene.map;
  const gridSizeStyle = useMemo(() => {
    if (map === null || map.showGrid === false || map.gridType === "NONE") return undefined;
    const x = (map.gridSize / map.width) * 100;
    const y = (map.gridSize / map.height) * 100;
    return {
      backgroundImage:
        "linear-gradient(to right, rgba(255,255,255,0.14) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.14) 1px, transparent 1px)",
      backgroundSize: x + "% " + y + "%"
    } as const;
  }, [map]);

  function canMove(token: SceneTokenView): boolean {
    if (props.readOnly || token.isLocked || token.isVisible === false) return false;
    if (props.isKP) return true;
    return token.ownerUserId !== null && token.ownerUserId === props.currentUserId;
  }

  function pointerToMap(event: React.PointerEvent<HTMLDivElement>): { x: number; y: number } | null {
    if (map === null) return null;
    const rect = mapRef.current?.getBoundingClientRect();
    if (rect === undefined) return null;
    return {
      x: Math.max(0, Math.min(map.width, ((event.clientX - rect.left) / rect.width) * map.width)),
      y: Math.max(0, Math.min(map.height, ((event.clientY - rect.top) / rect.height) * map.height))
    };
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>, token: SceneTokenView): void {
    if (canMove(token) === false) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ tokenId: token.id, pointerId: event.pointerId });
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>): void {
    if (drag === null) return;
    const point = pointerToMap(event);
    if (point === null) return;
    event.preventDefault();
    setTokens((prev) =>
      prev.map((token) => (token.id === drag.tokenId ? { ...token, x: point.x, y: point.y } : token))
    );
  }

  function onPointerUp(event: React.PointerEvent<HTMLDivElement>): void {
    if (drag === null) return;
    const point = pointerToMap(event);
    setDrag(null);
    if (point === null) return;
    const socket = socketRef.current;
    if (socket === null) return;
    socket.emit(
      "scene:token:move",
      { roomId: props.roomId, tokenId: drag.tokenId, x: point.x, y: point.y },
      (result: Ack) => {
        if (result.ok === false) {
          setError(result.error ?? "移动失败");
          router.refresh();
        }
      }
    );
  }

  if (map === null) {
    return (
      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <h2 className="text-sm font-medium text-white/80">战术棋盘</h2>
        <p className="mt-3 text-xs text-white/35">当前场景还没有地图配置，请 KP 前往场景管理创建地图。</p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-white/80">战术棋盘 · {props.scene.name}</h2>
          <p className="mt-1 text-[11px] text-white/40">
            {props.scene.timeOfDay === undefined ? "" : TIME_LABELS[props.scene.timeOfDay] ?? props.scene.timeOfDay}
            {" · "}
            {props.scene.weather === undefined ? "" : WEATHER_LABELS[props.scene.weather] ?? props.scene.weather}
            {props.scene.description === null ? "" : " · " + props.scene.description}
          </p>
        </div>
        <span className="rounded-full border border-spirit-400/30 px-2 py-0.5 text-[10px] text-spirit-300">
          {tokens.length} Token
        </span>
      </div>

      {props.scene.narration === null ? null : (
        <p className="mt-3 whitespace-pre-wrap rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2 text-xs leading-relaxed text-white/55">
          {props.scene.narration}
        </p>
      )}

      {error === null ? null : <p className="mt-3 text-xs text-red-300">{error}</p>}

      <div
        ref={mapRef}
        className="relative mt-4 w-full touch-none overflow-hidden rounded-lg border border-white/15 select-none"
        style={{ aspectRatio: map.width + " / " + map.height, backgroundColor: map.bgColor }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {map.backgroundUrl === null ? null : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={map.backgroundUrl} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-fill" draggable={false} />
        )}
        {gridSizeStyle === undefined ? null : (
          <div className="pointer-events-none absolute inset-0" style={gridSizeStyle} />
        )}
        {map.showFog ? <div className="pointer-events-none absolute inset-0 bg-black/25" /> : null}

        {tokens.filter((token) => token.isVisible).map((token) => {
          const widthPercent = (token.size * map.gridSize) / map.width * 100;
          const hpPercent = token.currentHp !== null && token.maxHp !== null && token.maxHp > 0
            ? Math.max(0, Math.min(100, (token.currentHp / token.maxHp) * 100))
            : null;
          return (
            <div
              key={token.id}
              className={"absolute flex aspect-square -translate-x-1/2 -translate-y-1/2 flex-col items-center " + (canMove(token) ? "cursor-grab active:cursor-grabbing" : "cursor-default")}
              style={{ left: (token.x / map.width) * 100 + "%", top: (token.y / map.height) * 100 + "%", width: widthPercent + "%", zIndex: 10 + token.zIndex }}
              onPointerDown={(event) => onPointerDown(event, token)}
              title={token.name}
            >
              <div
                className="relative h-full w-full overflow-hidden rounded-full border-2 bg-ink-900/80 shadow-lg"
                style={{ borderColor: token.borderColor }}
              >
                {token.imageUrl === null ? (
                  <span className="flex h-full w-full items-center justify-center text-[10px] font-medium text-white/80">
                    {token.name.slice(0, 1)}
                  </span>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={token.imageUrl} alt="" className="pointer-events-none h-full w-full object-cover" draggable={false} />
                )}
                {hpPercent === null || token.showHpBar === false ? null : (
                  <span className="absolute bottom-0 left-0 h-1 bg-emerald-400" style={{ width: hpPercent + "%" }} />
                )}
              </div>
              {token.showName ? (
                <span className="mt-0.5 max-w-full truncate rounded bg-black/60 px-1 text-[9px] leading-3 text-white/80">
                  {token.name}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>

      <p className="mt-2 text-[10px] text-white/30">
        KP 可移动全部 Token；玩家只能移动自己的角色 Token。Token 位置会实时同步。
      </p>
    </section>
  );
}
