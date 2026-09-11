import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ATTRIBUTE_KEYS } from "@touhou/rules";
import EndGamePanel from "@/components/room/EndGamePanel";
import { cancelGrowthCheckAction, resolveGrowthCheckAction, revertAdvancementAction } from "@/server/actions/advancement";
import { auth } from "@/server/auth";
import { buildEffectiveSkills } from "@/server/character/skills";
import { prisma } from "@/server/db/prisma";
import { ADVANCEMENT_SOURCE_LABELS } from "@/server/game/advancement";
import { growthCheckView, isAdvancementSource } from "@/server/game/view";
import { loadGameModuleView } from "@/server/modules/revision";
import { endGameWithAdvancementsAction } from "@/server/actions/room";
import { loadEffectivePack } from "@/server/rules/loader";

export const dynamic = "force-dynamic";

const KIND_LABELS: Record<string, string> = {
  ATTRIBUTE: "属性",
  SKILL: "技能",
  SAN: "SAN",
  ITEM: "物品",
  RELATIONSHIP: "关系",
  OTHER: "其他"
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

function deltaText(delta: number | null): string {
  if (delta === null) return "";
  return delta > 0 ? "+" + delta : String(delta);
}

const GROWTH_NOTICE: Record<string, string> = {
  passed: "成长检定完成：有技能成功提升，已写入成长记录。",
  failed: "成长检定完成：本次没有技能提升。",
  none: "没有待检定的成长点。",
  marked: "已标记成长点。",
  cancelled: "已取消成长点。",
  exists: "该技能已经有待检定成长点。",
  locked: "该成长点已经结算，不能重复操作。"
};

export default async function EndGamePage({
  params,
  searchParams
}: {
  params: { id: string };
  searchParams: { error?: string; growth?: string };
}) {
  const session = await auth();
  if (session === null) redirect("/login");

  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId: params.id, userId: session.user.id } },
    select: { role: true }
  });
  if (membership === null) notFound();
  if ((membership.role === "KP") === false) redirect("/rooms/" + params.id + "/prepare");

  const room = await prisma.room.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      name: true,
      status: true,
      system: true,
      rulePackVersionId: true,
      ruleOverride: true
    }
  });
  if (room === null) notFound();
  if (room.status === "LOBBY" || room.status === "ENDED") redirect("/rooms/" + params.id + "/prepare");

  const activeGame = await prisma.game.findFirst({
    where: {
      roomId: room.id,
      status: { in: ["PREPARING", "PLAYING", "PAUSED", "COMBAT"] }
    },
    orderBy: { createdAt: "desc" },
    include: {
      characters: {
        include: { character: true },
        orderBy: { createdAt: "asc" }
      }
    }
  });

  const gameModule = activeGame === null ? null : await loadGameModuleView(activeGame);
  const advancements = activeGame === null
    ? []
    : await prisma.characterAdvancement.findMany({
        where: { gameId: activeGame.id },
        include: { character: { select: { name: true } } },
        orderBy: { createdAt: "asc" }
      });
  const pendingChecks = activeGame === null
    ? []
    : await prisma.growthCheck.findMany({
        where: { gameId: activeGame.id, state: "PENDING" },
        include: { character: { select: { name: true } } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }]
      });
  const pendingRows = pendingChecks.map((item) => growthCheckView(item));

  const pack = await loadEffectivePack({
    id: room.id,
    system: room.system,
    rulePackVersionId: room.rulePackVersionId,
    ruleOverride: room.ruleOverride
  });
  const skillNames = new Map<string, string>();
  for (const skill of pack.compiled.skills) skillNames.set(skill.id, skill.name);

  const previews = (activeGame?.characters ?? []).map((item) => {
    const character = item.character;
    const effectiveSkills = buildEffectiveSkills(pack.compiled, character);
    const skills = Object.entries(effectiveSkills)
      .map(([id, value]) => ({ id, name: skillNames.get(id) ?? id, value }))
      .filter((row) => row.value > 0)
      .sort((a, b) => b.value - a.value);
    const checks = pendingRows.filter((check) => check.characterId === item.characterId);
    return {
      id: item.characterId,
      name: character.name,
      status: item.status,
      currentHp: item.currentHp,
      maxHp: character.maxHp,
      currentMp: item.currentMp,
      maxMp: character.maxMp,
      currentSan: item.currentSan,
      maxSan: character.maxSan,
      currentDp: item.currentDp,
      maxDp: character.maxDp,
      attributes: ATTRIBUTE_KEYS.map((key) => ({ key, value: character[key] })),
      skills,
      pendingChecks: checks
    };
  });

  const characters = previews.map((item) => ({
    id: item.id,
    name: item.name,
    currentHp: item.currentHp,
    maxHp: item.maxHp,
    currentMp: item.currentMp,
    maxMp: item.maxMp,
    currentSan: item.currentSan,
    maxSan: item.maxSan,
    status: item.status
  }));

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-6 py-12">
      <header>
        <Link href={"/rooms/" + room.id} className="text-xs text-white/40 transition hover:text-white/70">
          ← 返回跑团页
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">结束本局 · 成长确认</h1>
        <p className="mt-1 text-sm text-white/50">
          建议先确认本局成长与奖励，再结束。结束后房间回到准备页，角色、物品与成长记录都会保留。
        </p>
      </header>

      {activeGame === null ? (
        <section className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-5">
          <h2 className="text-sm font-medium text-amber-100">当前没有进行中的局</h2>
          <p className="mt-2 text-xs leading-relaxed text-amber-100/80">
            房间状态可能卡在 PLAYING / COMBAT / PAUSED，但数据库里没有可结束的 Game。
            点击下方按钮会把房间直接重置为 LOBBY，并关闭残留战斗。
          </p>
          <form action={endGameWithAdvancementsAction} className="mt-4">
            <input type="hidden" name="roomId" value={room.id} />
            <input type="hidden" name="gameId" value="" />
            <input type="hidden" name="rows" value="[]" />
            <button
              type="submit"
              className="rounded-lg bg-sakura-500 px-5 py-2.5 text-sm font-medium text-ink-900 transition hover:bg-sakura-400"
            >
              结束并重置房间
            </button>
          </form>
        </section>
      ) : null}

      {searchParams.error === "advancement" ? (
        <p className="rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-xs text-red-200">
          成长 / 奖励数据不合法，请检查目标、数值与角色。属性 / 技能 / SAN 的数值变化必须是非零整数。
        </p>
      ) : null}
      {searchParams.error === "game" ? (
        <p className="rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-xs text-red-200">
          当前局状态或角色不匹配，无法写入成长。
        </p>
      ) : null}
      {searchParams.growth === undefined ? null : (
        <p className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-xs text-emerald-200">
          {GROWTH_NOTICE[searchParams.growth] ?? searchParams.growth}
        </p>
      )}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-white/10 bg-ink-800/50 p-4">
          <p className="text-[10px] text-white/35">房间</p>
          <p className="mt-1 truncate text-sm text-white/80">{room.name}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-ink-800/50 p-4">
          <p className="text-[10px] text-white/35">本局</p>
          <p className="mt-1 truncate text-sm text-white/80">{activeGame?.title ?? "无进行中的局"}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-ink-800/50 p-4">
          <p className="text-[10px] text-white/35">团本快照</p>
          <p className="mt-1 truncate text-sm text-white/80">
            {gameModule === null ? "无团本" : gameModule.title + " · v" + gameModule.version}
          </p>
          <p className="mt-0.5 text-[10px] text-white/35">
            {gameModule === null ? "" : gameModule.source === "revision" ? "已锁定开局快照" : "旧局：未生成快照"}
          </p>
        </div>
        <div className="rounded-xl border border-white/10 bg-ink-800/50 p-4">
          <p className="text-[10px] text-white/35">角色 / 成长</p>
          <p className="mt-1 text-sm text-white/80">
            {characters.length} 名角色 · {advancements.length} 条记录
          </p>
          <p className="mt-0.5 text-[10px] text-amber-300/80">{pendingRows.length} 个待检定成长点</p>
        </div>
      </section>

      {activeGame === null ? null : (
        <section className="rounded-xl border border-amber-400/25 bg-amber-400/5 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium text-amber-100">成长点确认</h2>
              <p className="mt-1 text-[11px] text-amber-100/70">
                CoC 幕间成长检定：对每个待检定技能掷 1d100；结果大于当前技能值，或落在 96-100 时，技能 +1d10。
              </p>
            </div>
            {pendingRows.length === 0 ? null : (
              <form action={resolveGrowthCheckAction}>
                <input type="hidden" name="roomId" value={room.id} />
                <input type="hidden" name="gameId" value={activeGame.id} />
                <input type="hidden" name="returnTo" value={"/rooms/" + room.id + "/end"} />
                <button
                  type="submit"
                  className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-medium text-ink-900 transition hover:bg-amber-300"
                >
                  进行成长检定（{pendingRows.length}）
                </button>
              </form>
            )}
          </div>
          {pendingRows.length === 0 ? (
            <p className="mt-3 text-xs text-amber-100/50">没有待检定的成长点。</p>
          ) : (
            <ul className="mt-3 flex flex-col divide-y divide-amber-200/10">
              {pendingRows.map((check) => (
                <li key={check.id} className="flex flex-wrap items-center gap-2 py-2 text-xs">
                  <span className="font-medium text-amber-100/90">{check.characterName}</span>
                  <span className="rounded border border-amber-200/20 px-1.5 py-0.5 text-[10px] text-amber-100/80">
                    {check.skillName ?? check.skillId}
                  </span>
                  <span className="font-mono text-[10px] text-amber-100/60">当前 {check.beforeValue}</span>
                  {check.note === null ? null : <span className="text-amber-100/60">{check.note}</span>}
                  <form action={cancelGrowthCheckAction} className="ml-auto">
                    <input type="hidden" name="roomId" value={room.id} />
                    <input type="hidden" name="checkId" value={check.id} />
                    <input type="hidden" name="returnTo" value={"/rooms/" + room.id + "/end"} />
                    <button
                      type="submit"
                      className="rounded border border-red-400/30 px-2 py-0.5 text-[10px] text-red-300 transition hover:bg-red-400/10"
                    >
                      取消
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-medium text-white/80">角色卡预览</h2>
        {previews.length === 0 ? (
          <p className="rounded-xl border border-white/10 bg-ink-800/50 p-5 text-xs text-white/35">本局没有局内角色。</p>
        ) : (
          previews.map((card) => (
            <article key={card.id} className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-white/85">{card.name}</h3>
                  <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] text-white/45">
                    {card.status}
                  </span>
                  {card.pendingChecks.length === 0 ? null : (
                    <span className="rounded-full border border-amber-400/40 px-2 py-0.5 text-[10px] text-amber-300">
                      {card.pendingChecks.length} 个成长点
                    </span>
                  )}
                </div>
                <Link href={"/characters/" + card.id} className="text-[11px] text-spirit-400 hover:underline">
                  打开角色页 →
                </Link>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-4">
                {[
                  ["HP", card.currentHp, card.maxHp],
                  ["MP", card.currentMp, card.maxMp],
                  ["SAN", card.currentSan, card.maxSan],
                  ["DP", card.currentDp, card.maxDp]
                ].map(([label, current, max]) => (
                  <div key={String(label)} className="rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2 text-xs">
                    <span className="text-white/40">{label}</span>
                    <span className="ml-2 font-mono text-white/80">
                      {current}/{max}
                    </span>
                  </div>
                ))}
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
                {card.attributes.map((attribute) => (
                  <div
                    key={attribute.key}
                    className="flex items-center justify-between rounded-lg border border-white/10 bg-ink-900/60 px-3 py-1.5 text-xs"
                  >
                    <span className="text-white/40">{ATTRIBUTE_LABELS[attribute.key] ?? attribute.key}</span>
                    <span className="font-mono text-white/80">{attribute.value}</span>
                  </div>
                ))}
              </div>

              {card.skills.length === 0 ? null : (
                <details className="mt-3 rounded-lg border border-white/10 bg-ink-900/50">
                  <summary className="cursor-pointer px-3 py-2 text-xs text-white/60">
                    技能 {card.skills.length} 项（含待检定标记）
                  </summary>
                  <div className="grid max-h-72 gap-1.5 overflow-y-auto border-t border-white/5 p-3 sm:grid-cols-2 lg:grid-cols-3">
                    {card.skills.map((skill) => {
                      const pending = card.pendingChecks.find((check) => check.skillId === skill.id);
                      return (
                        <div
                          key={skill.id}
                          className={
                            "flex items-center justify-between gap-2 rounded border px-2 py-1 text-[11px] " +
                            (pending === undefined
                              ? "border-white/5 bg-ink-900/40"
                              : "border-amber-400/30 bg-amber-400/10")
                          }
                        >
                          <span className="truncate text-white/55">{skill.name}</span>
                          <span className="font-mono text-white/75">{skill.value}</span>
                        </div>
                      );
                    })}
                  </div>
                </details>
              )}
            </article>
          ))
        )}
      </section>

      {advancements.length === 0 ? null : (
        <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
          <h2 className="text-sm font-medium text-white/80">已有成长记录（{advancements.length}）</h2>
          <ul className="mt-3 flex flex-col divide-y divide-white/5">
            {advancements.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-2 py-2 text-xs">
                <span className="text-white/70">{item.character.name}</span>
                <span className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-white/45">
                  {KIND_LABELS[item.kind] ?? item.kind}
                </span>
                <span className="rounded border border-spirit-400/25 px-1.5 py-0.5 text-[10px] text-spirit-200">
                  {ADVANCEMENT_SOURCE_LABELS[isAdvancementSource(item.source) ? item.source : "OTHER"]}
                </span>
                {item.target === null ? null : <span className="font-mono text-[10px] text-spirit-200">{item.target}</span>}
                <span className="font-mono text-[11px] text-sakura-300">{deltaText(item.delta)}</span>
                {item.note === null ? null : <span className="text-white/40">{item.note}</span>}
                {item.revertedAt === null ? (
                  <form action={revertAdvancementAction} className="ml-auto">
                    <input type="hidden" name="advancementId" value={item.id} />
                    <input type="hidden" name="returnTo" value={"/rooms/" + room.id + "/end"} />
                    <button
                      type="submit"
                      className="rounded border border-red-400/30 px-2 py-0.5 text-[10px] text-red-300 transition hover:bg-red-400/10"
                    >
                      撤销
                    </button>
                  </form>
                ) : (
                  <span className="ml-auto rounded border border-red-400/30 px-1.5 py-0.5 text-[10px] text-red-300">
                    已撤销
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {activeGame === null ? null : (
        <EndGamePanel
          roomId={room.id}
          gameId={activeGame.id}
          characters={characters}
          pendingGrowthCount={pendingRows.length}
        />
      )}

      <div>
        <Link href={"/rooms/" + room.id} className="text-xs text-white/40 transition hover:text-white/70">
          ← 取消，返回跑团页
        </Link>
      </div>
    </main>
  );
}
