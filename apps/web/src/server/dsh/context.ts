import { prisma } from "@/server/db/prisma";
import { parseDshRoute, type DshContextKind, type DshRouteContext } from "@/shared/dsh-context";
import type { DshViewer } from "@/server/dsh/types";

const MAX_TEXT = 4_000;
const MAX_LIST = 40;

export interface DshResolvedContext {
  readonly route: DshRouteContext;
  readonly kind: DshContextKind;
  readonly label: string;
  readonly moduleId?: string;
  readonly roomId?: string;
  readonly characterId?: string;
  readonly combatId?: string;
  readonly cardId?: string;
  readonly gameId?: string;
  readonly canEditModule: boolean;
  readonly isKp: boolean;
  readonly roomRole: "KP" | "PLAYER" | "SPECTATOR" | null;
  readonly pack: Record<string, unknown>;
}

export type DshContextResult =
  | { readonly ok: true; readonly context: DshResolvedContext }
  | { readonly ok: false; readonly error: string };

function cleanText(value: unknown, maxLength = MAX_TEXT): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, maxLength);
}

function recordOf(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** 从 module.content.structured 里抽取名字列表，避免把整本团本塞进上下文。 */
function structuredSummary(content: unknown): Record<string, unknown> {
  const record = recordOf(content);
  const structured = recordOf(record?.structured);
  if (structured === null) return { textLength: cleanText(record?.text, MAX_TEXT)?.length ?? 0 };
  const keys = ["chapters", "scenes", "npcs", "items", "clues", "encounters", "magic", "rewards", "endings"];
  const summary: Record<string, unknown> = {
    textLength: typeof record?.text === "string" ? record.text.length : 0
  };
  for (const key of keys) {
    const list = structured[key];
    if (Array.isArray(list) === false) continue;
    summary[key] = list.slice(0, MAX_LIST).map((item) => {
      const entry = recordOf(item);
      if (entry === null) return String(item).slice(0, 120);
      const name = cleanText(entry.name, 120) ?? cleanText(entry.title, 120) ?? cleanText(entry.id, 120);
      return name ?? "（未命名）";
    });
  }
  return summary;
}

function basePack(route: DshRouteContext, viewer: DshViewer, label: string, extra?: Record<string, unknown>): Record<string, unknown> {
  return {
    page: { pathname: route.pathname, kind: route.kind, label },
    user: { username: viewer.username, role: viewer.role, isAdmin: viewer.role === "ADMIN" },
    navigation: navigationPack(route),
    ...(extra ?? {})
  };
}

export interface DshDeepLink {
  readonly label: string;
  readonly href: string;
  readonly hint: string;
}

export function siteMap(): readonly DshDeepLink[] {
  return [
    { label: "我的房间", href: "/", hint: "房间列表与新建房间" },
    { label: "团本广场", href: "/modules", hint: "浏览公开团本" },
    { label: "我的团本", href: "/modules/mine", hint: "新建 / 编辑团本" },
    { label: "我的角色", href: "/characters", hint: "创建与管理角色卡" },
    { label: "我的卡牌", href: "/cards", hint: "卡牌 / 符卡管理" },
    { label: "游戏历史", href: "/history", hint: "回看已结束的局" }
  ];
}

export function deepLinksForRoute(route: DshRouteContext): readonly DshDeepLink[] {
  const links: DshDeepLink[] = [];
  const push = (label: string, href: string, hint: string): void => {
    if (links.some((item) => item.href === href) === false) links.push({ label, href, hint });
  };
  if (route.roomId !== undefined) {
    push("房间首页", "/rooms/" + route.roomId, "场景、Token、聊天与 KP 工具");
    push("准备页", "/rooms/" + route.roomId + "/prepare", "选团本、审核角色、应用预设、开始跑团");
    push("场景管理", "/rooms/" + route.roomId + "/scenes", "创建 / 切换场景");
    push("房间团本", "/rooms/" + route.roomId + "/modules", "查看或导入本房团本");
    push("发起战斗", "/rooms/" + route.roomId + "/combat/new", "选择参战单位与规则");
  }
  if (route.moduleId !== undefined) {
    push("团本详情", "/modules/" + route.moduleId, "正文、章节、NPC、线索、资源与发布");
    if (route.roomId !== undefined) push("房间内团本", "/rooms/" + route.roomId + "/modules/" + route.moduleId, "应用到本房 / 预设内容");
  }
  if (route.characterId !== undefined) {
    push("角色详情", "/characters/" + route.characterId, "属性、技能、背景与装备");
    push("角色管理", "/characters/" + route.characterId + "/manage", "成长 / 审核状态");
    if (route.roomId !== undefined) push("房间角色页", "/rooms/" + route.roomId + "/characters/" + route.characterId, "本房内审核与装备");
  }
  if (route.combatId !== undefined && route.roomId !== undefined) {
    push("战斗页", "/rooms/" + route.roomId + "/combat/" + route.combatId, "行动、弹幕对决与战斗日志");
  }
  if (route.cardId !== undefined) push("卡牌编辑", "/cards/" + route.cardId + "/edit", "编辑卡面与效果");
  if (route.gameId !== undefined) push("游戏回顾", "/history/" + route.gameId, "本局快照与日志");
  return links;
}

function navigationPack(route: DshRouteContext): Record<string, unknown> {
  return { siteMap: siteMap(), deepLinks: deepLinksForRoute(route) };
}

interface RoomAccess {
  readonly room: Record<string, unknown> & { ownerId: string; name: string };
  readonly role: "KP" | "PLAYER" | "SPECTATOR" | null;
  readonly isOwner: boolean;
  readonly isAdmin: boolean;
  readonly isKp: boolean;
  readonly hasAccess: boolean;
}

async function loadRoomAccess(roomId: string, viewer: DshViewer): Promise<RoomAccess | null> {
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { id: true, name: true, status: true, system: true, ownerId: true }
  });
  if (room === null) return null;
  const member = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId, userId: viewer.id } },
    select: { role: true }
  });
  const isOwner = room.ownerId === viewer.id;
  const isAdmin = viewer.role === "ADMIN";
  const role = isOwner ? "KP" : member?.role ?? null;
  const isKp = isOwner || role === "KP" || isAdmin;
  return { room, role, isOwner, isAdmin, isKp, hasAccess: isOwner || member !== null || isAdmin };
}

