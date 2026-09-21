import { expect, test } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma } from "../src/server/db/prisma";
import { loadEffectivePack } from "../src/server/rules/loader";
import { characterRef, createCombatRecord, npcRef } from "../src/server/combat/setup";
import { clearCombatRuntime } from "../src/server/combat/runtime";
import { NpcStatsSchema } from "../src/shared/npc";

const PASSWORD = "e2epass123";

interface Fixture {
  readonly userId: string;
  readonly roomId: string;
  readonly combatId: string;
  readonly weakNpcId: string;
  readonly tankNpcId: string;
}

async function createFixture(username: string, withAbilities: boolean): Promise<Fixture> {
  await prisma.user.deleteMany({ where: { username } });
  const user = await prisma.user.create({
    data: { username, displayName: username, passwordHash: await bcrypt.hash(PASSWORD, 10), role: "USER" }
  });
  const room = await prisma.room.create({
    data: {
      name: "E2E 倒地与能力提示房",
      system: "TOUHOU",
      status: "PLAYING",
      ownerId: user.id,
      inviteCode: "CDH" + Date.now().toString(36).toUpperCase().slice(0, 6),
      ruleOverride: { combat: { mode: "DP" } } as never,
      members: { create: { userId: user.id, role: "KP" } }
    },
    select: { id: true, system: true, rulePackVersionId: true, ruleOverride: true }
  });
  const character = await prisma.character.create({
    data: {
      userId: user.id,
      system: "TOUHOU",
      name: "E2E 射手",
      str: 50, con: 50, siz: 50, dex: 70, app: 50, int: 60, pow: 50, edu: 60, luck: 50,
      hp: 30, maxHp: 30, mp: 20, maxMp: 20, san: 50, maxSan: 50, dp: 20, maxDp: 20,
      skills: { DANMAKU: 90, DODGE: 50, MELEE: 50, MAGIC: 80 }
    }
  });
  if (withAbilities) {
    await prisma.character.update({
      where: { id: character.id },
      data: { backstory: { abilities: { MAGIC: 3 } } as never }
    });
  }
  await prisma.roomCharacterEntry.create({ data: { roomId: room.id, characterId: character.id, status: "APPROVED" } });

  const baseNpc = {
    attributes: { str: 10, con: 10, siz: 10, dex: 5, app: 10, int: 10, pow: 0, edu: 10, luck: 10 },
    skills: { DODGE: 0 },
    weapons: [],
    maxMp: 0,
    maxSan: 30,
    maxDp: 0
  };
  const weak = await prisma.card.create({
    data: {
      scope: "ROOM", roomId: room.id, ownerId: user.id, type: "NPC", name: "一碰就倒木桩", system: "TOUHOU",
      stats: NpcStatsSchema.parse({ ...baseNpc, maxHp: 1 }) as never
    }
  });
  const tank = await prisma.card.create({
    data: {
      scope: "ROOM", roomId: room.id, ownerId: user.id, type: "NPC", name: "厚血木桩", system: "TOUHOU",
      stats: NpcStatsSchema.parse({ ...baseNpc, maxHp: 200 }) as never
    }
  });

  const effective = await loadEffectivePack({
    id: room.id,
    system: room.system,
    rulePackVersionId: room.rulePackVersionId,
    ruleOverride: room.ruleOverride
  });
  const created = await createCombatRecord(
    room.id,
    effective,
    [characterRef(character.id)],
    [npcRef(weak.id), npcRef(tank.id)]
  );
  if (created.ok === false || created.combatId === undefined) throw new Error(created.error ?? "combat create failed");
  return { userId: user.id, roomId: room.id, combatId: created.combatId, weakNpcId: weak.id, tankNpcId: tank.id };
}

async function cleanup(fixture: Fixture): Promise<void> {
  clearCombatRuntime(fixture.combatId);
  await prisma.room.delete({ where: { id: fixture.roomId } }).catch(() => undefined);
  await prisma.user.delete({ where: { id: fixture.userId } }).catch(() => undefined);
}

async function loginAndOpenCombat(page: import("@playwright/test").Page, username: string, fixture: Fixture): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("用户名").fill(username);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL("**/");
  await page.goto("/rooms/" + fixture.roomId + "/combat/" + fixture.combatId);
  await expect(page.getByText("参战单位").first()).toBeVisible({ timeout: 30_000 });
  // 等 socket 的首个战斗快照到达，声明按钮才会出现；否则 declareAll 会拿到 0 个按钮直接返回。
  await expect(page.getByText(/DP 宣言 · 第 1 轮/).first()).toBeVisible({ timeout: 30_000 });
}

