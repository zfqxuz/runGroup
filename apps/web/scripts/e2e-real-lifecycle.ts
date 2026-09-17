/**
 * 真实角色生命周期 E2E（本地/生产容器通用）：
 *   1. 真实 HTTP 导入用户上传的 COC7zfq.xlsx；
 *   2. 打开 /characters/[id]/manage 真实表单，改属性 / 技能点 / 性别并保存；
 *   3. 装备一件真实道具卡，并通过角色管理页真实表单修改这张装备的属性；
 *   4. 建真实房间 + 局 + 场景 / 地图 / Token，把角色带入真实游戏；
 *   5. 开一场真实战斗，用刚才编辑过的道具真实结算（治疗 / 次数 / 冷却）；
 *   6. 校验后清理全部测试数据。
 *
 * 运行：
 *   E2E_XLSX=/path/COC7zfq.xlsx npx tsx scripts/e2e-real-lifecycle.ts
 */
import fs from "node:fs";
import bcrypt from "bcryptjs";
import { prisma } from "../src/server/db/prisma";
import { loadEffectivePack } from "../src/server/rules/loader";
import { characterRef, createCombatRecord, npcRef, saveCombatState } from "../src/server/combat/setup";
import { clearCombatRuntime, loadCombatRuntime } from "../src/server/combat/runtime";
import { consumeItemUse, prepareItemAction } from "../src/server/combat/items";
import { resolveImmediateAction } from "@touhou/combat";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const FILE = process.env.E2E_XLSX ?? "/home/zfq/.dsh/attachments/v1/files/3f/3f8103ac30864351e38c7cfc3a7d14da65348993c0e3b0445772ca72dd2848fe/COC7zfq.xlsx";
const SOURCE_NPC_ID = process.env.E2E_SOURCE_NPC_ID ?? "cmtz4mw6e004hdq5amb3o8yk2";
const USERNAME = "e2elife";
const PASSWORD = "e2epass123";

let pass = 0;
let fail = 0;
function check(condition: boolean, label: string, detail?: unknown): void {
  if (condition) { pass += 1; console.log("PASS " + label); }
  else { fail += 1; console.log("FAIL " + label + (detail === undefined ? "" : " :: " + JSON.stringify(detail))); }
}

const jar = new Map<string, string>();
interface CallResult { status: number; text: string; location: string | null; }
function cookieHeader(): string {
  return [...jar.entries()].map(([k, v]) => k + "=" + v).join("; ");
}
async function call(path: string, init: RequestInit = {}): Promise<CallResult> {
  const headers = new Headers(init.headers);
  if (jar.size > 0) headers.set("cookie", cookieHeader());
  const response = await fetch(BASE + path, { ...init, headers, redirect: "manual" });
  const headersBag = response.headers as unknown as { getSetCookie?: () => string[] };
  const listed = headersBag.getSetCookie?.() ?? [];
  const fallback = response.headers.get("set-cookie");
  for (const cookie of listed.length > 0 ? listed : fallback === null ? [] : [fallback]) {
    const first = cookie.split(";")[0];
    if (first === undefined) continue;
    const equals = first.indexOf("=");
    if (equals <= 0) continue;
    jar.set(first.slice(0, equals), first.slice(equals + 1));
  }
  return { status: response.status, text: await response.text(), location: response.headers.get("location") };
}
function actionField(html: string, marker: string): string {
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) throw new Error("页面缺少标记：" + marker);
  const formStart = html.lastIndexOf("<form", markerIndex);
  const formEnd = html.indexOf("</form>", markerIndex);
  const form = html.slice(formStart, formEnd);
  const match = /name="([^"]*ACTION_ID[^"]*)"/.exec(form);
  if (match === null || match[1] === undefined) throw new Error("未找到 server action id：" + marker);
  return match[1];
}
async function login(): Promise<void> {
  const csrf = await call("/api/auth/csrf");
  const token = /"csrfToken":"([^"]+)"/.exec(csrf.text)?.[1];
  if (token === undefined) throw new Error("csrfToken 缺失");
  const result = await call("/api/auth/callback/credentials", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: BASE, referer: BASE + "/login" },
    body: new URLSearchParams({ csrfToken: token, username: USERNAME, password: PASSWORD, callbackUrl: BASE + "/", json: "true" }).toString()
  });
  if (result.status !== 302) throw new Error("登录失败 HTTP " + String(result.status));
}

