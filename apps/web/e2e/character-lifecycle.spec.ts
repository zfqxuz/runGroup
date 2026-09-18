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

test("一套角色编辑页：导入真实 Excel → 两页编辑（属性/技能 + 故事/财产/物品）→ 真实战斗用道具", async ({ page }) => {
  await prisma.user.deleteMany({ where: { username: USERNAME } });
  const user = await prisma.user.create({
    data: { username: USERNAME, displayName: USERNAME, passwordHash: await bcrypt.hash(PASSWORD, 10), role: "USER" }
  });

  let combatId: string | null = null;
  let roomId: string | null = null;

  try {
    // 1. 登录
    await page.goto("/login");
    await page.getByLabel("用户名").fill(USERNAME);
    await page.getByLabel("密码").fill(PASSWORD);
    await page.getByRole("button", { name: "登录" }).click();
    await page.waitForURL("**/");

    // 2. 导入真实 Excel
    await page.goto("/characters/import");
    await page.setInputFiles('input[type="file"][name="file"]', FILE);
    await page.getByRole("button", { name: "解析并导入" }).click();
    // Excel 导入后应直接落到统一编辑页，而不是旧的只读详情页。
    await page.waitForURL(/\/characters\/[^/]+\/edit\?imported=1/, { timeout: 60_000 });
    const characterId = new URL(page.url()).pathname.split("/")[2] ?? "";
    expect(characterId.length).toBeGreaterThan(0);

    // 3. 统一编辑页：第一页（属性 / 技能，必填）
    await expect(page.getByText("角色基本属性与技能")).toBeVisible();
    await page.getByLabel("性别").fill("浏览器编辑");
    await page.locator('input[name="attr_edu"]').fill("70");
    await page.locator('input[name="attr_int"]').fill("60");
    await page.locator('[data-skill-id="FIGHTING_BRAWL"] [data-testid="skill-interest"]').fill("15");
    await page.getByRole("button", { name: "下一步" }).click();
    await expect(page.getByText("人物故事 / 财产 / 持有物")).toBeVisible();

    // 4. 统一卡牌编辑页：创建一张卡并从角色编辑页加入（卡编辑收敛到一个页面）
    const libraryCard = await prisma.card.create({
      data: {
        scope: "COMPENDIUM", ownerId: user.id, type: "ITEM", system: "COC7",
        name: "浏览器道具·治疗药剂",
        stats: {
          effects: [{ type: "HEAL", amount: "1d6" }], targeting: "SELF", targetScope: "SELF",
          cost: { mp: 0, san: null, uses: 2, cooldownRounds: 0 }, usableIn: ["COMBAT"],
          selectableEffects: [], equippedEffects: null, effect: "", uses: 2, sanCost: null
        } as never
      }
    });
    await page.goto("/cards/" + libraryCard.id + "/edit?returnTo=" + encodeURIComponent("/characters/" + characterId + "/edit"));
    await expect(page.getByRole("heading", { name: /编辑卡牌/ })).toBeVisible();
    await page.getByLabel("卡名").fill("浏览器道具·强效治疗药剂");
    await page.getByRole("button", { name: "保存卡牌" }).click();
    await page.waitForURL((url) => url.pathname === "/characters/" + characterId + "/edit", { timeout: 30_000 });
    const editedCard = await prisma.card.findUniqueOrThrow({ where: { id: libraryCard.id } });
    expect(editedCard.name).toBe("浏览器道具·强效治疗药剂");

    // 4.1 第一页：属性 / 技能
    await page.getByLabel("性别").fill("浏览器编辑");
    await page.locator('input[name="attr_edu"]').fill("70");
    await page.locator('input[name="attr_int"]').fill("60");
    await page.locator('[data-skill-id="FIGHTING_BRAWL"] [data-testid="skill-interest"]').fill("15");
    await page.getByRole("button", { name: "下一步" }).click();
    await expect(page.getByText("人物故事 / 财产 / 持有物")).toBeVisible();

    // 4.1.1 返回第一页必须仍可编辑
    await page.getByRole("button", { name: "上一步" }).click();
    await expect(page.locator('input[name="attr_edu"]')).toBeEnabled();
    await page.locator('input[name="attr_edu"]').fill("75");
    await page.getByRole("button", { name: "下一步" }).click();

    // 4.2 第二页：人物故事 + 财产 + 从可用卡里选卡加入
    await page.locator('textarea[name="bs_appearance"]').fill("浏览器编辑后的角色外貌");
    await page.locator('input[name="asset_creditRating"]').fill("35");
    const availableRow = page.locator("li").filter({ hasText: editedCard.name }).last();
    await availableRow.getByTestId("item-add").click();
    await expect(page.getByTestId("item-card").filter({ hasText: editedCard.name })).toBeVisible();
    await page.getByRole("button", { name: "保存修改" }).click();
    await page.waitForURL((url) => url.pathname === "/characters/" + characterId, { timeout: 60_000 });

    // 5. 断言 DB：角色属性 / 技能 / 背景故事 / 财产 / 卡牌编辑 / 物品加入
    const afterEdit = await prisma.character.findUniqueOrThrow({ where: { id: characterId } });
    expect(afterEdit.edu).toBe(75);
    expect(afterEdit.int).toBe(60);
    expect(afterEdit.gender).toBe("浏览器编辑");
    expect(((afterEdit.skillAllocation as any)?.interest?.FIGHTING_BRAWL ?? 0)).toBe(15);
    expect((afterEdit.skills as Record<string, number>).FIGHTING_BRAWL).toBe(40);
    expect((afterEdit.backstory as Record<string, unknown>).appearance).toBe("浏览器编辑后的角色外貌");
    expect(((afterEdit.sourceData as Record<string, unknown>).assets as Record<string, unknown>).creditRating).toBe("35");
    const item = await prisma.card.findFirstOrThrow({ where: { characterId, name: "浏览器道具·强效治疗药剂" } });
    expect(item.type).toBe("ITEM");
    expect(item.characterId).toBe(characterId);
    expect((item.stats as Record<string, unknown>).effects).toEqual([{ type: "HEAL", amount: "1d6" }]);

    // 6. 建真实房间 / 局 / 场景 / 地图 / Token / 战斗
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

    // 7. 真实浏览器：战斗页点「使用道具」
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
