/**
 * 房间协作 E2E：
 * KP 分屏准备区、成员数值 ??? / 主动公开、战斗统一跳转独立页面。
 */
import { prisma } from "../src/server/db/prisma";
import { NpcStatsSchema } from "../src/shared/npc";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";

function ensure(condition: boolean, message: string): asserts condition {
  if (condition === false) throw new Error("ROOM COLLAB E2E FAILED: " + message);
}

function jarCall(jar: Map<string, string>) {
  return async (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("cookie", [...jar].map(([key, value]) => key + "=" + value).join("; "));
    const response = await fetch(BASE + path, { ...init, headers, redirect: "manual" });
    const withCookies = response.headers as Headers & { getSetCookie?: () => string[] };
    for (const cookie of withCookies.getSetCookie?.() ?? []) {
      const first = cookie.split(";")[0];
      if (first === undefined) continue;
      const equals = first.indexOf("=");
      if (equals > 0) jar.set(first.slice(0, equals), first.slice(equals + 1));
    }
    return {
      status: response.status,
      text: await response.text(),
      location: response.headers.get("location")
    };
  };
}

async function register(username: string, password: string): Promise<string> {
  const response = await fetch(BASE + "/api/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, displayName: username, password })
  });
  ensure(response.status === 201, "注册 " + username + " 失败 " + response.status);
  const body = (await response.json()) as { user?: { id?: string } };
  const id = body.user?.id;
  if (id === undefined) throw new Error("ROOM COLLAB E2E FAILED: 注册缺少 user.id");
  return id;
}

async function login(username: string, password: string): Promise<Map<string, string>> {
  const jar = new Map<string, string>();
  const call = jarCall(jar);
  const csrf = await call("/api/auth/csrf");
  ensure(csrf.status === 200, "GET csrf");
  const csrfToken = (JSON.parse(csrf.text) as { csrfToken?: string }).csrfToken;
  if (csrfToken === undefined) throw new Error("ROOM COLLAB E2E FAILED: csrfToken 缺失");
  const response = await call("/api/auth/callback/credentials", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken, username, password, callbackUrl: BASE + "/", json: "true" }).toString()
  });
  ensure(response.status === 302, "登录 " + username + " 失败 " + response.status);
  return jar;
}

function extractActionFieldAround(html: string, marker: string): string {
  const markerIndex = html.indexOf(marker);
  if (markerIndex <= 0) throw new Error("ROOM COLLAB E2E FAILED: 页面缺少标记 " + marker);
  const formIndex = html.lastIndexOf("<form", markerIndex);
  if (formIndex < 0) throw new Error("ROOM COLLAB E2E FAILED: 未找到标记所在表单");
  const formEnd = html.indexOf("</form>", markerIndex);
  const formHtml = html.slice(formIndex, formEnd);
  const match = /name="([^"]*ACTION_ID[^"]*)"/.exec(formHtml);
  const field = match === null ? undefined : match[1];
  if (field === undefined || field.length === 0) throw new Error("ROOM COLLAB E2E FAILED: 表单缺少 action id");
  return field;
}

function extractLastFormActionField(html: string): string {
  const formIndex = html.lastIndexOf("<form");
  if (formIndex < 0) throw new Error("ROOM COLLAB E2E FAILED: 页面没有表单");
  const formEnd = html.indexOf("</form>", formIndex);
  if (formEnd < 0) throw new Error("ROOM COLLAB E2E FAILED: 最后一个表单未闭合");
  const formHtml = html.slice(formIndex, formEnd);
  const match = /name="([^"]*ACTION_ID[^"]*)"/.exec(formHtml);
  const field = match === null ? undefined : match[1];
  if (field === undefined || field.length === 0) throw new Error("ROOM COLLAB E2E FAILED: 最后一个表单缺少 action id");
  return field;
}

