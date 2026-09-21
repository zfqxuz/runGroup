import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma } from "../src/server/db/prisma";
import { loadEffectivePack } from "../src/server/rules/loader";
import { createDanmakuLayer } from "../src/shared/danmaku/presets";
import type { DanmakuPattern } from "../src/shared/danmaku/schema";
import { NpcStatsSchema } from "../src/shared/npc";

const PASSWORD = "e2epass123";

function patternOf(type: "ring" | "spiral" | "fan" | "cross" | "laser", seed: number): DanmakuPattern {
  return { version: 1, seed, layers: [createDanmakuLayer(type)] };
}

const MAGIC_SPELL = {
  id: "e2e-dm-stardust",
  name: "星尘幻想",
  skill: "MAGIC",
  description: "E2E 双人弹幕战用的伤害法术。",
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

async function login(page: Page, username: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("用户名").fill(username);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL("**/", { timeout: 30_000 });
}

function spellcardStats(input: {
  mode: "DECLARATION" | "CONSUMPTION";
  mpCost: number;
  hpRatio: number | null;
  pattern: DanmakuPattern;
  danmaku: string;
}) {
  return {
    mode: input.mode,
    danmaku: input.danmaku,
    mpCost: input.mpCost,
    hpRatio: input.mode === "DECLARATION" ? input.hpRatio ?? 1 : null,
    durationTicks: input.mode === "DECLARATION" ? 100 : null,
    clearTargets: input.mode === "DECLARATION" ? "ALL" : null,
    enhanceType: "DANMAKU",
    enhanceValue: 1,
    pattern: input.pattern,
    effects: [],
    targeting: "SELF",
    targetScope: "SELF",
    combat: null,
    cost: { mp: input.mpCost, san: null, uses: null, cooldownRounds: 0 },
    usableIn: ["COMBAT"]
  };
}

async function createFixture(usernameA: string, usernameB: string, suffix: string): Promise<Fixture> {
  const [userA, userB] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { username: usernameA } }),
    prisma.user.findUniqueOrThrow({ where: { username: usernameB } })
  ]);

  const room = await prisma.room.create({
    data: {
      name: "E2E 双人弹幕战 " + suffix,
      system: "TOUHOU",
      status: "LOBBY",
      ownerId: userA.id,
      inviteCode: "DM" + suffix.toUpperCase(),
      selectedModuleId: null,
      ruleOverride: {
        combat: { mode: "DP" },
        magic: { enabled: true, spells: [MAGIC_SPELL] }
      } as never,
      members: {
        create: [
          { userId: userA.id, role: "KP" },
          { userId: userB.id, role: "PLAYER" }
        ]
      }
    },
    select: { id: true }
  });

  const characterA = await prisma.character.create({
    data: {
      userId: userA.id,
      system: "TOUHOU",
      name: "灵梦",
      str: 60, con: 60, siz: 60, dex: 90, app: 60, int: 70, pow: 60, edu: 60, luck: 60,
      hp: 400, maxHp: 400, mp: 300, maxMp: 300, san: 60, maxSan: 60, dp: 180, maxDp: 180,
      skills: { DANMAKU: 90, MELEE: 80, DODGE: 70, RESIST: 60, MAGIC: 90 },
      backstory: { abilities: { MAGIC: 3 }, spells: [MAGIC_SPELL.id] } as never
    }
  });
  const characterB = await prisma.character.create({
    data: {
      userId: userB.id,
      system: "TOUHOU",
      name: "魔理沙",
      str: 50, con: 55, siz: 55, dex: 70, app: 55, int: 60, pow: 55, edu: 55, luck: 55,
      hp: 400, maxHp: 400, mp: 300, maxMp: 300, san: 60, maxSan: 60, dp: 130, maxDp: 130,
      skills: { DANMAKU: 80, MELEE: 70, DODGE: 80, RESIST: 70, MAGIC: 80 },
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

  // 灵梦：展开型圆环 + 消费型扇形
  await prisma.card.create({
    data: {
      characterId: characterA.id, ownerId: userA.id, scope: "COMPENDIUM", type: "SPELLCARD", system: "TOUHOU",
      name: "梦想封印·环", isEquipped: true,
      stats: spellcardStats({ mode: "DECLARATION", mpCost: 10, hpRatio: 1, danmaku: "灵梦的圆环封印", pattern: patternOf("ring", 11) }) as never
    }
  });
  await prisma.card.create({
    data: {
      characterId: characterA.id, ownerId: userA.id, scope: "COMPENDIUM", type: "SPELLCARD", system: "TOUHOU",
      name: "封魔阵·散", isEquipped: true,
      stats: spellcardStats({ mode: "CONSUMPTION", mpCost: 5, hpRatio: null, danmaku: "扇形符札", pattern: patternOf("fan", 12) }) as never
    }
  });
  // 魔理沙：展开型激光 + 消费型交叉
  await prisma.card.create({
    data: {
      characterId: characterB.id, ownerId: userB.id, scope: "COMPENDIUM", type: "SPELLCARD", system: "TOUHOU",
      name: "恋符·激光", isEquipped: true,
      stats: spellcardStats({ mode: "DECLARATION", mpCost: 10, hpRatio: 1, danmaku: "魔理沙的激光阵", pattern: patternOf("laser", 21) }) as never
    }
  });
  await prisma.card.create({
    data: {
      characterId: characterB.id, ownerId: userB.id, scope: "COMPENDIUM", type: "SPELLCARD", system: "TOUHOU",
      name: "魔炮·星", isEquipped: true,
      stats: spellcardStats({ mode: "CONSUMPTION", mpCost: 5, hpRatio: null, danmaku: "十字星弹", pattern: patternOf("cross", 22) }) as never
    }
  });

  // 灵梦一侧的 NPC 盟友（自带螺旋符卡）
  const npcStats = NpcStatsSchema.parse({
    tier: "STANDARD",
    rarity: "COMMON",
    attributes: { str: 30, con: 40, siz: 40, dex: 50, app: 40, int: 40, pow: 30, edu: 30, luck: 30 },
    skills: { DANMAKU: 70, DODGE: 60 },
    weapons: [],
    maxHp: 200,
    maxMp: 200,
    maxSan: 30,
    maxDp: 100,
    spellcards: [
      {
        cardId: "e2e-dm-fairy-sc",
        name: "妖精弹幕·螺旋",
        stats: spellcardStats({ mode: "DECLARATION", mpCost: 0, hpRatio: 1, danmaku: "妖精的螺旋弹幕", pattern: patternOf("spiral", 31) }) as never
      }
    ]
  });
  const npcCard = await prisma.card.create({
    data: {
      scope: "ROOM", roomId: room.id, ownerId: userA.id, type: "NPC", name: "妖精", system: "TOUHOU",
      stats: npcStats as never
    }
  });

  // 场景 + 三枚 Token，供 KP 从 Token 直接开战
  const scene = await prisma.scene.create({
    data: { roomId: room.id, name: "E2E 弹幕战场", isActive: true, orderIndex: 0 }
  });
  const map = await prisma.map.create({
    data: {
      sceneId: scene.id, name: "弹幕战场地图", width: 1200, height: 800,
      gridSize: 70, gridType: "SQUARE", showGrid: true, showFog: false
    }
  });
  await prisma.token.createMany({
    data: [
      { roomId: room.id, mapId: map.id, characterId: characterA.id, name: "灵梦", x: 300, y: 300, size: 1, isVisible: true },
      { roomId: room.id, mapId: map.id, characterId: characterB.id, name: "魔理沙", x: 800, y: 300, size: 1, isVisible: true },
      { roomId: room.id, mapId: map.id, cardId: npcCard.id, name: "妖精", x: 300, y: 600, size: 1, isVisible: true }
    ]
  });

  return { roomId: room.id, usernameA, usernameB };
}

async function cleanup(fixture: Fixture | null, usernames: readonly string[]): Promise<void> {
  if (fixture !== null) {
    await prisma.room.deleteMany({ where: { id: fixture.roomId } }).catch(() => undefined);
  }
  await prisma.character.deleteMany({ where: { user: { username: { in: [...usernames] } } } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { username: { in: [...usernames] } } }).catch(() => undefined);
}

/** 当前浏览器出现「当前行动：<name>」时返回。 */
async function waitTurn(page: Page, name: string): Promise<void> {
  await expect(page.getByText(new RegExp("当前行动：\\s*" + name)).first()).toBeVisible({ timeout: 30_000 });
}

async function declareAll(page: Page): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    const declare = page.getByRole("button", { name: "声明" });
    const count = await declare.count();
    if (count === 0) return;
    await declare.first().click();
    await expect.poll(async () => declare.count(), { timeout: 20_000 }).toBeLessThan(count);
  }
}

