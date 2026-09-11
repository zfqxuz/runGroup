import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";

export const dynamic = "force-dynamic";

export default async function CharactersLibraryPage() {
  const session = await auth();
  if (session === null) redirect("/login");

  const characters = await prisma.character.findMany({
    where: { userId: session.user.id },
    include: { roomEntries: { select: { status: true } } },
    orderBy: { createdAt: "desc" }
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-6 py-12">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link href="/" className="text-xs text-white/40 transition hover:text-white/70">← 返回房间列表</Link>
          <h1 className="mt-2 text-2xl font-semibold">我的角色库</h1>
          <p className="mt-1 text-sm text-white/50">角色属于你自己，可带进任意房间（需 KP 审核）</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/characters/import" className="rounded-lg border border-spirit-400/40 px-3 py-2 text-xs text-spirit-400 transition hover:bg-spirit-400/10">导入 xlsx</Link>
          <Link href="/characters/new?system=COC7" className="rounded-lg border border-white/15 px-3 py-2 text-xs text-white/60 transition hover:border-white/35">新建 COC7 角色</Link>
          <Link href="/characters/new?system=TOUHOU" className="rounded-lg bg-sakura-500 px-4 py-2 text-xs font-medium text-ink-900 transition hover:bg-sakura-400">新建东方角色</Link>
        </div>
      </header>


      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <h2 className="text-sm font-medium text-white/80">全部（{characters.length}）</h2>
        {characters.length === 0 ? (
          <p className="mt-3 text-xs text-white/35">还没有角色卡</p>
        ) : (
          <ul className="mt-4 flex flex-col divide-y divide-white/5">
            {characters.map((character) => (
              <li key={character.id} className="py-3">
                <Link href={"/characters/" + character.id} className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-white/80">
                      {character.name}
                      {character.race === null ? null : (
                        <span className="ml-2 text-[11px] text-sakura-400">{character.race}</span>
                      )}
                    </p>
                    <p className="mt-0.5 text-[11px] text-white/35">
                      {character.system} · HP {character.maxHp} · SAN {character.maxSan}
                    </p>
                  </div>
                  <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] text-white/50">
                    {character.roomEntries.length} 个房间申请
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
