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
import { revertAdvancementAction, updateAdvancementAction } from "@/server/actions/advancement";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";
import { ADVANCEMENT_SOURCE_LABELS, summarizeAdvancements } from "@/server/game/advancement";
import { advancementView } from "@/server/game/view";
import type { AdvancementSource } from "@/shared/game";
import { RARITY_LABELS, cardRarityBorderClass } from "@/shared/card";

export const dynamic = "force-dynamic";

const LABELS: Record<string, string> = {
  str: "力量", con: "体质", siz: "体型", dex: "敏捷",
  app: "外貌", int: "智力", pow: "意志", edu: "教育", luck: "幸运"
};

export default async function CharacterDetailPage({
  params,
  searchParams
}: {
  params: { id: string };
  searchParams: { gkind?: string; gsource?: string; ggame?: string; advancement?: string };
}) {
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
  const allAdvancementRows = character.advancements.map((item) =>
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
  const growth = summarizeAdvancements(allAdvancementRows);
  const kindFilter = searchParams.gkind ?? "ALL";
  const sourceFilter = searchParams.gsource ?? "ALL";
  const gameFilter = searchParams.ggame ?? "ALL";
  const filterParams = new URLSearchParams();
  if (kindFilter !== "ALL") filterParams.set("gkind", kindFilter);
  if (sourceFilter !== "ALL") filterParams.set("gsource", sourceFilter);
  if (gameFilter !== "ALL") filterParams.set("ggame", gameFilter);
  const filterQuery = filterParams.toString();
  const filterSuffix = filterQuery.length === 0 ? "" : "?" + filterQuery;
  const returnTo = "/characters/" + character.id + filterSuffix;
  const advancementRows = allAdvancementRows.filter((item) => {
    if (kindFilter !== "ALL" && item.kind !== kindFilter) return false;
    if (sourceFilter !== "ALL" && item.source !== sourceFilter) return false;
    if (gameFilter === "manual" && item.gameId !== null) return false;
    if (gameFilter !== "ALL" && gameFilter !== "manual" && item.gameId !== gameFilter) return false;
    return true;
  });
  const filteredSummary = summarizeAdvancements(advancementRows);
  const gameOptions = [...new Map(
    character.advancements
      .filter((item) => item.gameId !== null)
      .map((item) => [item.gameId as string, item.game?.title ?? "未知局"] as const)
  ).entries()];
  const growthGroups = new Map<string, { title: string; rows: typeof advancementRows }>();
  for (const item of advancementRows) {
    const key = item.gameId ?? "manual";
    const group = growthGroups.get(key) ?? { title: item.gameTitle ?? "手动 / 其他成长", rows: [] };
    group.rows.push(item);
    growthGroups.set(key, group);
  }
  function growthLabel(kind: string, target: string | null): string {
    if (target === null) return "";
    if (kind === "ATTRIBUTE") return LABELS[target] ?? target;
    return target;
  }
  const advancementNotice = searchParams.advancement;
  const sourceOptions: readonly AdvancementSource[] = ["MANUAL", "END_REWARD", "GROWTH_CHECK", "MODULE", "IMPORT", "OTHER"];

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
          {ATTRIBUTE_KEYS.map((key) => {
            const bonus = growth.attribute[key] ?? 0;
            return (
              <div key={key} className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2">
                <span className="text-xs text-white/50">{LABELS[key]}</span>
                <span className="flex items-center gap-2">
                  {bonus === 0 ? null : (
                    <span className="rounded border border-sakura-500/30 px-1.5 py-0.5 font-mono text-[10px] text-sakura-300">
                      成长 {bonus > 0 ? "+" + bonus : bonus}
                    </span>
                  )}
                  <span className="font-mono text-sm text-white/80">{effective[key]}</span>
                </span>
              </div>
            );
          })}
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-4">
          {(["maxHp", "maxMp", "maxSan", "maxDp"] as const).map((key) => (
            <div key={key} className="rounded-lg border border-spirit-400/20 bg-spirit-400/5 px-3 py-2 text-center">
              <p className="text-[11px] text-white/40">{key}</p>
              <p className="text-lg font-semibold text-spirit-400">{outcome.derived[key]}</p>
              {key === "maxSan" && growth.san !== 0 ? (
                <p className="mt-0.5 text-[10px] text-sakura-300">成长 {growth.san > 0 ? "+" + growth.san : growth.san}</p>
              ) : null}
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
            {skillRows.map((row) => {
              const bonus = growth.skill[row.id] ?? 0;
              return (
                <div key={row.id} className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2">
                  <span className="truncate text-xs text-white/60">{row.name}</span>
                  <span className="flex items-center gap-2">
                    {bonus === 0 ? null : (
                      <span className="rounded border border-sakura-500/30 px-1.5 py-0.5 font-mono text-[10px] text-sakura-300">
                        成长 {bonus > 0 ? "+" + bonus : bonus}
                      </span>
                    )}
                    <span className="font-mono text-sm text-white/80">{row.value}</span>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-white/80">
              成长记录（{advancementRows.length}/{allAdvancementRows.length}）
            </h2>
            <p className="mt-1 text-[11px] text-white/35">
              可按类型、来源与局筛选；属性 / 技能 / SAN 记录支持编辑或撤销，撤销后不再计入成长汇总。
            </p>
          </div>
          <Link
            href={"/characters/" + character.id + "/growth/export" + filterSuffix}
            className="rounded-lg border border-spirit-400/40 px-3 py-1.5 text-xs text-spirit-300 transition hover:bg-spirit-400/10"
          >
            导出 CSV（当前筛选）
          </Link>
        </div>

        <form method="get" className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-white/10 bg-ink-900/40 p-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-white/35">类型</span>
            <select
              name="gkind"
              defaultValue={kindFilter}
              className="rounded-lg border border-white/15 bg-ink-900 px-2 py-1.5 text-xs text-white/70"
            >
              <option value="ALL">全部</option>
              {Object.entries(advancementKindLabels).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-white/35">来源</span>
            <select
              name="gsource"
              defaultValue={sourceFilter}
              className="rounded-lg border border-white/15 bg-ink-900 px-2 py-1.5 text-xs text-white/70"
            >
              <option value="ALL">全部</option>
              {sourceOptions.map((value) => (
                <option key={value} value={value}>{ADVANCEMENT_SOURCE_LABELS[value]}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-white/35">来源局</span>
            <select
              name="ggame"
              defaultValue={gameFilter}
              className="rounded-lg border border-white/15 bg-ink-900 px-2 py-1.5 text-xs text-white/70"
            >
              <option value="ALL">全部</option>
              <option value="manual">手动 / 无来源局</option>
              {gameOptions.map(([gameId, title]) => (
                <option key={gameId} value={gameId}>{title}</option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="rounded-lg bg-spirit-400 px-3 py-1.5 text-xs font-medium text-ink-900 transition hover:bg-spirit-300"
          >
            筛选
          </button>
          <Link href={"/characters/" + character.id} className="px-2 py-1.5 text-xs text-white/40 transition hover:text-white/70">
            重置
          </Link>
        </form>

        {advancementNotice === undefined ? null : (
          <p
            className={
              "mt-3 rounded-lg border px-3 py-2 text-[11px] " +
              (advancementNotice === "error" || advancementNotice === "locked"
                ? "border-red-400/30 bg-red-400/10 text-red-200"
                : "border-emerald-400/30 bg-emerald-400/10 text-emerald-200")
            }
          >
            {advancementNotice === "updated"
              ? "成长记录已更新。"
              : advancementNotice === "reverted"
                ? "成长记录已撤销，角色卡数值已回退。"
                : advancementNotice === "locked"
                  ? "该记录已撤销，不能再次操作。"
                  : "操作失败，请检查目标与数值。"}
          </p>
        )}

        {allAdvancementRows.length === 0 ? (
          <p className="mt-3 text-xs text-white/35">还没有成长记录</p>
        ) : advancementRows.length === 0 ? (
          <p className="mt-3 text-xs text-white/35">没有符合当前筛选条件的成长记录。</p>
        ) : (
          <>
            <div className="mt-4 grid gap-2 sm:grid-cols-4">
              <div className="rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2">
                <p className="text-[10px] text-white/35">筛选记录</p>
                <p className="mt-0.5 font-mono text-sm text-white/80">{filteredSummary.total}</p>
              </div>
              <div className="rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2">
                <p className="text-[10px] text-white/35">属性变化</p>
                <p className="mt-0.5 font-mono text-sm text-white/80">{Object.keys(filteredSummary.attribute).length}</p>
              </div>
              <div className="rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2">
                <p className="text-[10px] text-white/35">技能提升</p>
                <p className="mt-0.5 font-mono text-sm text-white/80">{Object.keys(filteredSummary.skill).length}</p>
              </div>
              <div className="rounded-lg border border-sakura-500/20 bg-sakura-500/5 px-3 py-2">
                <p className="text-[10px] text-sakura-300/70">SAN 累计</p>
                <p className="mt-0.5 font-mono text-sm text-sakura-300">{filteredSummary.san > 0 ? "+" + filteredSummary.san : filteredSummary.san}</p>
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-2">
              {[...growthGroups.entries()].map(([key, group]) => (
                <details key={key} open={group.rows.length <= 4} className="rounded-lg border border-white/10 bg-ink-900/50">
                  <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs text-white/70">
                    <span>
                      {group.title}
                      <span className="ml-2 text-[10px] text-white/35">{group.rows.length} 条</span>
                    </span>
                    <span className="text-[10px] text-white/30">展开 / 收起</span>
                  </summary>
                  <ul className="flex flex-col divide-y divide-white/5 border-t border-white/5 px-3">
                    {group.rows.map((item) => (
                      <li key={item.id} className="py-2.5 text-xs">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-white/75">{advancementKindLabels[item.kind] ?? item.kind}</span>
                          <span className="rounded border border-spirit-400/25 px-1.5 py-0.5 text-[10px] text-spirit-200">
                            {ADVANCEMENT_SOURCE_LABELS[item.source]}
                          </span>
                          {item.target === null ? null : (
                            <span className="rounded border border-spirit-400/25 px-1.5 py-0.5 font-mono text-[10px] text-spirit-200">
                              {growthLabel(item.kind, item.target)}
                            </span>
                          )}
                          {item.delta === null ? null : (
                            <span className="font-mono text-[11px] text-sakura-300">
                              {item.delta > 0 ? "+" + item.delta : item.delta}
                            </span>
                          )}
                          {item.editedAt === null ? null : (
                            <span className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-white/35">已编辑</span>
                          )}
                          {item.revertedAt === null ? null : (
                            <span className="rounded border border-red-400/30 px-1.5 py-0.5 text-[10px] text-red-300">已撤销</span>
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
                        {item.revertedAt === null ? (
                          <div className="mt-2 flex flex-wrap items-start gap-2">
                            <details className="min-w-[16rem] flex-1 rounded border border-white/10 bg-ink-900/40 p-2">
                              <summary className="cursor-pointer text-[10px] text-white/40">编辑记录</summary>
                              <form action={updateAdvancementAction} className="mt-2 grid gap-2 sm:grid-cols-4">
                                <input type="hidden" name="advancementId" value={item.id} />
                                <input type="hidden" name="returnTo" value={returnTo} />
                                <label className="flex flex-col gap-1">
                                  <span className="text-[10px] text-white/35">目标</span>
                                  <input
                                    name="target"
                                    defaultValue={item.target ?? ""}
                                    className="rounded border border-white/15 bg-ink-900 px-2 py-1 text-xs text-white/70"
                                  />
                                </label>
                                <label className="flex flex-col gap-1">
                                  <span className="text-[10px] text-white/35">数值变化</span>
                                  <input
                                    name="delta"
                                    type="number"
                                    defaultValue={item.delta ?? ""}
                                    className="rounded border border-white/15 bg-ink-900 px-2 py-1 text-xs text-white/70"
                                  />
                                </label>
                                <label className="flex flex-col gap-1">
                                  <span className="text-[10px] text-white/35">来源</span>
                                  <select
                                    name="source"
                                    defaultValue={item.source}
                                    className="rounded border border-white/15 bg-ink-900 px-2 py-1 text-xs text-white/70"
                                  >
                                    {sourceOptions.map((value) => (
                                      <option key={value} value={value}>{ADVANCEMENT_SOURCE_LABELS[value]}</option>
                                    ))}
                                  </select>
                                </label>
                                <label className="flex flex-col gap-1">
                                  <span className="text-[10px] text-white/35">备注</span>
                                  <input
                                    name="note"
                                    defaultValue={item.note ?? ""}
                                    className="rounded border border-white/15 bg-ink-900 px-2 py-1 text-xs text-white/70"
                                  />
                                </label>
                                <button
                                  type="submit"
                                  className="rounded border border-spirit-400/40 px-3 py-1 text-[11px] text-spirit-300 transition hover:bg-spirit-400/10 sm:col-span-4"
                                >
                                  保存修改
                                </button>
                              </form>
                            </details>
                            <form action={revertAdvancementAction} className="pt-2">
                              <input type="hidden" name="advancementId" value={item.id} />
                              <input type="hidden" name="returnTo" value={returnTo} />
                              <button
                                type="submit"
                                className="rounded border border-red-400/30 px-3 py-1 text-[11px] text-red-300 transition hover:bg-red-400/10"
                              >
                                撤销并回退数值
                              </button>
                            </form>
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          </>
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