async function loadRoomContext(roomId: string, viewer: DshViewer, route: DshRouteContext): Promise<DshResolvedContext | null> {
  const access = await loadRoomAccess(roomId, viewer);
  if (access === null || access.hasAccess === false) return null;
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: {
      id: true,
      name: true,
      status: true,
      system: true,
      description: true,
      chargenMethod: true,
      era: true,
      characterVisibility: true,
      magicEnabled: true,
      owner: { select: { username: true, displayName: true } },
      selectedModule: { select: { id: true, title: true, version: true, isPublished: true } },
      members: {
        select: {
          userId: true,
          role: true,
          ready: true,
          statsPublic: true,
          user: { select: { username: true, displayName: true } },
          activeCharacter: { select: { id: true, name: true } }
        },
        take: 50
      },
      games: {
        select: { id: true, title: true, status: true, startedAt: true, endedAt: true },
        orderBy: { createdAt: "desc" },
        take: 1
      }
    }
  });
  if (room === null) return null;
  const label = "房间 · " + room.name;
  const game = room.games[0] ?? null;
  const resource = {
    room: {
      id: room.id,
      name: room.name,
      status: room.status,
      system: room.system,
      description: cleanText(room.description, 1_000),
      chargenMethod: room.chargenMethod,
      era: room.era,
      characterVisibility: room.characterVisibility,
      magicEnabled: room.magicEnabled,
      owner: room.owner.displayName ?? room.owner.username,
      selectedModule: room.selectedModule === null ? null : { id: room.selectedModule.id, title: room.selectedModule.title, version: room.selectedModule.version, isPublished: room.selectedModule.isPublished },
      members: room.members.map((member) => ({
        name: member.user.displayName ?? member.user.username,
        role: member.role,
        ready: member.ready,
        statsPublic: member.statsPublic,
        activeCharacter: member.activeCharacter === null ? null : member.activeCharacter.name
      })),
      currentGame: game === null ? null : { id: game.id, title: game.title, status: game.status }
    }
  };
  const pack = basePack(route, viewer, label, {
    resource,
    permissions: { isKp: access.isKp, role: access.role, canEditModule: false }
  });
  return {
    route,
    kind: route.kind,
    label,
    roomId,
    canEditModule: false,
    isKp: access.isKp,
    roomRole: access.role,
    pack
  };
}

