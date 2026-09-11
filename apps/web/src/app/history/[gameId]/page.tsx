import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/server/auth";
import { loadGameModuleView } from "@/server/modules/revision";
import { prisma } from "@/server/db/prisma";

export const dynamic = "force-dynamic";

interface StoredContent {
  readonly text?: string;
  readonly kind?: string;
}

export default async function GameHistoryDetailPage({ params }: { params: { gameId: string } }) {
  const session = await auth();
  if (session === null) redirect("/login");

  const game = await prisma.game.findUnique({
    where: { id: params.gameId },
    include: {
      room: { select: { id: true, name: true, system: true, ownerId: true } },
      state: true,
      characters: {
        include: {
          character: { select: { id: true, name: true, occupation: true } }
        },
        orderBy: { createdAt: "asc" }
      },
      advancements: {
        include: { character: { select: { id: true, name: true } } },
        orderBy: { createdAt: "asc" }
      }
    }
  });
  if (game === null) notFound();
  const gameModule = await loadGameModuleView({
    moduleId: game.moduleId,
    moduleRevisionId: game.moduleRevisionId
  });

  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId: game.roomId, userId: session.user.id } },
    select: { role: true }
  });
  if (membership === null) notFound();

  const messages = await prisma.message.findMany({
    where:
      membership.role === "KP"
        ? { roomId: game.roomId }
        : { roomId: game.roomId, channel: { not: "KP_ONLY" } },
    include: { user: { select: { username: true, displayName: true } } },
    orderBy: { createdAt: "asc" },
    take: 300
  });

  const flags = game.state?.flags ?? {};
  const counters = game.state?.counters ?? {};
  const custom = game.state?.custom ?? {};

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-6 py-12">
      <header>
        <Link href="/history" className="text-xs text-white/40 transition hover:text-white/70">← 返回游戏历史</Link>
        <h1 className="mt-2 text-2xl font-semibold">{game.title || game.room.name}</h1>
        <p className="mt-1 text-xs text-white/45">
          房间：{game.room.name} · {game.room.system} · 已结束 · {game.endedAt?.toISOString().slice(0, 10) ?? "-"}
        </p>
      </header>


      {gameModule === null ? null : (
        <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-white/80">使用团本</h2>
            <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] text-white/45">
              {gameModule.source === "revision" ? "本局快照" : "历史数据"} · v{gameModule.version}
            </span>
          </div>
          <p className="mt-2 text-sm text-white/80">{gameModule.title}</p>
          <p className="mt-1 text-[11px] text-white/40">
            {gameModule.author ?? "未署名"} · {gameModule.system ?? "未指定系统"} · {gameModule.era ?? "未指定年代"}
          </p>
          <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
            <div>
              <p className="text-[10px] text-white/35">背景</p>
              <p className="mt-0.5 whitespace-pre-wrap text-white/60">{gameModule.background ?? "未填写"}</p>
            </div>
            <div>
              <p className="text-[10px] text-white/35">职业推荐</p>
              <p className="mt-0.5 whitespace-pre-wrap text-white/60">{gameModule.occupationRecommendation ?? "未填写"}</p>
            </div>
            <div className="sm:col-span-2">
              <p className="text-[10px] text-white/35">简介</p>
              <p className="mt-0.5 whitespace-pre-wrap text-white/60">{gameModule.synopsis ?? "未填写"}</p>
            </div>
          </div>
        </section>
      )}

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <h2 className="text-sm font-medium text-white/80">最终局内状态</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2">
            <p className="text-[10px] text-white/35">当前章节</p>
            <p className="mt-0.5 text-sm text-white/70">{game.state?.currentChapterId ?? "-"}</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2">
            <p className="text-[10px] text-white/35">当前场景</p>
            <p className="mt-0.5 text-sm text-white/70">{game.state?.currentSceneId ?? "-"}</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2">
            <p className="text-[10px] text-white/35">当前遭遇</p>
            <p className="mt-0.5 text-sm text-white/70">{game.state?.currentEncounterId ?? "-"}</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2">
            <p className="text-[10px] text-white/35">团内时间</p>
            <p className="mt-0.5 text-sm text-white/70">{game.state?.gameTime ?? "-"}</p>
          </div>
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-3">
          {[
            ["旗标", flags],
            ["计数器", counters],
            ["自定义", custom]
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-lg border border-white/10 bg-ink-900/60 p-3">
              <p className="text-[10px] text-white/35">{String(label)}</p>
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-white/55">
                {JSON.stringify(value, null, 2)}
              </pre>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <h2 className="text-sm font-medium text-white/80">局内角色（{game.characters.length}）</h2>
        {game.characters.length === 0 ? (
          <p className="mt-3 text-xs text-white/35">没有局内角色记录。</p>
        ) : (
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {game.characters.map((item) => (
              <div key={item.id} className="rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2.5">
                <p className="text-sm text-white/80">{item.character.name}</p>
                <p className="mt-0.5 text-[10px] text-white/35">{item.character.occupation ?? "无职业"} · {item.status}</p>
                <p className="mt-1 font-mono text-[11px] text-white/55">
                  HP {item.currentHp} · MP {item.currentMp} · SAN {item.currentSan} · DP {item.currentDp}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <h2 className="text-sm font-medium text-white/80">成长记录（{game.advancements.length}）</h2>
        {game.advancements.length === 0 ? (
          <p className="mt-3 text-xs text-white/35">没有成长记录。</p>
        ) : (
          <ul className="mt-3 flex flex-col divide-y divide-white/5">
            {game.advancements.map((item) => (
              <li key={item.id} className="py-2 text-xs">
                <span className="text-white/75">{item.character.name}</span>
                <span className="ml-2 rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-white/45">{item.kind}</span>
                {item.target === null ? null : <span className="ml-2 font-mono text-[10px] text-spirit-200">{item.target}</span>}
                {item.delta === null ? null : <span className="ml-2 font-mono text-sakura-300">{item.delta > 0 ? "+" + item.delta : item.delta}</span>}
                {item.note === null ? null : <p className="mt-1 text-white/45">{item.note}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <h2 className="text-sm font-medium text-white/80">房间历史消息（最近 {messages.length} 条）</h2>
        <ul className="mt-3 max-h-[480px] space-y-3 overflow-y-auto">
          {messages.map((message) => {
            const content = (message.content ?? {}) as StoredContent;
            return (
              <li key={message.id} className="text-xs">
                <div className="flex items-baseline gap-2">
                  <span className="text-white/70">{message.user.displayName ?? message.user.username}</span>
                  <span className="font-mono text-[10px] text-white/25">{message.createdAt.toISOString().slice(11, 19)}</span>
                </div>
                <p className="mt-0.5 whitespace-pre-wrap text-white/55">{content.text ?? ""}</p>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
