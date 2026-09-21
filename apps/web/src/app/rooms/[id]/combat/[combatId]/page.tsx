import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { CombatState } from "@touhou/combat";
import { spellTargeting } from "@touhou/rules";
import CombatBoard from "@/components/room/CombatBoard";
import KpBgmPanel from "@/components/room/KpBgmPanel";
import KpValueEditor from "@/components/room/KpValueEditor";
import KpToolsPanel from "@/components/room/KpToolsPanel";
import RoomBgmPlayer from "@/components/room/RoomBgmPlayer";
import { auth } from "@/server/auth";
import { combatFeatureFlags, loadAttackOptionsByParticipant, loadNpcWeaponsByParticipant, type CombatAttackOption } from "@/server/combat/options";
import { loadItemsByParticipant } from "@/server/combat/items";
import type { CombatItemOption } from "@/shared/combat-items";
import { loadNpcSpellcardsByParticipant, loadSpellcardsByParticipant } from "@/server/combat/spellcards";
import type { CombatSpellCardOption } from "@/shared/danmaku/spellcards";
import { prisma } from "@/server/db/prisma";
import { loadEffectivePack } from "@/server/rules/loader";
import { readRoomBgm } from "@/shared/bgm";
import { magicSpellEffectLabels } from "@/shared/magic";
import { buildAbilityHints } from "@/shared/ability-hints";

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
  const attackOptionsByParticipant: Record<string, readonly CombatAttackOption[]> = {};
  const spellIdsByParticipant: Record<string, readonly string[]> = {};
  const spellCardsByParticipant: Record<string, readonly CombatSpellCardOption[]> = {};
  if (snapshot !== null) {
    const state = snapshot.state as unknown as CombatState;
    const npcWeaponsByParticipant = await loadNpcWeaponsByParticipant(
      combat.id,
      state.participants.map((participant) => ({ id: participant.id, kind: participant.kind }))
    );
    const attackOptions = await loadAttackOptionsByParticipant(
      effective.compiled,
      state.participants.map((participant) => ({
        id: participant.id,
        kind: participant.kind,
        characterId: participant.characterId,
        skills: participant.skills
      })),
      npcWeaponsByParticipant
    );
    for (const [participantId, options] of attackOptions) {
      attackOptionsByParticipant[participantId] = options;
    }
    for (const participant of state.participants) {
      const raw = (participant as unknown as { spells?: unknown }).spells;
      spellIdsByParticipant[participant.id] = Array.isArray(raw)
        ? raw.filter((item): item is string => typeof item === "string")
        : [];
    }

    if (room.system === "TOUHOU") {
      const participantRefs = state.participants.map((participant) => ({
        id: participant.id,
        characterId: participant.characterId
      }));
      const npcSpellcardsByParticipant = await loadNpcSpellcardsByParticipant(combat.id, participantRefs);
      const spellCards = await loadSpellcardsByParticipant("TOUHOU", participantRefs, npcSpellcardsByParticipant);
      for (const [participantId, cards] of spellCards) {
        spellCardsByParticipant[participantId] = cards;
      }
    }
  }

  const participants = await prisma.combatParticipant.findMany({
    where: { combatId: combat.id },
    select: { id: true, name: true, isNPC: true, characterId: true, npcData: true }
  });
  // NPC 的运行时 participant.id 是卡牌 id（npcData.__participantId），
  // 不是 CombatParticipant 行的 cuid；KP 数值/工具引用必须使用运行时 id，
  // 否则房间实时数值、环境伤害、状态编辑都会查不到单位。
  const valueUnits = participants.map((participant) => {
    const npcData =
      participant.npcData !== null && typeof participant.npcData === "object" && Array.isArray(participant.npcData) === false
        ? (participant.npcData as Record<string, unknown>)
        : {};
    const runtimeId =
      participant.isNPC && typeof npcData.__participantId === "string"
        ? npcData.__participantId
        : participant.id;
    return {
      ref: participant.isNPC ? "npc:" + runtimeId : "character:" + (participant.characterId ?? participant.id),
      name: participant.name,
      kind: participant.isNPC ? ("NPC" as const) : ("PLAYER" as const)
    };
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
            userId: true,
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
  const itemOptionsByParticipant: Record<string, readonly CombatItemOption[]> = {};
  if (snapshot !== null) {
    const state = snapshot.state as unknown as CombatState;
    const ownedCharacterIds = new Set(
      characters.filter((character) => character.userId === session.user.id).map((character) => character.id)
    );
    const items = await loadItemsByParticipant(
      state.participants.map((participant) => ({
        id: participant.id,
        characterId: participant.characterId
      }))
    );
    for (const [participantId, options] of items) {
      const participant = state.participants.find((item) => item.id === participantId);
      const isMine = participant?.characterId !== null && participant?.characterId !== undefined
        ? ownedCharacterIds.has(participant.characterId)
        : false;
      if (membership.role === "KP" || isMine) itemOptionsByParticipant[participantId] = options;
    }
  }

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

  const bgmGame = await prisma.game.findFirst({
    where: { roomId: room.id, status: { in: ["PLAYING", "COMBAT"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true, state: { select: { custom: true } } }
  });
  const roomBgm = bgmGame?.state === null || bgmGame?.state === undefined ? null : readRoomBgm(bgmGame.state.custom);

  const combatFeatures = combatFeatureFlags(effective.compiled);
  const isKP = membership.role === "KP";
  const abilityHints = buildAbilityHints(effective.compiled.pack);
  const dpCosts = effective.compiled.pack.dp?.actionCosts ?? null;

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
            <span className="text-white/35"></span>
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

      <RoomBgmPlayer roomId={room.id} initialBgm={roomBgm} />

      {isKP && bgmGame !== null ? (
        <KpBgmPanel
          roomId={room.id}
          gameId={bgmGame.id}
          bgm={roomBgm}
          status={null}
          returnTo={"/rooms/" + room.id + "/combat/" + combat.id}
        />
      ) : null}

      {isKP ? <KpValueEditor roomId={room.id} units={valueUnits} /> : null}
      {isKP ? <KpToolsPanel roomId={room.id} units={valueUnits} /> : null}

      <CombatBoard
        roomId={room.id}
        combatId={combat.id}
        isKP={isKP}
        skillOptions={skillOptions}
        system={room.system}
        canCounter={combatFeatures.canCounter}
        canOutOfRule={combatFeatures.canOutOfRule}
        canCastMagic={combatFeatures.canCastMagic}
        canCastSpellcard={combatFeatures.canCastSpellcard}
        magicSpells={(effective.compiled.pack.magic?.spells ?? []).map((spell) => ({
          id: spell.id,
          name: spell.name,
          description: spell.description,
          mpCost: spell.mpCost,
          sanCost: spell.sanCost,
          damage: spell.damage,
          target: spell.target,
          targeting: spellTargeting(spell),
          effects: magicSpellEffectLabels(spell),
          abilityId: spell.abilityId,
          battleAttackKind: spell.battleAttack?.kind ?? null,
          battleAttackLabel:
            spell.battleAttack === undefined
              ? undefined
              : [
                  spell.battleAttack.bonusDice !== "0" ? "追加 " + spell.battleAttack.bonusDice + "D" : null,
                  spell.battleAttack.flatDamage !== "0" ? "伤害 +" + spell.battleAttack.flatDamage : null,
                  spell.battleAttack.danmakuDpReduction !== "0"
                    ? "回避 DP +" + spell.battleAttack.danmakuDpReduction
                    : null,
                  spell.battleAttack.multiTarget ? "多目标" : null,
                  spell.battleAttack.ignoreFormation ? "无视前卫/后卫" : null
                ]
                  .filter((part): part is string => part !== null)
                  .join(" / ") || undefined
        }))}
        attackOptionsByParticipant={attackOptionsByParticipant}
        itemOptionsByParticipant={itemOptionsByParticipant}
        spellIdsByParticipant={spellIdsByParticipant}
        spellCardsByParticipant={spellCardsByParticipant}
        abilityHints={abilityHints}
        dpCosts={dpCosts}
        portraits={portraits}
      />
    </main>
  );
}
