import { expect, test } from "@playwright/test";
import bcrypt from "bcryptjs";
import { prisma } from "../src/server/db/prisma";
import { loadEffectivePack } from "../src/server/rules/loader";
import { characterRef, createCombatRecord, npcRef } from "../src/server/combat/setup";
import { clearCombatRuntime } from "../src/server/combat/runtime";
import { NpcStatsSchema } from "../src/shared/npc";

const PASSWORD = "e2epass123";

interface Fixture {
  readonly userId: string;
  readonly roomId: string;
  readonly combatId: string;
  readonly npcId: string;
}

async function createFixture(username: string, mode: "INITIATIVE" | "DP"): Promise<Fixture> {
  await prisma.user.deleteMany({ where: { username } });
  const user = await prisma.user.create({
    data: { username, displayName: username, passwordHash: await bcrypt.hash(PASSWORD, 10), role: "USER" }
  });
  const room = await prisma.room.create({
    data: {
      name: "E2E 东方双模式房 " + mode,
      system: "TOUHOU",
      status: "PLAYING",
      ownerId: user.id,
      inviteCode: "TDM" + Date.now().toString(36).toUpperCase().slice(0, 6),
      ruleOverride: { combat: { mode } } as never,
      members: { create: { userId: user.id, role: "KP" } }
    },
    select: { id: true, system: true, rulePackVersionId: true, ruleOverride: true }
  });
  const character = await prisma.character.create({
    data: {
      userId: user.id, system: "TOUHOU", name: "E2E 东方角色",
      str: 50, con: 50, siz: 50, dex: 70, app: 50, int: 60, pow: 50, edu: 60, luck: 50,
      hp: 20, maxHp: 20, mp: 20, maxMp: 20, san: 50, maxSan: 50, dp: 20, maxDp: 20,
      skills: { FIREARMS_HANDGUN: 90, DANMAKU: 90, DODGE: 50, MELEE: 50 }
    }
  });
  await prisma.roomCharacterEntry.create({ data: { roomId: room.id, characterId: character.id, status: "APPROVED" } });

  await prisma.card.create({
    data: {
      characterId: character.id, ownerId: user.id, scope: "COMPENDIUM", type: "SPELLCARD", system: "TOUHOU",
      name: "测试符卡·武器", isEquipped: true,
      stats: {
        mode: "CONSUMPTION", danmaku: "e2e weapon", mpCost: 0, hpRatio: null, durationTicks: null,
        clearTargets: null, enhanceType: "DANMAKU", enhanceValue: 1,
        combat: { mode: "WEAPON", skillId: "FIREARMS_HANDGUN", damage: "10", range: "NEAR" }
      } as never
    }
  });
  await prisma.card.create({
    data: {
      characterId: character.id, ownerId: user.id, scope: "COMPENDIUM", type: "SPELLCARD", system: "TOUHOU",
      name: "测试符卡·护甲", isEquipped: true,
      stats: {
        mode: "DECLARATION", danmaku: "e2e armor", mpCost: 0, hpRatio: 1, durationTicks: 100,
        clearTargets: "ALL", enhanceType: "DANMAKU", enhanceValue: 1,
        combat: { mode: "ARMOR", armorRatio: 1 }
      } as never
    }
  });

  const npc = await prisma.card.create({
    data: {
      scope: "ROOM", roomId: room.id, ownerId: user.id, type: "NPC", name: "E2E 东方木桩", system: "TOUHOU",
      stats: NpcStatsSchema.parse({
        attributes: { str: 10, con: 10, siz: 10, dex: 5, app: 10, int: 10, pow: 10, edu: 10, luck: 10 },
        skills: { FIREARMS_HANDGUN: 90 },
        weapons: [{ name: "测试木桩武器", damage: "40", range: "NEAR", skillId: "FIREARMS_HANDGUN" }],
        maxHp: 60, maxMp: 0, maxSan: 30, maxDp: 0
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
  if (created.ok === false || created.combatId === undefined) throw new Error(created.error ?? "combat create failed");
  return { userId: user.id, roomId: room.id, combatId: created.combatId, npcId: npc.id };
}

async function cleanup(fixture: Fixture): Promise<void> {
  clearCombatRuntime(fixture.combatId);
  await prisma.room.delete({ where: { id: fixture.roomId } }).catch(() => undefined);
  await prisma.user.delete({ where: { id: fixture.userId } }).catch(() => undefined);
}

async function loginAndOpenCombat(page: import("@playwright/test").Page, username: string, fixture: Fixture): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("用户名").fill(username);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL("**/");
  await page.goto("/rooms/" + fixture.roomId + "/combat/" + fixture.combatId);
  await expect(page.getByText("参战单位").first()).toBeVisible({ timeout: 30_000 });
}

test("标准 CoC7 模式：符卡作为武器，通过页面点击打出 d100 攻击", async ({ page }) => {
  const username = "e2etdmweapon";
  const fixture = await createFixture(username, "INITIATIVE");
  try {
    await loginAndOpenCombat(page, username, fixture);
    await expect(page.getByText("DP 宣言", { exact: false })).toHaveCount(0);

    const weaponCardSelect = page.locator("select").filter({ hasText: "测试符卡·武器" });
    await expect(weaponCardSelect).toBeVisible({ timeout: 20_000 });
    await weaponCardSelect.selectOption({ index: 0 });
    await page.getByRole("button", { name: "释放符卡" }).click();
    await expect(page.getByText(/伤害结算/).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/符卡武器/).first()).toBeVisible({ timeout: 30_000 });
  } finally {
    await cleanup(fixture);
  }
});

test("标准 CoC7 模式：持续型符卡通过页面点击展开为护甲", async ({ page }) => {
  const username = "e2etdmarmor";
  const fixture = await createFixture(username, "INITIATIVE");
  try {
    await loginAndOpenCombat(page, username, fixture);
    const armorCardSelect = page.locator("select").filter({ hasText: "测试符卡·护甲" });
    await expect(armorCardSelect).toBeVisible({ timeout: 20_000 });
    await armorCardSelect.selectOption({ index: 1 });
    await page.getByRole("button", { name: "释放符卡" }).click();
    await expect(page.getByText(/符卡展开/).first()).toBeVisible({ timeout: 30_000 });
  } finally {
    await cleanup(fixture);
  }
});
