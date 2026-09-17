"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";
import { loadEffectivePack } from "@/server/rules/loader";
import { castOutsideCombat, listOutOfCombatMagic, parseMagicRef } from "@/server/magic/out-of-combat";
import { emitRoomRefresh } from "@/server/realtime";

function errorUrl(roomId: string, message: string): string {
  return "/rooms/" + roomId + "?magicError=" + encodeURIComponent(message);
}

/** 战斗外施法：只允许不依赖战斗结算的法术。 */
export async function castOutsideCombatAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");
  const roomId = String(formData.get("roomId") ?? "");
  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId, userId: session.user.id } },
    include: { room: true }
  });
  if (membership === null) redirect("/");
  const room = membership.room;
  const isKP = membership.role === "KP";

  const caster = parseMagicRef(String(formData.get("casterRef") ?? ""));
  const target = parseMagicRef(String(formData.get("targetRef") ?? ""));
  const spellId = String(formData.get("spellId") ?? "");
  if (caster === null || target === null || spellId.length === 0) {
    redirect(errorUrl(room.id, "请选择施法者、目标与法术"));
  }
  // 玩家只能用自己的角色施法。
  if (isKP === false) {
    if (caster.kind !== "CHARACTER") redirect(errorUrl(room.id, "你只能用自己的角色施法"));
    const entry = await prisma.roomCharacterEntry.findFirst({
      where: { roomId: room.id, characterId: caster.id, status: "APPROVED" },
      include: { character: { select: { userId: true } } }
    });
    if (entry === null || entry.character.userId !== session.user.id) {
      redirect(errorUrl(room.id, "你不能操控这个角色"));
    }
  }

  const effective = await loadEffectivePack({
    id: room.id,
    system: room.system,
    rulePackVersionId: room.rulePackVersionId,
    ruleOverride: room.ruleOverride
  });

  // 服务端权威校验：施法者必须持有该法术、在当前场景，且目标在当前场景内合法。
  const view = await listOutOfCombatMagic({
    roomId: room.id,
    userId: session.user.id,
    isKP,
    pack: effective.compiled
  });
  const casterRef = String(formData.get("casterRef") ?? "");
  const targetRef = String(formData.get("targetRef") ?? "");
  const casterOption = view.casters.find((item) => item.ref === casterRef);
  if (casterOption === undefined) {
    redirect(errorUrl(room.id, "当前场景没有可施法的角色 / 召唤物，或你没有持有可施放的法术"));
  }
  const spellOption = casterOption.spells.find((item) => item.id === spellId || item.name === spellId);
  if (spellOption === undefined) {
    redirect(errorUrl(room.id, "该施法者没有持有这个法术，或当前场景没有合法目标"));
  }
  if (spellOption.targetRefs.includes(targetRef) === false) {
    redirect(errorUrl(room.id, "目标不在当前场景，或不是该法术的合法目标"));
  }
  const spell = effective.compiled.pack.magic?.spells.find((item) => item.id === spellOption.id);
  if (spell === undefined) redirect(errorUrl(room.id, "没有找到这个法术"));

  const result = await castOutsideCombat({
    roomId: room.id,
    pack: effective.compiled,
    spell,
    caster,
    target,
    sceneId: view.sceneId
  });
  if (result.ok === false) {
    redirect(errorUrl(room.id, result.error ?? "施法失败"));
  }
  emitRoomRefresh(room.id, "magic-out-of-combat");
  revalidatePath("/rooms/" + room.id);
  redirect("/rooms/" + room.id + "?magicCast=" + encodeURIComponent(spell.name + "：" + result.log.join("，")));
}
