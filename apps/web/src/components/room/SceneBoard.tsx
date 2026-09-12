"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { io, type Socket } from "socket.io-client";
import ImageUpload from "@/components/upload/ImageUpload";
import { applyMapBackgroundAction, createSceneTokenAction } from "@/server/actions/scene";
import { shareClueWithMemberAction } from "@/server/actions/room-info";
import { createTradeOfferAction } from "@/server/actions/trade";
import { toggleVisionShareAction } from "@/server/actions/vision";
import type { Ack, RoomMemberView } from "@/shared/socket";
import type { SceneMapView, SceneTokenUpdate, SceneTokenView, SceneUpdated, SceneView, SceneVisibilityUpdated } from "@/shared/scene";
import { cellKeyAt, hexCellsCovering, hexPolygonPoints, snapPointToGrid, type GeometryPoint } from "@/shared/scene-geometry";
import { allVisionCellKeys, visionCellKeysForPoints } from "@/shared/scene-vision";

interface PlaceableUnit {
  readonly ref: string;
  readonly name: string;
  readonly kind: "PLAYER" | "NPC";
  readonly userId?: string | null;
}

interface BackgroundAssetOption {
  readonly id: string;
  readonly label: string;
  readonly url: string;
}

interface Props {
  readonly roomId: string;
  readonly isKP: boolean;
  readonly currentUserId: string;
  readonly readOnly: boolean;
  readonly returnTo: string;
  readonly scenes: readonly { readonly id: string; readonly name: string; readonly isActive: boolean }[];
  readonly units: readonly PlaceableUnit[];
  readonly members: readonly RoomMemberView[];
  readonly sharedUserIds: readonly string[];
  readonly backgroundAssets: readonly BackgroundAssetOption[];
  readonly canControlAll: boolean;
  readonly allowPlayerCombatRequest: boolean;
  readonly activeCombatId: string | null;
  readonly fill?: boolean;
  readonly tradeCards: readonly { readonly id: string; readonly name: string; readonly type: string }[];
  readonly shareableClues: readonly { readonly id: string; readonly title: string; readonly isPublic: boolean }[];
  readonly scene: SceneView;
}

interface DragState {
  readonly tokenId: string;
  readonly pointerId: number;
}

const TIME_LABELS: Record<string, string> = {
  DAWN: "\u9ece\u660e",
  DAY: "\u767d\u5929",
  DUSK: "\u9ec4\u660f",
  NIGHT: "\u591c\u665a",
  MIDNIGHT: "\u5348\u591c"
};

const WEATHER_LABELS: Record<string, string> = {
  NONE: "\u65e0",
  RAIN: "\u96e8",
  SNOW: "\u96ea",
  FOG: "\u96fe",
  STORM: "\u66b4\u98ce\u96e8",
  SAKURA: "\u6a31\u5439\u96ea",
  PETALS: "\u82b1\u74e3"
};


const ATTRIBUTE_LABELS: Record<string, string> = {
  str: "力量",
  con: "体质",
  siz: "体型",
  dex: "敏捷",
  app: "外貌",
  int: "智力",
  pow: "意志",
  edu: "教育",
  luck: "幸运"
};

function numberText(value: number | null | undefined): string {
  return value === null || value === undefined ? "？？？" : String(value);
}

interface TokenHoverCardProps {
  readonly token: SceneTokenView;
  readonly member: RoomMemberView | null;
  readonly roomId: string;
  readonly currentUserId: string;
  readonly canControlAll: boolean;
  readonly allowPlayerCombatRequest: boolean;
  readonly activeCombatId: string | null;
  readonly tradeCards: readonly { readonly id: string; readonly name: string; readonly type: string }[];
  readonly shareableClues: readonly { readonly id: string; readonly title: string; readonly isPublic: boolean }[];
  readonly sharedUserIds: readonly string[];
  readonly open: boolean;
  readonly onCardEnter: () => void;
  readonly onCardLeave: () => void;
}

