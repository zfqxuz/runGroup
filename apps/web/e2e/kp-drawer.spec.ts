import { expect, test } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma } from "../src/server/db/prisma";

const USERNAME = "e2ekpdrawer";
const PASSWORD = "e2epass123";

test("KP 准备区：抽屉层级 / 时间场景可编辑 / 战斗与申请合并 / 个人状态回退", async ({ page }) => {
  await prisma.user.deleteMany({ where: { username: USERNAME } });
  const user = await prisma.user.create({
    data: { username: USERNAME, displayName: USERNAME, passwordHash: await bcrypt.hash(PASSWORD, 10), role: "USER" }
  });
  let roomId: string | null = null;
  try {
    const room = await prisma.room.create({
      data: {
        name: "E2E KP 抽屉房",
        system: "COC7",
        status: "PLAYING",
        ownerId: user.id,
        inviteCode: "KPDRW" + Date.now().toString(36).slice(-4).toUpperCase(),
        members: { create: { userId: user.id, role: "KP" } }
      },
      select: { id: true }
    });
    roomId = room.id;
    const character = await prisma.character.create({
      data: {
        userId: user.id, system: "COC7", name: "E2E 抽屉调查员",
        str: 50, con: 50, siz: 50, dex: 50, app: 50, int: 50, pow: 50, edu: 50, luck: 50,
        hp: 11, maxHp: 11, mp: 9, maxMp: 9, san: 45, maxSan: 45, dp: 0, maxDp: 0, skills: {}
      }
    });
    await prisma.roomCharacterEntry.create({ data: { roomId: room.id, characterId: character.id, status: "APPROVED" } });
    const game = await prisma.game.create({
      data: { roomId: room.id, status: "PLAYING", title: "E2E 抽屉局", createdBy: user.id },
      select: { id: true }
    });
    await prisma.gameState.create({ data: { gameId: game.id, flags: {} as never, counters: {} as never, custom: {} as never } });
    await prisma.combatRequest.create({
      data: { roomId: room.id, initiatorId: user.id, status: "PENDING_REVIEW", setup: {} as never }
    });

    await page.goto("/login");
    await page.getByLabel("用户名").fill(USERNAME);
    await page.getByLabel("密码").fill(PASSWORD);
    await page.getByRole("button", { name: "登录" }).click();
    await page.waitForURL("**/");

    await page.goto("/rooms/" + room.id);
    await expect(page.getByText("KP 准备区", { exact: true })).toBeVisible();

    // 主动开战与战斗申请已合并为一个抽屉入口，不再各占一个菜单项。
    await expect(page.getByRole("button", { name: /场景与地图/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /战斗与申请/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^主动开战$/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^战斗申请$/ })).toHaveCount(0);

    // 有战斗申请时自动滑出「战斗与申请」抽屉。
    await expect(page.getByText("玩家战斗申请", { exact: true })).toBeVisible();
    await expect(page.locator("[data-kp-drawer-overlay]").getByText(USERNAME, { exact: true })).toBeVisible();

    // 抽屉必须盖在地图 / 日志之上（此前 sticky 侧栏形成 stacking context，抽屉被压住）。
    const covered = await page.evaluate(() => {
      const panel = document.querySelector("[data-kp-drawer-overlay] aside");
      if (panel === null) return { ok: false, reason: "no-overlay" };
      const panelLeft = panel.getBoundingClientRect().left;
      const kpSidebar = document.querySelector("main aside");
      const sidebarRight = kpSidebar === null ? 0 : kpSidebar.getBoundingClientRect().right;
      const x = Math.round(Math.max(sidebarRight + 40, 200));
      if (x >= panelLeft) return { ok: false, reason: "no-backdrop-gap" };
      const y = Math.round(window.innerHeight / 2);
      const el = document.elementFromPoint(x, y);
      return { ok: el !== null && el.closest("[data-kp-drawer-overlay]") !== null, x, y, hit: el?.tagName ?? null };
    });
    expect(covered, JSON.stringify(covered)).toMatchObject({ ok: true });

    // 即使没有 GameCharacter，个人状态看板也应从已审核角色卡回退展示。
    const hpCard = page.getByText("HP", { exact: true }).locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]");
    await expect(hpCard.getByText("11", { exact: true })).toBeVisible();

    // 不再显示“选择一个操作区…”占位提示。
    await expect(page.getByText("选择一个操作区，右侧滑出对应表单。", { exact: true })).toHaveCount(0);

    // 「背景音乐」抽屉：嵌入模式，不应再套卡片。
    await page.getByRole("button", { name: /背景音乐/ }).click();
    await expect(page.getByPlaceholder(/music\.163\.com/)).toBeVisible();
    await expect(page.locator("[data-kp-drawer-overlay] section.rounded-xl")).toHaveCount(0);

    // 「数值调整」抽屉：嵌入模式，不应再套卡片。
    await page.getByRole("button", { name: /数值调整/ }).click();
    await expect(page.getByText("目标单位", { exact: true })).toBeVisible();
    await expect(page.locator("[data-kp-drawer-overlay] section.rounded-xl")).toHaveCount(0);

    // 切到「场景与地图」：时间 / 章节 / 场景 / 遭遇 都应该是可编辑控件。
    await page.getByRole("button", { name: /场景与地图/ }).click();
    const gameTime = page.getByLabel("团内时间");
    await expect(gameTime).toBeEditable();
    await expect(page.getByLabel("当前章节")).toBeEditable();
    await expect(page.getByLabel("当前场景")).toBeEditable();
    await expect(page.getByLabel("当前遭遇")).toBeEditable();

    await gameTime.fill("第 2 天 上午 10:20");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.waitForURL("**/rooms/" + room.id + "?state=saved**");

    const savedState = await prisma.gameState.findUnique({ where: { gameId: game.id }, select: { gameTime: true } });
    expect(savedState?.gameTime).toBe("第 2 天 上午 10:20");
  } finally {
    if (roomId !== null) await prisma.room.delete({ where: { id: roomId } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
  }
});
