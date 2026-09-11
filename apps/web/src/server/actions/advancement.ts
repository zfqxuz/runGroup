"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { buildEffectiveSkills } from "@/server/character/skills";
import { prisma } from "@/server/db/prisma";
import {
  applyAdvancementEffect,
  reverseAdvancementEffect,
  validateAdvancement
} from "@/server/game/advancement";
import { resolveGameGrowthChecks } from "@/server/game/growth";
import { isActiveGameStatus, isAdvancementSource } from "@/server/game/view";
import { emitAdvancementUpdate } from "@/server/realtime";
import { loadEffectivePack } from "@/server/rules/loader";

function clean(value: FormDataEntryValue | null, maxLength: number): string {
  return String(value ?? "").trim().slice(0, maxLength);
}

function optionalClean(value: FormDataEntryValue | null, maxLength: number): string | null {
  const text = clean(value, maxLength);
  return text.length === 0 ? null : text;
}

function integerOf(value: FormDataEntryValue | null): number | null {
  const text = String(value ?? "").trim();
  if (text.length === 0) return null;
  const number = Number(text);
  if (Number.isFinite(number) === false) return null;
  if (Math.floor(number) !== number) return null;
  return number;
}

function withQuery(pathName: string, query: string): string {
  const separator = pathName.includes("?") ? "&" : "?";
  return pathName + separator + query;
}

function safeReturnPath(raw: string, fallback: string): string {
  if (raw.startsWith("/") && raw.startsWith("//") === false) return raw;
  return fallback;
}

async function requireKP(roomId: string, userId: string): Promise<boolean> {
  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId, userId } },
    select: { role: true }
  });
  return membership !== null && membership.role === "KP";
}

interface ManageableAdvancement {
  readonly id: string;
  readonly characterId: string;
  readonly gameId: string | null;
  readonly kind: string;
  readonly target: string | null;
  readonly delta: number | null;
  readonly note: string | null;
  readonly source: string;
  readonly createdBy: string | null;
  readonly metadata: unknown;
  readonly revertedAt: Date | null;
  readonly roomId: string | null;
  readonly characterUserId: string;
}

async function loadManageableAdvancement(
  advancementId: string,
  userId: string
): Promise<ManageableAdvancement | null> {
  const row = await prisma.characterAdvancement.findUnique({
    where: { id: advancementId },
    include: {
      character: { select: { userId: true } },
      game: { select: { roomId: true } }
    }
  });
  if (row === null) return null;

  const base: ManageableAdvancement = {
    id: row.id,
    characterId: row.characterId,
    gameId: row.gameId,
    kind: row.kind,
    target: row.target,
    delta: row.delta,
    note: row.note,
    source: row.source,
    createdBy: row.createdBy,
    metadata: row.metadata,
    revertedAt: row.revertedAt,
    roomId: row.game?.roomId ?? null,
    characterUserId: row.character.userId
  };

  if (row.character.userId === userId) return base;
  if (base.roomId === null) return null;
  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId: base.roomId, userId } },
    select: { role: true }
  });
  return membership !== null && membership.role === "KP" ? base : null;
}

