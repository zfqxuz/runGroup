import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { prisma } from "../src/server/db/prisma";

const PASSWORD = "e2epass123";

const MAGIC_SPELL = {
  id: "e2e-wim-stardust",
  name: "星尘幻想",
  skill: "MAGIC",
  description: "E2E 武器/道具/魔法局的伤害法术。",
  mpCost: "5",
  sanCost: "0",
  abilityId: "MAGIC",
  requiredLevel: 1,
  activation: { dice: "3D6" as const, target: "12" },
  resist: { attribute: "pow", skill: "RESIST", dice: "3D6" as const },
  target: "ONE" as const,
  targeting: "ENEMY" as const,
  effects: [{ type: "DAMAGE" as const, amount: "1d6" }]
};

interface Fixture {
  readonly roomId: string;
  readonly usernameA: string;
  readonly usernameB: string;
}

async function register(page: Page, username: string): Promise<void> {
  await page.goto("/register");
  await page.locator('input[autocomplete="username"]').fill(username);
  await page.locator('input[autocomplete="new-password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "注册并登录" }).click();
  await page.waitForURL("**/", { timeout: 30_000 });
}

async function createFixture(usernameA: string, usernameB: string, suffix: string): Promise<Fixture> {
  const [userA, userB] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { username: usernameA } }),
    prisma.user.findUniqueOrThrow({ where: { username: usernameB } })
  ]);
  const room = await prisma.room.create({
    data: {
      name: "E2E 武器道具魔法局 " + suffix,
      system: "TOUHOU",
      status: "LOBBY",
      ownerId: userA.id,
      inviteCode: "WIM" + suffix.toUpperCase(),
      selectedModuleId: null,
      ruleOverride: {
        combat: { mode: "DP" },
        magic: { enabled: true, spells: [MAGIC_SPELL] }
      } as never,
      members: { create: [{ userId: userA.id, role: "KP" }, { userId: userB.id, role: "PLAYER" }] }
    },
    select: { id: true }
  });
  const characterA = await prisma.character.create({
    data: {
      userId: userA.id, system: "TOUHOU", name: "灵梦",
      str: 60, con: 60, siz: 60, dex: 90, app: 60, int: 80, pow: 70, edu: 60, luck: 60,
      hp: 400, maxHp: 400, mp: 300, maxMp: 300, san: 60, maxSan: 60, dp: 200, maxDp: 200,
      skills: { DANMAKU: 90, MELEE: 70, DODGE: 70, RESIST: 60, MAGIC: 90 },
      backstory: { abilities: { MAGIC: 3 }, spells: [MAGIC_SPELL.id] } as never
    }
  });
  const characterB = await prisma.character.create({
    data: {
      userId: userB.id, system: "TOUHOU", name: "魔理沙",
      str: 55, con: 55, siz: 55, dex: 70, app: 55, int: 60, pow: 55, edu: 55, luck: 55,
      hp: 400, maxHp: 400, mp: 300, maxMp: 300, san: 60, maxSan: 60, dp: 150, maxDp: 150,
      skills: { DANMAKU: 80, MELEE: 80, DODGE: 80, RESIST: 70, MAGIC: 80 },
      backstory: { abilities: { MAGIC: 3 }, spells: [MAGIC_SPELL.id] } as never
    }
  });
  await prisma.roomCharacterEntry.createMany({
    data: [
      { roomId: room.id, characterId: characterA.id, status: "APPROVED" },
      { roomId: room.id, characterId: characterB.id, status: "APPROVED" }
    ]
  });
  await prisma.roomMember.update({
    where: { roomId_userId: { roomId: room.id, userId: userA.id } },
    data: { activeCharacterId: characterA.id }
  });
  await prisma.roomMember.update({
    where: { roomId_userId: { roomId: room.id, userId: userB.id } },
    data: { activeCharacterId: characterB.id }
  });

  // 武器：御币（射击 2d6） / 魔法扫帚（近战 1d8）
  await prisma.card.create({
    data: {
      characterId: characterA.id, ownerId: userA.id, scope: "COMPENDIUM", type: "WEAPON", system: "TOUHOU",
      name: "御币", isEquipped: true,
      stats: { damage: "2d6", range: "NEAR", skillId: "DANMAKU", accuracyMod: 0, mpCost: 0 } as never
    }
  });
  await prisma.card.create({
    data: {
      characterId: characterB.id, ownerId: userB.id, scope: "COMPENDIUM", type: "WEAPON", system: "TOUHOU",
      name: "魔法扫帚", isEquipped: true,
      stats: { damage: "1d8", range: "MELEE", skillId: "MELEE", accuracyMod: 0, mpCost: 0 } as never
    }
  });
  // 道具：灵药（自愈） / 符札炸弹（伤害道具）
  await prisma.card.create({
    data: {
      characterId: characterA.id, ownerId: userA.id, scope: "COMPENDIUM", type: "ITEM", system: "TOUHOU",
      name: "灵药", isEquipped: true,
      stats: {
        effects: [{ type: "HEAL", amount: "2d6" }],
        targeting: "SELF", targetScope: "SELF",
        cost: { mp: 0, san: null, uses: 3, cooldownRounds: 0 },
        usableIn: ["COMBAT"], weight: 0
      } as never
    }
  });
  await prisma.card.create({
    data: {
      characterId: characterB.id, ownerId: userB.id, scope: "COMPENDIUM", type: "ITEM", system: "TOUHOU",
      name: "符札炸弹", isEquipped: true,
      stats: {
        effects: [{ type: "DAMAGE", amount: "1d6" }],
        targeting: "ENEMY", targetScope: "ONE",
        cost: { mp: 0, san: null, uses: 2, cooldownRounds: 0 },
        usableIn: ["COMBAT"], weight: 0
      } as never
    }
  });

  const scene = await prisma.scene.create({ data: { roomId: room.id, name: "E2E 演武场", isActive: true, orderIndex: 0 } });
  const map = await prisma.map.create({
    data: { sceneId: scene.id, name: "演武地图", width: 1200, height: 800, gridSize: 70, gridType: "SQUARE", showGrid: true, showFog: false }
  });
  await prisma.token.createMany({
    data: [
      { roomId: room.id, mapId: map.id, characterId: characterA.id, name: "灵梦", x: 300, y: 300, size: 1, isVisible: true },
      { roomId: room.id, mapId: map.id, characterId: characterB.id, name: "魔理沙", x: 800, y: 300, size: 1, isVisible: true }
    ]
  });
  return { roomId: room.id, usernameA, usernameB };
}

