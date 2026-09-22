/**
 * dsh 悬浮球的页面上下文推导（客户端 / 服务端共用）。
 *
 * 悬浮球常驻在每个页面，靠 pathname 判断「现在在哪个场景」，并把对应的
 * moduleId / roomId / characterId / combatId / cardId / gameId 带进请求。
 * 这里只做纯字符串解析，不依赖 prisma，客户端可以同步算出上下文 key。
 */
export type DshContextKind =
  | "MODULE"
  | "ROOM"
  | "CHARACTER"
  | "COMBAT"
  | "GAME"
  | "CARD"
  | "GLOBAL";

export interface DshRouteContext {
  readonly kind: DshContextKind;
  readonly pathname: string;
  readonly moduleId?: string;
  readonly roomId?: string;
  readonly characterId?: string;
  readonly combatId?: string;
  readonly cardId?: string;
  readonly gameId?: string;
}

const ID_PATTERN = /^[A-Za-z0-9_-]{4,64}$/;

/** 路由里这些词是动作而不是资源 id。 */
const RESERVED_SEGMENTS = new Set([
  "new",
  "edit",
  "manage",
  "import",
  "mine",
  "requests",
  "effects",
  "system",
  "page"
]);

function resourceSegment(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    decoded = value;
  }
  const trimmed = decoded.trim();
  if (trimmed.length === 0) return null;
  if (RESERVED_SEGMENTS.has(trimmed.toLowerCase())) return null;
  return ID_PATTERN.test(trimmed) ? trimmed : null;
}

function normalizePath(pathname: string): string {
  const withoutHash = pathname.split("#")[0] ?? "";
  const withoutQuery = withoutHash.split("?")[0] ?? "";
  if (withoutQuery.length === 0) return "/";
  return withoutQuery.startsWith("/") ? withoutQuery : "/" + withoutQuery;
}

/** 把 pathname 解析成 dsh 上下文；识别不了就退回 GLOBAL。 */
export function parseDshRoute(pathname: string): DshRouteContext {
  const normalized = normalizePath(pathname);
  const parts = normalized.split("/").filter((part) => part.length > 0);
  const head = parts[0];
  const second = parts[1];
  const third = parts[2];
  const fourth = parts[3];

  if (head === "rooms") {
    const roomId = resourceSegment(second);
    if (roomId === null) return { kind: "GLOBAL", pathname: normalized };
    if (third === "combat") {
      const combatId = resourceSegment(fourth);
      return combatId === null
        ? { kind: "COMBAT", pathname: normalized, roomId }
        : { kind: "COMBAT", pathname: normalized, roomId, combatId };
    }
    if (third === "characters") {
      const characterId = resourceSegment(fourth);
      return characterId === null
        ? { kind: "CHARACTER", pathname: normalized, roomId }
        : { kind: "CHARACTER", pathname: normalized, roomId, characterId };
    }
    if (third === "modules") {
      const moduleId = resourceSegment(fourth);
      return moduleId === null
        ? { kind: "MODULE", pathname: normalized, roomId }
        : { kind: "MODULE", pathname: normalized, roomId, moduleId };
    }
    return { kind: "ROOM", pathname: normalized, roomId };
  }

  if (head === "modules") {
    const moduleId = resourceSegment(second);
    return moduleId === null
      ? { kind: "GLOBAL", pathname: normalized }
      : { kind: "MODULE", pathname: normalized, moduleId };
  }

  if (head === "characters") {
    const characterId = resourceSegment(second);
    return characterId === null
      ? { kind: "GLOBAL", pathname: normalized }
      : { kind: "CHARACTER", pathname: normalized, characterId };
  }

  if (head === "cards") {
    const cardId = resourceSegment(second);
    return cardId === null
      ? { kind: "GLOBAL", pathname: normalized }
      : { kind: "CARD", pathname: normalized, cardId };
  }

  if (head === "history") {
    const gameId = resourceSegment(second);
    return gameId === null
      ? { kind: "GLOBAL", pathname: normalized }
      : { kind: "GAME", pathname: normalized, gameId };
  }

  return { kind: "GLOBAL", pathname: normalized };
}

/** 上下文身份 key：只有它变化时才需要清空对话、重新拉技能列表。 */
export function dshContextKey(context: DshRouteContext): string {
  return [
    context.kind,
    context.moduleId ?? "",
    context.roomId ?? "",
    context.characterId ?? "",
    context.combatId ?? "",
    context.cardId ?? "",
    context.gameId ?? ""
  ].join("|");
}
