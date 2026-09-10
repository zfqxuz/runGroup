import Link from "next/link";
import { deleteCardAction } from "@/server/actions/card";
import { prisma } from "@/server/db/prisma";

interface Props {
  readonly roomId: string;
  readonly isKP: boolean;
}

interface NpcStatView {
  readonly tier?: string;
  readonly race?: string | null;
  readonly maxHp?: number;
  readonly presetId?: string | null;
}

export default async function RoomNpcPanel(props: Props) {
  if (props.isKP === false) return null;
  const cards = await prisma.card.findMany({
    where: { roomId: props.roomId, scope: "ROOM", type: "NPC" },
    orderBy: { createdAt: "desc" }
  });

  return (
    <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-white/80">本场 NPC / Boss（{cards.length}）</h2>
          <p className="mt-0.5 text-[11px] text-white/35">只在本房间可见，不会进入个人卡库</p>
        </div>
        <Link
          href={"/rooms/" + props.roomId + "/npcs/new"}
          className="rounded-lg border border-sakura-500/40 px-4 py-2 text-sm text-sakura-400 transition hover:bg-sakura-500/10"
        >
          准备 NPC / Boss
        </Link>
      </div>
      {cards.length === 0 ? (
        <p className="mt-3 text-xs text-white/35">还没有准备任何 NPC / Boss 卡</p>
      ) : (
        <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) => {
            const stats = (card.stats ?? {}) as NpcStatView;
            return (
              <li key={card.id} className="rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm text-white/80">{card.name}</p>
                  <span className="shrink-0 rounded border border-spirit-400/30 px-1.5 py-0.5 text-[10px] text-spirit-400">
                    {stats.tier ?? "NPC"}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[11px] text-white/35">
                  {stats.race ?? "无种族"} · HP {stats.maxHp ?? "?"}
                  {stats.presetId === null || stats.presetId === undefined ? " · 自建" : " · 预设 " + stats.presetId}
                </p>
                <form action={deleteCardAction} className="mt-2">
                  <input type="hidden" name="cardId" value={card.id} />
                  <button
                    type="submit"
                    className="w-full rounded-md border border-red-400/20 px-2 py-1 text-[11px] text-red-300/70 transition hover:border-red-400/50 hover:text-red-300"
                  >
                    删除
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