async function cleanup(fixture: Fixture | null, usernames: readonly string[]): Promise<void> {
  if (fixture !== null) await prisma.room.deleteMany({ where: { id: fixture.roomId } }).catch(() => undefined);
  await prisma.character.deleteMany({ where: { user: { username: { in: [...usernames] } } } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { username: { in: [...usernames] } } }).catch(() => undefined);
}

async function waitTurn(page: Page, name: string): Promise<void> {
  await expect(page.getByText(new RegExp("当前行动：\\s*" + name)).first()).toBeVisible({ timeout: 30_000 });
}

async function declareAll(page: Page): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    const declare = page.getByRole("button", { name: "声明" });
    const count = await declare.count();
    if (count === 0) return;
    await declare.first().click();
    await expect.poll(async () => declare.count(), { timeout: 20_000 }).toBeLessThan(count);
  }
}

async function react(page: Page, label: string): Promise<void> {
  const panel = page.locator("section").filter({ hasText: "你需要应对" }).first();
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await panel.locator("select").first().selectOption({ label });
  await panel.getByRole("button", { name: "提交应对" }).click();
  await expect(panel).toBeHidden({ timeout: 20_000 }).catch(() => undefined);
}

async function dpAttack(
  page: Page,
  input: { action: string; target?: string; weapon?: string }
): Promise<void> {
  await page.getByRole("combobox", { name: "行动", exact: true }).first().selectOption(input.action);
  if (input.weapon !== undefined) {
    const select = page.getByRole("combobox", { name: "武器 / 攻击方式" }).first();
    await expect(select).toBeVisible({ timeout: 15_000 });
    const value = await select.locator("option", { hasText: input.weapon }).first().getAttribute("value");
    if (value === null) throw new Error("找不到武器选项：" + input.weapon);
    await select.selectOption(value);
  }
  if (input.target !== undefined) {
    const targetSelect = page.getByRole("combobox", { name: "目标", exact: true }).first();
    await expect(targetSelect).toBeVisible({ timeout: 15_000 });
    await targetSelect.selectOption({ label: input.target });
  }
  await page.getByRole("button", { name: "发动 DP 行动" }).click();
}

