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
import ImageUpload from "@/components/upload/ImageUpload";
import { equipCardAction, unequipCardAction } from "@/server/actions/card";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";
import { advancementView } from "@/server/game/view";
import { RARITY_LABELS, cardRarityBorderClass } from "@/shared/card";

export const dynamic = "force-dynamic";

const LABELS: Record<string, string> = {
  str: "力量", con: "体质", siz: "体型", dex: "敏捷",
  app: "外貌", int: "智力", pow: "意志", edu: "教育", luck: "幸运"
};

export default async function CharacterDetailPage({ params }: { params: { id: string } }) {
  const session = await auth();
  if (session === null) redirect("/login");

  const character = await prisma.character.findUnique({
    where: { id: params.id },
    include: {
      roomEntries: { include: { room: { select: { id: true, name: true } } } },
      portrait: true,
      avatar: true,
      advancements: {
        include: { game: { select: { title: true } } },
        orderBy: { createdAt: "desc" }
      }
    }
  });
  if (character === null || character.userId !== session.user.id) notFound();

  const pack = resolveRulePack(
    character.system === "TOUHOU" ? "touhou-ext" : "coc7-baseline",
    builtinRegistry()
  );
  const compiled = compileParsedRulePack(pack);

  const base = {} as AttributeSet;
  for (const key of ATTRIBUTE_KEYS as readonly AttributeKey[]) base[key] = character[key];
  const outcome = computeDerived(compiled, { attributes: base, race: character.race });
  const effective = outcome.attributes as unknown as Record<string, number>;

  const equipped = await prisma.card.findMany({
    where: { characterId: character.id },
    orderBy: { createdAt: "asc" }
  });
  const library = await prisma.card.findMany({
    // 可装备的只有同模组的卡
    where: {
      ownerId: session.user.id,
      scope: "COMPENDIUM",
      characterId: null,
      system: character.system
    },
    orderBy: { createdAt: "desc" }
  });

  const skillValues = (character.skills ?? {}) as Record<string, number>;
  const allocation = (character.skillAllocation ?? {}) as { labels?: Record<string, string> };
  const labels = allocation.labels ?? {};
  const skillNameById = new Map<string, string>();
  for (const skill of pack.skills) skillNameById.set(skill.id, skill.name);
  for (const [id, name] of Object.entries(labels)) skillNameById.set(id, name);
  const skillRows = Object.entries(skillValues)
    .map(([id, value]) => ({ id, name: skillNameById.get(id) ?? id, value }))
    .filter((row) => typeof row.value === "number" && row.value > 0)
    .sort((a, b) => b.value - a.value);
  const advancementRows = character.advancements.map((item) =>
    advancementView({ ...item, character: { name: character.name } })
  );
  const advancementKindLabels: Record<string, string> = {
    ATTRIBUTE: "属性",
    SKILL: "技能",
    SAN: "SAN",
    ITEM: "物品",
    RELATIONSHIP: "关系",
    OTHER: "其他"
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-6 py-12">
      <header>
        <Link href="/characters" className="text-xs text-white/40 transition hover:text-white/70">← 返回角色库</Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{character.name}</h1>
          {character.race === null ? null : (
            <span className="rounded-full border border-sakura-500/40 px-2 py-0.5 text-xs text-sakura-400">
              {pack.races[character.race]?.name ?? character.race}
            </span>
          )}
          <span className="rounded-full border border-white/15 px-2 py-0.5 text-xs text-white/50">
            {character.system}
          </span>
          {character.era === null ? null : (
            <span className="rounded-full border border-white/15 px-2 py-0.5 text-xs text-white/50">
              {character.era === "CLASSIC" ? "1920 年代" : "现代"}
            </span>
          )}
          {character.occupation === null ? null : (
            <span className="rounded-full border border-sakura-500/40 px-2 py-0.5 text-xs text-sakura-400">
              {character.occupation}
            </span>
          )}
        </div>
        {character.roomEntries.length === 0 ? null : (
          <p className="mt-2 flex flex-wrap gap-2 text-[11px] text-white/40">
            {character.roomEntries.map((entry) => (
              <span key={entry.id} className="rounded border border-white/10 px-2 py-0.5">
                {entry.room.name} · {entry.status}
              </span>
            ))}
          </p>
        )}
      </header>

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <h2 className="text-sm font-medium text-white/80">立绘与头像</h2>
        <div className="mt-4 flex flex-wrap items-start gap-6">
          <ImageUpload
            kind="PORTRAIT"
            targetId={character.id}
            currentUrl={character.portrait?.url ?? null}
            label="上传立绘"
            shape="wide"
          />
          <ImageUpload
            kind="AVATAR"
            targetId={character.id}
            currentUrl={character.avatar?.url ?? null}
            label="上传头像"
            shape="square"
          />
        </div>
      </section>

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <h2 className="text-sm font-medium text-white/80">属性</h2>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {ATTRIBUTE_KEYS.map((key) => (
            <div key={key} className="flex items-center justify-between rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2">
              <span className="text-xs text-white/50">{LABELS[key]}</span>
              <span className="font-mono text-sm text-white/80">{effective[key]}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-4">
          {(["maxHp", "maxMp", "maxSan", "maxDp"] as const).map((key) => (
            <div key={key} className="rounded-lg border border-spirit-400/20 bg-spirit-400/5 px-3 py-2 text-center">
              <p className="text-[11px] text-white/40">{key}</p>
              <p className="text-lg font-semibold text-spirit-400">{outcome.derived[key]}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <h2 className="text-sm font-medium text-white/80">技能（{skillRows.length}）</h2>
        {skillRows.length === 0 ? (
          <p className="mt-3 text-xs text-white/35">未分配技能</p>
        ) : (
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {skillRows.map((row) => (
              <div key={row.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2">
                <span className="truncate text-xs text-white/60">{row.name}</span>
                <span className="font-mono text-sm text-white/80">{row.value}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <h2 className="text-sm font-medium text-white/80">成长记录（{advancementRows.length}）</h2>
        {advancementRows.length === 0 ? (
          <p className="mt-3 text-xs text-white/35">还没有成长记录</p>
        ) : (
          <ul className="mt-4 flex flex-col divide-y divide-white/5">
            {advancementRows.map((item) => (
              <li key={item.id} className="py-2.5 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-white/75">{advancementKindLabels[item.kind] ?? item.kind}</span>
                  {item.target === null ? null : (
                    <span className="rounded border border-spirit-400/25 px-1.5 py-0.5 font-mono text-[10px] text-spirit-200">
                      {item.target}
                    </span>
                  )}
                  {item.delta === null ? null : (
                    <span className="font-mono text-[11px] text-sakura-300">
                      {item.delta > 0 ? "+" + item.delta : item.delta}
                    </span>
                  )}
                  <span className="ml-auto text-[10px] text-white/30">
                    {item.createdAt.slice(0, 10)}
                  </span>
                </div>
                {item.note === null || item.note.length === 0 ? null : (
                  <p className="mt-1 leading-relaxed text-white/50">{item.note}</p>
                )}
                {item.gameTitle === null ? null : (
                  <p className="mt-0.5 text-[10px] text-white/30">来源：{item.gameTitle}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <h2 className="text-sm font-medium text-white/80">已装备（{equipped.length}）</h2>
        {equipped.length === 0 ? (
          <p className="mt-3 text-xs text-white/35">还没有装备</p>
        ) : (
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {equipped.map((card) => (
              <div key={card.id} className={"flex items-center justify-between gap-2 rounded-lg border-2 bg-emerald-400/5 px-3 py-2.5 " + cardRarityBorderClass(card.rarity)}>
                <div className="min-w-0">
                  <p className="truncate text-sm text-white/80">{card.name}</p>
                  <p className="text-[11px] text-white/35">{card.type} · {RARITY_LABELS[card.rarity]}</p>
                </div>
                <form action={unequipCardAction}>
                  <input type="hidden" name="cardId" value={card.id} />
                  <button type="submit" className="shrink-0 rounded-md border border-white/15 px-2 py-1 text-[11px] text-white/50 transition hover:border-white/35 hover:text-white">卸下</button>
                </form>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <h2 className="text-sm font-medium text-white/80">从我的卡库装备（{library.length}）</h2>
        {library.length === 0 ? (
          <p className="mt-3 text-xs text-white/35">
            卡库是空的，先去 <Link href="/cards" className="text-spirit-400 hover:underline">我的卡牌</Link> 建几张
          </p>
        ) : (
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {library.map((card) => (
              <form key={card.id} action={equipCardAction} className={"flex items-center justify-between gap-2 rounded-lg border-2 bg-ink-900/60 px-3 py-2.5 " + cardRarityBorderClass(card.rarity)}>
                <input type="hidden" name="cardId" value={card.id} />
                <input type="hidden" name="characterId" value={character.id} />
                <div className="min-w-0">
                  <p className="truncate text-sm text-white/70">{card.name}</p>
                  <p className="text-[11px] text-white/30">{card.type} · {RARITY_LABELS[card.rarity]}</p>
                </div>
                <button type="submit" className="shrink-0 rounded-md border border-sakura-500/40 px-2 py-1 text-[11px] text-sakura-400 transition hover:bg-sakura-500/10">装备</button>
              </form>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
