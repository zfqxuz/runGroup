import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { CombatState } from "@touhou/combat";
import { spellTargeting } from "@touhou/rules";
import CombatBoard from "@/components/room/CombatBoard";
import { auth } from "@/server/auth";
import { combatFeatureFlags, loadAttackSkillsByParticipant } from "@/server/combat/options";
import { prisma } from "@/server/db/prisma";
import { loadEffectivePack } from "@/server/rules/loader";
import { magicSpellEffectLabels } from "@/shared/magic";

export const dynamic = "force-dynamic";

export default async function CombatDetailPage({
  params
}: {
  params: { id: string; combatId: string };
}) {
  const session = await auth();
  if (session === null) redirect("/login");

  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId: params.id, userId: session.user.id } },
    include: { room: true }
  });
  if (membership === null) notFound();
  const room = membership.room;
  if (room.status === "LOBBY") redirect("/rooms/" + room.id + "/prepare");

  const combat = await prisma.combat.findUnique({ where: { id: params.combatId } });
  if (combat === null || combat.roomId !== room.id) notFound();
  // 已结束的战斗回到房间页；战斗逻辑与快照仍保留在数据库中。
  if (combat.endedAt !== null) redirect("/rooms/" + room.id + "?combat=ended");

  const effective = await loadEffectivePack({
    id: room.id,
    system: room.system,
    rulePackVersionId: room.rulePackVersionId,
    ruleOverride: room.ruleOverride
  });
  const skillOptions = effective.compiled.skills.map((skill) => ({ id: skill.id, name: skill.name }));

  const snapshot = await prisma.combatSnapshot.findFirst({
    where: { combatId: combat.id },
    orderBy: { seq: "desc" },
    select: { state: true }
  });
  const attackSkillsByParticipant: Record<string, readonly string[]> = {};
  if (snapshot !== null) {
    const state = snapshot.state as unknown as CombatState;
    const attackSkills = await loadAttackSkillsByParticipant(
      effective.compiled,
      state.participants.map((participant) => ({
        id: participant.id,
        kind: participant.kind,
        characterId: participant.characterId,
        skills: participant.skills
      }))
    );
    for (const [participantId, skillIds] of attackSkills) {
      attackSkillsByParticipant[participantId] = skillIds;
    }
  }

  const participants = await prisma.combatParticipant.findMany({
    where: { combatId: combat.id },
    select: { id: true, isNPC: true, characterId: true }
  });
  const characterIds = participants
    .map((participant) => participant.characterId)
    .filter((id): id is string => id !== null);
  const npcIds = participants.filter((participant) => participant.isNPC).map((participant) => participant.id);
  const [characters, npcCards] = await Promise.all([
    characterIds.length === 0
      ? Promise.resolve([])
      : prisma.character.findMany({
          where: { id: { in: characterIds } },
          select: {
            id: true,
            portrait: { select: { url: true, thumbnailUrl: true } },
            avatar: { select: { url: true, thumbnailUrl: true } }
          }
        }),
    npcIds.length === 0
      ? Promise.resolve([])
      : prisma.card.findMany({
          where: { id: { in: npcIds } },
          select: { id: true, imageUrl: true, thumbnailUrl: true }
        })
  ]);
  const characterImage = new Map(
    characters.map((character) => [
      character.id,
      character.portrait?.url ?? character.portrait?.thumbnailUrl ?? character.avatar?.url ?? character.avatar?.thumbnailUrl ?? null
    ])
  );
  const npcImage = new Map(npcCards.map((card) => [card.id, card.imageUrl ?? card.thumbnailUrl ?? null]));
  const portraits: Record<string, string> = {};
  for (const participant of participants) {
    const url = participant.characterId === null ? npcImage.get(participant.id) : characterImage.get(participant.characterId);
    if (url !== null && url !== undefined) portraits[participant.id] = url;
  }

  const combatFeatures = combatFeatureFlags(effective.compiled);
  const isKP = membership.role === "KP";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1500px] flex-col gap-5 px-6 py-10">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href={"/rooms/" + room.id} className="text-xs text-white/40 transition hover:text-white/70">
            ← 返回房间视角
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">战斗 · {room.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-3 text-xs text-white/50">
            <span className="rounded-full border border-spirit-400/30 px-2 py-0.5 text-spirit-400">{room.system}</span>
            <span className="rounded-full border border-white/15 px-2 py-0.5">{room.status}</span>
            <span className="rounded-full border border-sakura-500/40 px-2 py-0.5 text-sakura-400">
              我的身份：{membership.role}
            </span>
            <span className="text-white/35">战斗逻辑与快照仍保存在原系统中</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={"/rooms/" + room.id}
            className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/60 transition hover:border-white/35"
          >
            房间视角
          </Link>
        </div>
      </header>

      <CombatBoard
        roomId={room.id}
        combatId={combat.id}
        isKP={isKP}
        skillOptions={skillOptions}
        system={room.system}
        canCounter={combatFeatures.canCounter}
        canOutOfRule={combatFeatures.canOutOfRule}
        canCastMagic={combatFeatures.canCastMagic}
        magicSpells={(effective.compiled.pack.magic?.spells ?? []).map((spell) => ({
          id: spell.id,
          name: spell.name,
          description: spell.description,
          mpCost: spell.mpCost,
          sanCost: spell.sanCost,
          damage: spell.damage,
          target: spell.target,
          targeting: spellTargeting(spell),
          effects: magicSpellEffectLabels(spell)
        }))}
        attackSkillsByParticipant={attackSkillsByParticipant}
        portraits={portraits}
      />
    </main>
  );
}