/** 依次点击所有「声明」按钮；每次等待人数减少，避免 race。 */
async function declareAll(page: import("@playwright/test").Page): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    const declare = page.getByRole("button", { name: "声明" });
    const count = await declare.count();
    if (count === 0) return;
    await declare.first().click();
    await expect
      .poll(async () => declare.count(), { timeout: 15_000 })
      .toBeLessThan(count);
  }
}

/** 把当前所有应对窗口按「不应对」提交掉。 */
async function passAllReactions(page: import("@playwright/test").Page): Promise<void> {
  // 先等应对窗口渲染出来，否则第一轮 count() 会拿到 0 直接返回。
  await expect(page.getByRole("button", { name: "提交应对" }).first()).toBeVisible({ timeout: 15_000 });
  for (let i = 0; i < 8; i += 1) {
    const submit = page.getByRole("button", { name: "提交应对" });
    const count = await submit.count();
    if (count === 0) return;
    await submit.first().click();
    await expect
      .poll(async () => submit.count(), { timeout: 15_000 })
      .toBeLessThan(count);
  }
}

test("倒地的 NPC 会置灰并自动跳过，DP 战斗不会卡死", async ({ page }) => {
  const username = "e2edeathskip";
  const fixture = await createFixture(username, false);
  try {
    await loginAndOpenCombat(page, username, fixture);

    // 玩家与两个木桩都声明；玩家 DP 最高，先手行动。
    await declareAll(page);
    await expect(page.getByRole("button", { name: "发动 DP 行动" })).toBeVisible({ timeout: 20_000 });

    // 弹幕打全体：1 HP 木桩当场退场，厚血木桩存活。
    await page.getByRole("button", { name: "发动 DP 行动" }).click();
    await passAllReactions(page);

    // 退场单位有明确的置灰徽章，并且不再卡住行动顺序：
    // 下一行动者应该是存活的厚血木桩，而不是已退场的木桩。
    await expect(page.getByText("已退场").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("一碰就倒木桩", { exact: true }).first()).toBeVisible();
    // 行动顺序自动跳过了已退场单位，交棒给存活的厚血木桩。
    await expect(page.getByText(/当前行动：\s*厚血木桩/).first()).toBeVisible({ timeout: 20_000 });
  } finally {
    await cleanup(fixture);
  }
});

test("DP 能力下拉会显示规则包里的效果说明", async ({ page }) => {
  const username = "e2eabilityhint";
  const fixture = await createFixture(username, true);
  try {
    await loginAndOpenCombat(page, username, fixture);

    await declareAll(page);
    await expect(page.getByRole("button", { name: "发动 DP 行动" })).toBeVisible({ timeout: 20_000 });

    // 切到射击，才能选择「能力（LvD 伤害）」。
    await page.getByLabel("行动").selectOption("RANGED");
    const abilitySelect = page.locator("select").filter({ hasText: "魔法 Lv3" });
    await expect(abilitySelect).toBeVisible({ timeout: 15_000 });
    await abilitySelect.selectOption({ label: "魔法 Lv3" });
    await expect(page.getByText("以魔导书习得；有抵抗与仪式魔法规则。").first()).toBeVisible({ timeout: 15_000 });
  } finally {
    await cleanup(fixture);
  }
});

test("弹幕对决改为花映冢式左右分屏大舞台", async ({ page }) => {
  const username = "e2eduelstage";
  const fixture = await createFixture(username, false);
  try {
    await loginAndOpenCombat(page, username, fixture);

    const stage = page.getByTestId("danmaku-duel");
    await expect(stage).toBeVisible({ timeout: 20_000 });
    const stageBox = await stage.boundingBox();
    const viewport = page.viewportSize();
    expect(stageBox).not.toBeNull();
    expect(viewport).not.toBeNull();
    if (stageBox !== null && viewport !== null) {
      // 舞台要占据屏幕大部分高度（>45%），而不是旧版 230px 的小条。
      expect(stageBox.height).toBeGreaterThan(viewport.height * 0.45);
    }

    const usSide = page.getByTestId("danmaku-side-us");
    const themSide = page.getByTestId("danmaku-side-them");
    await expect(usSide).toBeVisible();
    await expect(themSide).toBeVisible();
    const usBox = await usSide.boundingBox();
    const themBox = await themSide.boundingBox();
    expect(usBox).not.toBeNull();
    expect(themBox).not.toBeNull();
    if (usBox !== null && themBox !== null) {
      // 一人一边：我方在左、敌方在右。
      expect(usBox.x).toBeLessThan(themBox.x + 1);
      expect(Math.abs(usBox.width - themBox.width)).toBeLessThan(30);
    }
    await expect(page.getByText(/我方/).first()).toBeVisible();
    await expect(page.getByText(/敌方/).first()).toBeVisible();
  } finally {
    await cleanup(fixture);
  }
});
