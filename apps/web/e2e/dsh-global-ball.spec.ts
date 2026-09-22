import { expect, test, type Locator, type Page } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma } from "../src/server/db/prisma";
import { loadEffectivePack } from "../src/server/rules/loader";
import { characterRef, createCombatRecord, npcRef } from "../src/server/combat/setup";
import { NpcStatsSchema } from "../src/shared/npc";
import { MODULE_DSH_SETTING_KEY } from "../src/server/dsh/access";

const USERNAME = "e2edshball";
const PASSWORD = "e2epass123";

async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("用户名").fill(USERNAME);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL("**/");
}

async function openBall(page: Page): Promise<Locator> {
  const ball = page.getByRole("button", { name: "打开 ai 助手" });
  await expect(ball).toBeVisible();
  const panel = page.locator("[data-dsh-panel]");
  if ((await panel.count()) === 0 || (await panel.isVisible()) === false) {
    await ball.click();
  }
  await expect(panel).toBeVisible();
  return panel;
}

test("dsh 悬浮球：常驻各页面并按场景自动带上下文", async ({ page }) => {
  await prisma.user.deleteMany({ where: { username: USERNAME } });
  const user = await prisma.user.create({
    data: { username: USERNAME, displayName: USERNAME, passwordHash: await bcrypt.hash(PASSWORD, 10), role: "USER" }
  });
  const previousSetting = await prisma.systemSetting.findUnique({ where: { key: MODULE_DSH_SETTING_KEY } });
  let roomId: string | null = null;
  let moduleId: string | null = null;
  let characterId: string | null = null;
  let combatId: string | null = null;
  try {
    const room = await prisma.room.create({
      data: {
        name: "E2E dsh 悬浮球房",
        system: "COC7",
        status: "PLAYING",
        ownerId: user.id,
        inviteCode: "DSHBALL" + Date.now().toString(36).slice(-4).toUpperCase(),
        members: { create: { userId: user.id, role: "KP" } }
      },
      select: { id: true, system: true, rulePackVersionId: true, ruleOverride: true }
    });
    roomId = room.id;

    const character = await prisma.character.create({
      data: {
        userId: user.id,
        roomId: room.id,
        system: "COC7",
        name: "E2E 悬浮球调查员",
        str: 50, con: 50, siz: 50, dex: 50, app: 50, int: 50, pow: 50, edu: 50, luck: 50,
        hp: 12, maxHp: 12, mp: 10, maxMp: 10, san: 50, maxSan: 50, dp: 0, maxDp: 0,
        skills: { "侦查": 60 } as never,
        reviewStatus: "APPROVED"
      },
      select: { id: true }
    });
    characterId = character.id;
    await prisma.roomCharacterEntry.create({ data: { roomId: room.id, characterId: character.id, status: "APPROVED" } });

    const game = await prisma.game.create({
      data: { roomId: room.id, status: "PLAYING", title: "E2E 悬浮球局", createdBy: user.id },
      select: { id: true }
    });
    await prisma.gameState.create({ data: { gameId: game.id, flags: {} as never, counters: {} as never, custom: {} as never } });
    await prisma.gameCharacter.create({
      data: { gameId: game.id, characterId: character.id, userId: user.id, currentHp: 12, currentMp: 10, currentSan: 50, currentDp: 0, conditions: [] as never }
    });

    const module = await prisma.module.create({
      data: {
        roomId: room.id,
        ownerId: user.id,
        title: "E2E 悬浮球团本",
        system: "COC7",
        era: "MODERN",
        author: USERNAME,
        version: "1.0.0",
        content: {
          format: "markdown",
          text: "# E2E 悬浮球团本\n\n## 第一幕\n调查旧宅。\n",
          structured: {
            chapters: [{ id: "ch1", title: "第一幕" }],
            scenes: [{ id: "sc1", name: "旧宅门厅" }],
            npcs: [{ id: "npc1", name: "老管家" }],
            clues: [], items: [], encounters: [], magic: [], rewards: [], endings: []
          }
        } as never
      },
      select: { id: true }
    });
    moduleId = module.id;

    const npc = await prisma.card.create({
      data: {
        scope: "ROOM",
        roomId: room.id,
        ownerId: user.id,
        type: "NPC",
        name: "E2E 悬浮球木桩",
        system: "COC7",
        stats: NpcStatsSchema.parse({
          attributes: { str: 10, con: 10, siz: 10, dex: 10, app: 10, int: 10, pow: 10, edu: 10, luck: 10 },
          skills: {},
          maxHp: 30,
          maxMp: 0,
          maxSan: 30,
          maxDp: 0
        }) as never
      },
      select: { id: true }
    });
    const effective = await loadEffectivePack({
      id: room.id,
      system: room.system,
      rulePackVersionId: room.rulePackVersionId,
      ruleOverride: room.ruleOverride
    });
    const created = await createCombatRecord(room.id, effective, [characterRef(character.id)], [npcRef(npc.id)]);
    expect(created.ok).toBe(true);
    if (created.combatId === undefined) throw new Error(created.error ?? "combat create failed");
    combatId = created.combatId;

    // 把测试账号加入 dsh 白名单，才能看到技能列表。
    await prisma.systemSetting.upsert({
      where: { key: MODULE_DSH_SETTING_KEY },
      update: { value: { enabled: true, entries: [USERNAME] } as never },
      create: { key: MODULE_DSH_SETTING_KEY, value: { enabled: true, entries: [USERNAME] } as never }
    });

    await login(page);

    // 1) 全局页：默认通用上下文
    let panel = await openBall(page);
    await expect(panel).toHaveAttribute("data-context-kind", "GLOBAL");
    await expect(panel.locator("[data-dsh-context-label]")).toContainText("通用助手");
    await expect(panel.locator('[data-skill-id="assistant.chat"]')).toBeVisible();
    await expect(panel.locator('[data-skill-id="nav.guide"]')).toBeVisible();
    await expect(panel.locator('[data-skill-id="kp.rule"]')).toBeVisible();
    await expect(panel.locator('[data-skill-id="combat.explain"]')).toHaveCount(0);

    // 1.5) 悬浮球可拖动到任意位置，并持久化
    await panel.getByRole("button", { name: "关闭" }).click();
    await expect(page.locator("[data-dsh-panel]")).toHaveCount(0);
    const ball = page.locator("[data-dsh-ball]");
    const before = await ball.boundingBox();
    const viewport = page.viewportSize();
    if (before === null || viewport === null) throw new Error("缺少悬浮球 / 视口信息");
    const targetX = 24;
    const targetY = viewport.height - 120;
    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
    await page.mouse.down();
    await page.mouse.move(targetX + before.width / 2, targetY + before.height / 2, { steps: 12 });
    await page.mouse.up();
    const after = await ball.boundingBox();
    expect(after).not.toBeNull();
    expect(Math.abs((after?.x ?? 0) - targetX)).toBeLessThan(8);
    expect(Math.abs((after?.y ?? 0) - targetY)).toBeLessThan(8);
    expect(await page.evaluate(() => window.localStorage.getItem("dsh-ball-position"))).not.toBeNull();

    // 拖动之后的普通点击仍然能打开面板
    await ball.click();
    panel = await openBall(page);
    await expect(panel).toHaveAttribute("data-context-kind", "GLOBAL");

    // 2) 团本页：带上 moduleId，作者多出「修改团本」
    await page.goto("/modules/" + module.id);
    panel = await openBall(page);
    await expect(panel).toHaveAttribute("data-context-kind", "MODULE");
    await expect(panel.locator("[data-dsh-context-label]")).toContainText("E2E 悬浮球团本");
    await expect(panel.locator('[data-skill-id="module.explain"]')).toBeVisible();
    await expect(panel.locator('[data-skill-id="module.edit"]')).toBeVisible();

    // 3) 房间页
    await page.goto("/rooms/" + room.id);
    panel = await openBall(page);
    await expect(panel).toHaveAttribute("data-context-kind", "ROOM");
    await expect(panel.locator("[data-dsh-context-label]")).toContainText("E2E dsh 悬浮球房");

    // 4) 角色页
    await page.goto("/rooms/" + room.id + "/characters/" + character.id);
    panel = await openBall(page);
    await expect(panel).toHaveAttribute("data-context-kind", "CHARACTER");
    await expect(panel.locator("[data-dsh-context-label]")).toContainText("E2E 悬浮球调查员");

    // 5) 战斗页：带上 combatId，出现战斗解读
    await page.goto("/rooms/" + room.id + "/combat/" + created.combatId);
    panel = await openBall(page);
    await expect(panel).toHaveAttribute("data-context-kind", "COMBAT");
    await expect(panel.locator("[data-dsh-context-label]")).toContainText("战斗");
    await expect(panel.locator('[data-skill-id="combat.explain"]')).toBeVisible();

    // 6) 站内跳转（不刷新）：悬浮球常驻，上下文跟随路由变化
    await page.locator("header").getByRole("link", { name: "团本广场" }).click();
    await page.waitForURL("**/modules");
    await expect(page.locator("[data-dsh-panel]")).toBeVisible();
    await expect(page.locator("[data-dsh-panel]")).toHaveAttribute("data-context-kind", "GLOBAL");
    await expect(page.locator("[data-dsh-panel] [data-dsh-context-label]")).toContainText("通用助手");
  } finally {
    if (combatId !== null) await prisma.combat.delete({ where: { id: combatId } }).catch(() => undefined);
    if (moduleId !== null) await prisma.module.delete({ where: { id: moduleId } }).catch(() => undefined);
    if (characterId !== null) await prisma.character.delete({ where: { id: characterId } }).catch(() => undefined);
    if (roomId !== null) await prisma.room.delete({ where: { id: roomId } }).catch(() => undefined);
    if (previousSetting === null) {
      await prisma.systemSetting.delete({ where: { key: MODULE_DSH_SETTING_KEY } }).catch(() => undefined);
    } else {
      await prisma.systemSetting.update({ where: { key: MODULE_DSH_SETTING_KEY }, data: { value: previousSetting.value as never } }).catch(() => undefined);
    }
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
  }
});
