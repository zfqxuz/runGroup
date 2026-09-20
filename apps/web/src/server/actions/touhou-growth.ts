"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { touhouGrowthGrant, touhouHpCoefficientAfter, touhouHpFromCoefficient, touhouSpellcardPoolAfter } from "@touhou/rules";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";
import {
  checkAbilityGrowth,
  checkAttributeGrowth,
  checkSkillGrowth,
  growthRemaining,
  readTouhouGrowth,
  withTouhouGrowth
} from "@/server/game/touhou-growth";
import { loadEffectivePack } from "@/server/rules/loader";

function clean(value: FormDataEntryValue | null, maxLength = 120): string {
  return String(value ?? "").trim().slice(0, maxLength);
}

function withQuery(pathName: string, query: string): string {
  const separator = pathName.includes("?") ? "&" : "?";
  return pathName + separator + query;
}

function safeReturnPath(raw: string, fallback: string): string {
  if (raw.startsWith("/") && raw.startsWith("//") === false) return raw;
  return fallback;
}

async function requireMember(roomId: string, userId: string): Promise<"KP" | "PLAYER" | null> {
  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId, userId } },
    select: { role: true }
  });
  if (membership === null) return null;
  return membership.role === "KP" ? "KP" : "PLAYER";
}

/** KP 分配成长等级（四类各一个 A-F）。 */
export async function grantTouhouGrowthAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");
  const roomId = clean(formData.get("roomId"), 80);
  if (roomId.length === 0) redirect("/");
  const membership = await requireMember(roomId, session.user.id);
  if (membership === null) redirect("/");
  if (membership !== "KP") redirect("/rooms/" + roomId + "/prepare");
  const returnTo = safeReturnPath(clean(formData.get("returnTo"), 300), "/rooms/" + roomId + "/end");

  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { system: true, rulePackVersionId: true, ruleOverride: true }
  });
  if (room === null || room.system !== "TOUHOU") {
    redirect(withQuery(returnTo, "error=touhou-growth"));
  }
  const effective = await loadEffectivePack({
    id: roomId,
    system: room.system,
    rulePackVersionId: room.rulePackVersionId,
    ruleOverride: room.ruleOverride
  });
  const rules = effective.compiled.pack.abilities;
  if (rules.enabled === false) redirect(withQuery(returnTo, "error=touhou-growth"));

  const characterId = clean(formData.get("characterId"), 80);
  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: { id: true, system: true, sourceData: true, con: true, hp: true, maxHp: true }
  });
  if (character === null || character.system !== "TOUHOU") {
    redirect(withQuery(returnTo, "error=touhou-growth"));
  }

  const grades = {
    attribute: clean(formData.get("attributeGrade"), 4),
    skill: clean(formData.get("skillGrade"), 4),
    ability: clean(formData.get("abilityGrade"), 4),
    hpSpellcard: clean(formData.get("hpSpellcardGrade"), 4)
  };
  const grant = touhouGrowthGrant(rules, grades);
  if (grant === null) redirect(withQuery(returnTo, "error=touhou-growth"));

  const pools = readTouhouGrowth(character.sourceData);
  const nextPools = {
    ...pools,
    granted: {
      attribute: pools.granted.attribute + grant.attribute,
      skill: pools.granted.skill + grant.skill,
      ability: pools.granted.ability + grant.ability,
      hpCoefficient: pools.granted.hpCoefficient + grant.hpCoefficient,
      spellcard: pools.granted.spellcard + grant.spellcard
    },
    hpCoefficient: touhouHpCoefficientAfter(pools.hpCoefficient, grant.hpCoefficient),
    spellcardPool: touhouSpellcardPoolAfter(pools.spellcardPool, grant.spellcard)
  };

  const nextMaxHp = touhouHpFromCoefficient(character.con, nextPools.hpCoefficient);
  const hpDelta = Math.max(0, nextMaxHp - character.maxHp);
  const nextHp = Math.min(nextMaxHp, character.hp + hpDelta);

  await prisma.$transaction(async (tx) => {
    await tx.character.update({
      where: { id: characterId },
      data: {
        sourceData: withTouhouGrowth(character.sourceData, nextPools) as never,
        ...(nextMaxHp === character.maxHp ? {} : { maxHp: nextMaxHp, hp: nextHp })
      }
    });
    await tx.characterAdvancement.create({
      data: {
        characterId,
        gameId: null,
        kind: "OTHER",
        target: null,
        delta: null,
        note:
          "千幻抄成长等级：" +
          grades.attribute +
          "/" +
          grades.skill +
          "/" +
          grades.ability +
          "/" +
          grades.hpSpellcard,
        source: "END_REWARD",
        createdBy: session.user.id,
        metadata: { touhouGrowth: grant, grades } as never
      }
    });
  });

  revalidatePath(returnTo);
  redirect(withQuery(returnTo, "growth=granted"));
}