export async function markGrowthCheckAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");

  const roomId = clean(formData.get("roomId"), 64);
  const gameId = clean(formData.get("gameId"), 64);
  const characterId = clean(formData.get("characterId"), 64);
  const skillId = clean(formData.get("skillId"), 120);
  const note = optionalClean(formData.get("note"), 500);
  const fallback = roomId.length === 0 ? "/" : "/rooms/" + roomId;
  const returnTo = safeReturnPath(clean(formData.get("returnTo"), 300), fallback);
  if (roomId.length === 0 || gameId.length === 0 || characterId.length === 0 || skillId.length === 0) {
    redirect(withQuery(returnTo, "error=growth"));
  }

  if ((await requireKP(roomId, session.user.id)) === false) redirect("/rooms/" + roomId);

  const game = await prisma.game.findUnique({ where: { id: gameId }, select: { roomId: true, status: true } });
  if (game === null || game.roomId !== roomId || isActiveGameStatus(game.status) === false) {
    redirect(withQuery(returnTo, "error=game"));
  }

  const gameCharacter = await prisma.gameCharacter.findUnique({
    where: { gameId_characterId: { gameId, characterId } },
    include: { character: true }
  });
  if (gameCharacter === null) redirect(withQuery(returnTo, "error=growth"));

  const room = await prisma.room.findUnique({
    where: { id: roomId },
    select: { system: true, rulePackVersionId: true, ruleOverride: true }
  });
  if (room === null) redirect("/");

  const pack = await loadEffectivePack({
    id: roomId,
    system: room.system,
    rulePackVersionId: room.rulePackVersionId,
    ruleOverride: room.ruleOverride
  });
  const skill = pack.compiled.skills.find((item) => item.id === skillId);
  if (skill === undefined) redirect(withQuery(returnTo, "error=growth"));

  const effective = buildEffectiveSkills(pack.compiled, gameCharacter.character);
  const beforeValue = effective[skillId] ?? 0;
  const existing = await prisma.growthCheck.findUnique({
    where: { gameId_characterId_skillId: { gameId, characterId, skillId } }
  });
  if (existing !== null && existing.state !== "CANCELLED") {
    redirect(withQuery(returnTo, "growth=exists"));
  }

  if (existing === null) {
    await prisma.growthCheck.create({
      data: { gameId, characterId, skillId, skillName: skill.name, beforeValue, note, createdBy: session.user.id }
    });
  } else {
    await prisma.growthCheck.update({
      where: { id: existing.id },
      data: {
        state: "PENDING",
        skillName: skill.name,
        beforeValue,
        note,
        roll: null,
        gain: null,
        resolvedAt: null,
        resolvedBy: null,
        advancementId: null,
        createdBy: session.user.id
      }
    });
  }

  emitAdvancementUpdate(roomId, gameId, characterId);
  revalidatePath("/rooms/" + roomId);
  revalidatePath("/rooms/" + roomId + "/end");
  redirect(withQuery(returnTo, "growth=marked"));
}

export async function cancelGrowthCheckAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");

  const roomId = clean(formData.get("roomId"), 64);
  const checkId = clean(formData.get("checkId"), 64);
  const returnTo = safeReturnPath(clean(formData.get("returnTo"), 300), "/rooms/" + roomId);
  if (roomId.length === 0 || checkId.length === 0) redirect("/rooms/" + roomId);

  if ((await requireKP(roomId, session.user.id)) === false) redirect("/rooms/" + roomId);

  const check = await prisma.growthCheck.findUnique({
    where: { id: checkId },
    include: { game: { select: { roomId: true, status: true } } }
  });
  if (check === null || check.game.roomId !== roomId) redirect(withQuery(returnTo, "error=growth"));
  if (check.state !== "PENDING") redirect(withQuery(returnTo, "growth=locked"));

  await prisma.growthCheck.update({ where: { id: checkId }, data: { state: "CANCELLED" } });

  emitAdvancementUpdate(roomId, check.gameId, check.characterId);
  revalidatePath("/rooms/" + roomId);
  revalidatePath("/rooms/" + roomId + "/end");
  redirect(withQuery(returnTo, "growth=cancelled"));
}

export async function resolveGrowthCheckAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");

  const roomId = clean(formData.get("roomId"), 64);
  const gameId = clean(formData.get("gameId"), 64);
  const characterId = optionalClean(formData.get("characterId"), 64);
  const seed = optionalClean(formData.get("seed"), 120);
  const returnTo = safeReturnPath(clean(formData.get("returnTo"), 300), "/rooms/" + roomId);
  if (roomId.length === 0 || gameId.length === 0) redirect("/rooms/" + roomId);

  if ((await requireKP(roomId, session.user.id)) === false) redirect("/rooms/" + roomId);

  const game = await prisma.game.findUnique({ where: { id: gameId }, select: { roomId: true, status: true } });
  if (game === null || game.roomId !== roomId || isActiveGameStatus(game.status) === false) {
    redirect(withQuery(returnTo, "error=game"));
  }

  const outcome = await prisma.$transaction((tx) =>
    resolveGameGrowthChecks(tx, {
      gameId,
      actorId: session.user.id,
      characterId,
      seed
    })
  );
  if (outcome.resolved === 0) redirect(withQuery(returnTo, "growth=none"));

  for (const result of outcome.results) {
    emitAdvancementUpdate(roomId, gameId, result.characterId);
  }
  revalidatePath("/rooms/" + roomId);
  revalidatePath("/rooms/" + roomId + "/end");
  redirect(withQuery(returnTo, outcome.passed > 0 ? "growth=passed" : "growth=failed"));
}

