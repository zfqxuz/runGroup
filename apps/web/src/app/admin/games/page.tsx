import Link from "next/link";
import { prisma } from "@/server/db/prisma";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  PREPARING: "准备中",
  PLAYING: "进行中",
  PAUSED: "已暂停",
  COMBAT: "战斗中",
  ENDED: "已结束"
};

export default async function AdminGamesPage() {
  const games = await prisma.game.findMany({
    include: {
      room: { select: { id: true, name: true } },
      module: { select: { id: true, title: true } },
      _count: { select: { characters: true, advancements: true } }
    },
    orderBy: { createdAt: "desc" },
    take: 200
  });

  return (
    <div className="flex flex-col gap-5">
      <header>
        <Link href="/admin" className="text-xs text-white/40 transition hover:text-white/70">← 管理后台</Link>
        <h1 className="mt-2 text-2xl font-semibold">游戏局</h1>
        <p className="mt-1 text-sm text-white/50">最近 {games.length} 局。只读视图，用于排查卡死局与历史数据。</p>
      </header>

      <div className="overflow-hidden rounded-xl border border-white/10 bg-ink-800/50">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-white/10 bg-ink-900/60 text-[10px] uppercase tracking-wider text-white/35">
            <tr>
              <th className="px-4 py-3">局</th>
              <th className="px-4 py-3">房间</th>
              <th className="px-4 py-3">团本</th>
              <th className="px-4 py-3">状态</th>
              <th className="px-4 py-3">创建 / 结束</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {games.map((game) => (
              <tr key={game.id}>
                <td className="px-4 py-3">
                  <Link href={"/history/" + game.id} className="font-medium text-white/80 hover:text-sakura-300">{game.title}</Link>
                  <p className="mt-0.5 text-[10px] text-white/35">角色 {game._count.characters} · 成长 {game._count.advancements}</p>
                </td>
                <td className="px-4 py-3 text-white/55">{game.room.name}</td>
                <td className="px-4 py-3 text-[10px] text-white/45">{game.module === null ? "无团本" : game.module.title}</td>
                <td className="px-4 py-3">
                  <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] text-white/55">
                    {STATUS_LABELS[game.status] ?? game.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-[10px] text-white/35">
                  {game.createdAt.toLocaleString("zh-CN")}
                  <br />
                  {game.endedAt === null ? "未结束" : game.endedAt.toLocaleString("zh-CN")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
