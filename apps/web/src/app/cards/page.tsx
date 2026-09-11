import Link from "next/link";
import { redirect } from "next/navigation";
import ImageUpload from "@/components/upload/ImageUpload";
import { copyCardTemplateAction, deleteCardAction, setCardTemplateAction } from "@/server/actions/card";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";
import { RARITY_LABELS, cardRarityBorderClass } from "@/shared/card";

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

  const templates = await prisma.card.findMany({
    where: { scope: "COMPENDIUM", isTemplate: true, ownerId: { not: session.user.id } },
    include: {
      owner: { select: { username: true, displayName: true } },
      instances: { where: { ownerId: session.user.id }, select: { id: true } }
    },
    orderBy: { updatedAt: "desc" }
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
            卡属于你自己，可带进任意房间（需 KP 审核）；也可以共享为模板供其他用户复制
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
        <h2 className="text-sm font-medium text-white/80">我的卡牌（{cards.length}）</h2>
        {cards.length === 0 ? (
          <p className="mt-3 text-xs text-white/35">还没有卡牌</p>
        ) : (
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((card) => (
              <div key={card.id} className={"rounded-lg border-2 bg-ink-900/60 px-3 py-2.5 " + cardRarityBorderClass(card.rarity)}>
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm text-white/80">{card.name}</p>
                  <span className="shrink-0 rounded border border-white/15 px-1.5 py-0.5 text-[10px] text-white/45">
                    {card.system}
                  </span>
                  <span className="shrink-0 rounded border border-spirit-400/30 px-1.5 py-0.5 text-[10px] text-spirit-400">
                    {card.type} · {RARITY_LABELS[card.rarity]}
                  </span>
                </div>
                <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-white/35">
                  <span>
                    {card.character === null ? "库中" : "已装备给 " + card.character.name}
                    {card.roomEntries.length === 0 ? "" : " · 已带入 " + card.roomEntries.length + " 个房间"}
                  </span>
                  {card.isTemplate ? (
                    <span className="rounded border border-amber-400/40 px-1.5 py-0.5 text-[10px] text-amber-300">共享模板</span>
                  ) : null}
                </p>
                <div className="mt-2">
                  <ImageUpload
                    kind="CARD_ART"
                    targetId={card.id}
                    currentUrl={card.imageUrl}
                    label="上传卡面"
                    shape="wide"
                  />
                </div>
                <div className="mt-2 flex gap-1">
                  <form action={setCardTemplateAction} className="flex-1">
                    <input type="hidden" name="cardId" value={card.id} />
                    <input type="hidden" name="shared" value={card.isTemplate ? "0" : "1"} />
                    <button type="submit" className="w-full rounded-md border border-amber-400/40 px-2 py-1 text-[11px] text-amber-300 transition hover:bg-amber-400/10">
                      {card.isTemplate ? "取消共享" : "共享为模板"}
                    </button>
                  </form>
                  <form action={deleteCardAction} className="flex-1">
                    <input type="hidden" name="cardId" value={card.id} />
                    <button type="submit" className="w-full rounded-md border border-white/15 px-2 py-1 text-[11px] text-white/40 transition hover:border-red-400/40 hover:text-red-300">
                      删除
                    </button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <div>
          <h2 className="text-sm font-medium text-white/80">共享模板库（{templates.length}）</h2>
          <p className="mt-0.5 text-[11px] text-white/35">其他用户共享的模板卡；复制后进入你的卡库</p>
        </div>
        {templates.length === 0 ? (
          <p className="mt-3 text-xs text-white/35">还没有可复制的共享模板</p>
        ) : (
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((card) => {
              const copied = card.instances.length > 0;
              return (
                <div key={card.id} className={"rounded-lg border-2 bg-ink-900/60 px-3 py-2.5 " + cardRarityBorderClass(card.rarity)}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm text-white/80">{card.name}</p>
                    <span className="shrink-0 rounded border border-white/15 px-1.5 py-0.5 text-[10px] text-white/45">
                      {card.system}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-[11px] text-white/35">
                    {card.type} · {RARITY_LABELS[card.rarity]} · {card.owner?.displayName ?? card.owner?.username ?? "未知"}
                  </p>
                  {card.description === null ? null : (
                    <p className="mt-1 line-clamp-2 text-[11px] text-white/30">{card.description}</p>
                  )}
                  <div className="mt-2">
                    {copied ? (
                      <span className="block rounded-md border border-emerald-400/30 px-2 py-1 text-center text-[11px] text-emerald-300">
                        已复制到我的卡库
                      </span>
                    ) : (
                      <form action={copyCardTemplateAction}>
                        <input type="hidden" name="templateId" value={card.id} />
                        <button type="submit" className="w-full rounded-md border border-sakura-500/40 px-2 py-1 text-[11px] text-sakura-400 transition hover:bg-sakura-500/10">
                          复制到我的卡库
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