async function loadModuleContext(
  moduleId: string,
  viewer: DshViewer,
  route: DshRouteContext,
  roomId?: string
): Promise<DshResolvedContext | null> {
  const moduleRecord = await prisma.module.findUnique({
    where: { id: moduleId },
    select: {
      id: true,
      title: true,
      system: true,
      era: true,
      version: true,
      author: true,
      synopsis: true,
      background: true,
      occupationRecommendation: true,
      isPublished: true,
      ownerId: true,
      roomId: true,
      content: true,
      owner: { select: { username: true, displayName: true } },
      room: { select: { id: true, name: true } }
    }
  });
  if (moduleRecord === null) return null;
  const isAdmin = viewer.role === "ADMIN";
  let membershipRole: "KP" | "PLAYER" | "SPECTATOR" | null = null;
  if (moduleRecord.roomId !== null) {
    const member = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId: moduleRecord.roomId, userId: viewer.id } },
      select: { role: true }
    });
    membershipRole = member?.role ?? null;
  }
  const isOwner = moduleRecord.ownerId === viewer.id;
  const canView = moduleRecord.isPublished || isOwner || membershipRole !== null || isAdmin;
  if (canView === false) return null;
  const canEditModule =
    isOwner || (moduleRecord.ownerId === null && moduleRecord.roomId !== null && membershipRole === "KP");
  const label = "团本 · " + moduleRecord.title;
  const pack = basePack(route, viewer, label, {
    resource: {
      module: {
        id: moduleRecord.id,
        title: moduleRecord.title,
        system: moduleRecord.system,
        era: moduleRecord.era,
        version: moduleRecord.version,
        author: moduleRecord.author ?? moduleRecord.owner?.displayName ?? moduleRecord.owner?.username ?? "未署名",
        published: moduleRecord.isPublished,
        synopsis: cleanText(moduleRecord.synopsis, 2_000),
        background: cleanText(moduleRecord.background, 2_000),
        occupationRecommendation: cleanText(moduleRecord.occupationRecommendation, 2_000),
        room: moduleRecord.room === null ? null : { id: moduleRecord.room.id, name: moduleRecord.room.name },
        structured: structuredSummary(moduleRecord.content)
      }
    },
    permissions: { canEditModule, isOwner, roomRole: membershipRole }
  });
  return {
    route,
    kind: route.kind,
    label,
    moduleId,
    roomId: roomId ?? moduleRecord.roomId ?? undefined,
    canEditModule,
    isKp: membershipRole === "KP" || isAdmin,
    roomRole: membershipRole,
    pack
  };
}