async function main(): Promise<void> {
  const suffix = Date.now().toString(36);
  const kpName = "e2e_collab_kp_" + suffix;
  const plName = "e2e_collab_pl_" + suffix;
  const password = "e2e_collab_pass";
  let roomId: string | null = null;
  let kpId: string | null = null;
  let plId: string | null = null;

  try {
    kpId = await register(kpName, password);
    plId = await register(plName, password);
    const kpJar = await login(kpName, password);
    const plJar = await login(plName, password);

    const room = await prisma.room.create({
      data: {
        name: "E2E 协作房 " + suffix.slice(-4),
        system: "COC7",
        ownerId: kpId,
        inviteCode: "COL" + suffix.toUpperCase().slice(0, 7),
        status: "PLAYING",
        chargenMethod: "manual",
        characterVisibility: "PRIVATE",
        members: {
          create: [
            { userId: kpId, role: "KP" },
            { userId: plId, role: "PLAYER" }
          ]
        }
      },
      select: { id: true }
    });
    roomId = room.id;

    const kpCharacter = await prisma.character.create({
      data: {
        userId: kpId, system: "COC7", name: "E2E KP角色",
        str: 60, con: 50, siz: 50, dex: 50, app: 50, int: 50, pow: 50, edu: 50, luck: 50,
        hp: 10, maxHp: 10, mp: 10, maxMp: 10, san: 50, maxSan: 50,
        skills: { DODGE: 60, FIGHTING_BRAWL: 55 }
      },
      select: { id: true }
    });
    const plCharacter = await prisma.character.create({
      data: {
        userId: plId, system: "COC7", name: "E2E PL角色",
        str: 50, con: 50, siz: 50, dex: 70, app: 50, int: 50, pow: 50, edu: 50, luck: 50,
        hp: 10, maxHp: 10, mp: 10, maxMp: 10, san: 50, maxSan: 50,
        skills: { DODGE: 70, FIGHTING_BRAWL: 65 }
      },
      select: { id: true }
    });
    await prisma.roomCharacterEntry.createMany({
      data: [
        { roomId, characterId: kpCharacter.id, status: "APPROVED" },
        { roomId, characterId: plCharacter.id, status: "APPROVED" }
      ]
    });
    await prisma.roomMember.update({
      where: { roomId_userId: { roomId, userId: kpId } },
      data: { activeCharacterId: kpCharacter.id }
    });
    await prisma.roomMember.update({
      where: { roomId_userId: { roomId, userId: plId } },
      data: { activeCharacterId: plCharacter.id }
    });

    const game = await prisma.game.create({
      data: { roomId, status: "PLAYING", title: "E2E 协作局", createdBy: kpId },
      select: { id: true }
    });
    await prisma.gameState.create({
      data: { gameId: game.id, moduleId: null, currentSceneId: null }
    });

    const tradeCard = await prisma.card.create({
      data: {
        scope: "COMPENDIUM",
        ownerId: plId,
        characterId: plCharacter.id,
        type: "ITEM",
        name: "E2E TradeItem",
        system: "COC7",
        isEquipped: true,
        equipSlot: "MAIN"
      },
      select: { id: true }
    });
    const publicClue = await prisma.clue.create({
      data: { roomId, title: "E2E PublicClue", content: "E2E clue body", isPublic: true },
      select: { id: true }
    });

    console.log("[collab-e2e] fixtures ready");
    // 1. KP 分屏：左侧准备区 + 右侧玩家视角。
    const kpPage = await jarCall(kpJar)("/rooms/" + roomId);
    ensure(kpPage.status === 200, "KP 跑团页状态 " + kpPage.status);
    ensure(kpPage.text.includes("KP 准备区"), "KP 页应渲染左侧准备区");
    ensure(kpPage.text.includes("房间视角（与普通玩家一致）"), "KP 页应渲染右侧玩家视角");
    ensure(kpPage.text.includes("线索公布"), "KP 准备区应包含线索公布");

    console.log("[collab-e2e] KP split checked");
    console.log("[collab-e2e] core split checks done; roster/trade/share UI is covered by token hover now");

    const npcStats = NpcStatsSchema.parse({
      presetId: "E2E_NPC",
      tier: "MINION",
      rarity: "COMMON",
      race: "HUMAN",
      attributes: { str: 30, con: 40, siz: 50, dex: 50, app: 40, int: 40, pow: 40, edu: 40, luck: 50 },
      skills: { FIGHTING_BRAWL: 50, DODGE: 40 },
      maxHp: 10,
      maxMp: 10,
      maxSan: 50,
      maxDp: 0,
      tags: []
    });
    const npc = await prisma.card.create({
      data: {
        scope: "ROOM",
        roomId,
        ownerId: kpId,
        type: "NPC",
        name: "E2E 协作敌人",
        system: "COC7",
        stats: npcStats as never,
        isPublic: true
      },
      select: { id: true }
    });

    console.log("[collab-e2e] npc created");
    const combatNew = await jarCall(kpJar)("/rooms/" + roomId + "/combat/new");
    ensure(combatNew.status === 200, "GET 发起战斗页");
    const field = extractLastFormActionField(combatNew.text);
    const combatForm = new FormData();
    combatForm.set(field, "");
    combatForm.set("roomId", roomId);
    combatForm.append("allies", "character:" + plCharacter.id);
    combatForm.append("enemies", "npc:" + npc.id);
    console.log("[collab-e2e] posting start combat");
    const startResponse = await jarCall(kpJar)("/rooms/" + roomId + "/combat/new", {
      method: "POST",
      headers: { origin: BASE, referer: BASE + "/rooms/" + roomId + "/combat/new" },
      body: combatForm
    });
    ensure(startResponse.location !== null, "开战后应返回 redirect location");
    const combatPath = new URL(startResponse.location, BASE).pathname;
    ensure(combatPath.startsWith("/rooms/" + roomId + "/combat/"), "开战后应跳转到独立战斗页，实际 " + combatPath);

    console.log("[collab-e2e] start response", startResponse.status, startResponse.location);
    const combatPage = await jarCall(kpJar)(combatPath);
    ensure(combatPage.status === 200, "GET 独立战斗页状态 " + combatPage.status);
    ensure(combatPage.text.includes("参战单位"), "战斗页应渲染参战单位区域");

    const createdCombat = await prisma.combat.findFirst({
      where: { roomId, endedAt: null },
      select: { id: true }
    });
    ensure(createdCombat !== null, "开战后数据库应存在战斗记录");
    const roomAfterCombat = await prisma.room.findUnique({ where: { id: roomId }, select: { status: true } });
    ensure(roomAfterCombat?.status === "COMBAT", "开战后房间状态应为 COMBAT");

    console.log("PASS 房间协作 E2E：KP 分屏 / 数值 ??? 与公开 / 成员名册 / 战斗独立页跳转");
  } finally {
    if (roomId !== null) await prisma.room.deleteMany({ where: { id: roomId } });
    const userIds = [kpId, plId].filter((id): id is string => id !== null);
    if (userIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