/** 玩家 / KP 消费成长点：特性值 / 技能 / 能力各一次升 1 级。 */
export async function spendTouhouGrowthAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");
  const roomId = clean(formData.get("roomId"), 80);
  if (roomId.length === 0) redirect("/");
  const membership = await requireMember(roomId, session.user.id);
  if (membership === null) redirect("/");
  const returnTo = safeReturnPath(clean(formData.get("returnTo"), 300), "/rooms/" + roomId + "/prepare");

  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { system: true, rulePackVersionId: true, ruleOverride: true }
  });
  if (room === null || room.system !== "TOUHOU") redirect(withQuery(returnTo, "error=touhou-growth"));
  const effective = await loadEffectivePack({
    id: roomId,
    system: room.system,
    rulePackVersionId: room.rulePackVersionId,
    ruleOverride: room.ruleOverride
  });
  const rules = effective.compiled.pack.abilities;
  if (rules.enabled === false) redirect(withQuery(returnTo, "error=touhou-growth"));

  const characterId = clean(formData.get("characterId"), 80);
  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: {
      id: true,
      userId: true,
      system: true,
      str: true, con: true, siz: true, dex: true, app: true, int: true, pow: true, edu: true, luck: true,
      skills: true,
      backstory: true,
      sourceData: true
    }
  });
  if (character === null || character.system !== "TOUHOU") {
    redirect(withQuery(returnTo, "error=touhou-growth"));
  }
  if (membership !== "KP" && character.userId !== session.user.id) {
    redirect(withQuery(returnTo, "error=touhou-growth"));
  }

  const kind = clean(formData.get("kind"), 20);
  const target = clean(formData.get("target"), 60);
  const pools = readTouhouGrowth(character.sourceData);
  const attributes = {
    str: character.str, con: character.con, siz: character.siz, dex: character.dex,
    app: character.app, int: character.int, pow: character.pow, edu: character.edu, luck: character.luck
  } as Record<string, number>;
  const skills = (character.skills ?? {}) as Record<string, number>;
  const backstory = (character.backstory ?? {}) as Record<string, unknown>;
  const abilities = (backstory.abilities ?? {}) as Record<string, number>;

  if (kind === "ATTRIBUTE") {
    if (attributes[target] === undefined) redirect(withQuery(returnTo, "error=touhou-growth"));
    const check = checkAttributeGrowth(pools, attributes[target] ?? 0);
    if (check.ok === false) redirect(withQuery(returnTo, "error=touhou-growth"));
    const nextPools = {
      ...pools,
      spent: { ...pools.spent, attribute: pools.spent.attribute + check.cost }
    };
    await prisma.$transaction(async (tx) => {
      await tx.character.update({
        where: { id: characterId },
        data: { [target]: (attributes[target] ?? 0) + 1, sourceData: withTouhouGrowth(character.sourceData, nextPools) as never } as never
      });
      await tx.characterAdvancement.create({
        data: {
          characterId, gameId: null, kind: "ATTRIBUTE", target, delta: 1,
          note: "千幻抄特性值成长（花费 " + check.cost + " 点）",
          source: "END_REWARD", createdBy: session.user.id,
          metadata: { touhouGrowthCost: check.cost } as never
        }
      });
    });
  } else if (kind === "SKILL") {
    if (target.length === 0) redirect(withQuery(returnTo, "error=touhou-growth"));
    const check = checkSkillGrowth(pools, skills[target] ?? 0);
    if (check.ok === false) redirect(withQuery(returnTo, "error=touhou-growth"));
    const nextPools = {
      ...pools,
      spent: { ...pools.spent, skill: pools.spent.skill + check.cost }
    };
    const nextSkills = { ...skills, [target]: check.to };
    await prisma.$transaction(async (tx) => {
      await tx.character.update({
        where: { id: characterId },
        data: { skills: nextSkills as never, sourceData: withTouhouGrowth(character.sourceData, nextPools) as never }
      });
      await tx.characterAdvancement.create({
        data: {
          characterId, gameId: null, kind: "SKILL", target, delta: 1,
          note: "千幻抄技能成长（花费 " + check.cost + " 点）",
          source: "END_REWARD", createdBy: session.user.id,
          metadata: { touhouGrowthCost: check.cost } as never
        }
      });
    });
  } else if (kind === "ABILITY") {
    const current = Math.max(0, Math.floor(abilities[target] ?? 0));
    const check = checkAbilityGrowth(rules, pools, target, current);
    if (check.ok === false) redirect(withQuery(returnTo, "error=touhou-growth"));
    const nextPools = {
      ...pools,
      spent: { ...pools.spent, ability: pools.spent.ability + check.cost },
      spentByAbility: {
        ...pools.spentByAbility,
        [target]: (pools.spentByAbility[target] ?? 0) + check.cost
      }
    };
    const nextBackstory = { ...backstory, abilities: { ...abilities, [target]: check.to } };
    await prisma.$transaction(async (tx) => {
      await tx.character.update({
        where: { id: characterId },
        data: { backstory: nextBackstory as never, sourceData: withTouhouGrowth(character.sourceData, nextPools) as never }
      });
      await tx.characterAdvancement.create({
        data: {
          characterId, gameId: null, kind: "OTHER", target, delta: 1,
          note: "千幻抄能力成长：" + target + " Lv" + current + " → Lv" + check.to + "（花费 " + check.cost + " 点）",
          source: "END_REWARD", createdBy: session.user.id,
          metadata: { touhouAbility: target, touhouGrowthCost: check.cost } as never
        }
      });
    });
  } else {
    redirect(withQuery(returnTo, "error=touhou-growth"));
  }

  revalidatePath(returnTo);
  redirect(withQuery(returnTo, "growth=spent"));
}