export async function updateAdvancementAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");

  const advancementId = clean(formData.get("advancementId"), 64);
  if (advancementId.length === 0) redirect("/");
  const row = await loadManageableAdvancement(advancementId, session.user.id);
  if (row === null) redirect("/");
  const fallback = row.roomId === null ? "/characters/" + row.characterId : "/rooms/" + row.roomId;
  const returnTo = safeReturnPath(clean(formData.get("returnTo"), 300), fallback);
  if (row.revertedAt !== null) redirect(withQuery(returnTo, "advancement=locked"));

  const target = optionalClean(formData.get("target"), 120);
  const delta = integerOf(formData.get("delta"));
  const note = optionalClean(formData.get("note"), 1000);
  const sourceRaw = clean(formData.get("source"), 40);
  const source = sourceRaw.length === 0 ? row.source : sourceRaw;
  if (isAdvancementSource(source) === false) redirect(withQuery(returnTo, "advancement=error"));

  const validation = validateAdvancement(row.kind, target, delta, note);
  if (validation.ok === false) redirect(withQuery(returnTo, "advancement=error"));

  await prisma.$transaction(async (tx) => {
    const current = await tx.character.findUnique({ where: { id: row.characterId } });
    if (current === null) return;
    await reverseAdvancementEffect(tx, row.characterId, current, {
      kind: row.kind,
      target: row.target,
      delta: row.delta
    });
    const fresh = await tx.character.findUnique({ where: { id: row.characterId } });
    if (fresh === null) return;
    await applyAdvancementEffect(tx, row.characterId, fresh, validation.value);
    await tx.characterAdvancement.update({
      where: { id: row.id },
      data: {
        target: validation.value.target,
        delta: validation.value.delta,
        note: validation.value.note,
        source,
        editedAt: new Date()
      }
    });
  });

  if (row.roomId !== null) emitAdvancementUpdate(row.roomId, row.gameId ?? "", row.characterId);
  revalidatePath("/characters/" + row.characterId);
  if (row.roomId !== null) {
    revalidatePath("/rooms/" + row.roomId);
    revalidatePath("/rooms/" + row.roomId + "/end");
  }
  redirect(withQuery(returnTo, "advancement=updated"));
}

export async function revertAdvancementAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");

  const advancementId = clean(formData.get("advancementId"), 64);
  if (advancementId.length === 0) redirect("/");
  const row = await loadManageableAdvancement(advancementId, session.user.id);
  if (row === null) redirect("/");
  const fallback = row.roomId === null ? "/characters/" + row.characterId : "/rooms/" + row.roomId;
  const returnTo = safeReturnPath(clean(formData.get("returnTo"), 300), fallback);
  if (row.revertedAt !== null) redirect(withQuery(returnTo, "advancement=locked"));

  await prisma.$transaction(async (tx) => {
    const current = await tx.character.findUnique({ where: { id: row.characterId } });
    if (current === null) return;
    await reverseAdvancementEffect(tx, row.characterId, current, {
      kind: row.kind,
      target: row.target,
      delta: row.delta
    });
    await tx.characterAdvancement.update({
      where: { id: row.id },
      data: { revertedAt: new Date(), revertedBy: session.user.id }
    });
  });

  if (row.roomId !== null) emitAdvancementUpdate(row.roomId, row.gameId ?? "", row.characterId);
  revalidatePath("/characters/" + row.characterId);
  if (row.roomId !== null) {
    revalidatePath("/rooms/" + row.roomId);
    revalidatePath("/rooms/" + row.roomId + "/end");
  }
  redirect(withQuery(returnTo, "advancement=reverted"));
}
