"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { io, type Socket } from "socket.io-client";
import { activateSceneAction, createSceneTokenAction } from "@/server/actions/scene";
import type { Ack } from "@/shared/socket";
import type { SceneMapView, SceneTokenUpdate, SceneTokenView, SceneUpdated } from "@/shared/scene";
import {
  cellKeyAt,
  computeVisibilityPolygon,
  hexCellsCovering,
  hexPolygonPoints,
  pointInPolygon,
  segmentFromPoints,
  snapPointToGrid,
  type GeometryPoint,
  type GeometrySegment
} from "@/shared/scene-geometry";

interface Props {
  readonly roomId: string;
  readonly isKP: boolean;
  readonly currentUserId: string;
  readonly readOnly: boolean;
  readonly returnTo: string;
  readonly scenes: readonly { readonly id: string; readonly name: string; readonly isActive: boolean }[];
  readonly units: readonly { readonly ref: string; readonly name: string; readonly kind: "PLAYER" | "NPC" }[];
  readonly scene: {
    readonly id: string;
    readonly name: string;
    readonly description: string | null;
    readonly narration: string | null;
    readonly weather: string;
    readonly timeOfDay: string;
    readonly map: SceneMapView | null;
  };
}

interface DragState {
  readonly tokenId: string;
  readonly pointerId: number;
}

type BoardMode = "select" | "wall" | "light" | "fog" | "delete";
type FogBrush = "REVEAL" | "HIDE";
type WallType = "WALL" | "DOOR" | "WINDOW" | "DIFFICULT_TERRAIN";

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

const WALL_LABELS: Record<string, string> = {
  WALL: "墙",
  DOOR: "门",
  WINDOW: "窗",
  DIFFICULT_TERRAIN: "困难地形"
};

const WALL_COLORS: Record<string, string> = {
  WALL: "rgba(255,255,255,0.75)",
  DOOR: "rgba(245,158,11,0.9)",
  WINDOW: "rgba(56,189,248,0.9)",
  DIFFICULT_TERRAIN: "rgba(239,68,68,0.8)"
};