function TokenHoverCard(props: TokenHoverCardProps) {
  const character = props.member?.character ?? null;
  const isOwn = props.member !== null && props.member.userId === props.currentUserId;
  const isOwnToken = props.token.ownerUserId === null ? false : props.token.ownerUserId === props.currentUserId;
  const canStart = props.activeCombatId === null && isOwnToken === false && (props.canControlAll || props.allowPlayerCombatRequest);
  const combatHref = "/rooms/" + props.roomId + "/combat/new?opponentTokenId=" + props.token.id;
  const imageUrl = character?.portraitUrl ?? props.member?.avatarUrl ?? props.token.imageUrl;
  return (
    <div
      className={
        "absolute bottom-full left-1/2 z-50 mb-2 w-72 -translate-x-1/2 rounded-xl border border-white/15 bg-ink-900/95 p-3 text-left shadow-xl backdrop-blur " +
        (props.open ? "block" : "hidden")
      }
      onMouseEnter={props.onCardEnter}
      onMouseLeave={props.onCardLeave}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-start gap-2.5">
        {imageUrl === null ? (
          <span className="flex h-16 w-12 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-ink-800 text-lg text-white/40">
            {props.token.name.slice(0, 1)}
          </span>
        ) : (
          <img src={imageUrl} alt="" className="h-16 w-12 shrink-0 rounded-lg border border-white/15 object-cover" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white/85">{character?.name ?? props.token.name}</p>
          <p className="mt-0.5 truncate text-[10px] text-white/40">{character?.occupation ?? "NPC / 未选择角色"}</p>
          <p className="mt-1 text-[10px] text-white/35">
            {props.member === null ? "地图单位" : props.member.role}
            {isOwn ? " · 你" : ""}
          </p>
        </div>
      </div>

      {character === null ? null : (
        <>
          <div className="mt-3 grid grid-cols-3 gap-1.5 font-mono text-[10px] text-white/60">
            <span className="rounded border border-white/10 bg-ink-800/60 px-1.5 py-1">HP {numberText(character.hp)}/{numberText(character.maxHp)}</span>
            <span className="rounded border border-white/10 bg-ink-800/60 px-1.5 py-1">MP {numberText(character.mp)}/{numberText(character.maxMp)}</span>
            <span className="rounded border border-white/10 bg-ink-800/60 px-1.5 py-1">SAN {numberText(character.san)}/{numberText(character.maxSan)}</span>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-1">
            {Object.entries(character.attributes).map(([key, value]) => (
              <span key={key} className="rounded border border-white/10 px-1 py-0.5 text-[9px] text-white/45">
                {ATTRIBUTE_LABELS[key] ?? key} {numberText(value)}
              </span>
            ))}
          </div>
          {character.skills.length === 0 ? null : (
            <div className="mt-2 flex flex-wrap gap-1">
              {character.skills.slice(0, 6).map((skill) => (
                <span key={skill.id} className="rounded border border-white/10 px-1.5 py-0.5 text-[9px] text-white/45">
                  {skill.id} {numberText(skill.value)}
                </span>
              ))}
            </div>
          )}
        </>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-white/10 pt-2">
        {props.activeCombatId !== null ? (
          <Link
            href={"/rooms/" + props.roomId + "/combat/" + props.activeCombatId}
            className="rounded border border-amber-400/50 bg-amber-400/10 px-2 py-1 text-[10px] text-amber-200 transition hover:bg-amber-400/20"
          >
            进入战斗
          </Link>
        ) : canStart ? (
          <Link
            href={combatHref}
            className="rounded border border-red-400/50 bg-red-400/10 px-2 py-1 text-[10px] text-red-200 transition hover:bg-red-400/20"
          >
            发起战斗
          </Link>
        ) : null}
        {props.member === null || isOwn || props.member.role === "KP" ? null : (
          <form action={toggleVisionShareAction}>
            <input type="hidden" name="roomId" value={props.roomId} />
            <input type="hidden" name="targetUserId" value={props.member.userId} />
            <input type="hidden" name="returnTo" value={"/rooms/" + props.roomId} />
            <button
              type="submit"
              className={
                "rounded border px-2 py-1 text-[10px] transition " +
                (props.sharedUserIds.includes(props.member.userId)
                  ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-300"
                  : "border-white/15 text-white/50 hover:border-white/35")
              }
            >
              {props.sharedUserIds.includes(props.member.userId) ? "已共享视野" : "共享视野"}
            </button>
          </form>
        )}
        {props.member === null || isOwn ? null : (
          <>
            <details className="relative rounded border border-white/10 bg-ink-800/60 px-2 py-1">
              <summary className="cursor-pointer text-[10px] text-emerald-300">交换物品</summary>
              {props.tradeCards.length === 0 ? (
                <p className="mt-1 text-[10px] text-white/35">没有可交易物品。</p>
              ) : (
                <form action={createTradeOfferAction} className="mt-1 flex w-56 flex-col gap-1">
                  <input type="hidden" name="roomId" value={props.roomId} />
                  <input type="hidden" name="toUserId" value={props.member.userId} />
                  <select name="cardId" className="rounded border border-white/15 bg-ink-900 px-1.5 py-1 text-[10px] text-white/70">
                    {props.tradeCards.map((card) => (
                      <option key={card.id} value={card.id}>{card.name}（{card.type}）</option>
                    ))}
                  </select>
                  <input name="note" placeholder="留言（可选）" className="rounded border border-white/15 bg-ink-900 px-1.5 py-1 text-[10px] text-white/70" />
                  <button type="submit" className="rounded bg-emerald-400 px-2 py-1 text-[10px] font-medium text-ink-900">发出交易</button>
                </form>
              )}
            </details>
            <details className="relative rounded border border-white/10 bg-ink-800/60 px-2 py-1">
              <summary className="cursor-pointer text-[10px] text-spirit-300">分享情报</summary>
              {props.shareableClues.length === 0 ? (
                <p className="mt-1 text-[10px] text-white/35">没有可分享线索。</p>
              ) : (
                <form action={shareClueWithMemberAction} className="mt-1 flex w-56 flex-col gap-1">
                  <input type="hidden" name="roomId" value={props.roomId} />
                  <input type="hidden" name="targetUserId" value={props.member.userId} />
                  <input type="hidden" name="returnTo" value={"/rooms/" + props.roomId + "?clue=shared#room-info"} />
                  <select name="clueId" className="rounded border border-white/15 bg-ink-900 px-1.5 py-1 text-[10px] text-white/70">
                    {props.shareableClues.map((clue) => (
                      <option key={clue.id} value={clue.id}>{clue.title}（{clue.isPublic ? "公开" : "仅我可见"}）</option>
                    ))}
                  </select>
                  <button type="submit" className="rounded bg-sakura-500 px-2 py-1 text-[10px] font-medium text-ink-900">发送情报</button>
                </form>
              )}
            </details>
          </>
        )}
      </div>
    </div>
  );
}

export default function SceneBoard(props: Props) {
  const router = useRouter();
  const mapRef = useRef<HTMLDivElement | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [map, setMap] = useState<SceneMapView | null>(() => props.scene.map);
  const [tokens, setTokens] = useState<SceneTokenView[]>(() => [...(props.scene.map?.tokens ?? [])]);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [openCardTokenId, setOpenCardTokenId] = useState<string | null>(null);
  const cardCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
        if (cancelled === false && result?.ok === true) router.refresh();
      });
    });
    socket.on("scene:token:updated", (update: SceneTokenUpdate) => {
      if (cancelled) return;
      if (update.roomId === props.roomId) {
        setTokens((prev) => {
          const exists = prev.some((token) => token.id === update.token.id);
          return exists
            ? prev.map((token) => (token.id === update.token.id ? update.token : token))
            : [...prev, update.token];
        });
      }
    });
    socket.on("scene:map:updated", (update: { readonly roomId: string; readonly sceneId: string; readonly map: SceneMapView }) => {
      if (cancelled) return;
      if (update.roomId === props.roomId) {
        setMap(update.map);
        setTokens([...update.map.tokens]);
      }
    });
    socket.on("scene:visibility:updated", (update: SceneVisibilityUpdated) => {
      if (cancelled) return;
      if (update.roomId !== props.roomId) return;
      if (update.sceneId !== props.scene.id) return;
      setTokens([...update.tokens]);
    });
    socket.on("scene:updated", (update: SceneUpdated) => {
      if (cancelled) return;
      if (update.roomId === props.roomId) router.refresh();
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

  const allCellKeys = useMemo(() => (map === null ? [] : allVisionCellKeys(map)), [map]);
  const viewerPoints = useMemo(() => {
    if (props.canControlAll) return [] as GeometryPoint[];
    const sharedOwners = new Set<string>([props.currentUserId, ...props.sharedUserIds]);
    return tokens
      .filter((token) => typeof token.ownerUserId === "string" && sharedOwners.has(token.ownerUserId))
      .filter((token) => token.isVisible)
      .map((token) => ({ x: token.x, y: token.y }));
  }, [tokens, props.canControlAll, props.currentUserId, props.sharedUserIds]);
  const revealedCells = useMemo(
    () => (map === null || props.canControlAll ? new Set(allCellKeys) : visionCellKeysForPoints(map, viewerPoints)),
    [map, props.canControlAll, allCellKeys, viewerPoints]
  );
  const fogActive = map === null || map.showFog === false || props.canControlAll ? false : map.gridType === "NONE" ? false : true;
  const visibleTokens = useMemo(() => {
    if (map === null) return [] as SceneTokenView[];
    return tokens
      .filter((token) => token.isVisible)
      .filter((token) => props.canControlAll || fogActive === false || revealedCells.has(cellKeyAt(map, token.x, token.y)));
  }, [tokens, map, props.canControlAll, fogActive, revealedCells]);

  function pointerToMap(event: React.PointerEvent<HTMLDivElement>): GeometryPoint | null {
    if (map === null) return null;
    const rect = mapRef.current?.getBoundingClientRect();
    if (rect === undefined) return null;
    return {
      x: Math.max(0, Math.min(map.width, ((event.clientX - rect.left) / rect.width) * map.width)),
      y: Math.max(0, Math.min(map.height, ((event.clientY - rect.top) / rect.height) * map.height))
    };
  }

  function canMove(token: SceneTokenView): boolean {
    if (props.readOnly || token.isLocked || token.isVisible === false) return false;
    if (props.canControlAll) return true;
    return token.ownerUserId === props.currentUserId;
  }

  function emitTokenMove(tokenId: string, point: GeometryPoint): void {
    const socket = socketRef.current;
    if (socket === null) return;
    socket.emit("scene:token:move", { roomId: props.roomId, tokenId, x: point.x, y: point.y }, (result: Ack) => {
      if (result.ok === false) setError(result.error ?? "移动 Token 失败");
    });
  }

  function cancelCardClose(): void {
    if (cardCloseTimerRef.current === null) return;
    clearTimeout(cardCloseTimerRef.current);
    cardCloseTimerRef.current = null;
  }

  function scheduleCardClose(tokenId: string): void {
    cancelCardClose();
    cardCloseTimerRef.current = setTimeout(() => {
      setOpenCardTokenId((prev) => (prev === tokenId ? null : prev));
    }, 280);
  }

  function onTokenPointerDown(event: React.PointerEvent<HTMLDivElement>, token: SceneTokenView): void {
    if (canMove(token) === false) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { tokenId: token.id, pointerId: event.pointerId };
    setDrag({ tokenId: token.id, pointerId: event.pointerId });
  }

  function onMapPointerMove(event: React.PointerEvent<HTMLDivElement>): void {
    if (drag === null) return;
    const point = pointerToMap(event);
    if (point === null) return;
    event.preventDefault();
    setTokens((prev) => prev.map((token) => (token.id === drag.tokenId ? { ...token, x: point.x, y: point.y } : token)));
  }

  function onMapPointerUp(event: React.PointerEvent<HTMLDivElement>): void {
    if (drag === null || map === null) return;
    const point = pointerToMap(event);
    const current = drag;
    dragRef.current = null;
    setDrag(null);
    if (point === null) return;
    const snapped = snapPointToGrid(map, point.x, point.y);
    setTokens((prev) => prev.map((token) => (token.id === current.tokenId ? { ...token, x: snapped.x, y: snapped.y } : token)));
    emitTokenMove(current.tokenId, snapped);
  }

  if (map === null) {
    return (
      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <h2 className="text-sm font-medium text-white/80">战术棋盘 · {props.scene.name}</h2>
        <p className="mt-2 text-xs text-white/45">当前场景还没有配置地图，请先在团本编辑器中为场景设置背景图。</p>
      </section>
    );
  }

  const squareFogRects: React.ReactNode[] = [];
  if (fogActive && map.gridType === "HEX") {
    // HEX 由下面的 SVG 渲染
  } else if (fogActive) {
    const cols = Math.max(1, Math.ceil(map.width / map.gridSize));
    const rows = Math.max(1, Math.ceil(map.height / map.gridSize));
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const key = String(col) + "," + String(row);
        if (revealedCells.has(key)) continue;
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
  if (fogActive && map.gridType === "HEX") {
    for (const cell of hexCellsCovering(map, 1)) {
      const key = "hex:" + String(cell.q) + "," + String(cell.r);
      if (revealedCells.has(key)) continue;
      hexFogPolygons.push(
        <polygon key={key} points={hexPolygonPoints(cell, map.gridSize)} fill="rgba(0,0,0,0.82)" />
      );
    }
  }

  const squaredGridStyle = map.showGrid && map.gridType === "SQUARE"
    ? {
        backgroundImage:
          "linear-gradient(to right, rgba(255,255,255,0.14) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.14) 1px, transparent 1px)",
        backgroundSize:
          ((map.gridSize / map.width) * 100).toFixed(4) + "% " + ((map.gridSize / map.height) * 100).toFixed(4) + "%"
      }
    : undefined;
  const hexGridPolygons = map.showGrid && map.gridType === "HEX" ? hexCellsCovering(map, 1) : [];
  const shareableMembers = props.members.filter(
    (member) => member.userId === props.currentUserId || member.role === "KP" ? false : true
  );

  return (
    <section className={(props.fill ? "h-full w-full" : "mx-auto w-full max-w-4xl") + " rounded-xl border border-white/10 bg-ink-800/50 p-5"}>
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
      </div>

      {props.isKP && props.readOnly === false ? (
        <div className="mt-4 grid gap-3 rounded-xl border border-white/10 bg-ink-900/60 p-3 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <p className="text-[10px] text-white/35">当前地图背景</p>
            <div className="h-24 w-full overflow-hidden rounded-lg border border-white/10 bg-ink-800">
              {map.backgroundUrl === null ? (
                <span className="flex h-full items-center justify-center text-[11px] text-white/25">无背景</span>
              ) : (
                <img src={map.backgroundUrl} alt="" className="h-full w-full object-cover" />
              )}
            </div>
            <ImageUpload kind="MAP" targetId={map.id} currentUrl={map.backgroundUrl} label="上传新背景" shape="wide" />
          </div>
          <form action={applyMapBackgroundAction} className="flex flex-col gap-2">
            <input type="hidden" name="roomId" value={props.roomId} />
            <input type="hidden" name="sceneId" value={props.scene.id} />
            <input type="hidden" name="returnTo" value={props.returnTo} />
            <p className="text-[10px] text-white/35">使用团本 / 房间素材作为背景</p>
            {props.backgroundAssets.length === 0 ? (
              <p className="rounded border border-white/10 bg-ink-800 px-2 py-1.5 text-[11px] text-white/35">
                团本和房间还没有可用图片，先上传或到团本编辑器添加素材。
              </p>
            ) : (
              <select name="assetId" className="rounded border border-white/15 bg-ink-900 px-2 py-1.5 text-xs text-white/75 outline-none">
                {props.backgroundAssets.map((asset) => (
                  <option key={asset.id} value={asset.id}>{asset.label}</option>
                ))}
              </select>
            )}
            <button
              type="submit"
              disabled={props.backgroundAssets.length === 0}
              className="self-start rounded border border-spirit-400/40 px-3 py-1.5 text-[11px] text-spirit-300 transition hover:bg-spirit-400/10 disabled:opacity-40"
            >
              应用背景
            </button>
          </form>
        </div>
      ) : null}

      {props.readOnly === false && props.units.length > 0 ? (
        <form action={createSceneTokenAction} className="mt-4 flex flex-wrap items-end gap-2 rounded-xl border border-white/10 bg-ink-900/60 p-3">
          <input type="hidden" name="roomId" value={props.roomId} />
          <input type="hidden" name="sceneId" value={props.scene.id} />
          <input type="hidden" name="returnTo" value={props.returnTo} />
          <label className="flex min-w-[200px] flex-1 flex-col gap-1">
            <span className="text-[10px] text-white/35">
              {props.isKP ? "放置全部 PC / NPC Token" : "放置我的角色 Token"}
            </span>
            <select name="unitRef" className="rounded border border-white/15 bg-ink-900 px-2 py-1 text-xs text-white/75">
              {props.units.map((unit) => (
                <option key={unit.ref} value={unit.ref}>
                  {unit.name}（{unit.kind === "NPC" ? "NPC" : "PC"}）
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="rounded border border-spirit-400/40 px-3 py-1.5 text-[11px] text-spirit-300 transition hover:bg-spirit-400/10">
            放置到本场景
          </button>
        </form>
      ) : null}

      {props.isKP === false && shareableMembers.length > 0 ? (
        <div className="mt-4 rounded-xl border border-white/10 bg-ink-900/60 p-3">
          <p className="text-[10px] text-white/35">共享战争视野（双向：对方也会看到你的视野）</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {shareableMembers.map((member) => {
              const shared = props.sharedUserIds.includes(member.userId);
              return (
                <form key={member.userId} action={toggleVisionShareAction}>
                  <input type="hidden" name="roomId" value={props.roomId} />
                  <input type="hidden" name="targetUserId" value={member.userId} />
                  <input type="hidden" name="returnTo" value={props.returnTo} />
                  <button
                    type="submit"
                    className={
                      "rounded border px-2 py-1 text-[10px] transition " +
                      (shared
                        ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-300"
                        : "border-white/15 text-white/50 hover:border-white/35")
                    }
                  >
                    {shared ? "已共享：" : "共享视野："}{member.displayName}
                  </button>
                </form>
              );
            })}
          </div>
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
        className="relative mt-4 w-full touch-none overflow-visible rounded-lg border border-white/15 select-none"
        style={{ aspectRatio: map.width + " / " + map.height, backgroundColor: map.bgColor }}
        onPointerMove={onMapPointerMove}
        onPointerUp={onMapPointerUp}
        onPointerCancel={onMapPointerUp}
      >
        {map.backgroundUrl === null ? null : (
          <img src={map.backgroundUrl} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-fill" draggable={false} />
        )}
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

        {visibleTokens.map((token) => {
          const widthPercent = ((token.size * map.gridSize) / map.width) * 100;
          const hpPercent = typeof token.currentHp === "number" && typeof token.maxHp === "number" && token.maxHp > 0
            ? Math.max(0, Math.min(100, (token.currentHp / token.maxHp) * 100))
            : null;
          return (
            <div
              key={token.id}
              className={"group absolute flex aspect-square -translate-x-1/2 -translate-y-1/2 flex-col items-center " + (canMove(token) ? "cursor-grab active:cursor-grabbing" : "cursor-default")}
              style={{
                left: (token.x / map.width) * 100 + "%",
                top: (token.y / map.height) * 100 + "%",
                width: widthPercent + "%",
                zIndex: 90 + token.zIndex
              }}
              onPointerDown={(event) => onTokenPointerDown(event, token)}
              onMouseEnter={() => {
                cancelCardClose();
                setOpenCardTokenId(token.id);
              }}
              onMouseLeave={() => scheduleCardClose(token.id)}
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
              <TokenHoverCard
                token={token}
                member={props.members.find((member) => member.userId === token.ownerUserId) ?? null}
                roomId={props.roomId}
                currentUserId={props.currentUserId}
                canControlAll={props.canControlAll}
                allowPlayerCombatRequest={props.allowPlayerCombatRequest}
                activeCombatId={props.activeCombatId}
                tradeCards={props.tradeCards}
                shareableClues={props.shareableClues}
                sharedUserIds={props.sharedUserIds}
                open={openCardTokenId === token.id}
                onCardEnter={cancelCardClose}
                onCardLeave={() => scheduleCardClose(token.id)}
              />
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
      </div>

    </section>
  );
}
