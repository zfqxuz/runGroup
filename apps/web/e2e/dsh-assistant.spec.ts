import { expect, test } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma } from "../src/server/db/prisma";
import { MODULE_DSH_SETTING_KEY } from "../src/server/dsh/access";

const USERNAME = "e2edshassistant";
const PASSWORD = "e2epass123";

test("ai团本助手：悬浮球 → 对话框 → 修改团本并小版本 +1", async ({ page }) => {
  test.skip(process.env.DSH_E2E !== "1", "需要 DSH_E2E=1，且服务器已配置 ai团本助手服务");
  await prisma.user.deleteMany({ where: { username: USERNAME } });
  const user = await prisma.user.create({
    data: { username: USERNAME, displayName: USERNAME, passwordHash: await bcrypt.hash(PASSWORD, 10), role: "USER" }
  });
  const previousSetting = await prisma.systemSetting.findUnique({ where: { key: MODULE_DSH_SETTING_KEY } });
  let roomId: string | null = null;
  let moduleId: string | null = null;
  try {
    const room = await prisma.room.create({
      data: {
        name: "E2E dsh 团本房",
        system: "COC7",
        status: "PLAYING",
        ownerId: user.id,
        inviteCode: "DSHE2E" + Date.now().toString(36).slice(-4).toUpperCase(),
        members: { create: { userId: user.id, role: "KP" } }
      },
      select: { id: true }
    });
    roomId = room.id;
    const module = await prisma.module.create({
      data: {
        roomId: room.id,
        ownerId: user.id,
        title: "E2E dsh 团本",
        system: "COC7",
        era: "MODERN",
        author: USERNAME,
        version: "1.0.0",
        content: {
          format: "markdown",
          text: "# E2E dsh 团本\n\n## 关键NPC\n守夜人老周。\n",
          sections: [],
          structured: {
            npcs: [{ id: "npc-zhou", kind: "npc", title: "老周", data: { name: "老周", attributes: { str: 60, con: 65, siz: 70, dex: 45, app: 50, int: 55, pow: 60, edu: 40, luck: 35 }, maxHp: 13, maxMp: 12 } }],
            clues: [], items: [], scenes: [], chapters: [], encounters: [], magic: [], rewards: [], endings: []
          }
        } as never
      },
      select: { id: true, version: true }
    });
    moduleId = module.id;
    await prisma.systemSetting.upsert({
      where: { key: MODULE_DSH_SETTING_KEY },
      update: { value: { enabled: true, entries: [USERNAME] } as never },
      create: { key: MODULE_DSH_SETTING_KEY, value: { enabled: true, entries: [USERNAME] } as never }
    });

    await page.goto("/login");
    await page.getByLabel("用户名").fill(USERNAME);
    await page.getByLabel("密码").fill(PASSWORD);
    await page.getByRole("button", { name: "登录" }).click();
    await page.waitForURL("**/");

    await page.goto("/rooms/" + room.id + "/modules/" + module.id);
    const ball = page.getByRole("button", { name: "打开 ai团本助手" });
    await expect(ball).toBeVisible();
    await ball.click();

    await expect(page.getByText("ai团本助手", { exact: true })).toBeVisible();
    await page.getByPlaceholder(/描述你想修改的内容/).fill("把标题改成「E2E dsh 团本（已改）」，并给老周补一句背景描述。");
    await page.getByRole("button", { name: "发送", exact: true }).click();

    // 思考过程气泡应在最终回复前出现，让用户看到 ai 在推进。
    await expect(page.locator('[data-role="thinking"]').last()).toBeVisible();

    // dsh 一轮通常 10~60 秒；等待助手气泡出现，再核对数据库版本。
    const assistantBubble = page.locator('[data-role="assistant"]').last();
    await expect(assistantBubble).toBeVisible({ timeout: 180_000 });
    await expect(assistantBubble).not.toHaveText("");
    await expect
      .poll(async () => (await prisma.module.findUnique({ where: { id: module.id }, select: { version: true } }))?.version, { timeout: 30_000 })
      .toBe("1.1.0");
    const updated = await prisma.module.findUnique({ where: { id: module.id }, select: { version: true, title: true } });
    expect(updated?.title).toBe("E2E dsh 团本（已改）");
  } finally {
    if (moduleId !== null) await prisma.module.delete({ where: { id: moduleId } }).catch(() => undefined);
    if (roomId !== null) await prisma.room.delete({ where: { id: roomId } }).catch(() => undefined);
    if (previousSetting === null) {
      await prisma.systemSetting.delete({ where: { key: MODULE_DSH_SETTING_KEY } }).catch(() => undefined);
    } else {
      await prisma.systemSetting.update({ where: { key: MODULE_DSH_SETTING_KEY }, data: { value: previousSetting.value as never } }).catch(() => undefined);
    }
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
  }
});

test("dsh 白名单：管理员在系统设置里配置", async ({ page }) => {
  test.skip(process.env.DSH_E2E !== "1", "需要 DSH_E2E=1");
  const username = "e2edshadmin";
  await prisma.user.deleteMany({ where: { username } });
  const admin = await prisma.user.create({
    data: { username, displayName: username, passwordHash: await bcrypt.hash(PASSWORD, 10), role: "ADMIN" }
  });
  const previousSetting = await prisma.systemSetting.findUnique({ where: { key: MODULE_DSH_SETTING_KEY } });
  try {
    await page.goto("/login");
    await page.getByLabel("用户名").fill(username);
    await page.getByLabel("密码").fill(PASSWORD);
    await page.getByRole("button", { name: "登录" }).click();
    await page.waitForURL("**/");

    await page.goto("/admin/system");
    await expect(page.getByRole("heading", { name: "ai团本助手白名单" })).toBeVisible();
    await page.getByLabel("启用 ai团本助手").check();
    await page.locator('textarea[name="entries"]').fill(username);
    await page.getByRole("button", { name: "保存白名单" }).click();
    await page.waitForURL("**/admin/system?saved=dsh");

    const saved = await prisma.systemSetting.findUnique({ where: { key: MODULE_DSH_SETTING_KEY } });
    const value = saved?.value as { readonly enabled?: boolean; readonly entries?: readonly string[] } | undefined;
    expect(value?.enabled).toBe(true);
    expect(value?.entries ?? []).toContain(username);
  } finally {
    if (previousSetting === null) {
      await prisma.systemSetting.delete({ where: { key: MODULE_DSH_SETTING_KEY } }).catch(() => undefined);
    } else {
      await prisma.systemSetting.update({ where: { key: MODULE_DSH_SETTING_KEY }, data: { value: previousSetting.value as never } }).catch(() => undefined);
    }
    await prisma.user.delete({ where: { id: admin.id } }).catch(() => undefined);
  }
});