async function react(page: Page, label: string, coverTarget?: string): Promise<void> {
  const panel = page.locator("section").filter({ hasText: "你需要应对" }).first();
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await panel.locator("select").first().selectOption({ label });
  if (label === "掩护队友") {
    // COVER 不显示 DP 骰输入，所以面板里最后一个 select 就是掩护目标。
    const coverSelect = panel.locator("select").last();
    await expect(coverSelect).toBeVisible({ timeout: 10_000 });
    if (coverTarget === undefined) {
      await coverSelect.selectOption({ index: 1 });
    } else {
      const value = await coverSelect.locator("option", { hasText: coverTarget }).first().getAttribute("value");
      if (value === null) throw new Error("找不到掩护目标：" + coverTarget);
      await coverSelect.selectOption(value);
    }
  }
  await panel.getByRole("button", { name: "提交应对" }).click();
  await expect(panel).toBeHidden({ timeout: 20_000 }).catch(() => undefined);
}

/** 提交剩余所有应对窗口（默认已选好的选项，通常是「不应对」）。 */
async function submitRemainingReactions(page: Page): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    const submit = page.getByRole("button", { name: "提交应对" });
    const count = await submit.count();
    if (count === 0) return;
    await submit.first().click();
    await expect.poll(async () => submit.count(), { timeout: 15_000 }).toBeLessThan(count);
  }
}

