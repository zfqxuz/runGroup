import { expect, test, type Page } from "@playwright/test";
import bcrypt from "bcryptjs";
import { rollPercentile } from "@touhou/formula";
import { nextRollRng, type CombatState } from "@touhou/combat";
import { makeCondition, type GameCondition } from "@touhou/rules";
import { prisma } from "../src/server/db/prisma";
import { loadEffectivePack } from "../src/server/rules/loader";
import { createCombatRecord, npcRef, saveCombatState } from "../src/server/combat/setup";
import { clearCombatRuntime, loadCombatRuntime } from "../src/server/combat/runtime";

const PASSWORD = "e2epass123";

async function createUser(username: string) {
  const stale = await prisma.user.findUnique({ where: { username }, select: { id: true } });
  if (stale !== null) {
    await prisma.room.deleteMany({ where: { ownerId: stale.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: stale.id } }).catch(() => undefined);
  }
  return prisma.user.create({
    data: {
      username,
      displayName: username,
      passwordHash: await bcrypt.hash(PASSWORD, 10),
      role: "USER"
    }
  });
}

async function login(page: Page, username: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("用户名").fill(username);
  await page.getByLabel("密码").fill(PASSWORD);
  await page.getByRole("button", { name: "登录" }).click();
  await page.waitForURL("**/");
}

interface NpcWeaponInput {
  readonly name: string;
  readonly damage?: string;
  readonly range?: string;
  readonly skillId?: string;
  readonly damageType?: string;
  readonly damageBands?: readonly { readonly label: string; readonly expression: string; readonly maxFeet: number | "DEX" | null }[];
  readonly shots?: readonly number[];
  readonly attacks?: number;
}

interface NpcStatsInput {
  readonly skills?: Readonly<Record<string, number>>;
  readonly weapons?: readonly NpcWeaponInput[];
  readonly attributes?: Partial<Record<"str" | "con" | "siz" | "dex" | "app" | "int" | "pow" | "edu" | "luck", number>>;
  readonly maxHp?: number;
  readonly maxMp?: number;
  readonly maxSan?: number;
  readonly spells?: readonly string[];
}

function npcStats(input: NpcStatsInput): Record<string, unknown> {
  const attributes = {
    str: 50, con: 50, siz: 50, dex: 50, app: 50, int: 50, pow: 50, edu: 50, luck: 50,
    ...(input.attributes ?? {})
  };
  return {
    presetId: null,
    tier: "STANDARD",
    race: null,
    attributes,
    skills: { ...(input.skills ?? {}) },
    weapons: (input.weapons ?? []).map((weapon) => ({ ...weapon })),
    armor: "0",
    spells: [...(input.spells ?? [])],
    maxHp: input.maxHp ?? 20,
    maxMp: input.maxMp ?? 10,
    maxSan: input.maxSan ?? 0,
    maxDp: 0,
    tags: [],
    rarity: "COMMON"
  };
}

interface CombatSeedRolls {
  readonly attack: number;
  readonly defense: number;
}

function simulateFirstAttack(
  seed: string,
  actorId: string,
  attackBonus = 0,
  attackPenalty = 0,
  defenseBonus = 0,
  defensePenalty = 0
): CombatSeedRolls {
  const state = { seed, rollSeq: 0 } as unknown as CombatState;
  const rng = nextRollRng(state, "attack:" + actorId);
  const attack = rollPercentile(rng, attackBonus, attackPenalty);
  const defense = rollPercentile(rng, defenseBonus, defensePenalty);
  return { attack: attack.roll, defense: defense.roll };
}

function findCombatSeed(
  actorId: string,
  predicate: (rolls: CombatSeedRolls) => boolean,
  options?: { readonly attackBonus?: number; readonly attackPenalty?: number; readonly defenseBonus?: number; readonly defensePenalty?: number }
): string {
  for (let index = 0; index < 200000; index += 1) {
    const seed = "e2e-seed-" + String(index);
    const rolls = simulateFirstAttack(
      seed,
      actorId,
      options?.attackBonus ?? 0,
      options?.attackPenalty ?? 0,
      options?.defenseBonus ?? 0,
      options?.defensePenalty ?? 0
    );
    if (predicate(rolls)) return seed;
  }
  throw new Error("未找到满足条件的确定性战斗种子");
}

interface CombatFixtureInput {
  readonly testName: string;
  readonly attacker: {
    readonly name?: string;
    readonly stats: NpcStatsInput;
    readonly x?: number;
    readonly conditions?: readonly GameCondition[];
  };
  readonly defender: {
    readonly name?: string;
    readonly stats: NpcStatsInput;
    readonly x?: number;
    readonly conditions?: readonly GameCondition[];
  };
  readonly extraAttackers?: readonly {
    readonly name?: string;
    readonly stats: NpcStatsInput;
    readonly x?: number;
  }[];
  readonly extraDefenders?: readonly {
    readonly name?: string;
    readonly stats: NpcStatsInput;
    readonly x?: number;
  }[];
  readonly ruleOverride?: Record<string, unknown>;
  readonly magicEnabled?: boolean;
  readonly seedPredicate?: (rolls: CombatSeedRolls) => boolean;
  readonly seedOptions?: { readonly attackBonus?: number; readonly attackPenalty?: number; readonly defenseBonus?: number; readonly defensePenalty?: number };
}

interface CombatFixtureResult {
  readonly username: string;
  readonly userId: string;
  readonly roomId: string;
  readonly combatId: string;
  readonly attackerId: string;
  readonly defenderId: string;
  readonly extraIds: readonly string[];
  readonly extraDefenderIds: readonly string[];
  readonly seed: string;
}

