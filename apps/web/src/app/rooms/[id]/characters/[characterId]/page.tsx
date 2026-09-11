import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ATTRIBUTE_KEYS,
  builtinRegistry,
  compileParsedRulePack,
  computeDerived,
  resolveRulePack,
  type AttributeKey,
  type AttributeSet
} from "@touhou/rules";
import { unequipCardAction } from "@/server/actions/card";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";
import { RARITY_LABELS, cardRarityBorderClass } from "@/shared/card";

export const dynamic = "force-dynamic";

const ATTRIBUTE_LABELS: Record<string, string> = {
  str: "力量 STR",
  con: "体质 CON",
  siz: "体型 SIZ",
  dex: "敏捷 DEX",
  app: "外貌 APP",
  int: "智力 INT",
  pow: "意志 POW",
  edu: "教育 EDU",
  luck: "幸运 LUCK"
};

export default async function CharacterPage({
  params
}: {
  params: { id: string; characterId: string };
}) {
  const session = await auth();
  if (session === null) redirect("/login");

  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId: params.id, userId: session.user.id } },
    include: { room: true }
  });
  if (membership === null) notFound();

  const character = await prisma.character.findUnique({
    where: { id: params.characterId },
    include: {
      user: { select: { username: true, displayName: true } },
      cards: { orderBy: { createdAt: "asc" } }
    }
  });
  if (character === null) notFound();

  const room = membership.room;
  const entry = await prisma.roomCharacterEntry.findUnique({
    where: { roomId_characterId: { roomId: room.id, characterId: character.id } },
    select: { status: true }
  });
  const isOwner = character.userId === session.user.id;
  const isKP = membership.role === "KP";
  const canViewByRoomConfig =
    room.characterVisibility === "PUBLIC" && entry !== null && entry.status === "APPROVED";
  if (isOwner === false && isKP === false && canViewByRoomConfig === false) notFound();
  const canManage = isOwner || isKP;
  const pack = resolveRulePack(
    room.system === "TOUHOU" ? "touhou-ext" : "coc7-baseline",
    builtinRegistry()
  );
  const compiled = compileParsedRulePack(pack);

  const base = {} as AttributeSet;
  for (const key of ATTRIBUTE_KEYS as readonly AttributeKey[]) {
    base[key] = character[key];
  }
  const outcome = computeDerived(compiled, { attributes: base, race: character.race });
  const effective = outcome.attributes as unknown as Record<string, number>;

  const pool = canManage
    ? await prisma.card.findMany({
        where: { roomId: room.id, scope: "ROOM", type: { not: "NPC" } },
        orderBy: { createdAt: "desc" }
      })
    : [];




  const skillValues = (character.skills ?? {}) as Record<string, number>;
  const skillRows = pack.skills
    .map((skill) => {
      const value = skillValues[skill.id];
      return { id: skill.id, name: skill.name, category: skill.category, value };
    })
    .filter((row) => typeof row.value === "number")
    .sort((left, right) => (right.value ?? 0) - (left.value ?? 0));

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-6 py-12">
      <header>
        <Link href={"/rooms/" + room.id} className="text-xs text-white/40 transition hover:text-white/70">
          ← 返回房间
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{character.name}</h1>
          {character.race === null ? null : (
            <span className="rounded-full border border-sakura-500/40 px-2 py-0.5 text-xs text-sakura-400">
              {pack.races[character.race]?.name ?? character.race}
            </span>
          )}
          <span className="rounded-full border border-white/15 px-2 py-0.5 text-xs text-white/50">
            {character.reviewStatus}
          </span>
        </div>
        <p className="mt-1 text-xs text-white/40">
          {character.user.displayName ?? character.user.username} · {pack.id}@{pack.version}
        </p>
      </header>

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <h2 className="text-sm font-medium text-white/80">属性</h2>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {ATTRIBUTE_KEYS.map((key) => (
            <div
              key={key}
              className="flex items-center justify-between rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2"
            >
              <span className="text-xs text-white/50">{ATTRIBUTE_LABELS[key]}</span>
              <span className="font-mono text-sm text-white/80">{effective[key]}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <h2 className="text-sm font-medium text-white/80">衍生属性</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          {([
            ["生命 HP", outcome.derived.maxHp],
            ["灵力 MP", outcome.derived.maxMp],
            ["理智 SAN", character.maxSan],
            ["骰池 DP", outcome.derived.maxDp]
          ] as const).map(([label, value]) => (
            <div
              key={label}
              className="rounded-lg border border-spirit-400/20 bg-spirit-400/5 px-3 py-3 text-center"
            >
              <p className="text-xs text-white/40">{label}</p>
              <p className="mt-1 text-2xl font-semibold text-spirit-400">{value}</p>
            </div>
          ))}
        </div>
        {outcome.flags.length === 0 ? null : (
          <p className="mt-3 text-[11px] text-white/35">种族特性：{outcome.flags.join(" · ")}</p>
        )}
      </section>

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <h2 className="text-sm font-medium text-white/80">技能（{skillRows.length}）</h2>
        {skillRows.length === 0 ? (
          <p className="mt-3 text-xs text-white/35">未分配技能</p>
        ) : (
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {skillRows.map((row) => (
              <div
                key={row.id}
                className="flex items-center justify-between rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2"
              >
                <span className="truncate text-xs text-white/60">{row.name}</span>
                <span className="font-mono text-sm text-white/80">{row.value}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {canManage === false ? null : (
      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <h2 className="text-sm font-medium text-white/80">持有卡牌（{character.cards.length}）</h2>
        {character.cards.length === 0 ? (
          <p className="mt-3 text-xs text-white/35">还没有卡牌，从下方卡池配发</p>
        ) : (
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {character.cards.map((card) => (
              <div key={card.id} className={"rounded-lg border-2 bg-ink-900/60 px-3 py-2.5 " + cardRarityBorderClass(card.rarity)}>
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm text-white/80">{card.name}</p>
                  <span className="shrink-0 rounded border border-spirit-400/30 px-1.5 py-0.5 text-[10px] text-spirit-400">
                    {card.type} · {RARITY_LABELS[card.rarity]}
                  </span>
                </div>
                {card.subtitle === null ? null : (
                  <p className="mt-0.5 truncate text-[11px] text-white/35">{card.subtitle}</p>
                )}
                <form action={unequipCardAction} className="mt-2">
                    <input type="hidden" name="cardId" value={card.id} />
                    <button
                      type="submit"
                      className={
                        card.isEquipped
                          ? "w-full rounded-md border border-emerald-400/40 bg-emerald-400/10 px-2 py-1 text-[11px] text-emerald-300"
                          : "w-full rounded-md border border-white/15 px-2 py-1 text-[11px] text-white/50 transition hover:border-white/35 hover:text-white"
                      }
                    >
                      卸下
                    </button>
                  </form>
              </div>
            ))}
          </div>
        )}
      </section>
      )}

    </main>
  );
}
