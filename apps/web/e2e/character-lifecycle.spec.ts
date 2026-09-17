import { expect, test } from "@playwright/test";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import { prisma } from "../src/server/db/prisma";
import { loadEffectivePack } from "../src/server/rules/loader";
import { characterRef, createCombatRecord, npcRef, saveCombatState } from "../src/server/combat/setup";
import { clearCombatRuntime, loadCombatRuntime } from "../src/server/combat/runtime";

const USERNAME = "e2ebrowser";
const PASSWORD = "e2epass123";
const FILE = process.env.E2E_XLSX ?? "/home/zfq/.dsh/attachments/v1/files/3f/3f8103ac30864351e38c7cfc3a7d14da65348993c0e3b0445772ca72dd2848fe/COC7zfq.xlsx";
const SOURCE_NPC_ID = process.env.E2E_SOURCE_NPC_ID ?? "cmtz4mw6e004hdq5amb3o8yk2";

const itemStats = {
  effects: [{ type: "HEAL", amount: "1d6" }],
  targeting: "SELF",
  targetScope: "SELF",
  cost: { mp: 0, san: null, uses: 3, cooldownRounds: 0 },
  usableIn: ["COMBAT"],
  selectableEffects: [],
  equippedEffects: null,
  effect: "浏览器道具",
  uses: 3,
  sanCost: null
};

