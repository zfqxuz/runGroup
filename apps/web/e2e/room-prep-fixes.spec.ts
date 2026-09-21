import { expect, test } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma } from "../src/server/db/prisma";
import { loadEffectivePack } from "../src/server/rules/loader";
import { createCombatRecord, npcRef } from "../src/server/combat/setup";
import { clearCombatRuntime } from "../src/server/combat/runtime";
import { NpcStatsSchema } from "../src/shared/npc";
import { SpellCardStatsSchema } from "../src/shared/card";

const PASSWORD = "e2epass123";

interface Fixture {
  readonly userId: string;
  readonly roomId: string;
  readonly characterId: string;
}

async function createRoomFixture(username: string): Promise<Fixture> {
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
      name: "准备区修复验证房",
      system: "TOUHOU",
      status: "LOBBY",
      ownerId: user.id,
      inviteCode: "RPF" + Date.now().toString(36).toUpperCase().slice(0, 6),
      ruleOverride: { combat: { mode: "INITIATIVE" } } as never,
      members: { create: { userId: user.id, role: "KP" } }
    },
    select: { id: true }
  });
  const character = await prisma.character.create({
    data: {
      userId: user.id,
      system: "TOUHOU",
      name: "验证角色",
      str: 50, con: 50, siz: 50, dex: 70, app: 50, int: 60, pow: 50, edu: 60, luck: 50,
      hp: 20, maxHp: 20, mp: 20, maxMp: 20, san: 50, maxSan: 50, dp: 20, maxDp: 20,
      skills: { DANMAKU: 80, MAGIC: 80, DODGE: 50, MELEE: 50 }
    }
  });
  await prisma.roomCharacterEntry.create({
    data: { roomId: room.id, characterId: character.id, status: "APPROVED" }
  });
  return { userId: user.id, roomId: room.id, characterId: character.id };
}

async function cleanup(fixture: Fixture): Promise<void> {
  await prisma.room.deleteMany({ where: { ownerId: fixture.userId } });
  await prisma.user.deleteMany({ where: { id: fixture.userId } });
}

async function login(page: import("@playwright/test").Page, username: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("用户名").fill(username);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL("**/");
}

test("准备页可把已通过审核的卡牌装备给已通过角色", async ({ page }) => {
  const username = "e2eprepfixcard";
  const fixture = await createRoomFixture(username);
  try {
    const card = await prisma.card.create({
      data: {
        ownerId: fixture.userId,
        scope: "COMPENDIUM",
        type: "WEAPON",
        name: "验证武器卡",
        system: "TOUHOU",
        stats: {
          damage: "1d6+db",
          range: "MELEE",
          skillId: "MELEE",
          accuracyMod: 0,
          mpCost: 0
        } as never
      }
    });
    await prisma.roomCardEntry.create({
      data: { roomId: fixture.roomId, cardId: card.id, status: "APPROVED" }
    });

    await login(page, username);
    await page.goto("/rooms/" + fixture.roomId + "/prepare");
    await expect(page.getByText("验证武器卡").first()).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "装备" }).first().click();
    await expect
      .poll(async () => {
        const updated = await prisma.card.findUnique({ where: { id: card.id } });
        return updated?.characterId ?? null;
      }, { timeout: 15_000 })
      .toBe(fixture.characterId);
  } finally {
    await cleanup(fixture);
  }
});

test("点击悬浮卡里的直接开战不会把 Token 拖到鼠标位置", async ({ page }) => {
  const username = "e2eprepfixbattle";
  const fixture = await createRoomFixture(username);
  try {
    const scene = await prisma.scene.create({
      data: { roomId: fixture.roomId, name: "验证场景", isActive: true, orderIndex: 0 }
    });
    const map = await prisma.map.create({
      data: {
        sceneId: scene.id,
        name: "验证地图",
        width: 800,
        height: 600,
        gridSize: 70,
        gridType: "SQUARE",
        showGrid: false,
        showFog: false
      }
    });
    const token = await prisma.token.create({
      data: { roomId: fixture.roomId, mapId: map.id, name: "敌方木桩", x: 400, y: 300, size: 1, isVisible: true }
    });

    await login(page, username);
    await page.goto("/rooms/" + fixture.roomId + "/prepare");
    const tokenNode = page.getByTitle("敌方木桩");
    await expect(tokenNode).toBeVisible({ timeout: 20_000 });
    await tokenNode.hover();
    await page.getByRole("link", { name: "直接开战" }).click();
    await page.waitForURL(new RegExp("/rooms/" + fixture.roomId + "/combat/new"), { timeout: 20_000 });
    const after = await prisma.token.findUnique({ where: { id: token.id } });
    expect(after?.x).toBe(400);
    expect(after?.y).toBe(300);
  } finally {
    await cleanup(fixture);
  }
});

