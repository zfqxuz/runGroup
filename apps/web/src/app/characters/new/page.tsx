import { redirect } from "next/navigation";
import { builtinRegistry, resolveRulePack } from "@touhou/rules";
import CharacterBuilder from "@/components/room/CharacterBuilder";
import { auth } from "@/server/auth";

export const dynamic = "force-dynamic";

export default async function NewLibraryCharacterPage(props: { searchParams: { system?: string } }) {
  const session = await auth();
  if (session === null) redirect("/login");

  const system = props.searchParams.system === "TOUHOU" ? "TOUHOU" : "COC7";
  const pack = resolveRulePack(system === "TOUHOU" ? "touhou-ext" : "coc7-baseline", builtinRegistry());

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-6 py-12">
      <h1 className="text-2xl font-semibold">新建角色卡 · {system}</h1>
      <CharacterBuilder roomId={null} system={system} pack={pack} chargenMethod={pack.attributes.methods[0]?.id ?? "destiny5"} />
    </main>
  );
}