async function createCombatFixture(input: CombatFixtureInput): Promise<CombatFixtureResult> {
  const username = "e2e" + input.testName.replace(/[^a-z0-9]/gi, "").slice(0, 14).toLowerCase();
  const user = await createUser(username);
  const room = await prisma.room.create({
    data: {
      name: "E2E-COC7 " + input.testName,
      system: "COC7",
      ownerId: user.id,
      inviteCode: "e2e-coc7-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8),
      status: "PLAYING",
      magicEnabled: input.magicEnabled === true,
      chargenMethod: "manual",
      era: "MODERN",
      ruleOverride: (input.ruleOverride ?? {}) as never
    }
  });
  await prisma.roomMember.create({ data: { roomId: room.id, userId: user.id, role: "KP" } });
  const scene = await prisma.scene.create({ data: { roomId: room.id, name: input.testName + " 场景", isActive: true } });
  const map = await prisma.map.create({
    data: { sceneId: scene.id, name: input.testName + " 地图", width: 2000, height: 1200, gridSize: 70, gridType: "SQUARE" }
  });
  async function makeNpc(label: string, stats: NpcStatsInput, x: number) {
    const card = await prisma.card.create({
      data: {
        roomId: room.id,
        scope: "ROOM",
        type: "NPC",
        system: "COC7",
        name: label,
        stats: npcStats(stats) as never
      }
    });
    await prisma.token.create({
      data: { roomId: room.id, mapId: map.id, cardId: card.id, name: card.name, x, y: 200 }
    });
    return card;
  }
  const attacker = await makeNpc(input.attacker.name ?? "E2E 攻击者", input.attacker.stats, input.attacker.x ?? 100);
  const defender = await makeNpc(input.defender.name ?? "E2E 防御者", input.defender.stats, input.defender.x ?? 590);
  const extras = [];
  for (let index = 0; index < (input.extraAttackers ?? []).length; index += 1) {
    const extra = input.extraAttackers![index]!;
    extras.push(await makeNpc(extra.name ?? "E2E 额外攻击者" + String(index + 1), extra.stats, extra.x ?? 300 + index * 100));
  }
  const extraDefenders = [];
  for (let index = 0; index < (input.extraDefenders ?? []).length; index += 1) {
    const extra = input.extraDefenders![index]!;
    extraDefenders.push(await makeNpc(extra.name ?? "E2E 额外防御者" + String(index + 1), extra.stats, extra.x ?? 800 + index * 100));
  }
  const effective = await loadEffectivePack({
    id: room.id,
    system: room.system,
    rulePackVersionId: room.rulePackVersionId,
    ruleOverride: room.ruleOverride
  });
  const created = await createCombatRecord(
    room.id,
    effective,
    [npcRef(attacker.id), ...extras.map((extra) => npcRef(extra.id))],
    [npcRef(defender.id), ...extraDefenders.map((extra) => npcRef(extra.id))]
  );
  if (created.ok === false || created.combatId === undefined) {
    throw new Error("创建战斗失败：" + String(created.error));
  }
  const combatId = created.combatId;
  const runtime = await loadCombatRuntime(combatId);
  if (runtime === null) throw new Error("加载战斗运行时失败");
  const mutable = runtime.state as unknown as {
    seed: string;
    rollSeq: number;
    initiativeOrder: string[];
    activeIndex: number;
    phase: string;
  };
  let seed = "e2e-seed-0";
  if (input.seedPredicate !== undefined) {
    seed = findCombatSeed(attacker.id, input.seedPredicate, input.seedOptions);
  }
  mutable.seed = seed;
  mutable.rollSeq = 0;
  mutable.initiativeOrder = [attacker.id, defender.id, ...extraDefenders.map((extra) => extra.id), ...extras.map((extra) => extra.id)];
  mutable.activeIndex = 0;
  mutable.phase = "AWAITING_ACTION";
  for (const participant of runtime.state.participants) {
    participant.isReady = participant.id === attacker.id;
    participant.reactionsThisRound = 0;
    participant.hp = participant.maxHp;
    participant.mp = participant.maxMp;
    participant.san = participant.maxSan;
    participant.defeated = false;
    participant.dead = false;
    participant.unconscious = false;
    participant.dying = false;
  }
  const attackerParticipant = runtime.state.participants.find((participant) => participant.id === attacker.id);
  if (attackerParticipant !== undefined && input.attacker.conditions !== undefined) {
    attackerParticipant.conditions = [...input.attacker.conditions];
  }
  const defenderParticipant = runtime.state.participants.find((participant) => participant.id === defender.id);
  if (defenderParticipant !== undefined && input.defender.conditions !== undefined) {
    defenderParticipant.conditions = [...input.defender.conditions];
  }
  await saveCombatState(combatId, runtime.state);
  clearCombatRuntime(combatId);
  return {
    username,
    userId: user.id,
    roomId: room.id,
    combatId,
    attackerId: attacker.id,
    defenderId: defender.id,
    extraIds: extras.map((extra) => extra.id),
    extraDefenderIds: extraDefenders.map((extra) => extra.id),
    seed
  };
}

async function openCombat(page: Page, roomId: string, combatId: string): Promise<void> {
  await page.goto("/rooms/" + roomId + "/combat/" + combatId);
  await expect(page.getByRole("button", { name: "攻击", exact: true })).toBeVisible({ timeout: 30_000 });
}

async function clickAttack(page: Page): Promise<void> {
  await page.getByRole("button", { name: "攻击", exact: true }).click();
}

async function selectAttackSkill(page: Page, skillId: string): Promise<void> {
  const select = page.locator("select").filter({ has: page.locator('option[value="' + skillId + '"]') }).first();
  await expect(select).toBeVisible({ timeout: 15_000 });
  await select.selectOption(skillId);
}

async function selectAttackTarget(page: Page, targetId: string): Promise<void> {
  const select = page.locator("select").filter({ has: page.locator('option[value="' + targetId + '"]') }).first();
  await expect(select).toBeVisible({ timeout: 15_000 });
  await select.selectOption(targetId);
}

async function chooseReaction(page: Page, label: "不应对" | "闪避" | "反击" | "寻找掩体"): Promise<void> {
  const panel = page.locator("section").filter({ hasText: "你需要应对" }).first();
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await panel.locator("select").first().selectOption({ label });
  await panel.getByRole("button", { name: "提交应对" }).click();
}

async function latestCombatState(combatId: string): Promise<{
  readonly log: Array<{ readonly text: string; readonly data?: Record<string, unknown> }>;
  readonly participants: Array<{ readonly id: string; readonly hp: number; readonly prone?: boolean; readonly grappledBy?: string | null; readonly disarmed?: boolean; readonly initiativeMod?: number }>;
}> {
  const snapshot = await prisma.combatSnapshot.findFirst({ where: { combatId }, orderBy: { seq: "desc" } });
  if (snapshot === null) throw new Error("战斗快照不存在");
  return snapshot.state as never;
}

async function cleanupCombatFixture(fixture: CombatFixtureResult): Promise<void> {
  clearCombatRuntime(fixture.combatId);
  await prisma.room.delete({ where: { id: fixture.roomId } }).catch(() => undefined);
  await prisma.character.deleteMany({ where: { userId: fixture.userId } }).catch(() => undefined);
  await prisma.user.delete({ where: { id: fixture.userId } }).catch(() => undefined);
}

