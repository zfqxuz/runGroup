import Link from "next/link";
import { redirect } from "next/navigation";
import AppTabs from "@/components/layout/AppTabs";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";

export const dynamic = "force-dynamic";

export default async function GameHistoryPage() {
  const session = await auth();
  if (session === null) redirect("/login");

  const games = await prisma.game.findMany({
    where: {
      status: "ENDED",
      room: { members: { some: { userId: session.user.id } } }
    },
    include: {
      room: { select: { id: true, name: true, system: true } },
      module: { select: { id: true, title: true, era: true, system: true } }
    },
    orderBy: { createdAt: "desc" }
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-6 py-12">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/" className="text-xs text-white/40 transition hover:text-white/70">← 返回房间列表</Link>
          <h1 className="mt-2 text-2xl font-semibold">游戏历史</h1>
          <p className="mt-1 text-sm text-white/50">你参与过的已结束局。进入后为只读视图。</p>
        </div>
      </header>

      <AppTabs />

      {games.length === 0 ? (
        <p className="rounded-xl border border-dashed border-white/15 px-5 py-12 text-center text-sm text-white/40">
          还没有已结束的游戏记录。
        </p>
      ) : (
        <section className="flex flex-col gap-3">
          {games.map((game) => (
            <Link
              key={game.id}
              href={"/history/" + game.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-ink-800/40 px-5 py-4 transition hover:border-sakura-500/40"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-white/85">{game.title || game.room.name}</p>
                <p className="mt-1 text-[11px] text-white/40">
                  房间：{game.room.name} · {game.module?.title ?? "无团本"} · {game.room.system}
                </p>
              </div>
              <div className="shrink-0 text-right text-[11px] text-white/40">
                <p>已结束</p>
                <p className="mt-0.5">{game.endedAt === null ? "-" : game.endedAt.toISOString().slice(0, 19).replace("T", " ")}</p>
              </div>
            </Link>
          ))}
        </section>
      )}
    </main>
  );
}
