import Link from "next/link";
import NpcEditForm from "@/components/room/NpcEditForm";
import { deleteCardAction } from "@/server/actions/card";
import { setNpcVisibilityAction } from "@/server/actions/npc";
import { prisma } from "@/server/db/prisma";
import { RARITY_LABELS, cardRarityBorderClass } from "@/shared/card";
import { NpcStatsSchema, NPC_ATTRIBUTE_KEYS } from "@/shared/npc";

interface Props {
  readonly roomId: string;
  readonly isKP: boolean;
}

const TIER_LABELS: Record<string, string> = {
  MINION: "杂兵",
  STANDARD: "标准",
  ELITE: "精英",
  BOSS: "Boss"
};

const ATTRIBUTE_LABELS: Record<string, string> = {
  str: "力量",
  con: "体质",
  siz: "体型",
  dex: "敏捷",
  app: "外貌",
  int: "智力",
  pow: "意志",
  edu: "教育",
  luck: "幸运"
};

export default async function RoomNpcPanel(props: Props) {
  const cards = await prisma.card.findMany({
    where: {
      roomId: props.roomId,
      scope: "ROOM",
      type: "NPC",
      ...(props.isKP ? {} : { isPublic: true })
    },
    orderBy: { createdAt: "desc" }
  });
  if (props.isKP === false && cards.length === 0) return null;

  return (
    <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-white/80">
            {props.isKP ? "本场 NPC / Boss（" + String(cards.length) + "）" : "已公开的 NPC / Boss（" + String(cards.length) + "）"}
          </h2>
          <p className="mt-0.5 text-[11px] text-white/35">
            {props.isKP
              ? "默认对玩家隐藏；点击「公开属性」后玩家才能看到名字、属性与技能。"
              : "KP 只公开了这些单位的情报。"}
          </p>
        </div>
        {props.isKP ? (
          <Link
            href={"/rooms/" + props.roomId + "/npcs/new"}
            className="rounded-lg border border-sakura-500/40 px-4 py-2 text-sm text-sakura-400 transition hover:bg-sakura-500/10"
          >
            准备 NPC / Boss
          </Link>
        ) : null}
      </div>
      {cards.length === 0 ? (
        <p className="mt-3 text-xs text-white/35">还没有准备任何 NPC / Boss 卡</p>
      ) : (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {cards.map((card) => {
            const parsed = NpcStatsSchema.safeParse(card.stats);
            const stats = parsed.success ? parsed.data : null;
            return (
              <li key={card.id} className={"rounded-lg border-2 bg-ink-900/60 px-3 py-3 " + cardRarityBorderClass(card.rarity)}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="truncate text-sm text-white/85">{card.name}</p>
                    {card.isPublic ? (
                      <span className="rounded border border-emerald-400/40 px-1.5 py-0.5 text-[10px] text-emerald-300">已公开</span>
                    ) : (
                      <span className="rounded border border-amber-400/40 px-1.5 py-0.5 text-[10px] text-amber-300">隐藏</span>
                    )}
                  </div>
                  <span className="shrink-0 rounded border border-spirit-400/30 px-1.5 py-0.5 text-[10px] text-spirit-400">
                    {stats === null ? "NPC" : TIER_LABELS[stats.tier] ?? stats.tier} · {RARITY_LABELS[card.rarity]}
                  </span>
                </div>
                {stats === null ? null : (
                  <>
                    <p className="mt-1 text-[11px] text-white/45">
                      {stats.race ?? "无种族"} · HP {stats.maxHp} · MP {stats.maxMp} · SAN {stats.maxSan} · DP {stats.maxDp}
                    </p>
                    <div className="mt-2 grid grid-cols-3 gap-1 text-[10px] text-white/55">
                      {NPC_ATTRIBUTE_KEYS.map((key) => (
                        <span key={key} className="rounded border border-white/10 px-1.5 py-0.5">
                          {ATTRIBUTE_LABELS[key] ?? key} {stats.attributes[key]}
                        </span>
                      ))}
                    </div>
                    {Object.keys(stats.skills).length === 0 ? null : (
                      <p className="mt-2 line-clamp-2 text-[10px] text-white/35">
                        技能：{Object.entries(stats.skills).slice(0, 10).map(([id, value]) => id + " " + String(value)).join(" · ")}
                      </p>
                    )}
                  </>
                )}
                {props.isKP ? (
                  <NpcEditForm roomId={props.roomId} card={card} returnTo={"/rooms/" + props.roomId + "/prepare"} />
                ) : null}
                {props.isKP ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <form action={setNpcVisibilityAction}>
                      <input type="hidden" name="roomId" value={props.roomId} />
                      <input type="hidden" name="cardId" value={card.id} />
                      <input type="hidden" name="isPublic" value={card.isPublic ? "0" : "1"} />
                      <button
                        type="submit"
                        className="rounded-md border border-emerald-400/40 px-2 py-1 text-[11px] text-emerald-300 transition hover:bg-emerald-400/10"
                      >
                        {card.isPublic ? "取消公开" : "公开属性"}
                      </button>
                    </form>
                    <form action={deleteCardAction}>
                      <input type="hidden" name="cardId" value={card.id} />
                      <button
                        type="submit"
                        className="rounded-md border border-red-400/20 px-2 py-1 text-[11px] text-red-300/70 transition hover:border-red-400/50 hover:text-red-300"
                      >
                        删除
                      </button>
                    </form>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
