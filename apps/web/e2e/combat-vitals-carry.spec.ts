import { expect, test } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma } from "../src/server/db/prisma";
import { loadEffectivePack } from "../src/server/rules/loader";
import { characterRef, createCombatRecord, npcRef } from "../src/server/combat/setup";
import { clearCombatRuntime } from "../src/server/combat/runtime";
import { NpcStatsSchema } from "../src/shared/npc";

const USERNAME = "e2ecombatcarry";
const PASSWORD = "e2epass123";

test("战斗结束后房间看板保留战斗中的 HP", async ({ page }) => {
  await prisma.user.deleteMany({ where: { username: USERNAME } });
  const user = await prisma.user.create({
    data: { username: USERNAME, displayName: USERNAME, passwordHash: await bcrypt.hash(PASSWORD, 10), role: "USER" }
  });
  let roomId: string | null = null;
  let combatId: string | null = null;
  try {
    const room = await prisma.room.create({
      data: {
        name: "E2E 战斗数值继承房",
        system: "COC7",
        status: "PLAYING",
        ownerId: user.id,
        inviteCode: "CARRY" + Date.now().toString(36).toUpperCase().slice(0, 6),
        members: { create: { userId: user.id, role: "KP" } }
      },
      select: { id: true, system: true, rulePackVersionId: true, ruleOverride: true }
    });
    roomId = room.id;
    const character = await prisma.character.create({
      data: {
        userId: user.id, system: "COC7", name: "E2E 带伤调查员",
        str: 50, con: 50, siz: 50, dex: 50, app: 50, int: 50, pow: 50, edu: 50, luck: 50,
        hp: 12, maxHp: 12, mp: 10, maxMp: 10, san: 50, maxSan: 50, dp: 0, maxDp: 0, skills: {}
      }
    });
    await prisma.roomCharacterEntry.create({ data: { roomId: room.id, characterId: character.id, status: "APPROVED" } });
    const game = await prisma.game.create({
      data: { roomId: room.id, status: "PLAYING", title: "E2E 带伤局", createdBy: user.id },
      select: { id: true }
    });
    await prisma.gameState.create({ data: { gameId: game.id, flags: {} as never, counters: {} as never, custom: {} as never } });
    const startHp = 5;
    await prisma.gameCharacter.create({
      data: { gameId: game.id, characterId: character.id, userId: user.id, currentHp: startHp, currentMp: 4, currentSan: 40, currentDp: 0, conditions: [] as never }
    });
    const npc = await prisma.card.create({
      data: {
        scope: "ROOM", roomId: room.id, ownerId: user.id, type: "NPC", name: "E2E 木桩", system: "COC7",
        stats: NpcStatsSchema.parse({
          attributes: { str: 10, con: 10, siz: 10, dex: 10, app: 10, int: 10, pow: 10, edu: 10, luck: 10 },
          skills: {}, maxHp: 30, maxMp: 0, maxSan: 30, maxDp: 0
        }) as never
      }
    });
    const effective = await loadEffectivePack({
      id: room.id,
      system: room.system,
      rulePackVersionId: room.rulePackVersionId,
      ruleOverride: room.ruleOverride
    });
    const created = await createCombatRecord(room.id, effective, [characterRef(character.id)], [npcRef(npc.id)]);
    expect(created.ok).toBe(true);
    if (created.combatId === undefined) throw new Error(created.error);
    combatId = created.combatId;

    await page.goto("/login");
    await page.getByLabel("用户名").fill(USERNAME);
    await page.getByLabel("密码").fill(PASSWORD);
    await page.getByRole("button", { name: "登录" }).click();
    await page.waitForURL("**/");

    await page.goto("/rooms/" + room.id + "/combat/" + combatId);
    page.on("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "中止战斗" }).click();
    await page.waitForURL("**/rooms/" + room.id + "**", { timeout: 30_000 });

    const hpCard = page.getByText("HP", { exact: true }).locator("xpath=ancestor::div[contains(@class,'rounded-lg')][1]");
    await expect(hpCard.getByText(String(startHp), { exact: true })).toBeVisible();
  } finally {
    if (combatId !== null) clearCombatRuntime(combatId);
    if (roomId !== null) await prisma.room.delete({ where: { id: roomId } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
  }
});
