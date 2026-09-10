import { redirect } from "next/navigation";
import { builtinRegistry, resolveRulePack } from "@touhou/rules";
import CardBuilder from "@/components/room/CardBuilder";
import { auth } from "@/server/auth";

export const dynamic = "force-dynamic";

export default async function NewLibraryCardPage(props: { searchParams: { system?: string } }) {
  const session = await auth();
  if (session === null) redirect("/login");

  const system = props.searchParams.system === "TOUHOU" ? "TOUHOU" : "COC7";
  const pack = resolveRulePack(system === "TOUHOU" ? "touhou-ext" : "coc7-baseline", builtinRegistry());
  const spell = pack.spellcard;

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-6 py-12">
      <h1 className="text-2xl font-semibold">新建卡牌 · {system}</h1>
      <CardBuilder
        roomId={null}
        system={system}
        isTouhou={system === "TOUHOU"}
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
