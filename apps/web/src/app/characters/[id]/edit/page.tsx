import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { builtinRegistry, resolveRulePack, type AttributeSet } from "@touhou/rules";
import CharacterBuilder, { type CharacterEditorInitial, type CharacterItemDraft } from "@/components/room/CharacterBuilder";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";
import { availableEra, toOccupationView } from "@/shared/occupation";

export const dynamic = "force-dynamic";

function recordOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && Array.isArray(value) === false
    ? (value as Record<string, unknown>)
    : {};
}

function pointMapOf(value: unknown): Record<string, number> {
  const output: Record<string, number> = {};
  for (const [key, raw] of Object.entries(recordOf(value))) {
    const number = Math.floor(Number(raw));
    if (Number.isFinite(number) && number > 0) output[key] = number;
  }
  return output;
}

function slotsOf(value: unknown): Record<string, string[]> {
  const output: Record<string, string[]> = {};
  for (const [key, raw] of Object.entries(recordOf(value))) {
    output[key] = Array.isArray(raw) ? raw.filter((item): item is string => typeof item === "string") : [];
  }
  return output;
}

function combatModeOf(ruleOverride: unknown): "INITIATIVE" | "ATB" | "DP" {
  if (ruleOverride === null || typeof ruleOverride !== "object" || Array.isArray(ruleOverride)) {
    return "INITIATIVE";
  }
  const combat = (ruleOverride as Record<string, unknown>).combat;
  if (combat === null || typeof combat !== "object" || Array.isArray(combat)) return "INITIATIVE";
  const mode = (combat as Record<string, unknown>).mode;
  return mode === "DP" || mode === "ATB" ? mode : "INITIATIVE";
}

function attributesOf(base: Record<string, unknown>): AttributeSet {
  return {
    str: Math.floor(Number(base.str ?? 0)),
    con: Math.floor(Number(base.con ?? 0)),
    siz: Math.floor(Number(base.siz ?? 0)),
    dex: Math.floor(Number(base.dex ?? 0)),
    app: Math.floor(Number(base.app ?? 0)),
    int: Math.floor(Number(base.int ?? 0)),
    pow: Math.floor(Number(base.pow ?? 0)),
    edu: Math.floor(Number(base.edu ?? 0)),
    luck: Math.floor(Number(base.luck ?? 0))
  };
}

export default async function EditCharacterPage({
  params,
  searchParams
}: {
  params: { id: string };
  searchParams: { roomId?: string };
}) {
  const session = await auth();
  if (session === null) redirect("/login");

  const character = await prisma.character.findUnique({
    where: { id: params.id },
    include: { cards: { where: { characterId: params.id }, orderBy: { createdAt: "asc" } } }
  });
  if (character === null) notFound();

  const roomId = searchParams.roomId ?? null;
  const isOwner = character.userId === session.user.id;
  let room = null;
  if (isOwner === false) {
    if (roomId === null) notFound();
    const membership = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId: session.user.id } },
      include: { room: true }
    });
    if (membership === null || membership.role !== "KP") notFound();
    const entry = await prisma.roomCharacterEntry.findUnique({
      where: { roomId_characterId: { roomId, characterId: character.id } }
    });
    if (entry === null || entry.status !== "APPROVED") notFound();
    room = membership.room;
  }

  const availableCards = await prisma.card.findMany({
    where: { ownerId: character.userId, scope: "COMPENDIUM", characterId: null, system: character.system },
    orderBy: { createdAt: "desc" },
    select: { id: true, type: true, name: true, subtitle: true, stats: true, scope: true }
  });

  const system = (room?.system ?? character.system) === "TOUHOU" ? "TOUHOU" : "COC7";
  const pack = resolveRulePack(system === "TOUHOU" ? "touhou-ext" : "coc7-baseline", builtinRegistry());
  const occupations = await prisma.occupation.findMany({
    where: { system, era: { in: [...availableEra(room?.era ?? character.era)] } },
    orderBy: { code: "asc" }
  });

  const mods = recordOf(character.raceMods);
  const base = recordOf(mods.baseAttributes);
  const hasBase = Object.keys(base).length > 0;
  const ageAdjusted = mods.ageAdjusted === false ? false : true;
  const applyAgeAdjustment = system === "COC7" && hasBase && ageAdjusted;
  const allocation = recordOf(character.skillAllocation);

  const initial: CharacterEditorInitial = {
    id: character.id,
    name: character.name,
    playerName: character.playerName,
    gender: character.gender,
    residence: character.residence,
    race: character.race,
    attributes: applyAgeAdjustment
      ? attributesOf(base)
      : {
          str: character.str,
          con: character.con,
          siz: character.siz,
          dex: character.dex,
          app: character.app,
          int: character.int,
          pow: character.pow,
          edu: character.edu,
          luck: character.luck
        },
    age: character.age,
    ageAllocation: recordOf(mods.ageAllocation),
    occupationId: character.occupationId,
    occupationAdded: pointMapOf(allocation.occupation),
    interestAdded: pointMapOf(allocation.interest),
    slotAssignments: slotsOf(allocation.slots),
    backstory: recordOf(character.backstory),
    sourceData: recordOf(character.sourceData),
    assets: recordOf(recordOf(character.sourceData).assets),
    items: character.cards.map((card): CharacterItemDraft => ({
      id: card.id,
      kind: card.type === "WEAPON" || card.type === "SPELLCARD" ? card.type : "ITEM",
      name: card.name,
      subtitle: card.subtitle,
      description: card.description,
      stats: recordOf(card.stats)
    }))
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-6 py-12">
      <header>
        <Link
          href={roomId === null ? "/characters" : "/rooms/" + roomId + "/characters/" + character.id}
          className="text-xs text-white/40 transition hover:text-white/70"
        >
          ← 返回
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">编辑角色 · {character.name}</h1>
        <p className="mt-1 text-xs text-white/45">第一页必填，第二页选填。</p>
      </header>
      <CharacterBuilder
        roomId={roomId}
        system={system}
        pack={pack}
        chargenMethod={typeof mods.method === "string" ? mods.method : pack.attributes.methods[0]?.id ?? "manual"}
        era={room?.era ?? character.era ?? null}
        occupations={occupations.map(toOccupationView)}
        mode="EDIT"
        combatMode={system === "TOUHOU" ? (room === null ? undefined : combatModeOf(room.ruleOverride)) : undefined}
        characterId={character.id}
        initial={initial}
        applyAgeAdjustment={applyAgeAdjustment}
        returnTo={"/characters/" + character.id + "/edit" + (roomId === null ? "" : "?roomId=" + roomId)}
        availableCards={availableCards
          .filter((card) => card.type === "WEAPON" || card.type === "ITEM" || card.type === "SPELLCARD")
          .map((card) => ({
            id: card.id,
            kind: card.type as "WEAPON" | "ITEM" | "SPELLCARD",
            name: card.name,
            subtitle: card.subtitle,
            stats: recordOf(card.stats),
            scope: card.scope
          }))}
      />
    </main>
  );
}
