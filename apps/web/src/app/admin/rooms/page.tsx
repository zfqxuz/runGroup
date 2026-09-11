import Link from "next/link";
import { adminSetRoomStatusAction, deleteRoomAdminAction } from "@/server/actions/admin";
import { prisma } from "@/server/db/prisma";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  LOBBY: "准备中",
  PLAYING: "跑团中",
  PAUSED: "已暂停",
  COMBAT: "战斗中",
  ENDED: "已结束"
};

const STATUSES = ["LOBBY", "PLAYING", "PAUSED", "COMBAT", "ENDED"] as const;

export default async function AdminRoomsPage({
  searchParams
}: {
  searchParams: { saved?: string; error?: string };
}) {
  const rooms = await prisma.room.findMany({
    include: {
      owner: { select: { username: true, displayName: true } },
      rulePack: { select: { version: true, pack: { select: { name: true } } } },
      _count: { select: { members: true, games: true, modules: true } }
    },
    orderBy: { createdAt: "desc" },
    take: 200
  });

  return (
    <div className="flex flex-col gap-5">
      <header>
        <Link href="/admin" className="text-xs text-white/40 transition hover:text-white/70">← 管理后台</Link>
        <h1 className="mt-2 text-2xl font-semibold">房间管理</h1>
        <p className="mt-1 text-sm text-white/50">全站房间共 {rooms.length} 个。强制改状态用于处理卡死房间，删除会级联清理房间数据。</p>
      </header>

      {searchParams.saved === undefined ? null : (
        <p className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-200">操作已保存：{searchParams.saved}</p>
      )}
      {searchParams.error === undefined ? null : (
        <p className="rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-200">操作失败：{searchParams.error}</p>
      )}

      <div className="overflow-hidden rounded-xl border border-white/10 bg-ink-800/50">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-white/10 bg-ink-900/60 text-[10px] uppercase tracking-wider text-white/35">
            <tr>
              <th className="px-4 py-3">房间</th>
              <th className="px-4 py-3">KP / 成员</th>
              <th className="px-4 py-3">规则包</th>
              <th className="px-4 py-3">状态</th>
              <th className="px-4 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {rooms.map((room) => (
              <tr key={room.id}>
                <td className="px-4 py-3">
                  <Link href={"/rooms/" + room.id + "/prepare"} className="font-medium text-white/80 hover:text-sakura-300">{room.name}</Link>
                  <p className="mt-0.5 text-[10px] text-white/35">
                    {room.system} · 邀请码 {room.inviteCode} · 局 {room._count.games} · 团 {room._count.modules}
                  </p>
                </td>
                <td className="px-4 py-3 text-white/55">
                  {room.owner.displayName ?? room.owner.username}
                  <span className="text-white/30"> / {room._count.members} 人</span>
                </td>
                <td className="px-4 py-3 text-[10px] text-white/45">
                  {room.rulePack === null ? "内置默认包" : room.rulePack.pack.name + " v" + room.rulePack.version}
                </td>
                <td className="px-4 py-3">
                  <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] text-white/55">
                    {STATUS_LABELS[room.status] ?? room.status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <form action={adminSetRoomStatusAction} className="flex items-center gap-1">
                      <input type="hidden" name="roomId" value={room.id} />
                      <select name="status" defaultValue={room.status} className="rounded border border-white/15 bg-ink-900 px-1.5 py-1 text-[10px]">
                        {STATUSES.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
                      </select>
                      <button type="submit" className="rounded border border-white/15 px-2 py-1 text-[10px] text-white/60 transition hover:text-white">改状态</button>
                    </form>
                    <form action={deleteRoomAdminAction}>
                      <input type="hidden" name="roomId" value={room.id} />
                      <button type="submit" className="rounded border border-red-400/30 px-2 py-1 text-[10px] text-red-300 transition hover:bg-red-400/10">删除</button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