async function loadCharacterContext(
  characterId: string,
  viewer: DshViewer,
  route: DshRouteContext,
  roomId?: string
): Promise<DshResolvedContext | null> {
  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: {
      id: true,
      name: true,
      playerName: true,
      userId: true,
      roomId: true,
      system: true,
      era: true,
      reviewStatus: true,
      reviewComment: true,
      occupation: true,
      occupationRef: { select: { name: true } },
      str: true, con: true, siz: true, dex: true, app: true, int: true, pow: true, edu: true, luck: true,
      hp: true, maxHp: true, mp: true, maxMp: true, san: true, maxSan: true, dp: true, maxDp: true,
      skills: true,
      cards: { select: { id: true, name: true, type: true, isEquipped: true }, take: 40 },
      room: { select: { id: true, name: true } }
    }
  });
  if (character === null) return null;
  const isAdmin = viewer.role === "ADMIN";
  const isOwner = character.userId === viewer.id;
  let isKp = false;
  let roomRole: "KP" | "PLAYER" | "SPECTATOR" | null = null;
  if (character.roomId !== null) {
    const access = await loadRoomAccess(character.roomId, viewer);
    if (access === null) return null;
    isKp = access.isKp;
    roomRole = access.role;
  }
  const canView = isOwner || isKp || isAdmin;
  if (canView === false) return null;
  const skills = recordOf(character.skills) ?? {};
  const skillEntries = Object.entries(skills)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number")
    .slice(0, 80);
  const label = "角色 · " + character.name;
  const pack = basePack(route, viewer, label, {
    resource: {
      character: {
        id: character.id,
        name: character.name,
        playerName: character.playerName,
        system: character.system,
        era: character.era,
        reviewStatus: character.reviewStatus,
        reviewComment: cleanText(character.reviewComment, 500),
        occupation: character.occupationRef?.name ?? character.occupation,
        attributes: {
          STR: character.str, CON: character.con, SIZ: character.siz, DEX: character.dex,
          APP: character.app, INT: character.int, POW: character.pow, EDU: character.edu, LUCK: character.luck
        },
        vitals: {
          hp: { current: character.hp, max: character.maxHp },
          mp: { current: character.mp, max: character.maxMp },
          san: { current: character.san, max: character.maxSan },
          dp: { current: character.dp, max: character.maxDp }
        },
        skills: Object.fromEntries(skillEntries),
        cards: character.cards.map((card) => ({ name: card.name, type: card.type, equipped: card.isEquipped })),
        room: character.room === null ? null : { id: character.room.id, name: character.room.name }
      }
    },
    permissions: { isOwner, isKp, roomRole }
  });
  return {
    route,
    kind: route.kind,
    label,
    characterId,
    roomId: roomId ?? character.roomId ?? undefined,
    canEditModule: false,
    isKp,
    roomRole,
    pack
  };
}

async function loadCombatContext(combatId: string, viewer: DshViewer, route: DshRouteContext): Promise<DshResolvedContext | null> {
  const combat = await prisma.combat.findUnique({
    where: { id: combatId },
    select: {
      id: true,
      roomId: true,
      sceneId: true,
      round: true,
      phase: true,
      tick: true,
      startedAt: true,
      endedAt: true,
      participants: {
        orderBy: { atbValue: "desc" },
        select: {
          id: true,
          characterId: true,
          isNPC: true,
          name: true,
          currentHp: true, maxHp: true,
          currentMp: true, maxMp: true,
          currentSan: true, maxSan: true,
          currentDp: true, maxDp: true,
          statusEffects: true,
          isIdentified: true,
          isPublic: true,
          character: { select: { userId: true } }
        }
      },
      actions: {
        orderBy: { seq: "desc" },
        take: 12,
        select: { seq: true, actorId: true, type: true, resolution: true, damageDealt: true, createdAt: true }
      }
    }
  });
  if (combat === null) return null;
  const access = await loadRoomAccess(combat.roomId, viewer);
  if (access === null || access.hasAccess === false) return null;
  const nameById = new Map(combat.participants.map((participant) => [participant.id, participant.name]));
  const label = "战斗 · 第 " + String(combat.round) + " 轮";
  const pack = basePack(route, viewer, label, {
    resource: {
      combat: {
        id: combat.id,
        roomId: combat.roomId,
        sceneId: combat.sceneId,
        round: combat.round,
        phase: combat.phase,
        tick: combat.tick,
        startedAt: combat.startedAt.toISOString(),
        endedAt: combat.endedAt === null ? null : combat.endedAt.toISOString(),
        participants: combat.participants.map((participant) => {
          const canSeeNumbers = access.isKp || participant.isPublic || participant.isIdentified || participant.character?.userId === viewer.id;
          return {
            name: participant.name,
            kind: participant.isNPC ? "NPC" : "PC",
            ...(canSeeNumbers
              ? {
                  hp: { current: participant.currentHp, max: participant.maxHp },
                  mp: { current: participant.currentMp, max: participant.maxMp },
                  san: { current: participant.currentSan, max: participant.maxSan },
                  dp: { current: participant.currentDp, max: participant.maxDp },
                  statusEffects: participant.statusEffects,
                  identified: participant.isIdentified
                }
              : { hp: "？？", note: "未公开 / 未识破，数值对当前用户隐藏" })
          };
        }),
        recentActions: combat.actions.map((action) => ({
          seq: action.seq,
          actor: nameById.get(action.actorId) ?? "未知单位",
          type: action.type,
          resolution: action.resolution,
          damageDealt: action.damageDealt
        }))
      }
    },
    permissions: { isKp: access.isKp, roomRole: access.role }
  });
  return {
    route,
    kind: route.kind,
    label,
    combatId,
    roomId: combat.roomId,
    canEditModule: false,
    isKp: access.isKp,
    roomRole: access.role,
    pack
  };
}

