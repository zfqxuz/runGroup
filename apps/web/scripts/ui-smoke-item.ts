/**
 * 真实 UI 冒烟：真实角色 + 真实装备道具 + 真实战斗，用真实 NextAuth 会话打开页面。
 * setup + HTTP 断言 + cleanup 一体，跑完自动清理，可直接在生产容器里执行：
 *   docker exec -w /repo/apps/web touhou-trpg-app npx tsx scripts/ui-smoke-item.ts
 *
 * 说明：CombatBoard 的行动面板是客户端 socket 加载后才渲染的，SSR HTML 不会有「使用道具」按钮；
 * 因此这里同时断言「页面 props 下发了真实道具」与「生产构建 bundle 含该组件文本」。
 */
import bcrypt from "bcryptjs";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { prisma } from "../src/server/db/prisma";
import { loadEffectivePack } from "../src/server/rules/loader";
import { characterRef, createCombatRecord, npcRef, saveCombatState } from "../src/server/combat/setup";
import { loadCombatRuntime } from "../src/server/combat/runtime";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";
const BUNDLE_DIR = process.env.E2E_BUNDLE_DIR ?? ".next/static";
const USERNAME = "e2eitem";
const PASSWORD = "e2epass123";
const SOURCE_CHARACTER_ID = process.env.E2E_SOURCE_CHARACTER_ID ?? "cmtxofchd0001mx564v5ztjog";
const SOURCE_NPC_ID = process.env.E2E_SOURCE_NPC_ID ?? "cmu409s9n005hcq5g9z9vbthp";

let pass = 0;
let fail = 0;
function check(condition: boolean, label: string, detail?: unknown): void {
  if (condition) { pass += 1; console.log("PASS " + label); }
  else { fail += 1; console.log("FAIL " + label + (detail === undefined ? "" : " :: " + JSON.stringify(detail))); }
}

interface CallResult { readonly status: number; readonly text: string; }

function absorbCookies(response: Response, jar: Map<string, string>): void {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const listed = headers.getSetCookie?.() ?? [];
  const fallback = response.headers.get("set-cookie");
  const cookies = listed.length > 0 ? listed : fallback === null ? [] : [fallback];
  for (const cookie of cookies) {
    const first = cookie.split(";")[0];
    if (first === undefined) continue;
    const equals = first.indexOf("=");
    if (equals <= 0) continue;
    jar.set(first.slice(0, equals), first.slice(equals + 1));
  }
}

function cookieHeader(jar: Map<string, string>): string {
  return [...jar.entries()].map(([name, value]) => name + "=" + value).join("; ");
}

async function call(jar: Map<string, string>, path: string, init: RequestInit = {}): Promise<CallResult> {
  const headers = new Headers(init.headers);
  const cookie = cookieHeader(jar);
  if (cookie.length > 0) headers.set("cookie", cookie);
  const response = await fetch(BASE + path, { ...init, headers, redirect: "manual" });
  absorbCookies(response, jar);
  return { status: response.status, text: await response.text() };
}

async function login(): Promise<Map<string, string>> {
  const jar = new Map<string, string>();
  const csrf = await call(jar, "/api/auth/csrf");
  const csrfToken = /"csrfToken":"([^"]+)"/.exec(csrf.text)?.[1];
  if (csrfToken === undefined) throw new Error("csrfToken 缺失");
  const result = await call(jar, "/api/auth/callback/credentials", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: BASE, referer: BASE + "/login" },
    body: new URLSearchParams({ csrfToken, username: USERNAME, password: PASSWORD, callbackUrl: BASE + "/", json: "true" }).toString()
  });
  if (result.status !== 302) throw new Error("登录失败 HTTP " + String(result.status));
  return jar;
}

/** 递归扫描生产构建产物，确认客户端组件文本真的进了 bundle。 */
function bundleContains(dir: string, needle: string): boolean {
  let entries: string[] = [];
  try { entries = readdirSync(dir); } catch { return false; }
  for (const entry of entries) {
    const full = dir + "/" + entry;
    if (statSync(full).isDirectory()) {
      if (bundleContains(full, needle)) return true;
    } else if (full.endsWith(".js")) {
      try { if (readFileSync(full, "utf8").includes(needle)) return true; } catch { /* ignore */ }
    }
  }
  return false;
}