async function dpAttack(page: Page, input: { action: string; target?: string; waitAfter?: boolean }): Promise<void> {
  // 用 ARIA role + name，避免 <label> 包住 select 时把 option 文本算进 label 文本。
  const actionSelect = page.getByRole("combobox", { name: "行动", exact: true }).first();
  await expect(actionSelect).toBeVisible({ timeout: 15_000 });
  await actionSelect.selectOption(input.action);
  if (input.target !== undefined) {
    const targetSelect = page.getByRole("combobox", { name: "目标", exact: true }).first();
    await expect(targetSelect).toBeVisible({ timeout: 15_000 });
    await targetSelect.selectOption({ label: input.target });
  }
  await page.getByRole("button", { name: "发动 DP 行动" }).click();
}

async function selectOptionByText(select: ReturnType<Page["locator"]>, text: string): Promise<void> {
  const option = select.locator("option", { hasText: text }).first();
  await expect(option).toHaveCount(1, { timeout: 15_000 });
  const value = await option.getAttribute("value");
  if (value === null) throw new Error("找不到下拉项：" + text);
  await select.selectOption(value);
}

async function castSpellcard(page: Page, cardName: string): Promise<void> {
  const castButton = page.getByRole("button", { name: "释放符卡" });
  await expect(castButton).toBeVisible({ timeout: 20_000 });
  const panel = castButton.locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]');
  await selectOptionByText(panel.locator("select").first(), cardName);
  await castButton.click();
}

async function castMagic(page: Page, spellName: string, targetName: string): Promise<void> {
  const castButton = page.getByRole("button", { name: "施法", exact: true });
  await expect(castButton).toBeVisible({ timeout: 20_000 });
  const panel = castButton.locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]');
  await selectOptionByText(panel.locator("select").first(), spellName);
  // 选择法术后 React 才会渲染目标下拉，等它出现再选目标。
  await page.waitForTimeout(300);
  const targetSelect = panel.locator("select").nth(1);
  if ((await targetSelect.count()) > 0) {
    await selectOptionByText(targetSelect, targetName).catch(() => undefined);
  }
  await castButton.click();
}