test.describe.serial("COC7 合规浏览器端到端", () => {
  test("C-1/I-3/D-6 入门版固定建卡页：固定数组、九值分配、信用评级 40、半值显示", async ({ page }) => {
    const username = "e2ecoc7chargen";
    const user = await createUser(username);
    let roomId: string | null = null;
    try {
      const room = await prisma.room.create({
        data: {
          name: "E2E-COC7 入门版建卡",
          system: "COC7",
          ownerId: user.id,
          inviteCode: "e2e-coc7-chargen-" + Date.now().toString(36),
          status: "PLAYING",
          chargenMethod: "starter-quickstart",
          era: "MODERN"
        }
      });
      roomId = room.id;
      await prisma.roomMember.create({
        data: { roomId: room.id, userId: user.id, role: "KP" }
      });

      await login(page, username);
      await page.goto("/rooms/" + room.id + "/characters/new");
      await expect(page.getByText("入门版固定技能分配")).toBeVisible({ timeout: 30_000 });

      await page.getByLabel("角色名").fill("浏览器·苏珊");
      await page.getByLabel("性别").fill("女");
      await page.getByRole("button", { name: "按顺序填入固定数组" }).click();

      const starter = page.locator("section").filter({ hasText: "入门版固定技能分配" }).first();
      const skillNames = [
        "格斗（斗殴）",
        "闪避",
        "侦查",
        "聆听",
        "潜行",
        "图书馆使用",
        "心理学",
        "母语"
      ];
      const values = ["70", "60", "60", "50", "50", "50", "40", "40"];
      const selects = starter.locator("select");
      const numbers = starter.locator('input[type="number"]');
      for (let index = 0; index < skillNames.length; index += 1) {
        await selects.nth(index).selectOption({ label: skillNames[index]! });
        await numbers.nth(index).fill(values[index]!);
      }
      await numbers.nth(8).fill("40"); // 信用评级

      const interestNames = ["汽车驾驶", "魅惑", "历史", "法律"];
      for (let index = 0; index < interestNames.length; index += 1) {
        await selects.nth(8 + index).selectOption({ label: interestNames[index]! });
      }

      // D-6：属性块应显示困难值与极限值
      await expect(page.getByText(/困难\s+\d+/).first()).toBeVisible();
      await expect(page.getByText(/极限\s+\d+/).first()).toBeVisible();

      await page.getByRole("button", { name: "下一步" }).click();
      await expect(page.getByText("人物故事 / 财产 / 持有物")).toBeVisible();
      await page.getByRole("button", { name: "提交给 KP 审核" }).click();
      await page.waitForURL((url) => url.pathname === "/rooms/" + roomId, { timeout: 60_000 });

      const character = await prisma.character.findFirstOrThrow({
        where: { userId: user.id, name: "浏览器·苏珊" }
      });
      expect(character.str).toBe(40);
      expect(character.con).toBe(50);
      expect(character.siz).toBe(50);
      expect(character.dex).toBe(50);
      expect(character.app).toBe(60);
      expect(character.int).toBe(60);
      expect(character.pow).toBe(70);
      expect(character.edu).toBe(80);
      const skills = character.skills as Record<string, number>;
      expect(skills.FIGHTING_BRAWL).toBe(70);
      expect(skills.DODGE).toBe(60);
      expect(skills.SPOT_HIDDEN).toBe(60);
      expect(skills.CREDIT_RATING).toBe(40);
      expect(skills.DRIVE_AUTO).toBe(40);
      expect(skills.CTHULHU_MYTHOS ?? 0).toBe(0);
      await page.goto("/characters/" + character.id);
      await expect(page.getByText("普通", { exact: false }).first()).toBeVisible({ timeout: 15_000 });
    } finally {
      if (roomId !== null) await prisma.room.delete({ where: { id: roomId } }).catch(() => undefined);
      await prisma.character.deleteMany({ where: { userId: user.id } }).catch(() => undefined);
      await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    }
  });

  test("I-1/G-1/D-3 跑团页：技能难度检定入成长池、SAN 检定扣减、疯狂发作写入状态", async ({ page }) => {
    const username = "e2ecoc7room";
    const user = await createUser(username);
    let roomId: string | null = null;
    try {
      const room = await prisma.room.create({
        data: {
          name: "E2E-COC7 跑团检定",
          system: "COC7",
          ownerId: user.id,
          inviteCode: "e2e-coc7-room-" + Date.now().toString(36),
          status: "PLAYING",
          chargenMethod: "manual",
          era: "MODERN"
        }
      });
      roomId = room.id;
      const character = await prisma.character.create({
        data: {
          userId: user.id,
          roomId: room.id,
          system: "COC7",
          reviewStatus: "APPROVED",
          name: "E2E·检定者",
          occupation: null,
          era: "MODERN",
          age: 30,
          str: 50, con: 50, siz: 50, dex: 50, app: 50, int: 50, pow: 50, edu: 50, luck: 50,
          hp: 10, maxHp: 10, mp: 10, maxMp: 10, san: 50, maxSan: 99, dp: 0, maxDp: 0,
          skills: { FIGHTING_BRAWL: 200, DODGE: 200 } as never
        }
      });
      await prisma.roomMember.create({
        data: { roomId: room.id, userId: user.id, role: "PLAYER", activeCharacterId: character.id, ready: true }
      });
      await prisma.roomCharacterEntry.create({
        data: { roomId: room.id, characterId: character.id, status: "APPROVED" }
      });
      const game = await prisma.game.create({
        data: { roomId: room.id, title: "E2E 检定局", status: "PLAYING", createdBy: user.id }
      });
      await prisma.gameState.create({ data: { gameId: game.id, flags: {} as never, counters: {} as never, custom: {} as never } });
      await prisma.gameCharacter.create({
        data: {
          gameId: game.id,
          characterId: character.id,
          userId: user.id,
          status: "ALIVE",
          currentHp: 10,
          currentMp: 10,
          currentSan: 50,
          currentDp: 0,
          conditions: [] as never
        }
      });

      await login(page, username);
      await page.goto("/rooms/" + room.id);
      await expect(page.getByPlaceholder("说点什么（回车发送）")).toBeVisible({ timeout: 30_000 });

      // G-2：成长面板必须显示房间实际生效的 96–100 成长规则。
      await expect(page.getByTestId("growth-rule-badge")).toContainText("完整版", { timeout: 20_000 });

      // 技能检定：默认已选中角色最高技能，改为困难后掷骰；成功应写入成长池。
      await page.locator("select").filter({ hasText: "技能检定" }).selectOption("CHECK");
      await page.locator('select[title="检定难度"]').selectOption("HARD");
      await page.locator('select[title="奖励骰"]').selectOption("1");
      await expect(page.getByRole("button", { name: "检定 格斗（斗殴）" })).toBeEnabled();
      await page.getByRole("button", { name: "检定 格斗（斗殴）" }).click();

      await expect
        .poll(async () => prisma.growthCheck.count({ where: { gameId: game.id, characterId: character.id, skillId: "FIGHTING_BRAWL" } }), {
          timeout: 20_000
        })
        .toBe(1);
      const skillRoll = await prisma.diceRoll.findFirst({
        where: { roomId: room.id, userId: user.id },
        orderBy: { id: "desc" }
      });
      const skillResults = skillRoll?.results as { bonusDice?: number; difficulty?: string } | null;
      expect(skillResults?.bonusDice).toBe(1);
      expect(skillResults?.difficulty).toBe("HARD");

      // SAN 检定：成功/失败都损失 1，currentSan 应从 50 → 49。
      await page.locator("select").filter({ hasText: "理智检定" }).selectOption("SANITY");
      await page.getByLabel("成功损失").fill("1");
      await page.getByLabel("失败损失").fill("1");
      await page.getByRole("button", { name: "理智检定" }).click();
      await expect
        .poll(async () => (await prisma.gameCharacter.findUniqueOrThrow({ where: { gameId_characterId: { gameId: game.id, characterId: character.id } } })).currentSan, { timeout: 20_000 })
        .toBe(49);

      // 疯狂发作：写入 INSANITY 条件。
      await page.getByRole("button", { name: "疯狂发作 1D10" }).click();
      await expect
        .poll(async () => {
          const row = await prisma.gameCharacter.findUniqueOrThrow({ where: { gameId_characterId: { gameId: game.id, characterId: character.id } } });
          const conditions = row.conditions as Array<{ type?: string }>;
          return conditions.some((condition) => condition.type === "INSANITY");
        }, { timeout: 20_000 })
        .toBe(true);

      // D-3：现实检定——把 SAN 压到 0 保证失败，失败写入 HALLUCINATION。
      await prisma.gameCharacter.update({
        where: { gameId_characterId: { gameId: game.id, characterId: character.id } },
        data: { currentSan: 0 }
      });
      await page.getByRole("button", { name: "现实检定" }).click();
      await expect(page.getByText(/【现实检定】/).first()).toBeVisible({ timeout: 20_000 });
      await expect
        .poll(async () => {
          const row = await prisma.gameCharacter.findUniqueOrThrow({
            where: { gameId_characterId: { gameId: game.id, characterId: character.id } }
          });
          const conditions = row.conditions as Array<{ type?: string }>;
          return conditions.some((condition) => condition.type === "HALLUCINATION");
        }, { timeout: 20_000 })
        .toBe(true);

      // D-3：疯狂发作表 9/10 会把新恐惧症/躁狂症写入角色背景（真实浏览器反复点击触发随机表）。
      let backgroundEntry: string | null = null;
      for (let attempt = 0; attempt < 40 && (backgroundEntry ?? "").length === 0; attempt += 1) {
        await page.getByRole("button", { name: "疯狂发作 1D10" }).click();
        await page.waitForTimeout(220);
        const row = await prisma.character.findUniqueOrThrow({
          where: { id: character.id },
          select: { backstory: true }
        });
        const backstory = (row.backstory ?? {}) as Record<string, unknown>;
        backgroundEntry = typeof backstory.phobias === "string" ? backstory.phobias : null;
      }
      expect((backgroundEntry ?? "").length).toBeGreaterThan(0);
      await expect(page.getByText(/已写入角色背景/).first()).toBeVisible({ timeout: 20_000 });
    } finally {
      if (roomId !== null) await prisma.room.delete({ where: { id: roomId } }).catch(() => undefined);
      await prisma.character.deleteMany({ where: { userId: user.id } }).catch(() => undefined);
      await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    }
  });

  test("F-1 闪避成功等级低于攻击时仍应命中", async ({ page }) => {
    const fixture = await createCombatFixture({
      testName: "F1 dodge rank",
      attacker: { stats: { skills: { FIGHTING_BRAWL: 999 } } },
      defender: { stats: { skills: { FIGHTING_BRAWL: 999, DODGE: 40 } } },
      seedPredicate: (rolls) => rolls.attack <= 100 && rolls.defense >= 21 && rolls.defense <= 40
    });
    try {
      await login(page, fixture.username);
      await openCombat(page, fixture.roomId, fixture.combatId);
      await clickAttack(page);
      await chooseReaction(page, "闪避");
      await expect
        .poll(async () => {
          const state = await latestCombatState(fixture.combatId);
          return state.log.some((entry) => entry.data?.rollType === "DODGE") &&
            state.log.some((entry) => entry.data?.rollType === "DAMAGE_SETTLE");
        }, { timeout: 20_000 })
        .toBe(true);
      const state = await latestCombatState(fixture.combatId);
      const dodge = state.log.find((entry) => entry.data?.rollType === "DODGE");
      const defender = state.participants.find((item) => item.id === fixture.defenderId);
      expect(dodge?.data?.result).toBe("REGULAR");
      expect(dodge?.data?.success).toBe(false);
      expect(defender?.hp ?? 20).toBeLessThan(20);
    } finally {
      await cleanupCombatFixture(fixture);
    }
  });

  test("F-2 反击同级不造成伤害，反击成功才向攻击者结算伤害", async ({ page }) => {
    const equal = await createCombatFixture({
      testName: "F2 counter equal",
      attacker: { stats: { skills: { FIGHTING_BRAWL: 999 } } },
      defender: { stats: { skills: { FIGHTING_BRAWL: 999 } } }
    });
    const win = await createCombatFixture({
      testName: "F2 counter win",
      attacker: { stats: { skills: { FIGHTING_BRAWL: 50 } } },
      defender: { stats: { skills: { FIGHTING_BRAWL: 999 } } },
      seedPredicate: (rolls) => rolls.attack >= 21 && rolls.attack <= 50
    });
    try {
      await login(page, equal.username);
      await openCombat(page, equal.roomId, equal.combatId);
      await clickAttack(page);
      await chooseReaction(page, "反击");
      await expect
        .poll(async () => (await latestCombatState(equal.combatId)).log.some((entry) => entry.data?.rollType === "COUNTER"), { timeout: 20_000 })
        .toBe(true);
      const equalState = await latestCombatState(equal.combatId);
      const equalCounter = equalState.log.find((entry) => entry.data?.rollType === "COUNTER");
      expect(equalCounter?.data?.success).toBe(false);
      expect(equalState.log.some((entry) => entry.data?.rollType === "COUNTER_DAMAGE_SETTLE")).toBe(false);
      expect(equalState.participants.find((item) => item.id === equal.attackerId)?.hp).toBe(20);
    } finally {
      await cleanupCombatFixture(equal);
    }
    try {
      await login(page, win.username);
      await openCombat(page, win.roomId, win.combatId);
      await clickAttack(page);
      await chooseReaction(page, "反击");
      await expect
        .poll(async () => (await latestCombatState(win.combatId)).log.some((entry) => entry.data?.rollType === "COUNTER_DAMAGE_SETTLE"), { timeout: 20_000 })
        .toBe(true);
      const winState = await latestCombatState(win.combatId);
      const counter = winState.log.find((entry) => entry.data?.rollType === "COUNTER");
      expect(counter?.data?.success).toBe(true);
      expect(winState.participants.find((item) => item.id === win.attackerId)?.hp ?? 20).toBeLessThan(20);
    } finally {
      await cleanupCombatFixture(win);
    }
  });

  test("F-3 极限成功时贯穿武器造成最大伤害 + DB + 额外武器骰", async ({ page }) => {
    const fixture = await createCombatFixture({
      testName: "F3 impale",
      attacker: {
        stats: {
          skills: { FIGHTING_BRAWL: 999 },
          weapons: [{ name: "仪式剑", damage: "1d6", range: "MELEE", skillId: "FIGHTING_BRAWL", damageType: "IMPALING" }]
        }
      },
      defender: { stats: { skills: {} } }
    });
    try {
      await login(page, fixture.username);
      await openCombat(page, fixture.roomId, fixture.combatId);
      await clickAttack(page);
      await chooseReaction(page, "不应对");
      await expect
        .poll(async () => (await latestCombatState(fixture.combatId)).log.some((entry) => entry.data?.rollType === "DAMAGE_ROLL"), { timeout: 20_000 })
        .toBe(true);
      const damage = (await latestCombatState(fixture.combatId)).log.find((entry) => entry.data?.rollType === "DAMAGE_ROLL");
      expect(damage?.data?.mode).toBe("EXTREME_IMPALING");
      expect(String(damage?.data?.expression ?? "")).toContain("额外");
    } finally {
      await cleanupCombatFixture(fixture);
    }
  });

  test("F-4 火器不能被闪避/反击，寻找掩体成功后攻击者承受惩罚骰", async ({ page }) => {
    const fixture = await createCombatFixture({
      testName: "F4 cover",
      attacker: {
        stats: {
          skills: { FIREARMS_HANDGUN: 999 },
          weapons: [{ name: "手枪", damage: "1d6", range: "NEAR", skillId: "FIREARMS_HANDGUN", damageType: "IMPALING" }]
        }
      },
      defender: { stats: { skills: { DODGE: 999, FIGHTING_BRAWL: 999 } } }
    });
    try {
      await login(page, fixture.username);
      await openCombat(page, fixture.roomId, fixture.combatId);
      await selectAttackSkill(page, "FIREARMS_HANDGUN");
      await clickAttack(page);
      const panel = page.locator("section").filter({ hasText: "你需要应对" }).first();
      await expect(panel).toBeVisible({ timeout: 15_000 });
      const options = await panel.locator("select").first().locator("option").allTextContents();
      expect(options).not.toContain("闪避");
      expect(options).not.toContain("反击");
      expect(options).toContain("寻找掩体");
      await chooseReaction(page, "寻找掩体");
      await expect
        .poll(async () => (await latestCombatState(fixture.combatId)).log.some((entry) => entry.data?.rollType === "SEEK_COVER"), { timeout: 20_000 })
        .toBe(true);
      const state = await latestCombatState(fixture.combatId);
      const cover = state.log.find((entry) => entry.data?.rollType === "SEEK_COVER");
      const attack = state.log.find((entry) => entry.data?.rollType === "ATTACK");
      expect(cover?.data?.success).toBe(true);
      expect(String(attack?.data?.modifiers ?? "")).toContain("目标寻找掩体");
    } finally {
      await cleanupCombatFixture(fixture);
    }
  });

  test("F-5/U-6 霰弹枪按地图英尺距离自动选择近/远伤害档", async ({ page }) => {
    const shotgunStats = {
      skills: { FIREARMS_RIFLE: 999 },
      weapons: [{
        name: "霰弹枪", damage: "4d6/2d6", range: "NEAR", skillId: "FIREARMS_RIFLE", damageType: "NONE",
        damageBands: [
          { label: "近距离", expression: "4d6", maxFeet: "DEX" as const },
          { label: "远距离", expression: "2d6", maxFeet: null }
        ]
      }]
    };
    const near = await createCombatFixture({
      testName: "F5 shotgun near",
      attacker: { stats: shotgunStats },
      defender: { stats: {}, x: 590 }
    });
    const far = await createCombatFixture({
      testName: "F5 shotgun far",
      attacker: { stats: shotgunStats },
      defender: { stats: {}, x: 1080 }
    });
    try {
      await login(page, near.username);
      await openCombat(page, near.roomId, near.combatId);
      await selectAttackSkill(page, "FIREARMS_RIFLE");
      // U-6：普通攻击面板展示地图实际英尺距离。
      await expect(page.getByTestId("combat-distance")).toContainText("35 英尺", { timeout: 20_000 });
      await clickAttack(page);
      await chooseReaction(page, "不应对");
      await expect
        .poll(async () => (await latestCombatState(near.combatId)).log.some((entry) => entry.data?.rollType === "DAMAGE_ROLL"), { timeout: 20_000 })
        .toBe(true);
      const nearDamage = (await latestCombatState(near.combatId)).log.find((entry) => entry.data?.rollType === "DAMAGE_ROLL");
      // 攻击者技能 999 → 必定极难成功，贯穿/钝击极限伤害会显示为最大武器值 + DB。
      expect(nearDamage?.data?.expression).toBe("24 + DB 0");
    } finally {
      await cleanupCombatFixture(near);
    }
    try {
      await login(page, far.username);
      await openCombat(page, far.roomId, far.combatId);
      await selectAttackSkill(page, "FIREARMS_RIFLE");
      await expect(page.getByTestId("combat-distance")).toContainText("70 英尺", { timeout: 20_000 });
      await clickAttack(page);
      await chooseReaction(page, "不应对");
      await expect
        .poll(async () => (await latestCombatState(far.combatId)).log.some((entry) => entry.data?.rollType === "DAMAGE_ROLL"), { timeout: 20_000 })
        .toBe(true);
      const farDamage = (await latestCombatState(far.combatId)).log.find((entry) => entry.data?.rollType === "DAMAGE_ROLL");
      expect(farDamage?.data?.expression).toBe("12 + DB 0");
    } finally {
      await cleanupCombatFixture(far);
    }
  });

  test("U-2 手枪三连射：三发各带惩罚骰且逐发结算", async ({ page }) => {
    const fixture = await createCombatFixture({
      testName: "U2 rapid fire",
      attacker: {
        stats: {
          skills: { FIREARMS_HANDGUN: 999 },
          weapons: [{ name: "手枪", damage: "1d6", range: "NEAR", skillId: "FIREARMS_HANDGUN", damageType: "IMPALING", shots: [1, 2, 3] }]
        }
      },
      defender: { stats: { maxHp: 200 }, x: 800 }
    });
    try {
      await login(page, fixture.username);
      await openCombat(page, fixture.roomId, fixture.combatId);
      await selectAttackSkill(page, "FIREARMS_HANDGUN");
      await page.getByLabel("射击次数").selectOption("3");
      await clickAttack(page);
      await chooseReaction(page, "不应对");
      await expect
        .poll(async () => {
          const state = await latestCombatState(fixture.combatId);
          return state.log.filter((entry) => entry.data?.rollType === "DAMAGE_SETTLE").length;
        }, { timeout: 20_000 })
        .toBe(3);
      const state = await latestCombatState(fixture.combatId);
      const attacks = state.log.filter((entry) => entry.data?.rollType === "ATTACK");
      expect(attacks).toHaveLength(3);
      expect(attacks.every((entry) => Number(entry.data?.shotCount) === 3)).toBe(true);
      expect(attacks.every((entry) => String(entry.data?.modifiers ?? "").includes("连射"))).toBe(true);
    } finally {
      await cleanupCombatFixture(fixture);
    }
  });

  test("U-5 战技：踢倒成功使目标倒地", async ({ page }) => {
    const fixture = await createCombatFixture({
      testName: "U5 maneuver",
      attacker: { stats: { skills: { FIGHTING_BRAWL: 999 } } },
      defender: { stats: {} }
    });
    try {
      await login(page, fixture.username);
      await openCombat(page, fixture.roomId, fixture.combatId);
      await page.locator("select").filter({ hasText: "战技：踢倒" }).selectOption("TRIP");
      await page.getByRole("button", { name: "使用战技" }).click();
      await chooseReaction(page, "不应对");
      await expect
        .poll(async () => (await latestCombatState(fixture.combatId)).participants.find((item) => item.id === fixture.defenderId)?.prone === true, { timeout: 20_000 })
        .toBe(true);
    } finally {
      await cleanupCombatFixture(fixture);
    }
  });

  test("U-7 准备火器：浏览器按钮写入 +50 DEX 先攻修正", async ({ page }) => {
    const fixture = await createCombatFixture({
      testName: "U7 ready weapon",
      attacker: {
        stats: {
          skills: { FIREARMS_HANDGUN: 999 },
          weapons: [{ name: "手枪", damage: "1d6", range: "NEAR", skillId: "FIREARMS_HANDGUN", damageType: "IMPALING" }]
        }
      },
      defender: { stats: {} }
    });
    try {
      await login(page, fixture.username);
      await openCombat(page, fixture.roomId, fixture.combatId);
      await page.getByRole("button", { name: "准备火器（先攻 +50）" }).click();
      await expect
        .poll(async () => (await latestCombatState(fixture.combatId)).participants.find((item) => item.id === fixture.attackerId)?.initiativeMod, { timeout: 20_000 })
        .toBe(50);
    } finally {
      await cleanupCombatFixture(fixture);
    }
  });

  test("U-6 投掷超过 STR/5 码时，浏览器行动被服务端拒绝", async ({ page }) => {
    const fixture = await createCombatFixture({
      testName: "U6 throw range",
      attacker: {
        stats: {
          skills: { THROW: 999 },
          weapons: [{ name: "投石", damage: "1d6", range: "NEAR", skillId: "THROW" }],
          attributes: { str: 50 }
        }
      },
      defender: { stats: {}, x: 1080 }
    });
    try {
      await login(page, fixture.username);
      await openCombat(page, fixture.roomId, fixture.combatId);
      await selectAttackSkill(page, "THROW");
      await clickAttack(page);
      await expect(page.getByText("超出投掷最大射程", { exact: false })).toBeVisible({ timeout: 15_000 });
    } finally {
      await cleanupCombatFixture(fixture);
    }
  });

  test("U-1 自定义状态修正会写入攻击日志来源", async ({ page }) => {
    const fixture = await createCombatFixture({
      testName: "U1 modifiers",
      attacker: {
        stats: { skills: { FIGHTING_BRAWL: 999 } },
        conditions: [
          makeCondition({
            type: "CURSE",
            note: "U-1 诅咒",
            unit: "ROUND",
            remaining: 1,
            data: { attackBonusDice: 1, attackPenaltyDice: 2 }
          })
        ]
      },
      defender: { stats: {} }
    });
    try {
      await login(page, fixture.username);
      await openCombat(page, fixture.roomId, fixture.combatId);
      await clickAttack(page);
      await chooseReaction(page, "不应对");
      await expect
        .poll(async () => (await latestCombatState(fixture.combatId)).log.some((entry) => entry.data?.rollType === "ATTACK"), { timeout: 20_000 })
        .toBe(true);
      const attack = (await latestCombatState(fixture.combatId)).log.find((entry) => entry.data?.rollType === "ATTACK");
      const modifiers = String(attack?.data?.modifiers ?? "");
      expect(modifiers).toContain("U-1 诅咒");
      expect(modifiers).toContain("1 奖励骰");
      expect(modifiers).toContain("2 惩罚骰");
    } finally {
      await cleanupCombatFixture(fixture);
    }
  });

  test("U-4 寡不敌众：目标本轮已闪避后，后续近战攻击获得奖励骰", async ({ page }) => {
    const fixture = await createCombatFixture({
      testName: "U4 outnumber",
      attacker: { stats: { skills: { FIGHTING_BRAWL: 999 } } },
      defender: { stats: { skills: { FIGHTING_BRAWL: 999, DODGE: 999 } } },
      extraAttackers: [{ stats: { skills: { FIGHTING_BRAWL: 999 } }, x: 300 }]
    });
    try {
      await login(page, fixture.username);
      await openCombat(page, fixture.roomId, fixture.combatId);

      // 第一个近战攻击 → 防御者闪避，reactionsThisRound +1。
      await selectAttackTarget(page, fixture.defenderId);
      await clickAttack(page);
      await chooseReaction(page, "闪避");
      await expect
        .poll(async () => (await latestCombatState(fixture.combatId)).log.some((entry) => entry.data?.rollType === "DODGE"), { timeout: 20_000 })
        .toBe(true);

      // 防御者回合跳过。
      await page.getByRole("button", { name: "跳过" }).click();
      await expect
        .poll(async () => {
          const state = await latestCombatState(fixture.combatId);
          return state.log.some((entry) => entry.text.includes("E2E 防御者 跳过本回合"));
        }, { timeout: 20_000 })
        .toBe(true);

      // 额外攻击者回合：选防御者为目标再攻击，日志应带寡不敌众奖励骰。
      await selectAttackTarget(page, fixture.defenderId);
      await clickAttack(page);
      await chooseReaction(page, "不应对");
      await expect
        .poll(async () => {
          const state = await latestCombatState(fixture.combatId);
          return state.log.some(
            (entry) =>
              entry.data?.rollType === "ATTACK" &&
              String(entry.data?.modifiers ?? "").includes("寡不敌众")
          );
        }, { timeout: 20_000 })
        .toBe(true);
      const state = await latestCombatState(fixture.combatId);
      const extraAttack = [...state.log]
        .reverse()
        .find((entry) => entry.data?.rollType === "ATTACK" && String(entry.data?.modifiers ?? "").includes("寡不敌众"));
      expect(extraAttack).toBeDefined();
      expect(String(extraAttack?.data?.modifiers ?? "")).toContain("1 奖励骰");
    } finally {
      await cleanupCombatFixture(fixture);
    }
  });

  test("R-1 MP 不足时按缺口从 HP 扣除（浏览器施法）", async ({ page }) => {
    const fixture = await createCombatFixture({
      testName: "R1 mp overflow",
      attacker: {
        stats: {
          skills: { MAGIC: 999 },
          spells: ["drain-self"],
          maxMp: 0,
          maxHp: 10
        }
      },
      defender: { stats: {} },
      magicEnabled: true,
      ruleOverride: {
        magic: {
          enabled: true,
          system: "COC7",
          spells: [{
            id: "drain-self",
            name: "抽取生命",
            skill: "MAGIC",
            mpCost: "5",
            sanCost: "0",
            target: "SELF",
            effects: [{ type: "HEAL", amount: "1" }]
          }]
        }
      }
    });
    try {
      await login(page, fixture.username);
      await openCombat(page, fixture.roomId, fixture.combatId);
      await expect(page.getByRole("button", { name: "施法" })).toBeVisible({ timeout: 15_000 });
      await page.getByRole("button", { name: "施法" }).click();
      await expect
        .poll(async () => (await latestCombatState(fixture.combatId)).log.some((entry) => entry.data?.rollType === "MP_OVERFLOW_TO_HP"), { timeout: 20_000 })
        .toBe(true);
      const state = await latestCombatState(fixture.combatId);
      const caster = state.participants.find((item) => item.id === fixture.attackerId);
      // 0 MP 支付 5 点：HP 10 → 5，然后 HEAL 1 → 6。
      expect(caster?.hp).toBe(6);
    } finally {
      await cleanupCombatFixture(fixture);
    }
  });

  test("C-3/D-5 手工建卡：浏览器添加外语（拉丁语）专精并按兴趣点保存", async ({ page }) => {
    const username = "e2ecoc7specialty";
    const user = await createUser(username);
    let roomId: string | null = null;
    try {
      const room = await prisma.room.create({
        data: {
          name: "E2E-COC7 手工专精建卡",
          system: "COC7",
          ownerId: user.id,
          inviteCode: "e2e-coc7-specialty-" + Date.now().toString(36),
          status: "PLAYING",
          chargenMethod: "manual",
          era: "MODERN"
        }
      });
      roomId = room.id;
      await prisma.roomMember.create({ data: { roomId: room.id, userId: user.id, role: "KP" } });

      await login(page, username);
      await page.goto("/rooms/" + room.id + "/characters/new");
      await expect(page.getByText("技能分配")).toBeVisible({ timeout: 30_000 });

      await page.getByLabel("角色名").fill("浏览器·专精");
      for (const key of ["str", "con", "siz", "dex", "app", "int", "pow", "edu", "luck"]) {
        await page.locator('input[name="attr_' + key + '"]').fill("50");
      }
      const confirmAge = page.getByRole("button", { name: /确认年龄/ });
      if (await confirmAge.isVisible().catch(() => false)) {
        await confirmAge.click();
      }

      const specialtyBlock = page
        .locator("div.rounded-xl")
        .filter({ hasText: "添加专精（外语 / 科学 / 驾驶 / 生存 / 技艺 / 射击）" })
        .first();
      await specialtyBlock.locator("select").selectOption("LANGUAGE_OTHER");
      await specialtyBlock.getByPlaceholder("拉丁语").fill("拉丁语");
      await specialtyBlock.getByRole("button", { name: "添加专精" }).click();

      const row = page.locator('[data-skill-id="LANGUAGE_OTHER#拉丁语"]');
      await expect(row).toBeVisible({ timeout: 15_000 });
      await row.locator('[data-testid="skill-interest"]').fill("40");

      await page.getByRole("button", { name: "下一步" }).click();
      await expect(page.getByText("人物故事 / 财产 / 持有物")).toBeVisible({ timeout: 30_000 });
      await page.getByRole("button", { name: "提交给 KP 审核" }).click();
      await page.waitForURL((url) => url.pathname === "/rooms/" + roomId, { timeout: 60_000 });

      const character = await prisma.character.findFirstOrThrow({
        where: { userId: user.id, name: "浏览器·专精" }
      });
      const skills = character.skills as Record<string, number>;
      // 基础 1 + 兴趣 40 = 41，验证复合 key 真正落库。
      expect(skills["LANGUAGE_OTHER#拉丁语"]).toBe(41);
    } finally {
      if (roomId !== null) await prisma.room.delete({ where: { id: roomId } }).catch(() => undefined);
      await prisma.character.deleteMany({ where: { userId: user.id } }).catch(() => undefined);
      await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    }
  });

  test("D-2 环境持续伤害：DOT 在回合结束时自动结算并扣减轮数", async ({ page }) => {
    const fixture = await createCombatFixture({
      testName: "D2 dot",
      attacker: { stats: { skills: { FIGHTING_BRAWL: 999 } } },
      defender: { stats: { maxHp: 100, skills: { DODGE: 999 } } }
    });
    try {
      await login(page, fixture.username);
      await openCombat(page, fixture.roomId, fixture.combatId);

      const tools = page.locator("section").filter({ hasText: "KP 工作台" }).first();
      await expect(tools).toBeVisible({ timeout: 20_000 });
      const readToolsHp = async (): Promise<number> => {
        const text = await tools.innerText();
        const match = /HP (\d+)\//.exec(text);
        return match ? Number(match[1]) : -1;
      };
      await tools.locator("select").first().selectOption({ label: "E2E 防御者（NPC）" });

      // KP 工作台真实施加“火焰 1d6，持续 3 轮”。
      await tools.getByRole("button", { name: "环境 / 持续伤害" }).click();
      await tools.getByLabel("持续轮数（0 = 只结算一次）").fill("3");
      await tools.getByRole("button", { name: "施加环境伤害" }).click();
      await expect(tools.locator("p").filter({ hasText: /【环境伤害·火焰】/ }).first()).toBeVisible({ timeout: 20_000 });
      const hpAfterEnvironment = await readToolsHp();

      // 真实点两次“跳过”走完一轮，回合结束自动结算 DOT。
      await page.getByRole("button", { name: "跳过", exact: true }).click();
      await expect(page.getByRole("button", { name: "跳过", exact: true })).toBeVisible({ timeout: 20_000 });
      await page.getByRole("button", { name: "跳过", exact: true }).click();

      await expect
        .poll(async () => (await latestCombatState(fixture.combatId)).log.some((entry) => entry.data?.rollType === "DOT"), { timeout: 20_000 })
        .toBe(true);
      await expect
        .poll(async () => {
          const state = await latestCombatState(fixture.combatId);
          return state.participants.find((item) => item.id === fixture.defenderId)?.hp ?? -1;
        }, { timeout: 20_000 })
        .toBeLessThan(hpAfterEnvironment);

      const state = await latestCombatState(fixture.combatId);
      const defender = state.participants.find((item) => item.id === fixture.defenderId) as unknown as
        | { conditions?: Array<{ type: string; duration: { remaining: number } }> }
        | undefined;
      expect(defender?.conditions?.find((condition) => condition.type === "DOT")?.duration.remaining).toBe(2);
    } finally {
      await cleanupCombatFixture(fixture);
    }
  });

  test("U-6 追逐攻击：按 Token 实际英尺距离自动选择远距离伤害档", async ({ page }) => {
    const shotgunStats = {
      skills: { FIREARMS_RIFLE: 999 },
      weapons: [{
        name: "霰弹枪", damage: "4d6/2d6", range: "NEAR", skillId: "FIREARMS_RIFLE", damageType: "NONE",
        damageBands: [
          { label: "近距离", expression: "4d6", maxFeet: "DEX" as const },
          { label: "远距离", expression: "2d6", maxFeet: null }
        ]
      }]
    };
    const fixture = await createCombatFixture({
      testName: "U6 chase",
      attacker: { stats: shotgunStats, x: 100 },
      // 高 HP 保证真实回合制的开场攻击不会在追逐建立前就打死目标。
      defender: { stats: { maxHp: 200 }, x: 1080 }
    });
    try {
      await login(page, fixture.username);
      await openCombat(page, fixture.roomId, fixture.combatId);
      await selectAttackSkill(page, "FIREARMS_RIFLE");
      await clickAttack(page);

      // 目标真实选择“逃跑（进入追逐）”。
      const reactionPanel = page.locator("section").filter({ hasText: "你需要应对" }).first();
      await expect(reactionPanel).toBeVisible({ timeout: 15_000 });
      await reactionPanel.locator("select").first().selectOption({ label: "逃跑（进入追逐）" });
      await reactionPanel.getByRole("button", { name: "提交应对" }).click();

      const chaseSection = page.locator("section").filter({ hasText: /追逐 · 第 \d+ 轮/ }).first();
      await expect(chaseSection).toBeVisible({ timeout: 30_000 });
      // U-6：追逐 UI 直接展示双方 Token 的实际英尺距离（100 → 1080，70 英尺）。
      await expect(page.getByTestId("chase-distance")).toContainText("70 英尺", { timeout: 20_000 });

      // 真实操作追逐：非攻击者回合结束回合；攻击者回合先前进 1 格到同地点再攻击。
      let attacked = false;
      for (let step = 0; step < 14 && attacked === false; step += 1) {
        const attackerTurn = await chaseSection
          .locator("span")
          .filter({ hasText: "E2E 攻击者 的回合" })
          .first()
          .isVisible()
          .catch(() => false);
        if (attackerTurn === false) {
          const endTurn = chaseSection.getByRole("button", { name: "结束回合" });
          if (await endTurn.isEnabled().catch(() => false)) {
            await endTurn.click();
            await page.waitForTimeout(250);
            continue;
          }
          break;
        }
        const attackButton = chaseSection.getByRole("button", { name: /攻击同地点目标/ });
        if (await attackButton.isEnabled().catch(() => false)) {
          await attackButton.click();
          const chaseReaction = page.locator("section").filter({ hasText: "你需要应对" }).first();
          if (await chaseReaction.isVisible().catch(() => false)) {
            await chaseReaction.locator("select").first().selectOption({ label: "不应对" });
            await chaseReaction.getByRole("button", { name: "提交应对" }).click();
          }
          attacked = true;
          break;
        }
        const forward = chaseSection.getByRole("button", { name: "前进 1 格" });
        if (await forward.isEnabled().catch(() => false)) {
          await forward.click();
          await page.waitForTimeout(250);
          continue;
        }
        const endTurn = chaseSection.getByRole("button", { name: "结束回合" });
        if (await endTurn.isEnabled().catch(() => false)) {
          await endTurn.click();
          await page.waitForTimeout(250);
          continue;
        }
        break;
      }
      expect(attacked).toBe(true);
      // 70 英尺 > DEX 50 英尺 → 服务端应把近距离 4d6 覆盖为远距离 2d6（极难成功显示 12 + DB 0）。
      await expect
        .poll(async () => {
          const state = await latestCombatState(fixture.combatId);
          return state.log.some(
            (entry) =>
              entry.data?.rollType === "DAMAGE_ROLL" && String(entry.data?.expression ?? "").includes("12")
          );
        }, { timeout: 20_000 })
        .toBe(true);
    } finally {
      await cleanupCombatFixture(fixture);
    }
  });

  test("U-3 多目标 / 多技能 routine：同一行动内用不同技能攻击两个目标", async ({ page }) => {
    const fixture = await createCombatFixture({
      testName: "U3 routine",
      attacker: {
        stats: {
          skills: { FIGHTING_BRAWL: 999, FIREARMS_HANDGUN: 999 },
          weapons: [
            { name: "徒手", damage: "1d3", range: "MELEE", skillId: "FIGHTING_BRAWL", damageType: "BLUNT" },
            { name: "手枪", damage: "1d10", range: "NEAR", skillId: "FIREARMS_HANDGUN", damageType: "IMPALING" }
          ]
        }
      },
      defender: { stats: { maxHp: 200 }, x: 590 },
      extraDefenders: [{ stats: { maxHp: 200 }, x: 700 }]
    });
    try {
      await login(page, fixture.username);
      await openCombat(page, fixture.roomId, fixture.combatId);

      // 浏览器真实展开 routine 面板，添加“徒手→防御者1 / 手枪→防御者2”两步。
      await page.getByText("多目标 / 多技能攻击 routine", { exact: false }).first().click();
      await page.getByRole("button", { name: "添加攻击步骤" }).click();
      await page.getByTestId("routine-skill-0").selectOption("FIGHTING_BRAWL");
      await page.getByTestId("routine-target-0").selectOption(fixture.defenderId);
      await page.getByRole("button", { name: "添加攻击步骤" }).click();
      await page.getByTestId("routine-skill-1").selectOption("FIREARMS_HANDGUN");
      await page.getByTestId("routine-target-1").selectOption(fixture.extraDefenderIds[0]!);
      await page.getByRole("button", { name: "执行多目标 routine" }).click();

      // 两个目标都必须真实进入应对窗口并提交。
      const reactionSection = page.locator("section").filter({ hasText: "你需要应对" }).first();
      await expect(reactionSection).toBeVisible({ timeout: 20_000 });
      const reactionBlocks = reactionSection.locator("div.rounded-lg").filter({ hasText: "请选择" });
      const blockCount = await reactionBlocks.count();
      expect(blockCount).toBe(2);
      for (let index = 0; index < blockCount; index += 1) {
        await reactionBlocks.nth(index).locator("select").first().selectOption({ label: "不应对" });
      }
      for (let index = 0; index < 4; index += 1) {
        const submit = reactionSection.getByRole("button", { name: "提交应对" });
        if ((await submit.count()) === 0) break;
        await submit.first().click();
        await page.waitForTimeout(200);
      }

      // 同一行动内出现两个不同技能的攻击日志，且两个目标都真实掉血。
      await expect
        .poll(async () => {
          const state = await latestCombatState(fixture.combatId);
          const skills = state.log
            .filter((entry) => entry.data?.rollType === "ATTACK")
            .map((entry) => String(entry.data?.skill ?? ""));
          return skills.includes("FIGHTING_BRAWL") && skills.includes("FIREARMS_HANDGUN");
        }, { timeout: 20_000 })
        .toBe(true);

      const state = await latestCombatState(fixture.combatId);
      expect(state.participants.find((item) => item.id === fixture.defenderId)?.hp).toBeLessThan(200);
      expect(state.participants.find((item) => item.id === fixture.extraDefenderIds[0])?.hp).toBeLessThan(200);
    } finally {
      await cleanupCombatFixture(fixture);
    }
  });

  test("D-5 专精候选：KP 工作台维护后，建卡页作为下拉候选", async ({ page }) => {
    const username = "e2ecoc7candidate";
    const user = await createUser(username);
    let roomId: string | null = null;
    try {
      const room = await prisma.room.create({
        data: {
          name: "E2E-COC7 专精候选",
          system: "COC7",
          ownerId: user.id,
          inviteCode: "e2e-coc7-candidate-" + Date.now().toString(36),
          status: "LOBBY",
          chargenMethod: "manual",
          era: "MODERN"
        }
      });
      roomId = room.id;
      await prisma.roomMember.create({ data: { roomId: room.id, userId: user.id, role: "KP" } });

      await login(page, username);
      await page.goto("/rooms/" + room.id + "/prepare");
      const tools = page.locator("section").filter({ hasText: "KP 工作台" }).first();
      await expect(tools).toBeVisible({ timeout: 30_000 });
      await tools.getByRole("button", { name: "专精候选" }).click();
      await tools.getByPlaceholder("例：拉丁语 / 生物学 / 沙漠").fill("拉丁语");
      await tools.getByRole("button", { name: "添加到列表" }).click();
      await tools.getByRole("button", { name: "保存专精候选" }).click();
      await expect(tools.getByText(/已保存 1 条专精候选/).first()).toBeVisible({ timeout: 20_000 });

      const saved = await prisma.room.findUniqueOrThrow({ where: { id: room.id }, select: { ruleOverride: true } });
      const candidates = (saved.ruleOverride as { specialtyCandidates?: unknown[] }).specialtyCandidates;
      expect(candidates?.length).toBe(1);

      // 建卡页真实读到候选，作为「专精名称」下拉选项。
      await page.goto("/rooms/" + room.id + "/characters/new");
      await expect(page.getByText("添加专精", { exact: false }).first()).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('#specialty-name-candidates option[value="拉丁语"]')).toHaveCount(1);
    } finally {
      if (roomId !== null) await prisma.room.delete({ where: { id: roomId } }).catch(() => undefined);
      await prisma.character.deleteMany({ where: { userId: user.id } }).catch(() => undefined);
      await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    }
  });

  test("D-7 后台规则包表格化内容编辑器：改技能并保存新版本", async ({ page }) => {
    const username = "e2ecoc7admin" + Date.now().toString(36).slice(-4);
    const user = await createUser(username);
    await prisma.user.update({ where: { id: user.id }, data: { role: "ADMIN" } });
    let packId: string | null = null;
    try {
      await login(page, username);
      await page.goto("/admin/rulepacks");
      await expect(page.getByRole("button", { name: "创建规则包" })).toBeVisible({ timeout: 30_000 });

      const slug = "e2e-admin-pack-" + Date.now().toString(36);
      const createForm = page.locator("form").filter({ has: page.getByRole("button", { name: "创建规则包" }) });
      await createForm.getByLabel("名称").fill("E2E 表格编辑规则包");
      await createForm.getByLabel("标识（唯一）").fill(slug);
      await createForm.locator('select[name="baseSlug"]').selectOption("coc7-baseline");
      await page.getByRole("button", { name: "创建规则包" }).click();
      await page.waitForURL(/\/admin\/rulepacks\/[^/]+\?saved=created/, { timeout: 60_000 });
      packId = new URL(page.url()).pathname.split("/")[3] ?? null;
      expect(packId).not.toBeNull();

      // 真实切到表单编辑，改第 1 行技能并新增一行技能。
      await expect(page.getByText("新建版本")).toBeVisible({ timeout: 30_000 });
      await page.getByRole("button", { name: "表单编辑" }).click();
      await expect(page.getByText(/技能表（/)).toBeVisible({ timeout: 20_000 });
      await page.getByTestId("skill-name-0").fill("格斗（斗殴）·E2E");
      const addSkillButton = page.getByRole("button", { name: "添加技能" });
      await addSkillButton.focus();
      await page.keyboard.press("Enter");
      const lastId = page.locator('[data-testid^="skill-id-"]').last();
      await lastId.fill("E2E_TEST_SKILL");
      const lastIndex = Number((await lastId.getAttribute("data-testid"))?.replace("skill-id-", "") ?? "-1");
      expect(lastIndex).toBeGreaterThan(0);
      await page.getByTestId("skill-name-" + lastIndex).fill("E2E 测试技能");
      await page.getByTestId("skill-base-" + lastIndex).fill("1");

      const versionForm = page.locator("form").filter({ has: page.getByRole("button", { name: "保存草稿版本" }) });
      await versionForm.getByLabel("版本号").fill("9.9.9");
      await versionForm.getByRole("button", { name: "保存草稿版本" }).click();
      await page.waitForURL(/saved=version/, { timeout: 60_000 });

      const version = await prisma.rulePackVersion.findFirstOrThrow({
        where: { packId: packId!, version: "9.9.9" },
        orderBy: { createdAt: "desc" }
      });
      const config = version.config as { skills?: Array<{ id?: string; name?: string }> };
      expect(config.skills?.some((skill) => skill.id === "E2E_TEST_SKILL" && skill.name === "E2E 测试技能")).toBe(true);
      expect(config.skills?.[0]?.name).toBe("格斗（斗殴）·E2E");
    } finally {
      if (packId !== null) await prisma.rulePack.delete({ where: { id: packId } }).catch(() => undefined);
      await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    }
  });
});