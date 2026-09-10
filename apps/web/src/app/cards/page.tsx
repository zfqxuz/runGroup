import Link from "next/link";
import { redirect } from "next/navigation";
import { deleteCardAction } from "@/server/actions/card";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";

export const dynamic = "force-dynamic";

export default async function CardsLibraryPage() {
  const session = await auth();
  if (session === null) redirect("/login");

  const cards = await prisma.card.findMany({
    where: { ownerId: session.user.id, scope: "COMPENDIUM" },
    include: {
      character: { select: { id: true, name: true } },
      roomEntries: { select: { status: true } }
    },
    orderBy: { createdAt: "desc" }
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-6 py-12">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link href="/" className="text-xs text-white/40 transition hover:text-white/70">
            ← 返回房间列表
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">我的卡牌库</h1>
          <p className="mt-1 text-sm text-white/50">
            卡属于你自己，可带进任意房间（需 KP 审核）
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/cards/new?system=COC7" className="rounded-lg border border-white/15 px-3 py-2 text-xs text-white/60 transition hover:border-white/35">
            新建 COC7 卡
          </Link>
          <Link href="/cards/new?system=TOUHOU" className="rounded-lg bg-sakura-500 px-4 py-2 text-xs font-medium text-ink-900 transition hover:bg-sakura-400">
            新建东方卡
          </Link>
        </div>
      </header>

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <h2 className="text-sm font-medium text-white/80">全部（{cards.length}）</h2>
        {cards.length === 0 ? (
          <p className="mt-3 text-xs text-white/35">还没有卡牌</p>
        ) : (
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((card) => (
              <div key={card.id} className="rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm text-white/80">{card.name}</p>
                  <span className="shrink-0 rounded border border-spirit-400/30 px-1.5 py-0.5 text-[10px] text-spirit-400">
                    {card.type}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[11px] text-white/35">
                  {card.character === null ? "库中" : "已装备给 " + card.character.name}
                  {card.roomEntries.length === 0 ? "" : " · 已带入 " + card.roomEntries.length + " 个房间"}
                </p>
                <form action={deleteCardAction} className="mt-2">
                  <input type="hidden" name="cardId" value={card.id} />
                  <button type="submit" className="w-full rounded-md border border-white/15 px-2 py-1 text-[11px] text-white/40 transition hover:border-red-400/40 hover:text-red-300">
                    删除
                  </button>
                </form>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
