import { expect, test } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma } from "../src/server/db/prisma";

const USERNAME = "e2ekpdrawer";
const PASSWORD = "e2epass123";

test("KP 准备区侧边菜单抽屉 + 无 GameCharacter 个人状态回退", async ({ page }) => {
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
    await expect(page.getByRole("button", { name: /场景与地图/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /战斗申请/ })).toBeVisible();

    // 有战斗申请时自动滑出「战斗申请」抽屉。
    await expect(page.getByText("待审批战斗申请（1）")).toBeVisible();

    // 即使没有 GameCharacter，个人状态看板也应从已审核角色卡回退展示。
    const hpCard = page.getByText("HP", { exact: true }).locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]");
    await expect(hpCard.getByText("11", { exact: true })).toBeVisible();

    // 点击侧边菜单切换抽屉。
    await page.getByRole("button", { name: /场景与地图/ }).click();
    await expect(page.getByText("切换场景", { exact: true })).toBeVisible();
  } finally {
    if (roomId !== null) await prisma.room.delete({ where: { id: roomId } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
  }
});