test("两个真实浏览器用户打一场多回合弹幕战：不同攻击 / 应对 / 弹幕类型", async ({ browser }) => {
  test.setTimeout(300_000);
  const suffix = Date.now().toString(36).slice(-5);
  const usernameA = "e2edmA" + suffix;
  const usernameB = "e2edmB" + suffix;
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

    // 双方准备 + KP 开始跑团（真实页面点击）
    await pageA.goto("/rooms/" + fixture.roomId + "/prepare");
    await pageA.getByRole("button", { name: "我准备好了" }).click();
    await pageB.goto("/rooms/" + fixture.roomId + "/prepare");
    await pageB.getByRole("button", { name: "我准备好了" }).click();
    await pageA.goto("/rooms/" + fixture.roomId + "/prepare");
    await pageA.getByRole("button", { name: "开始跑团" }).click();
    await pageA.waitForURL("**/rooms/" + fixture.roomId, { timeout: 30_000 });

    // KP 从魔理沙的 Token 发起真实战斗
    const token = pageA.getByTitle("魔理沙");
    await expect(token).toBeVisible({ timeout: 20_000 });
    await token.hover();
    const combatLink = token.locator("a", { hasText: /直接开战/ }).first();
    await expect(combatLink).toBeVisible({ timeout: 15_000 });
    await combatLink.focus();
    await pageA.keyboard.press("Enter");
    await pageA.waitForURL((url) => /\/rooms\/[^/]+\/combat\/new$/.test(url.pathname), { timeout: 30_000 });

    // 选择双方：灵梦 + 妖精（我方） vs 魔理沙（敌方）
    const pickSide = async (name: string, side: "我方" | "敌方"): Promise<void> => {
      const buttons = pageA.getByRole("button", { name: side });
      const count = await buttons.count();
      for (let index = 0; index < count; index += 1) {
        const button = buttons.nth(index);
        const row = button.locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]');
        const text = await row.innerText().catch(() => "");
        if (text.includes(name) === false) continue;
        const className = (await button.getAttribute("class")) ?? "";
        const active = side === "我方" ? className.includes("border-sky-400/60") : className.includes("border-red-400/60");
        if (active === false) await button.click();
        return;
      }
      throw new Error("找不到单位选择项：" + name + " / " + side);
    };
    await pickSide("灵梦", "我方");
    await pickSide("妖精", "我方");
    await pickSide("魔理沙", "敌方");

    // 战前符卡宣言：把双方 2 张符卡都勾上
    for (const cardName of ["梦想封印·环", "封魔阵·散", "恋符·激光", "魔炮·星"]) {
      const checkbox = pageA.locator('label:has-text("' + cardName + '") input[type="checkbox"]').first();
      await expect(checkbox).toBeVisible({ timeout: 15_000 });
      if ((await checkbox.isChecked()) === false) await checkbox.check();
    }
    await pageA.getByRole("button", { name: "直接开战" }).click();
    await pageA.waitForURL(
      (url) => /\/rooms\/[^/]+\/combat\/(?!new$)[^/]+$/.test(url.pathname),
      { timeout: 30_000 }
    );
    const combatUrl = pageA.url();

    await pageB.goto(combatUrl);
    await expect(pageA.getByText("参战单位").first()).toBeVisible({ timeout: 30_000 });
    await expect(pageB.getByText("参战单位").first()).toBeVisible({ timeout: 30_000 });
    await expect(pageA.getByTestId("danmaku-duel")).toBeVisible({ timeout: 20_000 });
    await expect(pageB.getByTestId("danmaku-duel")).toBeVisible({ timeout: 20_000 });

    // ---- 第 1 轮：双方（含 NPC）宣言 ----
    await expect(pageA.getByText(/DP 宣言 · 第 1 轮/).first()).toBeVisible({ timeout: 20_000 });
    await declareAll(pageA);
    await declareAll(pageB);

    // 灵梦：展开型圆环符卡（不同类型弹幕）
    await waitTurn(pageA, "灵梦");
    await castSpellcard(pageA, "梦想封印·环");
    await expect(pageA.getByTestId("danmaku-side-us")).toHaveAttribute("data-pattern", /ring/, { timeout: 20_000 });

    // 魔理沙：展开型激光符卡（与灵梦的圆环是不同类型的弹幕）
    await waitTurn(pageB, "魔理沙");
    await castSpellcard(pageB, "恋符·激光");
    await expect(pageB.getByTestId("danmaku-side-us")).toHaveAttribute("data-pattern", /laser/, { timeout: 20_000 });

    // 妖精（KP 操控）：弹幕打全体；魔理沙选择「闪避」
    await waitTurn(pageA, "妖精");
    await dpAttack(pageA, { action: "DANMAKU" });
    await react(pageB, "闪避");
    await expect(pageA.locator("p").filter({ hasText: /回避弹幕/ }).first()).toBeVisible({ timeout: 20_000 });

    // ---- 第 2 轮 ----
    await expect(pageA.getByText(/DP 宣言 · 第 2 轮/).first()).toBeVisible({ timeout: 30_000 });
    await declareAll(pageA);
    await declareAll(pageB);

    // 灵梦：射击；魔理沙选择「防御」
    await waitTurn(pageA, "灵梦");
    await dpAttack(pageA, { action: "RANGED", target: "魔理沙" });
    await react(pageB, "防御");
    await expect(pageA.locator("p").filter({ hasText: /射击|命中/ }).first()).toBeVisible({ timeout: 20_000 });

    // 魔理沙：追击；灵梦选择「掩护队友」让妖精挡下
    await waitTurn(pageB, "魔理沙");
    await dpAttack(pageB, { action: "CHASE", target: "灵梦" });
    // 追击的应对窗口同时包含目标（灵梦）和目标队友（妖精）：
    // 灵梦真实选择「掩护队友」，让妖精成为掩护者；妖精自己按不应对。
    const reactionSection = pageA.locator("section").filter({ hasText: "你需要应对" }).first();
    await expect(reactionSection).toBeVisible({ timeout: 30_000 });
    const targetPanel = reactionSection
      .locator("div")
      .filter({ hasText: /攻击\s*灵梦，请选择\s*灵梦\s*的应对/ })
      .last();
    await expect(targetPanel).toBeVisible({ timeout: 20_000 });
    await targetPanel.locator("select").first().selectOption({ label: "掩护队友" });
    await targetPanel.locator("select").last().selectOption({ index: 1 });
    await targetPanel.getByRole("button", { name: "提交应对" }).click();
    const allyPanel = reactionSection
      .locator("div")
      .filter({ hasText: /攻击\s*妖精，请选择\s*妖精\s*的应对/ })
      .last();
    await expect(allyPanel).toBeVisible({ timeout: 20_000 });
    await allyPanel.getByRole("button", { name: "提交应对" }).click();
    await expect(pageA.locator("p").filter({ hasText: /掩护|追击/ }).first()).toBeVisible({ timeout: 20_000 });

    // 妖精：近战；魔理沙选择「不应对」
    await waitTurn(pageA, "妖精");
    await dpAttack(pageA, { action: "MELEE", target: "魔理沙" });
    await react(pageB, "不应对");
    await expect(pageB.locator("p").filter({ hasText: /近战|接近/ }).first()).toBeVisible({ timeout: 20_000 });

    // ---- 第 3 轮 ----
    await expect(pageA.getByText(/DP 宣言 · 第 3 轮/).first()).toBeVisible({ timeout: 30_000 });
    await declareAll(pageA);
    await declareAll(pageB);

    // 灵梦：星尘幻想（MAGIC）；魔理沙选择「抵抗」
    await waitTurn(pageA, "灵梦");
    await castMagic(pageA, "星尘幻想", "魔理沙");
    await react(pageB, "抵抗");
    await expect(pageA.locator("p").filter({ hasText: /抵抗|星尘幻想/ }).first()).toBeVisible({ timeout: 20_000 });

    // 魔理沙：消费型交叉符卡，舞台全屏播放一次
    await waitTurn(pageB, "魔理沙");
    await castSpellcard(pageB, "魔炮·星");
    await expect(pageB.getByTestId("danmaku-oneshot")).toBeVisible({ timeout: 15_000 });
    await expect(pageB.getByTestId("danmaku-oneshot")).toHaveAttribute("data-pattern", /cross/, { timeout: 15_000 });

    // 妖精：其他判定（调查），不进入应对窗口
    await waitTurn(pageA, "妖精");
    await pageA.getByRole("combobox", { name: "行动", exact: true }).selectOption("SKILL");
    await pageA.getByRole("button", { name: "发动 DP 行动" }).click();
    await expect(pageA.locator("p").filter({ hasText: /其他判定/ }).first()).toBeVisible({ timeout: 20_000 });

    // 日志里应能同时看到双方不同类型的符卡与攻击
    const logText = await pageA.locator("body").innerText();
    for (const expected of ["梦想封印·环", "恋符·激光", "魔炮·星", "星尘幻想"]) {
      expect(logText).toContain(expected);
    }
  } finally {
    for (const context of contexts) await context.close().catch(() => undefined);
    await cleanup(fixture, [usernameA, usernameB]);
  }
});
