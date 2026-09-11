import Link from "next/link";
import { prisma } from "@/server/db/prisma";

export const dynamic = "force-dynamic";

const MODULES_NAV = [
  { href: "/admin/users", title: "用户管理", description: "角色、禁用状态与管理员权限" },
  { href: "/admin/rooms", title: "房间管理", description: "房间状态、成员、规则包绑定与删除" },
  { href: "/admin/modules", title: "团本管理", description: "全站团本发布、下架与删除" },
  { href: "/admin/rulepacks", title: "规则包管理", description: "创建、版本、发布、绑房与导入导出" },
  { href: "/admin/games", title: "游戏局", description: "查看全站开局与结束状态" },
  { href: "/admin/system", title: "系统设置", description: "DeepSeek 等平台级配置" },
  { href: "/admin/audit", title: "审计日志", description: "所有管理员操作留痕" }
] as const;

function StatCard({ label, value, hint }: { readonly label: string; readonly value: number; readonly hint: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-ink-800/50 p-4">
      <p className="text-[11px] text-white/40">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-white/90">{value}</p>
      <p className="mt-1 text-[10px] text-white/30">{hint}</p>
    </div>
  );
}

export default async function AdminDashboardPage() {
  const [users, rooms, modules, games, rulePacks, auditCount, recentAudit, recentGames] = await Promise.all([
    prisma.user.count(),
    prisma.room.count(),
    prisma.module.count(),
    prisma.game.count(),
    prisma.rulePack.count(),
    prisma.adminAuditLog.count(),
    prisma.adminAuditLog.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
    prisma.game.findMany({
      orderBy: { createdAt: "desc" },
      take: 6,
      include: { room: { select: { id: true, name: true } }, module: { select: { title: true } } }
    })
  ]);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold">管理后台</h1>
        <p className="mt-1 text-sm text-white/50">平台数据、规则包与 AI 导入配置的总控台。</p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <StatCard label="用户" value={users} hint="注册账号总数" />
        <StatCard label="房间" value={rooms} hint="含已结束" />
        <StatCard label="团本" value={modules} hint="全站团本总数" />
        <StatCard label="游戏局" value={games} hint="历史与进行中" />
        <StatCard label="规则包" value={rulePacks} hint="DB 管理的规则包" />
        <StatCard label="审计记录" value={auditCount} hint="管理员操作留痕" />
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {MODULES_NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-xl border border-white/10 bg-ink-800/50 p-4 transition hover:border-sakura-500/40"
          >
            <p className="text-sm font-medium text-white/85">{item.title}</p>
            <p className="mt-1 text-[11px] leading-5 text-white/40">{item.description}</p>
          </Link>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
          <h2 className="text-sm font-medium text-white/80">最近游戏局</h2>
          {recentGames.length === 0 ? (
            <p className="mt-3 text-xs text-white/35">暂无游戏局。</p>
          ) : (
            <ul className="mt-3 flex flex-col divide-y divide-white/5">
              {recentGames.map((game) => (
                <li key={game.id} className="flex items-center justify-between gap-3 py-2 text-xs">
                  <span className="min-w-0 truncate text-white/70">{game.title}</span>
                  <span className="shrink-0 text-white/35">
                    {game.room.name} · {game.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
          <h2 className="text-sm font-medium text-white/80">最近管理操作</h2>
          {recentAudit.length === 0 ? (
            <p className="mt-3 text-xs text-white/35">暂无操作记录。</p>
          ) : (
            <ul className="mt-3 flex flex-col divide-y divide-white/5">
              {recentAudit.map((log) => (
                <li key={log.id} className="flex items-center justify-between gap-3 py-2 text-xs">
                  <span className="min-w-0 truncate text-white/70">
                    {log.actorName ?? "管理员"} · {log.action}
                  </span>
                  <span className="shrink-0 text-white/30">{log.targetType}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
