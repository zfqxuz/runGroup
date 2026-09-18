import { redirect } from "next/navigation";
import { builtinRegistry, resolveRulePack } from "@touhou/rules";
import CardBuilder from "@/components/room/CardBuilder";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";

export const dynamic = "force-dynamic";

function roomIdFromReturnTo(returnTo: string | undefined): string | null {
  if (returnTo === undefined || returnTo.length === 0) return null;
  try {
    const url = new URL(returnTo, "http://local");
    const roomId = url.searchParams.get("roomId");
    return roomId === null || roomId.length === 0 ? null : roomId;
  } catch {
    return null;
  }
}

export default async function NewLibraryCardPage(props: { searchParams: { system?: string; returnTo?: string } }) {
  const session = await auth();
  if (session === null) redirect("/login");

  const system = props.searchParams.system === "TOUHOU" ? "TOUHOU" : "COC7";
  const returnTo = props.searchParams.returnTo;
  const roomId = roomIdFromReturnTo(returnTo);
  let npcCards: { id: string; name: string }[] = [];
  if (roomId !== null) {
    const membership = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId: session.user.id } },
      select: { role: true }
    });
    if (membership !== null) {
      npcCards = await prisma.card.findMany({
        where: {
          roomId,
          type: "NPC",
          ...(membership.role === "KP" ? {} : { isPublic: true })
        },
        select: { id: true, name: true },
        orderBy: { name: "asc" }
      });
    }
  }
  const pack = resolveRulePack(system === "TOUHOU" ? "touhou-ext" : "coc7-baseline", builtinRegistry());
  const spell = pack.spellcard;

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-6 py-12">
      <h1 className="text-2xl font-semibold">新建卡牌 · {system}</h1>
      <CardBuilder
        roomId={null}
        system={system}
        isTouhou={system === "TOUHOU"}
        returnTo={returnTo ?? null}
        npcCards={npcCards}
        spellDefaults={
          spell === undefined
            ? null
            : {
                hpRatio: Number(spell.declaration.hpRatio),
                durationTicks: Number(spell.declaration.durationTicks),
                consumptionMpCost: Number(spell.consumption.mpCost),
                declarationMpCost: 10,
                clearTargets: spell.declaration.clearTargets
              }
        }
      />
    </main>
  );
}