async function main(): Promise<void> {
  await prisma.user.deleteMany({ where: { username: USERNAME } });
  const source = await prisma.character.findUniqueOrThrow({ where: { id: SOURCE_CHARACTER_ID } });
  const sourceNpc = await prisma.card.findUniqueOrThrow({ where: { id: SOURCE_NPC_ID } });
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const user = await prisma.user.create({ data: { username: USERNAME, displayName: USERNAME, passwordHash, role: "USER" } });
  const room = await prisma.room.create({
    data: {
      name: "E2E-UI 道具", system: "COC7", ownerId: user.id,
      inviteCode: "e2e-ui-item-" + Date.now().toString(36), status: "PLAYING", magicEnabled: false,
      ruleOverride: { magic: { enabled: false, system: "COC7", spells: [] } } as never
    }
  });
  const player = await prisma.character.create({
    data: {
      userId: user.id, roomId: room.id, system: source.system, name: "E2E-UI 道具玩家", occupation: source.occupation,
      age: source.age, str: source.str, con: source.con, siz: source.siz, dex: source.dex, app: source.app,
      int: source.int, pow: source.pow, edu: source.edu, luck: source.luck,
      hp: source.hp, maxHp: source.maxHp, mp: source.mp, maxMp: source.maxMp,
      san: source.san, maxSan: source.maxSan, dp: source.dp, maxDp: source.maxDp,
      skills: source.skills as never, raceMods: source.raceMods as never,
      skillAllocation: source.skillAllocation as never, sourceData: {} as never, era: source.era
    }
  });
  await prisma.roomMember.create({ data: { roomId: room.id, userId: user.id, role: "KP", activeCharacterId: player.id, ready: true } });
  await prisma.roomCharacterEntry.create({ data: { roomId: room.id, characterId: player.id, status: "APPROVED" } });
  const game = await prisma.game.create({ data: { roomId: room.id, title: "E2E-UI 道具局", status: "PLAYING", createdBy: user.id } });
  await prisma.gameState.create({ data: { gameId: game.id, flags: {} as never, counters: {} as never, custom: {} as never } });
  await prisma.gameCharacter.create({
    data: { gameId: game.id, characterId: player.id, userId: user.id, status: "ALIVE", currentHp: 9, currentMp: 12, currentSan: 60, currentDp: 0, conditions: [] as never }
  });

  // 已装备的真实道具卡（战斗内可用）
  const equipped = await prisma.card.create({
    data: {
      scope: "COMPENDIUM", ownerId: user.id, type: "ITEM", system: "COC7", name: "E2E-UI·治疗药水",
      characterId: player.id, isEquipped: true,
      stats: {
        effects: [{ type: "HEAL", amount: "1d6" }], targeting: "SELF", targetScope: "SELF",
        cost: { mp: 0, san: null, uses: 3, cooldownRounds: 0 }, usableIn: ["COMBAT"],
        selectableEffects: [], equippedEffects: null, effect: "", uses: null, sanCost: null
      } as never
    }
  });
  // 库中带可选效果的道具卡（验证装备时的效果勾选 UI）
  const libraryItem = await prisma.card.create({
    data: {
      scope: "COMPENDIUM", ownerId: user.id, type: "ITEM", system: "COC7", name: "E2E-UI·圣水",
      stats: {
        effects: [{ type: "HEAL", amount: "1d6" }, { type: "ARMOR", amount: "3", durationTicks: "0" }],
        targeting: "SELF", targetScope: "SELF",
        cost: { mp: 0, san: null, uses: null, cooldownRounds: 0 }, usableIn: ["COMBAT"],
        selectableEffects: [0, 1], equippedEffects: null, effect: "", uses: null, sanCost: null
      } as never
    }
  });

  const scene = await prisma.scene.create({ data: { roomId: room.id, name: "E2E-UI 道具场景", isActive: true } });
  const map = await prisma.map.create({ data: { sceneId: scene.id, name: "E2E-UI 道具地图", width: 1000, height: 800, gridSize: 70 } });
  await prisma.token.create({ data: { roomId: room.id, mapId: map.id, characterId: player.id, name: player.name, x: 200, y: 200 } });
  const enemy = await prisma.card.create({
    data: {
      roomId: room.id, scope: "ROOM", type: "NPC", name: "E2E-UI 道具敌人", system: sourceNpc.system,
      stats: sourceNpc.stats as never
    }
  });
  await prisma.token.create({ data: { roomId: room.id, mapId: map.id, cardId: enemy.id, name: enemy.name, x: 400, y: 200 } });

  const effective = await loadEffectivePack({ id: room.id, system: room.system, rulePackVersionId: room.rulePackVersionId, ruleOverride: room.ruleOverride });
  const created = await createCombatRecord(room.id, effective, [characterRef(player.id)], [npcRef(enemy.id)]);
  if (created.ok === false || created.combatId === undefined) throw new Error("开战失败：" + String(created.error));
  const runtime = await loadCombatRuntime(created.combatId);
  if (runtime !== null) {
    runtime.state.initiativeOrder = [player.id, enemy.id];
    runtime.state.activeIndex = 0;
    runtime.state.phase = "AWAITING_ACTION";
    for (const participant of runtime.state.participants) participant.isReady = participant.id === player.id;
    await saveCombatState(created.combatId, runtime.state);
  }

  try {
    const jar = await login();
    const combatPage = await call(jar, "/rooms/" + room.id + "/combat/" + created.combatId);
    check(combatPage.status === 200, "战斗页 HTTP 200", combatPage.status);
    check(combatPage.text.includes(equipped.id), "战斗页服务端下发真实已装备道具（props 内 cardId）", equipped.id);
    check(combatPage.text.includes("1d6"), "战斗页服务端下发道具效果数值");
    check(bundleContains(BUNDLE_DIR, "使用道具"), "部署产物客户端 bundle 含「使用道具」组件");

    const charPage = await call(jar, "/characters/" + player.id);
    check(charPage.status === 200, "角色页 HTTP 200", charPage.status);
    check(charPage.text.includes("装备时选择生效效果"), "角色页渲染装备时的效果勾选");
    check(charPage.text.includes(libraryItem.name) && charPage.text.includes("固定生效") === false, "角色页库中可选效果道具出现在装备区");

    const cardsPage = await call(jar, "/cards");
    check(cardsPage.status === 200, "卡牌库 HTTP 200", cardsPage.status);
    check(cardsPage.text.includes("转为武器"), "卡牌库渲染「转为武器」按钮");
  } finally {
    await prisma.card.deleteMany({ where: { id: { in: [equipped.id, libraryItem.id] } } }).catch(() => undefined);
    await prisma.room.delete({ where: { id: room.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    console.log("cleanup done");
  }

  console.log("E2E UI ITEM RESULT: passed=" + pass + " failed=" + fail);
  if (fail > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error("E2E UI ITEM CRASHED", error);
  process.exitCode = 1;
}).finally(() => {
  void prisma.$disconnect();
});
