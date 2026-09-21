import path from "node:path";
import { expect, test } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma } from "../src/server/db/prisma";

const PASSWORD = "e2epass123";
const DEMO_MODULE_PATH = path.resolve(process.cwd(), "../../docs/demo/TOUHOU-DEMO-MODULE.md");

interface Fixture {
  readonly userId: string;
  readonly roomId: string;
  readonly roomName: string;
}

async function createLobbyFixture(username: string): Promise<Fixture> {
  await prisma.user.deleteMany({ where: { username } });
  const user = await prisma.user.create({
    data: {
      username,
      displayName: username,
      passwordHash: await bcrypt.hash(PASSWORD, 10),
      role: "USER"
    }
  });
  const room = await prisma.room.create({
    data: {
      name: "Demo 开局验证房",
      system: "TOUHOU",
      status: "LOBBY",
      ownerId: user.id,
      inviteCode: "TDM" + Date.now().toString(36).toUpperCase().slice(0, 6),
      ruleOverride: { combat: { mode: "INITIATIVE" } } as never,
      members: { create: { userId: user.id, role: "KP" } }
    },
    select: { id: true, name: true }
  });
  return { userId: user.id, roomId: room.id, roomName: room.name };
}

async function cleanup(fixture: Fixture): Promise<void> {
  await prisma.room.deleteMany({ where: { ownerId: fixture.userId } });
  await prisma.module.deleteMany({ where: { ownerId: fixture.userId } });
  await prisma.user.deleteMany({ where: { id: fixture.userId } });
}

async function login(page: import("@playwright/test").Page, username: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("用户名").fill(username);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL("**/");
}

test("从 0 新建空白团本，导入 Demo 团本，可选不带团本开局", async ({ page }) => {
  const username = "e2etouhoudemo";
  const fixture = await createLobbyFixture(username);
  try {
    await login(page, username);

    // 1) 从 0 新建空白团本
    await page.goto("/modules/mine");
    await page.getByRole("button", { name: "从 0 新建空白" }).click();
    await page.waitForURL(/\/modules\/[^/?]+\?saved=new/);
    const blankModuleId = page.url().match(/\/modules\/([^/?]+)/)?.[1];
    if (blankModuleId === undefined) throw new Error("blank module id missing");
    const blank = await prisma.module.findUnique({ where: { id: blankModuleId }, select: { content: true } });
    const blankContent = (blank?.content ?? {}) as { text?: string; sections?: unknown[] };
    expect(blankContent.text).toBe("");
    expect(blankContent.sections).toEqual([]);

    // 2) 导入 Demo 东方团本到房间
    await page.goto("/rooms/" + fixture.roomId + "/modules");
    await page.locator('input[type="file"]').setInputFiles(DEMO_MODULE_PATH);
    await page.getByRole("button", { name: "导入标准团本" }).click();
    await page.waitForURL(new RegExp("/rooms/" + fixture.roomId + "/modules/[^/?]+"));
    const demoModuleId = page.url().match(/\/modules\/([^/?]+)/)?.[1];
    if (demoModuleId === undefined) throw new Error("demo module id missing");
    const demo = await prisma.module.findUnique({
      where: { id: demoModuleId },
      select: { title: true, system: true, sourceType: true }
    });
    expect(demo).toMatchObject({ title: "迷途竹林的假月", system: "TOUHOU", sourceType: "MARKDOWN" });
    const [chapters, scenes, npcs, items, clues, encounters] = await Promise.all([
      prisma.chapterTemplate.count({ where: { moduleId: demoModuleId } }),
      prisma.sceneTemplate.count({ where: { moduleId: demoModuleId } }),
      prisma.npcTemplate.count({ where: { moduleId: demoModuleId } }),
      prisma.itemTemplate.count({ where: { moduleId: demoModuleId } }),
      prisma.clueTemplate.count({ where: { moduleId: demoModuleId } }),
      prisma.encounterTemplate.count({ where: { moduleId: demoModuleId } })
    ]);
    expect(chapters).toBeGreaterThan(0);
    expect(scenes).toBeGreaterThan(0);
    expect(npcs).toBeGreaterThan(0);
    expect(items).toBeGreaterThan(0);
    expect(clues).toBeGreaterThan(0);
    expect(encounters).toBeGreaterThan(0);
    const afterImportRoom = await prisma.room.findUnique({ where: { id: fixture.roomId }, select: { selectedModuleId: true } });
    expect(afterImportRoom?.selectedModuleId).toBe(demoModuleId);

    // 3) 应用 Demo 团本预设
    await page.goto("/rooms/" + fixture.roomId + "/prepare");
    await expect(page.getByText("迷途竹林的假月").first()).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "应用团本预设" }).click();
    await expect(page.getByText(/团本预设已应用/)).toBeVisible({ timeout: 30_000 });
    const [presetScenes, presetClues, presetCards, presetEncounters] = await Promise.all([
      prisma.scene.count({ where: { roomId: fixture.roomId } }),
      prisma.clue.count({ where: { roomId: fixture.roomId } }),
      prisma.card.count({ where: { roomId: fixture.roomId, scope: "ROOM" } }),
      prisma.encounter.count({ where: { roomId: fixture.roomId } })
    ]);
    expect(presetScenes).toBeGreaterThan(0);
    expect(presetClues).toBeGreaterThan(0);
    expect(presetCards).toBeGreaterThan(0);
    expect(presetEncounters).toBeGreaterThan(0);

    // 4) 显式选择“不选择团本”，验证可以不带团本开局
    await page.locator('select[name="moduleId"]').selectOption("");
    await page.getByRole("button", { name: "保存团本选择" }).click();
    await page.waitForURL(/module=selected/);
    const roomBeforeStart = await prisma.room.findUnique({ where: { id: fixture.roomId }, select: { selectedModuleId: true } });
    expect(roomBeforeStart?.selectedModuleId).toBeNull();

    await page.getByRole("button", { name: "我准备好了" }).click();
    await expect(page.getByRole("button", { name: /开始跑团/ })).toBeEnabled({ timeout: 20_000 });
    await page.getByRole("button", { name: /开始跑团/ }).click();
    await page.waitForURL(new RegExp("/rooms/" + fixture.roomId + "$"), { timeout: 30_000 });

    const game = await prisma.game.findFirst({
      where: { roomId: fixture.roomId, status: "PLAYING" },
      select: { id: true, moduleId: true, title: true }
    });
    expect(game).not.toBeNull();
    expect(game?.moduleId).toBeNull();
    expect(game?.title).toBe(fixture.roomName);
  } finally {
    await cleanup(fixture);
  }
});