export default function SceneBoard(props: Props) {
  const router = useRouter();
  const mapRef = useRef<HTMLDivElement | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const fogStrokeRef = useRef<Set<string>>(new Set());
  const wallStartRef = useRef<GeometryPoint | null>(null);
  const [map, setMap] = useState<SceneMapView | null>(() => props.scene.map);
  const [tokens, setTokens] = useState<SceneTokenView[]>(() => [...(props.scene.map?.tokens ?? [])]);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [mode, setMode] = useState<BoardMode>("select");
  const [fogBrush, setFogBrush] = useState<FogBrush>("REVEAL");
  const [fogStroke, setFogStroke] = useState<{ readonly mode: FogBrush; readonly cells: readonly string[] } | null>(null);
  const [wallType, setWallType] = useState<WallType>("WALL");
  const [wallDraftEnd, setWallDraftEnd] = useState<GeometryPoint | null>(null);
  const [lightRadius, setLightRadius] = useState(220);
  const [lightColor, setLightColor] = useState("#ffaa00");
  const [showPlayerVision, setShowPlayerVision] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMap(props.scene.map);
    setTokens([...(props.scene.map?.tokens ?? [])]);
  }, [props.scene.id, props.scene.map]);

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
      socket.emit("room:join", props.roomId, (result: { ok?: boolean }) => {
        // 首次连接 / 断线重连后都主动同步一次，
        // 避免错过 scene:updated 后一直停留在旧场景。
        if (cancelled === false && result?.ok === true) router.refresh();
      });
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
    socket.on("scene:map:updated", (update: { readonly roomId: string; readonly sceneId: string; readonly map: SceneMapView }) => {
      if (cancelled || update.roomId !== props.roomId) return;
      setMap(update.map);
      setTokens([...update.map.tokens]);
    });
    socket.on("scene:fog:updated", (update: { readonly roomId: string; readonly sceneId: string; readonly fogRevealed: readonly string[] }) => {
      if (cancelled || update.roomId !== props.roomId) return;
      setMap((prev) => (prev === null ? prev : { ...prev, fogRevealed: update.fogRevealed }));
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

  const revealedNow = useMemo(() => {
    const set = new Set<string>(map?.fogRevealed ?? []);
    if (fogStroke !== null) {
      for (const cell of fogStroke.cells) {
        if (fogStroke.mode === "REVEAL") set.add(cell);
        else set.delete(cell);
      }
    }
    return set;
  }, [map?.fogRevealed, fogStroke]);

  const wallSegments = useMemo(() => {
    if (map === null) return [] as GeometrySegment[];
    const segments: GeometrySegment[] = [];
    for (const wall of map.walls) {
      const segment = segmentFromPoints(wall.points);
      if (segment !== null) segments.push(segment);
    }
    return segments;
  }, [map]);

  const availableUnits = useMemo(() => {
    return props.units.filter((unit) => {
      const [kind, id] = unit.ref.split(":", 2);
      if (id === undefined || id.length === 0) return false;
      if (kind === "character") return tokens.some((token) => token.characterId === id) === false;
      if (kind === "npc") return tokens.some((token) => token.cardId === id) === false;
      return true;
    });
  }, [props.units, tokens]);

  const viewerToken = useMemo(
    () => tokens.find((token) => token.ownerUserId === props.currentUserId && token.isVisible) ?? null,
    [tokens, props.currentUserId]
  );

  const visionPolygon = useMemo(() => {
    if (map === null) return [] as GeometryPoint[];
    const origin = viewerToken === null ? null : { x: viewerToken.x, y: viewerToken.y };
    if (origin === null) return [];
    return computeVisibilityPolygon(origin, wallSegments, map.width, map.height);
  }, [map, viewerToken, wallSegments]);

  const losEnabled = map !== null && wallSegments.length > 0 && (props.isKP ? showPlayerVision : true);

  function isTokenVisible(token: SceneTokenView): boolean {
    if (props.isKP) return true;
    if (map !== null && map.showFog) {
      const key = cellKeyAt(map, token.x, token.y);
      if (key.length > 0 && revealedNow.has(key) === false) return false;
    }
    if (losEnabled && visionPolygon.length >= 3 && viewerToken !== null && token.id !== viewerToken.id) {
      if (pointInPolygon({ x: token.x, y: token.y }, visionPolygon) === false) return false;
    }
    return true;
  }

  function canMove(token: SceneTokenView): boolean {
    if (props.readOnly || token.isLocked || token.isVisible === false) return false;
    if (props.isKP) return true;
    return token.ownerUserId !== null && token.ownerUserId === props.currentUserId;
  }

  function pointerToMap(event: React.PointerEvent<HTMLDivElement>): GeometryPoint | null {
    if (map === null) return null;
    const rect = mapRef.current?.getBoundingClientRect();
    if (rect === undefined) return null;
    return {
      x: Math.max(0, Math.min(map.width, ((event.clientX - rect.left) / rect.width) * map.width)),
      y: Math.max(0, Math.min(map.height, ((event.clientY - rect.top) / rect.height) * map.height))
    };
  }

  function emitTokenMove(tokenId: string, point: GeometryPoint): void {
    const socket = socketRef.current;
    if (socket === null) return;
    socket.emit(
      "scene:token:move",
      { roomId: props.roomId, tokenId, x: point.x, y: point.y },
      (result: Ack) => {
        if (result.ok === false) {
          setError(result.error ?? "移动失败");
          router.refresh();
        }
      }
    );
  }

  function emitWall(point: GeometryPoint): void {
    const start = wallStartRef.current;
    if (start === null) return;
    const socket = socketRef.current;
    if (socket === null) return;
    const points = [start.x, start.y, point.x, point.y];
    socket.emit("scene:wall:create", { roomId: props.roomId, sceneId: props.scene.id, points, type: wallType }, (result: Ack) => {
      if (result.ok === false) setError(result.error ?? "墙体创建失败");
    });
  }

  function emitLight(point: GeometryPoint): void {
    const socket = socketRef.current;
    if (socket === null) return;
    socket.emit(
      "scene:light:create",
      { roomId: props.roomId, sceneId: props.scene.id, x: point.x, y: point.y, radius: lightRadius, color: lightColor, intensity: 1 },
      (result: Ack) => {
        if (result.ok === false) setError(result.error ?? "灯光创建失败");
      }
    );
  }

  function emitFog(cells: readonly string[]): void {
    if (cells.length === 0) return;
    const socket = socketRef.current;
    if (socket === null) return;
    socket.emit("scene:fog:paint", { roomId: props.roomId, sceneId: props.scene.id, cells, mode: fogBrush }, (result: Ack) => {
      if (result.ok === false) setError(result.error ?? "迷雾更新失败");
    });
  }

  function deleteWall(wallId: string): void {
    const socket = socketRef.current;
    if (socket === null) return;
    socket.emit("scene:wall:delete", { roomId: props.roomId, wallId }, (result: Ack) => {
      if (result.ok === false) setError(result.error ?? "墙体删除失败");
    });
  }

  function deleteLight(lightId: string): void {
    const socket = socketRef.current;
    if (socket === null) return;
    socket.emit("scene:light:delete", { roomId: props.roomId, lightId }, (result: Ack) => {
      if (result.ok === false) setError(result.error ?? "灯光删除失败");
    });
  }

  function onTokenPointerDown(event: React.PointerEvent<HTMLDivElement>, token: SceneTokenView): void {
    if (mode !== "select" || canMove(token) === false) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { tokenId: token.id, pointerId: event.pointerId };
    setDrag({ tokenId: token.id, pointerId: event.pointerId });
  }

  function onMapPointerDown(event: React.PointerEvent<HTMLDivElement>): void {
    if (props.isKP === false || props.readOnly) return;
    const point = pointerToMap(event);
    if (point === null || map === null) return;
    setError(null);
    if (mode === "wall") {
      wallStartRef.current = point;
      setWallDraftEnd(point);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (mode === "light") {
      emitLight(point);
      return;
    }
    if (mode === "fog") {
      fogStrokeRef.current = new Set();
      const key = cellKeyAt(map, point.x, point.y);
      if (key.length > 0) {
        fogStrokeRef.current.add(key);
        setFogStroke({ mode: fogBrush, cells: Array.from(fogStrokeRef.current) });
      }
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }

  function onMapPointerMove(event: React.PointerEvent<HTMLDivElement>): void {
    if (map === null) return;
    const point = pointerToMap(event);
    if (point === null) return;

    if (drag !== null && mode === "select") {
      event.preventDefault();
      setTokens((prev) => prev.map((token) => (token.id === drag.tokenId ? { ...token, x: point.x, y: point.y } : token)));
      return;
    }
    if (mode === "wall" && wallStartRef.current !== null) {
      event.preventDefault();
      setWallDraftEnd(point);
      return;
    }
    if (mode === "fog" && fogStrokeRef.current.size > 0) {
      event.preventDefault();
      const key = cellKeyAt(map, point.x, point.y);
      if (key.length > 0 && fogStrokeRef.current.has(key) === false) {
        fogStrokeRef.current.add(key);
        setFogStroke({ mode: fogBrush, cells: Array.from(fogStrokeRef.current) });
      }
    }
  }

  function onMapPointerUp(event: React.PointerEvent<HTMLDivElement>): void {
    if (map === null) return;
    const point = pointerToMap(event);

    if (drag !== null) {
      const current = drag;
      dragRef.current = null;
      setDrag(null);
      if (point !== null) {
        const snapped = snapPointToGrid(map, point.x, point.y);
        setTokens((prev) => prev.map((token) => (token.id === current.tokenId ? { ...token, x: snapped.x, y: snapped.y } : token)));
        emitTokenMove(current.tokenId, snapped);
      }
      return;
    }
    if (mode === "wall" && wallStartRef.current !== null && point !== null) {
      emitWall(point);
      wallStartRef.current = null;
      setWallDraftEnd(null);
      return;
    }
    if (mode === "fog" && fogStrokeRef.current.size > 0) {
      const cells = Array.from(fogStrokeRef.current);
      fogStrokeRef.current = new Set();
      setFogStroke(null);
      emitFog(cells);
    }
  }

  function clearWalls(): void {
    if (window.confirm("确定清空当前场景的所有墙体吗？") === false) return;
    const socket = socketRef.current;
    if (socket === null) return;
    socket.emit("scene:wall:clear", { roomId: props.roomId, sceneId: props.scene.id }, (result: Ack) => {
      if (result.ok === false) setError(result.error ?? "清空墙体失败");
    });
  }

  function clearLights(): void {
    if (window.confirm("确定清空当前场景的所有灯光吗？") === false) return;
    const socket = socketRef.current;
    if (socket === null) return;
    socket.emit("scene:light:clear", { roomId: props.roomId, sceneId: props.scene.id }, (result: Ack) => {
      if (result.ok === false) setError(result.error ?? "清空灯光失败");
    });
  }

  function resetFog(): void {
    const socket = socketRef.current;
    if (socket === null) return;
    socket.emit("scene:fog:reset", { roomId: props.roomId, sceneId: props.scene.id }, (result: Ack) => {
      if (result.ok === false) setError(result.error ?? "迷雾重置失败");
    });
  }

  if (map === null) {
    return (
      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <h2 className="text-sm font-medium text-white/80">战术棋盘</h2>
        <p className="mt-3 text-xs text-white/35">当前场景还没有地图配置，请 KP 前往场景管理创建地图。</p>
      </section>
    );
  }

  const sortedLayers = [...map.layers].sort((left, right) => left.zIndex - right.zIndex);
  const squareFogRects: React.ReactNode[] = [];
  if (map.showFog && map.gridType !== "HEX") {
    const cols = Math.max(1, Math.ceil(map.width / map.gridSize));
    const rows = Math.max(1, Math.ceil(map.height / map.gridSize));
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const key = String(col) + "," + String(row);
        if (revealedNow.has(key)) continue;
        const cellWidth = Math.min(map.gridSize, map.width - col * map.gridSize);
        const cellHeight = Math.min(map.gridSize, map.height - row * map.gridSize);
        squareFogRects.push(
          <span
            key={key}
            className="absolute bg-black/80"
            style={{
              left: ((col * map.gridSize) / map.width) * 100 + "%",
              top: ((row * map.gridSize) / map.height) * 100 + "%",
              width: (cellWidth / map.width) * 100 + "%",
              height: (cellHeight / map.height) * 100 + "%"
            }}
          />
        );
      }
    }
  }
  const hexFogPolygons: React.ReactNode[] = [];
  if (map.showFog && map.gridType === "HEX") {
    for (const cell of hexCellsCovering(map, 1)) {
      if (revealedNow.has("hex:" + String(cell.q) + "," + String(cell.r))) continue;
      hexFogPolygons.push(
        <polygon key={String(cell.q) + ":" + String(cell.r)} points={hexPolygonPoints(cell, map.gridSize)} fill="rgba(0,0,0,0.82)" />
      );
    }
  }

  const boundsPath = "M0 0 H" + String(map.width) + " V" + String(map.height) + " H0 Z";
  const visionPath = visionPolygon.length < 3
    ? ""
    : boundsPath + " " + visionPolygon.map((point) => "L" + point.x.toFixed(2) + " " + point.y.toFixed(2)).join(" ") + " Z";
  const visionMask = losEnabled && visionPath.length > 0;

  const squaredGridStyle = map.showGrid && map.gridType === "SQUARE"
    ? {
        backgroundImage:
          "linear-gradient(to right, rgba(255,255,255,0.14) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.14) 1px, transparent 1px)",
        backgroundSize:
          ((map.gridSize / map.width) * 100).toFixed(4) + "% " + ((map.gridSize / map.height) * 100).toFixed(4) + "%"
      }
    : undefined;

  const hexGridPolygons = map.showGrid && map.gridType === "HEX" ? hexCellsCovering(map, 1) : [];

  return (
    <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-white/80">战术棋盘 · {props.scene.name}</h2>
          <p className="mt-1 text-[11px] text-white/40">
            {TIME_LABELS[props.scene.timeOfDay] ?? props.scene.timeOfDay}
            {" · "}
            {WEATHER_LABELS[props.scene.weather] ?? props.scene.weather}
            {props.scene.description === null ? "" : " · " + props.scene.description}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-spirit-400/30 px-2 py-0.5 text-[10px] text-spirit-300">
            {tokens.length} Token · {map.walls.length} 墙 · {map.lights.length} 灯
          </span>
          {props.isKP && props.readOnly === false ? (
            <span className="rounded-full border border-sakura-500/30 px-2 py-0.5 text-[10px] text-sakura-300">KP 场景编辑</span>
          ) : null}
        </div>
      </div>

      {props.isKP && props.readOnly === false ? (
        <div className="mt-4 grid gap-2 rounded-xl border border-white/10 bg-ink-900/60 p-3 sm:grid-cols-2">
          <form action={activateSceneAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="roomId" value={props.roomId} />
            <input type="hidden" name="returnTo" value={props.returnTo} />
            <label className="flex min-w-[160px] flex-1 flex-col gap-1">
              <span className="text-[10px] text-white/35">切换场景</span>
              <select name="sceneId" defaultValue={props.scene.id} className="rounded border border-white/15 bg-ink-900 px-2 py-1 text-xs text-white/75">
                {props.scenes.map((scene) => (
                  <option key={scene.id} value={scene.id}>
                    {scene.name}
                    {scene.isActive ? "（当前）" : ""}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="rounded border border-emerald-400/40 px-3 py-1.5 text-[11px] text-emerald-300 transition hover:bg-emerald-400/10">
              切换
            </button>
          </form>
          <form action={createSceneTokenAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="roomId" value={props.roomId} />
            <input type="hidden" name="sceneId" value={props.scene.id} />
            <input type="hidden" name="returnTo" value={props.returnTo} />
            <label className="flex min-w-[160px] flex-1 flex-col gap-1">
              <span className="text-[10px] text-white/35">放置玩家 / NPC Token</span>
              <select name="unitRef" className="rounded border border-white/15 bg-ink-900 px-2 py-1 text-xs text-white/75" disabled={availableUnits.length === 0}>
                {availableUnits.length === 0 ? <option value="">当前场景已放置全部单位</option> : null}
                {availableUnits.map((unit) => (
                  <option key={unit.ref} value={unit.ref}>
                    {unit.name}（{unit.kind === "NPC" ? "NPC" : "PC"}）
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" disabled={availableUnits.length === 0} className="rounded border border-spirit-400/40 px-3 py-1.5 text-[11px] text-spirit-300 transition hover:bg-spirit-400/10 disabled:opacity-40">
              放置
            </button>
          </form>
        </div>
      ) : null}

      {props.isKP && props.readOnly === false ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-ink-900/60 p-3">
          <span className="text-[10px] text-white/35">工具</span>
          {(["select", "wall", "light", "fog", "delete"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => {
                setMode(item);
                setError(null);
              }}
              className={
                "rounded-md border px-2.5 py-1 text-[11px] transition " +
                (mode === item
                  ? "border-sakura-500/60 bg-sakura-500/15 text-sakura-300"
                  : "border-white/15 text-white/50 hover:text-white")
              }
            >
              {item === "select" ? "移动 Token" : null}
              {item === "wall" ? "画墙" : null}
              {item === "light" ? "放灯光" : null}
              {item === "fog" ? "战雾" : null}
              {item === "delete" ? "删除" : null}
            </button>
          ))}

          {mode === "wall" ? (
            <label className="flex items-center gap-1 text-[10px] text-white/45">
              类型
              <select
                value={wallType}
                onChange={(event) => setWallType(event.target.value as WallType)}
                className="rounded border border-white/15 bg-ink-900 px-1.5 py-1 text-[10px]"
              >
                {Object.entries(WALL_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <span className="text-white/25">地图上拖拽画一段墙</span>
            </label>
          ) : null}

          {mode === "light" ? (
            <span className="flex flex-wrap items-center gap-2 text-[10px] text-white/45">
              <label className="flex items-center gap-1">
                半径
                <input
                  type="number"
                  min={20}
                  max={2000}
                  value={lightRadius}
                  onChange={(event) => setLightRadius(Number(event.target.value))}
                  className="w-16 rounded border border-white/15 bg-ink-900 px-1.5 py-1 text-[10px]"
                />
              </label>
              <label className="flex items-center gap-1">
                颜色
                <input
                  type="color"
                  value={lightColor}
                  onChange={(event) => setLightColor(event.target.value)}
                  className="h-6 w-10 rounded border border-white/15 bg-ink-900"
                />
              </label>
              <span className="text-white/25">点击地图放置</span>
            </span>
          ) : null}

          {mode === "fog" ? (
            <span className="flex flex-wrap items-center gap-1 text-[10px] text-white/45">
              <button
                type="button"
                onClick={() => setFogBrush("REVEAL")}
                className={"rounded border px-2 py-1 transition " + (fogBrush === "REVEAL" ? "border-emerald-400/50 text-emerald-300" : "border-white/15 text-white/45")}
              >
                揭示
              </button>
              <button
                type="button"
                onClick={() => setFogBrush("HIDE")}
                className={"rounded border px-2 py-1 transition " + (fogBrush === "HIDE" ? "border-red-400/50 text-red-300" : "border-white/15 text-white/45")}
              >
                遮回
              </button>
              <button type="button" onClick={resetFog} className="rounded border border-white/15 px-2 py-1 text-white/45 transition hover:text-white">
                清空已揭示
              </button>
              <span className="text-white/25">在地图上拖动刷格子</span>
            </span>
          ) : null}

          {mode === "delete" ? (
            <span className="flex flex-wrap items-center gap-2 text-[10px] text-white/35">
              <span>点击墙体或灯光进行删除</span>
              <button type="button" onClick={clearWalls} className="rounded border border-red-400/30 px-2 py-1 text-red-300 transition hover:bg-red-400/10">
                清空墙体
              </button>
              <button type="button" onClick={clearLights} className="rounded border border-amber-400/30 px-2 py-1 text-amber-300 transition hover:bg-amber-400/10">
                清空灯光
              </button>
            </span>
          ) : null}

          <label className="ml-auto flex items-center gap-1 text-[10px] text-white/45">
            <input
              type="checkbox"
              checked={showPlayerVision}
              onChange={(event) => setShowPlayerVision(event.target.checked)}
              className="accent-sakura-500"
            />
            预览玩家视线遮挡
          </label>
        </div>
      ) : null}

      {error === null ? null : <p className="mt-3 text-xs text-red-300">{error}</p>}

      {props.scene.narration === null ? null : (
        <p className="mt-3 whitespace-pre-wrap rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2 text-xs leading-relaxed text-white/55">
          {props.scene.narration}
        </p>
      )}

      <div
        ref={mapRef}
        className="relative mt-4 w-full touch-none overflow-hidden rounded-lg border border-white/15 select-none"
        style={{ aspectRatio: map.width + " / " + map.height, backgroundColor: map.bgColor }}
        onPointerDown={onMapPointerDown}
        onPointerMove={onMapPointerMove}
        onPointerUp={onMapPointerUp}
        onPointerCancel={onMapPointerUp}
      >
        {map.backgroundUrl === null ? null : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={map.backgroundUrl} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-fill" draggable={false} />
        )}

        {sortedLayers.map((layer) => {
          if (layer.visible === false || layer.imageUrl === null) return null;
          return (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={layer.id}
              src={layer.imageUrl}
              alt=""
              draggable={false}
              className="pointer-events-none absolute inset-0 h-full w-full object-fill"
              style={{
                opacity: layer.opacity,
                zIndex: 2 + layer.zIndex,
                left: (layer.offsetX / map.width) * 100 + "%",
                top: (layer.offsetY / map.height) * 100 + "%",
                transform: "scale(" + String(layer.scale) + ")",
                transformOrigin: "center"
              }}
            />
          );
        })}

        {squaredGridStyle === undefined ? null : (
          <div className="pointer-events-none absolute inset-0" style={{ ...squaredGridStyle, zIndex: 20 }} />
        )}

        {map.gridType === "HEX" ? (
          <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={"0 0 " + map.width + " " + map.height} preserveAspectRatio="none" style={{ zIndex: 20 }}>
            {hexGridPolygons.map((cell) => (
              <polygon
                key={"grid-" + String(cell.q) + ":" + String(cell.r)}
                points={hexPolygonPoints(cell, map.gridSize)}
                fill="none"
                stroke="rgba(255,255,255,0.16)"
                strokeWidth={1}
              />
            ))}
          </svg>
        ) : null}

        {map.lights.map((light) => (
          <div
            key={light.id}
            className={mode === "delete" && props.isKP ? "absolute rounded-full" : "pointer-events-none absolute rounded-full"}
            onClick={mode === "delete" && props.isKP ? () => deleteLight(light.id) : undefined}
            style={{
              left: ((light.x - light.radius) / map.width) * 100 + "%",
              top: ((light.y - light.radius) / map.height) * 100 + "%",
              width: ((light.radius * 2) / map.width) * 100 + "%",
              height: ((light.radius * 2) / map.height) * 100 + "%",
              zIndex: 25,
              opacity: light.intensity,
              background: "radial-gradient(circle, " + light.color + "88 0%, " + light.color + "22 55%, transparent 72%)"
            }}
          />
        ))}

        <svg className="absolute inset-0 h-full w-full" viewBox={"0 0 " + map.width + " " + map.height} preserveAspectRatio="none" style={{ zIndex: 30 }}>
          {map.walls.map((wall) => {
            const segment = segmentFromPoints(wall.points);
            if (segment === null) return null;
            return (
              <line
                key={wall.id}
                x1={segment.a.x}
                y1={segment.a.y}
                x2={segment.b.x}
                y2={segment.b.y}
                stroke={WALL_COLORS[wall.type] ?? WALL_COLORS.WALL}
                strokeWidth={5}
                strokeLinecap="round"
                onClick={mode === "delete" && props.isKP ? () => deleteWall(wall.id) : undefined}
                style={{ cursor: mode === "delete" && props.isKP ? "pointer" : "default", pointerEvents: mode === "delete" && props.isKP ? "auto" : "none" }}
              />
            );
          })}
          {wallStartRef.current !== null && wallDraftEnd !== null ? (
            <line
              x1={wallStartRef.current.x}
              y1={wallStartRef.current.y}
              x2={wallDraftEnd.x}
              y2={wallDraftEnd.y}
              stroke="rgba(244,114,182,0.9)"
              strokeWidth={4}
              strokeDasharray="8 6"
              strokeLinecap="round"
            />
          ) : null}
        </svg>

        {tokens.filter((token) => token.isVisible && isTokenVisible(token)).map((token) => {
          const widthPercent = ((token.size * map.gridSize) / map.width) * 100;
          const hpPercent = token.currentHp !== null && token.maxHp !== null && token.maxHp > 0
            ? Math.max(0, Math.min(100, (token.currentHp / token.maxHp) * 100))
            : null;
          return (
            <div
              key={token.id}
              className={"absolute flex aspect-square -translate-x-1/2 -translate-y-1/2 flex-col items-center " + (canMove(token) && mode === "select" ? "cursor-grab active:cursor-grabbing" : "cursor-default")}
              style={{
                left: (token.x / map.width) * 100 + "%",
                top: (token.y / map.height) * 100 + "%",
                width: widthPercent + "%",
                zIndex: 40 + token.zIndex
              }}
              onPointerDown={(event) => onTokenPointerDown(event, token)}
              title={token.name}
            >
              <div
                className="relative h-full w-full overflow-hidden rounded-full border-2 bg-ink-900/80 shadow-lg"
                style={{ borderColor: token.borderColor, transform: "rotate(" + token.rotation + "deg)" }}
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

        {map.gridType === "HEX" ? (
          <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={"0 0 " + map.width + " " + map.height} preserveAspectRatio="none" style={{ zIndex: 50 }}>
            {hexFogPolygons}
          </svg>
        ) : (
          <span className="pointer-events-none absolute inset-0" style={{ zIndex: 50 }}>{squareFogRects}</span>
        )}

        {visionMask ? (
          <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={"0 0 " + map.width + " " + map.height} preserveAspectRatio="none" style={{ zIndex: 60 }}>
            <path d={visionPath} fill="rgba(0,0,0,0.72)" fillRule="evenodd" />
          </svg>
        ) : null}
      </div>

      <p className="mt-2 text-[10px] text-white/30">
        {props.isKP
          ? "KP：选择「移动 Token」拖动任意 Token；画墙 / 灯光 / 战雾工具会通过 Socket 实时同步；视线遮挡按墙体计算。"
          : viewerToken === null
            ? "你还没有可操作的当前角色 Token；战雾与视线遮挡仍会生效。"
            : "玩家只能移动自己的角色 Token；战雾未揭示区域和墙体遮挡的 Token 不可见。"}
      </p>
    </section>
  );
}