test("真实浏览器完整角色生命周期：导入 → 角色管理编辑 → 装备编辑 → 开战 → 战斗中使用道具", async ({ page }) => {
  // 前置：清掉同名用户
  await prisma.user.deleteMany({ where: { username: USERNAME } });
  const user = await prisma.user.create({
    data: { username: USERNAME, displayName: USERNAME, passwordHash: await bcrypt.hash(PASSWORD, 10), role: "USER" }
  });

  let combatId: string | null = null;
  let roomId: string | null = null;

  try {
    // ---------- 1. 真实浏览器登录 ----------
    await page.goto("/login");
    await page.getByLabel("用户名").fill(USERNAME);
    await page.getByLabel("密码").fill(PASSWORD);
    await page.getByRole("button", { name: "登录" }).click();
    await page.waitForURL("**/");

    // ---------- 2. 浏览器上传真实 Excel ----------
    await page.goto("/characters/import");
    await page.setInputFiles('input[type="file"][name="file"]', FILE);
    await page.getByRole("button", { name: "解析并导入" }).click();
    await page.waitForURL(/\/characters\/[^/]+\?imported=1/, { timeout: 60_000 });
    const characterId = new URL(page.url()).pathname.split("/")[2] ?? "";
    expect(characterId.length).toBeGreaterThan(0);
    await expect(page.getByRole("heading", { name: /阿拉蕾/ })).toBeVisible();
    await expect(page.getByText("背景故事与经历")).toBeVisible();
    await expect(page.getByText("金色长发").first()).toBeVisible();

    // ---------- 3. 在角色管理页真实点击编辑属性 / 技能 / 性别 ----------
    await page.goto("/characters/" + characterId + "/manage");
    await expect(page.getByRole("heading", { name: /角色管理 · 阿拉蕾/ })).toBeVisible();
    await page.getByLabel("性别").fill("浏览器编辑");
    await page.locator('input[name="attr_edu"]').fill("70");
    await page.locator('input[name="attr_int"]').fill("60");
    // 兴趣点：斗殴 10 -> 15（INT 60 => 兴趣池 120，总量不超）
    const brawlRow = page.locator("tr").filter({ hasText: "格斗（斗殴）" }).first();
    await brawlRow.locator('input[name^="int_"]').fill("15");
    await page.getByRole("button", { name: "保存角色" }).click();
    await page.waitForURL(/saved=manage/, { timeout: 30_000 });
    await expect(page.getByText("已保存")).toBeVisible();

    const afterEdit = await prisma.character.findUniqueOrThrow({ where: { id: characterId } });
    expect(afterEdit.edu).toBe(70);
    expect(afterEdit.int).toBe(60);
    expect(afterEdit.gender).toBe("浏览器编辑");
    expect(((afterEdit.skillAllocation as any)?.interest?.FIGHTING_BRAWL ?? 0)).toBe(15);
    expect((afterEdit.skills as Record<string, number>).FIGHTING_BRAWL).toBe(40);

    // ---------- 4. 浏览器里装备一件道具，并在页面上编辑装备属性 ----------
    const item = await prisma.card.create({
      data: {
        scope: "COMPENDIUM", ownerId: user.id, type: "ITEM", system: "COC7",
        name: "浏览器道具·治疗药剂", stats: itemStats as never
      }
    });
    await page.goto("/characters/" + characterId + "/manage");
    const libraryForm = page.locator("form").filter({ hasText: "浏览器道具·治疗药剂" }).first();
    await libraryForm.getByRole("button", { name: "装备" }).click();
    await expect(async () => {
      const row = await prisma.card.findUniqueOrThrow({ where: { id: item.id } });
      expect(row.characterId).toBe(characterId);
      expect(row.isEquipped).toBe(true);
    }).toPass({ timeout: 20_000 });

    await page.goto("/characters/" + characterId + "/manage?card=" + item.id);
    await expect(page.getByRole("heading", { name: /编辑装备属性/ })).toBeVisible();
    const cardForm = page.locator("form").filter({ has: page.getByRole("button", { name: "保存装备属性" }) });
    await cardForm.locator('input[name="name"]').fill("浏览器道具·强效治疗药剂");
    await cardForm.locator('input[name="costUses"]').fill("2");
    await cardForm.locator('input[name="costCooldown"]').fill("1");
    await cardForm.locator('textarea[name="effectsJson"]').fill(JSON.stringify([{ type: "HEAL", amount: "2d6" }]));
    await cardForm.getByRole("button", { name: "保存装备属性" }).click();
    await page.waitForURL(/saved=card/, { timeout: 30_000 });

    const afterCard = await prisma.card.findUniqueOrThrow({ where: { id: item.id } });
    const stats = afterCard.stats as Record<string, unknown>;
    expect(afterCard.name).toBe("浏览器道具·强效治疗药剂");
    expect((stats.effects as Array<Record<string, unknown>>)[0]?.amount).toBe("2d6");
    expect((stats.cost as Record<string, unknown>).uses).toBe(2);

    // ---------- 5. 建真实房间 / 局 / 战斗（测试数据） ----------
    const room = await prisma.room.create({
      data: {
        name: "E2E-浏览器", system: "COC7", ownerId: user.id,
        inviteCode: "e2e-browser-" + Date.now().toString(36), status: "PLAYING", magicEnabled: false,
        chargenMethod: "manual", era: "CLASSIC"
      }
    });
    roomId = room.id;
    await prisma.roomMember.create({ data: { roomId: room.id, userId: user.id, role: "PLAYER", activeCharacterId: characterId, ready: true } });
    await prisma.roomCharacterEntry.create({ data: { roomId: room.id, characterId, status: "APPROVED" } });
    const game = await prisma.game.create({ data: { roomId: room.id, title: "E2E-浏览器局", status: "PLAYING", createdBy: user.id } });
    await prisma.gameState.create({ data: { gameId: game.id, flags: {} as never, counters: {} as never, custom: {} as never } });
    await prisma.gameCharacter.create({
      data: { gameId: game.id, characterId, userId: user.id, status: "ALIVE", currentHp: afterEdit.maxHp, currentMp: afterEdit.maxMp, currentSan: afterEdit.maxSan, currentDp: afterEdit.maxDp, conditions: [] as never }
    });
    const scene = await prisma.scene.create({ data: { roomId: room.id, name: "E2E-浏览器场景", isActive: true } });
    const map = await prisma.map.create({ data: { sceneId: scene.id, name: "E2E-浏览器地图", width: 1000, height: 800, gridSize: 70 } });
    await prisma.token.create({ data: { roomId: room.id, mapId: map.id, characterId, name: afterEdit.name, x: 100, y: 100 } });
    const sourceNpc = await prisma.card.findUniqueOrThrow({ where: { id: SOURCE_NPC_ID } });
    const enemy = await prisma.card.create({
      data: { roomId: room.id, scope: "ROOM", type: "NPC", name: "E2E-浏览器敌人", system: sourceNpc.system, stats: sourceNpc.stats as never }
    });
    await prisma.token.create({ data: { roomId: room.id, mapId: map.id, cardId: enemy.id, name: enemy.name, x: 300, y: 100 } });

    const effective = await loadEffectivePack({ id: room.id, system: room.system, rulePackVersionId: room.rulePackVersionId, ruleOverride: room.ruleOverride });
    const created = await createCombatRecord(room.id, effective, [characterRef(characterId)], [npcRef(enemy.id)]);
    expect(created.ok).toBe(true);
    if (created.combatId === undefined) throw new Error("开战失败：" + String(created.error));
    combatId = created.combatId;

    // 把角色设为当前行动单位并压低 HP，方便验证道具回血
    const runtime = await loadCombatRuntime(combatId);
    if (runtime === null) throw new Error("runtime 加载失败");
    const pc = runtime.state.participants.find((entry) => entry.id === characterId);
    if (pc === undefined) throw new Error("角色不在战斗中");
    runtime.state.initiativeOrder = [characterId, enemy.id];
    runtime.state.activeIndex = 0;
    runtime.state.phase = "AWAITING_ACTION";
    for (const participant of runtime.state.participants) participant.isReady = participant.id === characterId;
    pc.hp = Math.max(1, pc.maxHp - 5);
    const hpBefore = pc.hp;
    await saveCombatState(combatId, runtime.state);

    // ---------- 6. 真实浏览器：在战斗页面点「使用道具」 ----------
    await page.goto("/rooms/" + room.id + "/combat/" + combatId);
    await expect(page.getByRole("button", { name: "使用道具" })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "使用道具" }).click();
    await expect(page.getByText(/恢复 \d+ HP/)).toBeVisible({ timeout: 30_000 });

    const snapshot = await prisma.combatSnapshot.findFirst({ where: { combatId }, orderBy: { seq: "desc" } });
    const state = snapshot?.state as { participants?: Array<{ id: string; hp: number; itemUsesLeft?: Record<string, number> }> } | undefined;
    const persisted = state?.participants?.find((entry) => entry.id === characterId);
    expect(persisted?.hp ?? 0).toBeGreaterThan(hpBefore);
    expect(persisted?.itemUsesLeft?.[item.id]).toBe(1);
  } finally {
    if (combatId !== null) clearCombatRuntime(combatId);
    await prisma.card.deleteMany({ where: { ownerId: user.id } }).catch(() => undefined);
    if (roomId !== null) await prisma.room.delete({ where: { id: roomId } }).catch(() => undefined);
    await prisma.character.deleteMany({ where: { userId: user.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
  }
});
