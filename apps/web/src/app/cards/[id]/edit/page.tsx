import { notFound, redirect } from "next/navigation";
import { builtinRegistry, resolveRulePack } from "@touhou/rules";
import CardBuilder from "@/components/room/CardBuilder";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";
import { CARD_KINDS, type CardKind } from "@/shared/card";

export const dynamic = "force-dynamic";

export default async function EditCardPage({
  params,
  searchParams
}: {
  params: { id: string };
  searchParams: { returnTo?: string };
}) {
  const session = await auth();
  if (session === null) redirect("/login");
  const card = await prisma.card.findUnique({ where: { id: params.id } });
  if (card === null || card.ownerId !== session.user.id) notFound();
  if ((CARD_KINDS as readonly string[]).includes(card.type) === false) notFound();

  const system = card.system === "TOUHOU" ? "TOUHOU" : "COC7";
  const pack = resolveRulePack(system === "TOUHOU" ? "touhou-ext" : "coc7-baseline", builtinRegistry());
  const spell = pack.spellcard;
  const stats =
    card.stats !== null && typeof card.stats === "object" && Array.isArray(card.stats) === false
      ? (card.stats as Record<string, unknown>)
      : {};

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-6 py-12">
      <h1 className="text-2xl font-semibold">编辑卡牌 · {card.name}</h1>
      <CardBuilder
        roomId={null}
        system={system}
        isTouhou={system === "TOUHOU"}
        returnTo={searchParams.returnTo ?? null}
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
        initial={{
          cardId: card.id,
          kind: card.type as CardKind,
          name: card.name,
          subtitle: card.subtitle ?? "",
          description: card.description ?? "",
          stats
        }}
      />
    </main>
  );
}
