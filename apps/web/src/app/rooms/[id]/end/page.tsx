import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import EndGamePanel from "@/components/room/EndGamePanel";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";
import { loadGameModuleView } from "@/server/modules/revision";
import { endGameWithAdvancementsAction } from "@/server/actions/room";

export const dynamic = "force-dynamic";

const KIND_LABELS: Record<string, string> = {
  ATTRIBUTE: "属性",
  SKILL: "技能",
  SAN: "SAN",
  ITEM: "物品",
  RELATIONSHIP: "关系",
  OTHER: "其他"
};

function deltaText(delta: number | null): string {
  if (delta === null) return "";
  return delta > 0 ? "+" + delta : String(delta);
}

export default async function EndGamePage({
  params,
  searchParams
}: {
  params: { id: string };
  searchParams: { error?: string };
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
    select: { id: true, name: true, status: true }
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
        include: { character: { select: { id: true, name: true, maxHp: true, maxMp: true, maxSan: true } } },
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
  const characters = (activeGame?.characters ?? []).map((item) => ({
    id: item.characterId,
    name: item.character.name,
    currentHp: item.currentHp,
    maxHp: item.character.maxHp,
    currentMp: item.currentMp,
    maxMp: item.character.maxMp,
    currentSan: item.currentSan,
    maxSan: item.character.maxSan,
    status: item.status
  }));

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-6 py-12">
      <header>
        <Link href={"/rooms/" + room.id} className="text-xs text-white/40 transition hover:text-white/70">
          ← 返回跑团页
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">结束本局</h1>
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
          <p className="text-[10px] text-white/35">角色 / 已有成长</p>
          <p className="mt-1 text-sm text-white/80">
            {characters.length} 名角色 · {advancements.length} 条成长
          </p>
        </div>
      </section>

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <h2 className="text-sm font-medium text-white/80">局内角色</h2>
        {characters.length === 0 ? (
          <p className="mt-3 text-xs text-white/35">本局没有局内角色。</p>
        ) : (
          <ul className="mt-3 flex flex-col divide-y divide-white/5">
            {characters.map((character) => (
              <li key={character.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-xs">
                <span className="font-medium text-white/75">{character.name}</span>
                <span className="text-white/40">
                  HP {character.currentHp}/{character.maxHp} · MP {character.currentMp}/{character.maxMp} · SAN{" "}
                  {character.currentSan}/{character.maxSan} · {character.status}
                </span>
              </li>
            ))}
          </ul>
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
                {item.target === null ? null : <span className="font-mono text-[10px] text-spirit-200">{item.target}</span>}
                <span className="font-mono text-[11px] text-sakura-300">{deltaText(item.delta)}</span>
                {item.note === null ? null : <span className="text-white/40">{item.note}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {activeGame === null ? null : (
        <EndGamePanel roomId={room.id} gameId={activeGame.id} characters={characters} />
      )}

      <div>
        <Link href={"/rooms/" + room.id} className="text-xs text-white/40 transition hover:text-white/70">
          ← 取消，返回跑团页
        </Link>
      </div>
    </main>
  );
}
