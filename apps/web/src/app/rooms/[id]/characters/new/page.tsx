import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { builtinRegistry, resolveRulePack } from "@touhou/rules";
import CharacterBuilder from "@/components/room/CharacterBuilder";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";
import { availableEra, toOccupationView } from "@/shared/occupation";
import { specialtyCandidatesOf } from "@/shared/specialty";

export const dynamic = "force-dynamic";

function combatModeOf(ruleOverride: unknown): "INITIATIVE" | "ATB" | "DP" {
  if (ruleOverride === null || typeof ruleOverride !== "object" || Array.isArray(ruleOverride)) {
    return "INITIATIVE";
  }
  const combat = (ruleOverride as Record<string, unknown>).combat;
  if (combat === null || typeof combat !== "object" || Array.isArray(combat)) return "INITIATIVE";
  const mode = (combat as Record<string, unknown>).mode;
  return mode === "DP" || mode === "ATB" ? mode : "INITIATIVE";
}

export default async function NewCharacterPage({ params }: { params: { id: string } }) {
  const session = await auth();
  if (session === null) redirect("/login");

  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId: params.id, userId: session.user.id } },
    include: { room: true }
  });
  if (membership === null) notFound();

  const room = membership.room;
  const pack = resolveRulePack(
    room.system === "TOUHOU" ? "touhou-ext" : "coc7-baseline",
    builtinRegistry()
  );
  const occupations = await prisma.occupation.findMany({
    where: { system: room.system, era: { in: [...availableEra(room.era)] } },
    orderBy: { code: "asc" }
  });
  const availableCards = await prisma.card.findMany({
    where: { ownerId: session.user.id, scope: "COMPENDIUM", characterId: null, system: room.system },
    orderBy: { createdAt: "desc" },
    select: { id: true, type: true, name: true, subtitle: true, stats: true, scope: true }
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-6 py-12">
      <header>
        <Link
          href={"/rooms/" + room.id + "/prepare"}
          className="text-xs text-white/40 transition hover:text-white/70"
        >
          ← 返回房间准备页
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">新建角色卡</h1>
        <p className="mt-1 text-sm text-white/50">
          {room.name} · {pack.id}@{pack.version}
          {room.era === null ? "" : room.era === "CLASSIC" ? " · 1920 年代" : " · 现代"}
        </p>
      </header>

      <CharacterBuilder
        roomId={room.id}
        system={room.system}
        pack={pack}
        chargenMethod={room.chargenMethod ?? "destiny5"}
        era={room.era}
        specialtyCandidates={specialtyCandidatesOf(room.ruleOverride)}
        occupations={occupations.map(toOccupationView)}
        mode="CREATE"
        combatMode={room.system === "TOUHOU" ? combatModeOf(room.ruleOverride) : undefined}
        returnTo={"/rooms/" + room.id + "/characters/new"}
        availableCards={availableCards
          .filter((card) => card.type === "WEAPON" || card.type === "ITEM" || card.type === "SPELLCARD")
          .map((card) => ({
            id: card.id,
            kind: card.type as "WEAPON" | "ITEM" | "SPELLCARD",
            name: card.name,
            subtitle: card.subtitle,
            stats: card.stats !== null && typeof card.stats === "object" && Array.isArray(card.stats) === false ? (card.stats as Record<string, unknown>) : {},
            scope: card.scope
          }))}
      />
    </main>
  );
}