const itemStats = {
  effects: [{ type: "HEAL", amount: "1d6" }],
  targeting: "SELF",
  targetScope: "SELF",
  cost: { mp: 0, san: null, uses: 3, cooldownRounds: 0 },
  usableIn: ["COMBAT"],
  selectableEffects: [],
  equippedEffects: null,
  effect: "真实道具",
  uses: 3,
  sanCost: null
};

async function main(): Promise<void> {
  const buffer = fs.readFileSync(FILE);
  await prisma.user.deleteMany({ where: { username: USERNAME } });
  const user = await prisma.user.create({
    data: { username: USERNAME, displayName: USERNAME, passwordHash: await bcrypt.hash(PASSWORD, 10), role: "USER" }
  });
  let characterId: string | null = null;
  let combatId: string | null = null;
  let itemCardId: string | null = null;

  try {
    await login();

    // ---------- 1. 真实 HTTP 导入真实 Excel ----------
    const importPage = await call("/characters/import");
    check(importPage.status === 200, "打开导入页 HTTP 200", importPage.status);
    const importAction = actionField(importPage.text, "选择 .xlsx 文件");
    const importForm = new FormData();
    importForm.set(importAction, "");
    importForm.set("file", new File([Uint8Array.from(buffer)], "COC7zfq.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    }));
    const imported = await call("/characters/import", {
      method: "POST",
      headers: { origin: BASE, referer: BASE + "/characters/import" },
      body: importForm
    });
    check(imported.status < 400, "真实 Excel 导入请求成功", imported.status);
    const character = await prisma.character.findFirst({
      where: { userId: user.id, name: "阿拉蕾" },
      orderBy: { createdAt: "desc" }
    });
    check(character !== null, "导入后生成真实角色");
    if (character === null) return;
    characterId = character.id;
    check(character.edu === 60 && character.int === 50 && character.gender === "女", "导入属性 / 性别正确", {
      edu: character.edu, int: character.int, gender: character.gender
    });
    const backstory = (character.backstory ?? {}) as Record<string, unknown>;
    check(typeof backstory.appearance === "string" && String(backstory.appearance).includes("金色长发"), "导入背景故事落库");

    // ---------- 2. 在角色管理页真实编辑属性 / 技能点 / 性别 ----------
    const manage = await call("/characters/" + character.id + "/manage");
    check(manage.status === 200, "打开角色管理页 HTTP 200", manage.status);
    check(manage.text.includes("技能（职业点 / 兴趣点）") && manage.text.includes("背景故事与经历"), "角色管理页包含技能与背景故事");
    const manageAction = actionField(manage.text, 'name="attr_str"');

    const allocation = (character.skillAllocation ?? {}) as Record<string, unknown>;
    const occ = (allocation.occupation ?? {}) as Record<string, number>;
    const interest = { ...((allocation.interest ?? {}) as Record<string, number>) };
    interest.FIGHTING_BRAWL = (interest.FIGHTING_BRAWL ?? 0) + 5;
    const slots = (allocation.slots ?? {}) as Record<string, string[]>;
    const ageAllocation = (((character.raceMods ?? {}) as Record<string, unknown>).ageAllocation ?? {}) as Record<string, number>;

    const editForm = new FormData();
    editForm.set(manageAction, "");
    editForm.set("characterId", character.id);
    editForm.set("roomId", "");
    editForm.set("returnTo", "/characters/" + character.id + "/manage");
    editForm.set("system", character.system);
    editForm.set("era", character.era ?? "");
    editForm.set("chargenMethod", "manual");
    editForm.set("name", character.name);
    editForm.set("playerName", character.playerName ?? "");
    editForm.set("gender", "真实编辑");
    editForm.set("age", String(character.age ?? 18));
    editForm.set("residence", character.residence ?? "");
    editForm.set("occupationId", character.occupationId ?? "");
    const editedAttributes: Record<string, number> = {
      str: character.str, con: character.con, siz: character.siz, dex: character.dex,
      app: character.app, int: 60, pow: character.pow, edu: 70, luck: character.luck
    };
    for (const key of ["str", "con", "siz", "dex", "app", "int", "pow", "edu", "luck"]) editForm.set("attr_" + key, String(editedAttributes[key]));
    for (const key of ["str", "con", "siz", "dex"]) editForm.set("age_" + key, String(ageAllocation[key] ?? 0));
    for (const [id, value] of Object.entries(occ)) editForm.set("occ_" + id, String(value));
    for (const [id, value] of Object.entries(interest)) editForm.set("int_" + id, String(value));
    for (const [slotId, picks] of Object.entries(slots)) picks.forEach((skillId, index) => editForm.set("slot_" + slotId + "_" + index, skillId));
    editForm.set("hp", String(character.hp));
    editForm.set("mp", String(character.mp));
    editForm.set("san", String(character.san));
    editForm.set("dp", String(character.dp));
    const bs = (character.backstory ?? {}) as Record<string, unknown>;
    const bsMap: ReadonlyArray<readonly [string, string]> = [
      ["appearance", "bs_appearance"], ["beliefs", "bs_beliefs"], ["significantPeople", "bs_significantPeople"],
      ["meaningfulPlaces", "bs_meaningfulPlaces"], ["treasuredPossessions", "bs_treasuredPossessions"], ["traits", "bs_traits"],
      ["secrets", "bs_secrets"], ["scars", "bs_scars"], ["phobias", "bs_phobias"]
    ];
    for (const [key, field] of bsMap) editForm.set(field, typeof bs[key] === "string" ? bs[key] as string : "");
    editForm.set("bs_experiences", JSON.stringify(bs.experiences ?? []));
    editForm.set("bs_mythosExperiences", JSON.stringify(bs.mythosExperiences ?? []));
    editForm.set("bs_companions", JSON.stringify(bs.companions ?? []));
    editForm.set("bs_spellDetails", JSON.stringify(bs.spellDetails ?? []));
    editForm.set("bs_spells", JSON.stringify(bs.spells ?? []));

    const savedManage = await call("/characters/" + character.id + "/manage", {
      method: "POST",
      headers: { origin: BASE, referer: BASE + "/characters/" + character.id + "/manage" },
      body: editForm
    });
    check(savedManage.location !== null && savedManage.location.includes("saved=manage"), "角色管理保存成功（页面表单）", savedManage.location);
    const afterEdit = await prisma.character.findUniqueOrThrow({ where: { id: character.id } });
    check(afterEdit.edu === 70 && afterEdit.int === 60 && afterEdit.gender === "真实编辑", "属性 / 性别真实落库", {
      edu: afterEdit.edu, int: afterEdit.int, gender: afterEdit.gender
    });
    check(((afterEdit.skillAllocation as any)?.interest?.FIGHTING_BRAWL ?? 0) === 15, "技能兴趣点真实落库");
    check((afterEdit.skills as Record<string, number>).FIGHTING_BRAWL === 40, "技能总值按规则重算（25 基础 + 15 兴趣）", (afterEdit.skills as Record<string, number>).FIGHTING_BRAWL);

    // ---------- 3. 真实装备 + 在角色管理页编辑装备属性 ----------
    const itemCard = await prisma.card.create({
      data: {
        scope: "COMPENDIUM", ownerId: user.id, type: "ITEM", system: "COC7",
        name: "真实道具·治疗药剂", stats: itemStats as never
      }
    });
    itemCardId = itemCard.id;
    const manageWithLibrary = await call("/characters/" + character.id + "/manage");
    const equipAction = actionField(manageWithLibrary.text, "真实道具·治疗药剂");
    const equipForm = new FormData();
    equipForm.set(equipAction, "");
    equipForm.set("cardId", itemCard.id);
    equipForm.set("characterId", character.id);
    const equippedResponse = await call("/characters/" + character.id + "/manage", {
      method: "POST",
      headers: { origin: BASE, referer: BASE + "/characters/" + character.id + "/manage" },
      body: equipForm
    });
    const equippedCard = await prisma.card.findUniqueOrThrow({ where: { id: itemCard.id } });
    check(equippedResponse.status < 400 && equippedCard.characterId === character.id && equippedCard.isEquipped, "通过角色管理页真实装备成功");

    const manageCard = await call("/characters/" + character.id + "/manage?card=" + itemCard.id);
    check(manageCard.status === 200 && manageCard.text.includes("编辑装备属性"), "打开装备属性编辑表单", manageCard.status);
    const cardAction = actionField(manageCard.text, "保存装备属性");
    const cardForm = new FormData();
    cardForm.set(cardAction, "");
    cardForm.set("cardId", itemCard.id);
    cardForm.set("characterId", character.id);
    cardForm.set("roomId", "");
    cardForm.set("returnTo", "/characters/" + character.id + "/manage");
    cardForm.set("kind", "ITEM");
    cardForm.set("name", "真实道具·强效治疗药剂");
    cardForm.set("subtitle", "改动后");
    cardForm.set("description", "通过角色管理页编辑");
    cardForm.set("targeting", "SELF");
    cardForm.set("targetScope", "SELF");
    cardForm.set("weaponType", "BRAWL");
    cardForm.set("costMp", "1");
    cardForm.set("costSan", "");
    cardForm.set("costUses", "2");
    cardForm.set("costCooldown", "1");
    cardForm.set("usableIn_COMBAT", "on");
    cardForm.set("selectableEffects", "");
    cardForm.set("itemEffect", "强效治疗");
    cardForm.set("effectsJson", JSON.stringify([{ type: "HEAL", amount: "2d6" }]));
    const cardSaved = await call("/characters/" + character.id + "/manage", {
      method: "POST",
      headers: { origin: BASE, referer: BASE + "/characters/" + character.id + "/manage?card=" + itemCard.id },
      body: cardForm
    });
    check(cardSaved.location !== null && cardSaved.location.includes("saved=card"), "装备属性保存成功（角色管理页表单）", cardSaved.location);
    const afterCard = await prisma.card.findUniqueOrThrow({ where: { id: itemCard.id } });
    const stats = afterCard.stats as Record<string, unknown>;
    const effects = stats.effects as Array<Record<string, unknown>>;
    check(afterCard.name === "真实道具·强效治疗药剂", "装备名称真实落库");
    check(effects.length === 1 && effects[0]?.amount === "2d6", "装备效果真实改为 2d6", effects);
    check((stats.cost as Record<string, unknown>)?.uses === 2, "装备使用次数真实落库");

    // ---------- 4. 真实房间 / 局 / 场景 / 地图 / Token ----------
    const room = await prisma.room.create({
      data: {
        name: "E2E-生命周期", system: "COC7", ownerId: user.id,
        inviteCode: "e2e-life-" + Date.now().toString(36), status: "PLAYING", magicEnabled: false,
        chargenMethod: "manual", era: "CLASSIC"
      }
    });
    await prisma.roomMember.create({ data: { roomId: room.id, userId: user.id, role: "PLAYER", activeCharacterId: character.id, ready: true } });
    await prisma.roomCharacterEntry.create({ data: { roomId: room.id, characterId: character.id, status: "APPROVED" } });
    const game = await prisma.game.create({ data: { roomId: room.id, title: "E2E-生命周期局", status: "PLAYING", createdBy: user.id } });
    await prisma.gameState.create({ data: { gameId: game.id, flags: {} as never, counters: {} as never, custom: {} as never } });
    await prisma.gameCharacter.create({
      data: { gameId: game.id, characterId: character.id, userId: user.id, status: "ALIVE", currentHp: afterEdit.maxHp, currentMp: afterEdit.maxMp, currentSan: afterEdit.maxSan, currentDp: afterEdit.maxDp, conditions: [] as never }
    });
    const scene = await prisma.scene.create({ data: { roomId: room.id, name: "E2E-生命周期场景", isActive: true } });
    const map = await prisma.map.create({ data: { sceneId: scene.id, name: "E2E-生命周期地图", width: 1000, height: 800, gridSize: 70 } });
    await prisma.token.create({ data: { roomId: room.id, mapId: map.id, characterId: character.id, name: character.name, x: 100, y: 100 } });
    const sourceNpc = await prisma.card.findUniqueOrThrow({ where: { id: SOURCE_NPC_ID } });
    const enemy = await prisma.card.create({
      data: { roomId: room.id, scope: "ROOM", type: "NPC", name: "E2E-敌人", system: sourceNpc.system, stats: sourceNpc.stats as never }
    });
    await prisma.token.create({ data: { roomId: room.id, mapId: map.id, cardId: enemy.id, name: enemy.name, x: 300, y: 100 } });

    const effective = await loadEffectivePack({
      id: room.id, system: room.system, rulePackVersionId: room.rulePackVersionId, ruleOverride: room.ruleOverride
    });
    const created = await createCombatRecord(room.id, effective, [characterRef(character.id)], [npcRef(enemy.id)]);
    check(created.ok === true && created.combatId !== undefined, "加入真实游戏并开战", created.error);
    if (created.combatId === undefined) return;
    combatId = created.combatId;

    // ---------- 5. 真实战斗中使用刚编辑过的道具 ----------
    const runtime = await loadCombatRuntime(combatId);
    if (runtime === null) { check(false, "战斗 runtime 加载"); return; }
    const pc = runtime.state.participants.find((item) => item.id === character.id);
    check(pc !== undefined, "角色在真实战斗中");
    if (pc === undefined) return;
    const items = runtime.itemsByParticipant.get(pc.id) ?? [];
    const item = items.find((entry) => entry.cardId === itemCard.id);
    check(item !== undefined && item.effects[0]?.type === "HEAL", "战斗内加载到刚编辑的道具与 2d6 效果", items.map((entry) => entry.name));
    if (item === undefined) return;

    pc.hp = Math.max(1, pc.maxHp - 5);
    const hpBefore = pc.hp;
    const prepared = prepareItemAction(runtime.pack, pc, items, { actorId: pc.id, kind: "ITEM", itemCardId: itemCard.id }, runtime.state.round);
    check(prepared.ok === true, "服务端解析道具行动", prepared.ok ? undefined : prepared.error);
    if (prepared.ok === false) return;
    consumeItemUse(pc, prepared.item, runtime.state.round);
    resolveImmediateAction(runtime.pack, runtime.state, prepared.action, {});
    check(pc.hp > hpBefore, "真实战斗中道具生效（回血）", { before: hpBefore, after: pc.hp });
    check(pc.itemUsesLeft?.[itemCard.id] === 1, "战斗内使用次数扣减", pc.itemUsesLeft);
    check((pc.itemCooldownUntil?.[itemCard.id] ?? 0) === runtime.state.round + 1, "战斗内冷却写入", pc.itemCooldownUntil);

    await saveCombatState(combatId, runtime.state);
    const itemCombatPage = await call("/rooms/" + room.id + "/combat/" + combatId);
    check(itemCombatPage.status === 200, "真实战斗页面可打开", itemCombatPage.status);
  } finally {
    if (combatId !== null) clearCombatRuntime(combatId);
    if (itemCardId !== null) await prisma.card.delete({ where: { id: itemCardId } }).catch(() => undefined);
    const rooms = await prisma.room.findMany({ where: { ownerId: user.id }, select: { id: true } });
    for (const room of rooms) await prisma.room.delete({ where: { id: room.id } }).catch(() => undefined);
    if (characterId !== null) await prisma.character.delete({ where: { id: characterId } }).catch(() => undefined);
    await prisma.card.deleteMany({ where: { ownerId: user.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    console.log("cleanup done");
  }

  console.log("E2E REAL LIFECYCLE RESULT: passed=" + pass + " failed=" + fail);
  if (fail > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error("E2E REAL LIFECYCLE CRASHED", error);
  process.exitCode = 1;
}).finally(() => {
  void prisma.$disconnect();
});
