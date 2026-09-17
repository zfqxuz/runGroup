import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";
import { updateCharacterProfileAction } from "@/server/actions/character";

export const dynamic = "force-dynamic";

const inputClass =
  "w-full rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm text-white outline-none focus:border-sakura-500";

export default async function EditCharacterPage({
  params,
  searchParams
}: {
  params: { id: string };
  searchParams?: { error?: string };
}) {
  const session = await auth();
  if (session === null) redirect("/login");
  const character = await prisma.character.findUnique({ where: { id: params.id } });
  if (character === null || character.userId !== session.user.id) notFound();

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-5 px-6 py-12">
      <header>
        <Link href={"/characters/" + character.id} className="text-xs text-white/40 transition hover:text-white/70">
          ← 返回角色
        </Link>
        <h1 className="mt-2 text-xl font-semibold">编辑角色卡</h1>
      </header>

      {searchParams?.error === undefined ? null : (
        <p className="rounded-lg border border-red-400/30 bg-red-400/5 px-4 py-3 text-sm text-red-300">
          {searchParams.error}
        </p>
      )}

      <form action={updateCharacterProfileAction} className="flex flex-col gap-4 rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <input type="hidden" name="characterId" value={character.id} />
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs text-white/50">
            角色名
            <input name="name" defaultValue={character.name} maxLength={50} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-white/50">
            玩家名
            <input name="playerName" defaultValue={character.playerName ?? ""} maxLength={50} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-white/50">
            职业
            <input name="occupation" defaultValue={character.occupation ?? ""} maxLength={50} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-white/50">
            年龄
            <input name="age" type="number" min={15} max={90} defaultValue={character.age ?? ""} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-white/50">
            性别
            <input name="gender" defaultValue={character.gender ?? ""} maxLength={20} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-white/50">
            住地
            <input name="residence" defaultValue={character.residence ?? ""} maxLength={80} className={inputClass} />
          </label>
        </div>
        <p className="text-[11px] text-white/35">当前资源（留空表示不修改）</p>
        <div className="grid gap-4 sm:grid-cols-4">
          <label className="flex flex-col gap-1 text-xs text-white/50">
            HP
            <input name="hp" type="number" defaultValue={character.hp} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-white/50">
            MP
            <input name="mp" type="number" defaultValue={character.mp} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-white/50">
            SAN
            <input name="san" type="number" defaultValue={character.san} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-white/50">
            DP
            <input name="dp" type="number" defaultValue={character.dp} className={inputClass} />
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <Link
            href={"/characters/" + character.id}
            className="rounded-lg border border-white/15 px-4 py-2 text-xs text-white/60 transition hover:border-white/35"
          >
            取消
          </Link>
          <button type="submit" className="rounded-lg border border-sakura-500/50 bg-sakura-500/10 px-4 py-2 text-xs font-medium text-sakura-300 transition hover:bg-sakura-500/20">
            保存
          </button>
        </div>
      </form>
    </main>
  );
}