async function useItem(page: Page, itemName: string, target?: string): Promise<void> {
  const button = page.getByRole("button", { name: "使用道具" });
  await expect(button).toBeVisible({ timeout: 20_000 });
  const panel = button.locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]');
  const select = panel.locator("select").first();
  const value = await select.locator("option", { hasText: itemName }).first().getAttribute("value");
  if (value === null) throw new Error("找不到道具：" + itemName);
  await select.selectOption(value);
  await page.waitForTimeout(300);
  if (target !== undefined) {
    const targetSelect = panel.locator("select").nth(1);
    if ((await targetSelect.count()) > 0) {
      const targetValue = await targetSelect.locator("option", { hasText: target }).first().getAttribute("value");
      if (targetValue !== null) await targetSelect.selectOption(targetValue);
    }
  }
  await button.click();
}

async function castMagic(page: Page, spellName: string, targetName: string): Promise<void> {
  const button = page.getByRole("button", { name: "施法", exact: true });
  await expect(button).toBeVisible({ timeout: 20_000 });
  const panel = button.locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]');
  const spellSelect = panel.locator("select").first();
  const spellValue = await spellSelect.locator("option", { hasText: spellName }).first().getAttribute("value");
  if (spellValue === null) throw new Error("找不到法术：" + spellName);
  await spellSelect.selectOption(spellValue);
  await page.waitForTimeout(300);
  const targetSelect = panel.locator("select").nth(1);
  if ((await targetSelect.count()) > 0) {
    const targetValue = await targetSelect.locator("option", { hasText: targetName }).first().getAttribute("value");
    if (targetValue !== null) await targetSelect.selectOption(targetValue);
  }
  await button.click();
}