async function loadGameContext(gameId: string, viewer: DshViewer, route: DshRouteContext): Promise<DshResolvedContext | null> {
  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: {
      id: true,
      roomId: true,
      title: true,
      status: true,
      startedAt: true,
      endedAt: true,
      moduleId: true,
      module: { select: { title: true, version: true } },
      state: { select: { currentChapterId: true, currentSceneId: true, currentEncounterId: true, gameTime: true, paused: true } }
    }
  });
  if (game === null) return null;
  const access = await loadRoomAccess(game.roomId, viewer);
  if (access === null || access.hasAccess === false) return null;
  const label = "回顾 · " + game.title;
  const pack = basePack(route, viewer, label, {
    resource: {
      game: {
        id: game.id,
        title: game.title,
        status: game.status,
        module: game.module === null ? null : { id: game.moduleId, title: game.module.title, version: game.module.version },
        startedAt: game.startedAt === null ? null : game.startedAt.toISOString(),
        endedAt: game.endedAt === null ? null : game.endedAt.toISOString(),
        state: game.state === null ? null : {
          gameTime: game.state.gameTime,
          paused: game.state.paused,
          currentChapterId: game.state.currentChapterId,
          currentSceneId: game.state.currentSceneId,
          currentEncounterId: game.state.currentEncounterId
        }
      }
    },
    permissions: { isKp: access.isKp, roomRole: access.role }
  });
  return {
    route,
    kind: route.kind,
    label,
    gameId,
    roomId: game.roomId,
    canEditModule: false,
    isKp: access.isKp,
    roomRole: access.role,
    pack
  };
}

async function loadCardContext(cardId: string, viewer: DshViewer, route: DshRouteContext): Promise<DshResolvedContext | null> {
  const card = await prisma.card.findUnique({
    where: { id: cardId },
    select: {
      id: true,
      name: true,
      subtitle: true,
      description: true,
      type: true,
      scope: true,
      rarity: true,
      system: true,
      isEquipped: true,
      equipSlot: true,
      quantity: true,
      pointCost: true,
      ownerId: true,
      roomId: true,
      characterId: true,
      stats: true,
      character: { select: { name: true, userId: true } },
      room: { select: { id: true, name: true } }
    }
  });
  if (card === null) return null;
  const isAdmin = viewer.role === "ADMIN";
  const isOwner = card.ownerId === viewer.id || card.character?.userId === viewer.id;
  let isKp = false;
  let roomRole: "KP" | "PLAYER" | "SPECTATOR" | null = null;
  if (card.roomId !== null) {
    const access = await loadRoomAccess(card.roomId, viewer);
    if (access !== null) {
      isKp = access.isKp;
      roomRole = access.role;
    }
  }
  if (isOwner === false && isKp === false && isAdmin === false) return null;
  const label = "卡牌 · " + card.name;
  const pack = basePack(route, viewer, label, {
    resource: {
      card: {
        id: card.id,
        name: card.name,
        subtitle: card.subtitle,
        description: cleanText(card.description, 2_000),
        type: card.type,
        scope: card.scope,
        rarity: card.rarity,
        system: card.system,
        equipped: card.isEquipped,
        equipSlot: card.equipSlot,
        quantity: card.quantity,
        pointCost: card.pointCost,
        stats: card.stats,
        ownerCharacter: card.character === null ? null : { name: card.character.name },
        room: card.room === null ? null : { id: card.room.id, name: card.room.name }
      }
    },
    permissions: { isOwner, isKp, roomRole }
  });
  return {
    route,
    kind: route.kind,
    label,
    cardId,
    roomId: card.roomId ?? undefined,
    canEditModule: false,
    isKp,
    roomRole,
    pack
  };
}

