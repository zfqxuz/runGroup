import { expect, test } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma } from "../src/server/db/prisma";

const USERNAME = "e2esummonui";
const PASSWORD = "e2epass123";
const NPC_ID = "cmzzzzzzzzzzzzzzzzzzzzzzz";

test("召唤效果绑定 NPC 卡：只展示名称，隐藏 cardId", async ({ page }) => {
  await prisma.user.deleteMany({ where: { username: USERNAME } });
  const user = await prisma.user.create({
    data: { username: USERNAME, displayName: USERNAME, passwordHash: await bcrypt.hash(PASSWORD, 10), role: "USER" }
  });
  const room = await prisma.room.create({
    data: {
      name: "E2E 召唤绑定房",
      system: "COC7",
      ownerId: user.id,
      inviteCode: "SUMMON" + Date.now().toString(36).toUpperCase().slice(0, 6),
      members: { create: { userId: user.id, role: "KP" } }
    },
    select: { id: true }
  });
  await prisma.card.create({
    data: {
      id: NPC_ID,
      scope: "ROOM",
      roomId: room.id,
      ownerId: user.id,
      type: "NPC",
      name: "E2E 召唤 NPC",
      stats: { attributes: {}, maxHp: 10 } as never,
      isPublic: true
    }
  });

  try {
    await page.goto("/login");
    await page.getByLabel("用户名").fill(USERNAME);
    await page.getByLabel("密码").fill(PASSWORD);
    await page.getByRole("button", { name: "登录" }).click();
    await page.waitForURL("**/");

    await page.goto("/rooms/" + room.id + "/cards/new");
    await page.getByRole("button", { name: "道具卡" }).click();

    const effectTypeSelect = page.locator("select").filter({ has: page.locator('option[value="SUMMON"]') }).first();
    await effectTypeSelect.selectOption("SUMMON");
    await page.getByRole("button", { name: "+ 添加效果" }).click();

    const npcSelect = page.locator("select").filter({ has: page.locator('option[value="' + NPC_ID + '"]') });
    await expect(npcSelect).toHaveValue("");
    await expect(npcSelect.locator('option[value=""]')).toHaveText("不绑定，按名字匹配");
    await expect(npcSelect.locator('option[value="' + NPC_ID + '"]')).toHaveText("E2E 召唤 NPC");
    const optionText = await npcSelect.locator('option[value="' + NPC_ID + '"]').textContent();
    expect(optionText ?? "").not.toContain(NPC_ID);

    await npcSelect.selectOption(NPC_ID);
    const value = await page.locator('input[name="card-effects"]').inputValue();
    expect(value).toContain('"type":"SUMMON"');
    expect(value).toContain('"cardId":"' + NPC_ID + '"');
    expect(value).toContain('"name":"E2E 召唤 NPC"');
  } finally {
    await prisma.card.deleteMany({ where: { roomId: room.id } }).catch(() => undefined);
    await prisma.room.delete({ where: { id: room.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
  }
});
