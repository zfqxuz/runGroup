import { createSeededRng, randomSeed, type Rng } from "@touhou/formula";
import { resolveGrowthChecks } from "@touhou/rules";
import type { Prisma } from "@prisma/client";
import { buildEffectiveSkills } from "@/server/character/skills";
import { applyAdvancement } from "@/server/game/advancement";
import { loadEffectivePack } from "@/server/rules/loader";

export interface ResolveGrowthOptions {
  readonly gameId: string;
  readonly actorId: string;
  readonly characterId?: string | null;
  readonly seed?: string | null;
  readonly rng?: Rng;
}

export interface ResolvedGrowthCheck {
  readonly checkId: string;
  readonly characterId: string;
  readonly skillId: string;
  readonly skillName: string | null;
  readonly beforeValue: number;
  readonly roll: number;
  readonly passed: boolean;
  readonly gain: number;
}

export interface ResolveGrowthOutcome {
  readonly resolved: number;
  readonly passed: number;
  readonly results: readonly ResolvedGrowthCheck[];
}

function growthNote(roll: number, beforeValue: number, gain: number): string {
  if (roll >= 96 && roll <= beforeValue) {
    return "成长检定：d100=" + roll + " 位于大成功区间，技能 +" + gain;
  }
  return "成长检定：d100=" + roll + " > 原技能值 " + beforeValue + "，技能 +" + gain;
}

/**
 * 对一个局内所有待检定成长点执行 CoC 幕间成长检定。
 * 必须在事务内调用；成功时写入来源为 GROWTH_CHECK 的成长记录并同步角色卡。
 */
export async function resolveGameGrowthChecks(
  tx: Prisma.TransactionClient,
  options: ResolveGrowthOptions
): Promise<ResolveGrowthOutcome> {
  const checks = await tx.growthCheck.findMany({
    where: {
      gameId: options.gameId,
      state: "PENDING",
      ...(options.characterId === null || options.characterId === undefined
        ? {}
        : { characterId: options.characterId })
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }]
  });
  if (checks.length === 0) {
    return { resolved: 0, passed: 0, results: [] };
  }

  const game = await tx.game.findUnique({
    where: { id: options.gameId },
    select: {
      id: true,
      room: {
        select: { id: true, system: true, rulePackVersionId: true, ruleOverride: true }
      }
    }
  });
  if (game === null) {
    return { resolved: 0, passed: 0, results: [] };
  }

  const pack = await loadEffectivePack({
    id: game.room.id,
    system: game.room.system,
    rulePackVersionId: game.room.rulePackVersionId,
    ruleOverride: game.room.ruleOverride
  });
  const skillNames = new Map<string, string>();
  for (const skill of pack.compiled.skills) skillNames.set(skill.id, skill.name);

  const characterIds = [...new Set(checks.map((check) => check.characterId))];
  const characters = await tx.character.findMany({ where: { id: { in: characterIds } } });
  const skillsByCharacter = new Map<string, Record<string, number>>();
  for (const character of characters) {
    skillsByCharacter.set(character.id, buildEffectiveSkills(pack.compiled, character));
  }

  const inputs = checks.map((check) => ({
    id: check.id,
    skillId: check.skillId,
    beforeValue: skillsByCharacter.get(check.characterId)?.[check.skillId] ?? check.beforeValue
  }));

  const rng = options.rng ?? createSeededRng(options.seed ?? randomSeed());
  const rolled = resolveGrowthChecks(inputs, rng);
  const now = new Date();
  const results: ResolvedGrowthCheck[] = [];
  let passedCount = 0;

  for (const result of rolled) {
    const check = checks.find((item) => item.id === result.id);
    if (check === undefined) continue;
    const skillName = skillNames.get(check.skillId) ?? check.skillName;

    if (result.passed === false) {
      await tx.growthCheck.update({
        where: { id: check.id },
        data: {
          state: "FAILED",
          beforeValue: result.beforeValue,
          roll: result.roll,
          gain: 0,
          skillName,
          resolvedBy: options.actorId,
          resolvedAt: now
        }
      });
      results.push({
        checkId: check.id,
        characterId: check.characterId,
        skillId: check.skillId,
        skillName,
        beforeValue: result.beforeValue,
        roll: result.roll,
        passed: false,
        gain: 0
      });
      continue;
    }

    passedCount += 1;
    const fresh = await tx.character.findUnique({ where: { id: check.characterId } });
    if (fresh === null) continue;
    const note = growthNote(result.roll, result.beforeValue, result.gain);
    const advancement = await applyAdvancement(
      tx,
      options.gameId,
      check.characterId,
      fresh,
      { kind: "SKILL", target: check.skillId, delta: result.gain, note },
      {
        source: "GROWTH_CHECK",
        createdBy: options.actorId,
        metadata: {
          checkId: check.id,
          roll: result.roll,
          gain: result.gain,
          beforeValue: result.beforeValue
        }
      }
    );
    await tx.growthCheck.update({
      where: { id: check.id },
      data: {
        state: "PASSED",
        beforeValue: result.beforeValue,
        roll: result.roll,
        gain: result.gain,
        skillName,
        resolvedBy: options.actorId,
        resolvedAt: now,
        advancementId: advancement.id
      }
    });
    results.push({
      checkId: check.id,
      characterId: check.characterId,
      skillId: check.skillId,
      skillName,
      beforeValue: result.beforeValue,
      roll: result.roll,
      passed: true,
      gain: result.gain
    });
  }

  return { resolved: results.length, passed: passedCount, results };
}