/** GLOBAL：没有具体资源，只有站点地图与当前用户信息。 */
function globalContext(route: DshRouteContext, viewer: DshViewer, note?: string): DshResolvedContext {
  const label = "通用助手";
  const pack = basePack(route, viewer, label, {
    resource: null,
    ...(note === undefined ? {} : { note })
  });
  return { route, kind: "GLOBAL", label, canEditModule: false, isKp: false, roomRole: null, pack };
}

export async function resolveDshContext(pathname: string, viewer: DshViewer): Promise<DshContextResult> {
  const route = parseDshRoute(pathname);
  try {
    if (route.kind === "MODULE" && route.moduleId !== undefined) {
      const context = await loadModuleContext(route.moduleId, viewer, route, route.roomId);
      if (context !== null) return { ok: true, context };
      return { ok: true, context: globalContext(route, viewer, "无法读取该团本（不存在或没有权限），已退化为通用助手。") };
    }
    if (route.kind === "ROOM" && route.roomId !== undefined) {
      const context = await loadRoomContext(route.roomId, viewer, route);
      if (context !== null) return { ok: true, context };
      return { ok: true, context: globalContext(route, viewer, "无法读取该房间（不存在或没有权限），已退化为通用助手。") };
    }
    if (route.kind === "CHARACTER" && route.characterId !== undefined) {
      const context = await loadCharacterContext(route.characterId, viewer, route, route.roomId);
      if (context !== null) return { ok: true, context };
      return { ok: true, context: globalContext(route, viewer, "无法读取该角色（不存在或没有权限），已退化为通用助手。") };
    }
    if (route.kind === "COMBAT" && route.combatId !== undefined) {
      const context = await loadCombatContext(route.combatId, viewer, route);
      if (context !== null) return { ok: true, context };
      return { ok: true, context: globalContext(route, viewer, "无法读取该战斗（不存在或没有权限），已退化为通用助手。") };
    }
    if (
      route.roomId !== undefined &&
      route.moduleId === undefined &&
      route.characterId === undefined &&
      route.combatId === undefined &&
      route.gameId === undefined &&
      route.cardId === undefined &&
      (route.kind === "COMBAT" || route.kind === "CHARACTER" || route.kind === "MODULE")
    ) {
      // 例如 /rooms/:id/combat/new 或 /rooms/:id/modules：还没有具体资源，退化为房间上下文。
      const roomRoute: DshRouteContext = { ...route, kind: "ROOM" };
      const roomContext = await loadRoomContext(route.roomId, viewer, roomRoute);
      if (roomContext !== null) return { ok: true, context: roomContext };
      return { ok: true, context: globalContext(roomRoute, viewer, "无法读取该房间（不存在或没有权限），已退化为通用助手。") };
    }
    if (route.kind === "GAME" && route.gameId !== undefined) {
      const context = await loadGameContext(route.gameId, viewer, route);
      if (context !== null) return { ok: true, context };
      return { ok: true, context: globalContext(route, viewer, "无法读取该历史局（不存在或没有权限），已退化为通用助手。") };
    }
    if (route.kind === "CARD" && route.cardId !== undefined) {
      const context = await loadCardContext(route.cardId, viewer, route);
      if (context !== null) return { ok: true, context };
      return { ok: true, context: globalContext(route, viewer, "无法读取该卡牌（不存在或没有权限），已退化为通用助手。") };
    }
    return { ok: true, context: globalContext(route, viewer) };
  } catch (error) {
    console.error("[dsh] 读取页面上下文失败", error);
    return { ok: false, error: "读取页面上下文失败，请稍后重试" };
  }
}