test("NPC 自带符卡会出现在战斗操作区并可以释放", async ({ page }) => {
  const username = "e2enpcspellcard";
  const fixture = await createRoomFixture(username);
  let combatId: string | null = null;
  try {
    await prisma.room.update({ where: { id: fixture.roomId }, data: { status: "PLAYING" } });
    const armorStats = SpellCardStatsSchema.parse({
      mode: "DECLARATION",
      danmaku: "NPC 护甲符卡演出",
      mpCost: 0,
      hpRatio: 1,
      durationTicks: 60,
      clearTargets: "ALL",
      enhanceType: "SPELL",
      enhanceValue: 1,
      effects: [],
      targeting: "SELF",
      targetScope: "SELF",
      combat: { mode: "ARMOR", armorRatio: 1 }
    });
    const casterStats = NpcStatsSchema.parse({
      tier: "ELITE",
      rarity: "RARE",
      attributes: { str: 50, con: 60, siz: 55, dex: 90, app: 40, int: 60, pow: 70, edu: 50, luck: 40 },
      skills: { DANMAKU: 80, MAGIC: 80, DODGE: 50 },
      weapons: [],
      maxHp: 20,
      maxMp: 50,
      maxSan: 50,
      maxDp: 0,
      spellcards: [{ cardId: "npc-spellcard-armor", name: "NPC 护甲符卡", stats: armorStats }]
    });
    const dummyStats = NpcStatsSchema.parse({
      tier: "MINION",
      rarity: "COMMON",
      attributes: { str: 20, con: 20, siz: 20, dex: 10, app: 20, int: 20, pow: 20, edu: 20, luck: 20 },
      skills: { DODGE: 10 },
      weapons: [],
      maxHp: 5,
      maxMp: 0,
      maxSan: 10,
      maxDp: 0
    });
    const [caster, dummy] = await Promise.all([
      prisma.card.create({
        data: { scope: "ROOM", roomId: fixture.roomId, ownerId: fixture.userId, type: "NPC", name: "有符卡的 NPC", system: "TOUHOU", stats: casterStats as never }
      }),
      prisma.card.create({
        data: { scope: "ROOM", roomId: fixture.roomId, ownerId: fixture.userId, type: "NPC", name: "木桩", system: "TOUHOU", stats: dummyStats as never }
      })
    ]);

    const effective = await loadEffectivePack({
      id: fixture.roomId,
      system: "TOUHOU",
      rulePackVersionId: null,
      ruleOverride: { combat: { mode: "INITIATIVE" } }
    });
    const created = await createCombatRecord(fixture.roomId, effective, [npcRef(dummy.id)], [npcRef(caster.id)]);
    if (created.ok === false || created.combatId === undefined) throw new Error(created.error ?? "combat create failed");
    combatId = created.combatId;

    await login(page, username);
    await page.goto("/rooms/" + fixture.roomId + "/combat/" + combatId);
    await expect(page.getByText("参战单位").first()).toBeVisible({ timeout: 30_000 });
    const cardSelect = page.locator("select").filter({ hasText: "NPC 护甲符卡" });
    await expect(cardSelect).toBeVisible({ timeout: 20_000 });
    await cardSelect.selectOption({ index: 0 });
    await page.getByRole("button", { name: "释放符卡" }).click();
    await expect(page.getByText(/符卡展开/).first()).toBeVisible({ timeout: 30_000 });
  } finally {
    if (combatId !== null) clearCombatRuntime(combatId);
    await cleanup(fixture);
  }
});