test("两个真实用户打一场带武器 / 道具 / 魔法的 DP 局", async ({ browser }) => {
  test.setTimeout(300_000);
  const suffix = Date.now().toString(36).slice(-5);
  const usernameA = "e2ewimA" + suffix;
  const usernameB = "e2ewimB" + suffix;
  const contexts: BrowserContext[] = [];
  let fixture: Fixture | null = null;
  try {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    contexts.push(ctxA, ctxB);
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    await register(pageA, usernameA);
    await register(pageB, usernameB);
    fixture = await createFixture(usernameA, usernameB, suffix);

    await pageA.goto("/rooms/" + fixture.roomId + "/prepare");
    await pageA.getByRole("button", { name: "我准备好了" }).click();
    await pageB.goto("/rooms/" + fixture.roomId + "/prepare");
    await pageB.getByRole("button", { name: "我准备好了" }).click();
    await pageA.goto("/rooms/" + fixture.roomId + "/prepare");
    await pageA.getByRole("button", { name: "开始跑团" }).click();
    await pageA.waitForURL("**/rooms/" + fixture.roomId, { timeout: 30_000 });

    const token = pageA.getByTitle("魔理沙");
    await expect(token).toBeVisible({ timeout: 20_000 });
    await token.hover();
    const link = token.locator("a", { hasText: /直接开战/ }).first();
    await expect(link).toBeVisible({ timeout: 15_000 });
    await link.focus();
    await pageA.keyboard.press("Enter");
    await pageA.waitForURL((url) => /\/rooms\/[^/]+\/combat\/new$/.test(url.pathname), { timeout: 30_000 });

    const pickSide = async (name: string, side: "我方" | "敌方"): Promise<void> => {
      const buttons = pageA.getByRole("button", { name: side });
      const count = await buttons.count();
      for (let index = 0; index < count; index += 1) {
        const button = buttons.nth(index);
        const row = button.locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]');
        if ((await row.innerText().catch(() => "")).includes(name) === false) continue;
        const className = (await button.getAttribute("class")) ?? "";
        const active = side === "我方" ? className.includes("border-sky-400/60") : className.includes("border-red-400/60");
        if (active === false) await button.click();
        return;
      }
      throw new Error("找不到单位：" + name);
    };
    await pickSide("灵梦", "我方");
    await pickSide("魔理沙", "敌方");
    await pageA.getByRole("button", { name: "直接开战" }).click();
    await pageA.waitForURL((url) => /\/rooms\/[^/]+\/combat\/(?!new$)[^/]+$/.test(url.pathname), { timeout: 30_000 });
    const combatUrl = pageA.url();
    await pageB.goto(combatUrl);
    await expect(pageA.getByText("参战单位").first()).toBeVisible({ timeout: 30_000 });
    await expect(pageB.getByText("参战单位").first()).toBeVisible({ timeout: 30_000 });

    // ---- 第 1 轮：武器 ----
    await expect(pageA.getByText(/DP 宣言 · 第 1 轮/).first()).toBeVisible({ timeout: 20_000 });
    await declareAll(pageA);
    await declareAll(pageB);

    // 灵梦用「御币」射击：武器下拉来自已装备武器，伤害 2d6
    await waitTurn(pageA, "灵梦");
    await pageA.getByRole("combobox", { name: "行动", exact: true }).first().selectOption("RANGED");
    const weaponOption = pageA.getByRole("combobox", { name: "武器 / 攻击方式" }).first();
    await expect(weaponOption).toBeVisible({ timeout: 15_000 });
    await expect(weaponOption.locator("option", { hasText: "御币（2d6）" })).toHaveCount(1);
    await dpAttack(pageA, { action: "RANGED", target: "魔理沙", weapon: "御币" });
    await react(pageB, "不应对");
    await expect(pageA.locator("p").filter({ hasText: /使用「御币」.*射击（DP）/ }).first()).toBeVisible({ timeout: 20_000 });

    // 魔理沙用「魔法扫帚」近战
    await waitTurn(pageB, "魔理沙");
    await dpAttack(pageB, { action: "MELEE", target: "灵梦", weapon: "魔法扫帚" });
    await react(pageA, "不应对");
    await expect(pageB.locator("p").filter({ hasText: /使用「魔法扫帚」/ }).first()).toBeVisible({ timeout: 20_000 });

    // ---- 第 2 轮：道具 ----
    await expect(pageA.getByText(/DP 宣言 · 第 2 轮/).first()).toBeVisible({ timeout: 30_000 });
    await declareAll(pageA);
    await declareAll(pageB);

    // 灵梦使用「灵药」自愈
    await waitTurn(pageA, "灵梦");
    await useItem(pageA, "灵药");
    await expect(pageA.locator("p").filter({ hasText: /灵药/ }).first()).toBeVisible({ timeout: 20_000 });

    // 魔理沙使用「符札炸弹」攻击灵梦
    await waitTurn(pageB, "魔理沙");
    await useItem(pageB, "符札炸弹", "灵梦");
    await react(pageA, "不应对");
    await expect(pageB.locator("p").filter({ hasText: /符札炸弹/ }).first()).toBeVisible({ timeout: 20_000 });

    // ---- 第 3 轮：魔法 ----
    await expect(pageA.getByText(/DP 宣言 · 第 3 轮/).first()).toBeVisible({ timeout: 30_000 });
    await declareAll(pageA);
    await declareAll(pageB);

    await waitTurn(pageA, "灵梦");
    await castMagic(pageA, "星尘幻想", "魔理沙");
    await react(pageB, "抵抗");
    await expect(pageA.locator("p").filter({ hasText: /星尘幻想/ }).first()).toBeVisible({ timeout: 20_000 });

    const body = await pageA.locator("body").innerText();
    for (const expected of ["御币", "灵药", "星尘幻想"]) {
      expect(body).toContain(expected);
    }
  } finally {
    for (const context of contexts) await context.close().catch(() => undefined);
    await cleanup(fixture, [usernameA, usernameB]);
  }
});
