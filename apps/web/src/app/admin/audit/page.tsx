import Link from "next/link";
import { prisma } from "@/server/db/prisma";

export const dynamic = "force-dynamic";

function detailText(value: unknown): string {
  if (value === null || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const parts = Object.entries(record).slice(0, 4).map(([key, item]) => key + "=" + String(item));
  return parts.join(" · ");
}

export default async function AdminAuditPage() {
  const logs = await prisma.adminAuditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 300
  });

  return (
    <div className="flex flex-col gap-5">
      <header>
        <Link href="/admin" className="text-xs text-white/40 transition hover:text-white/70">← 管理后台</Link>
        <h1 className="mt-2 text-2xl font-semibold">审计日志</h1>
        <p className="mt-1 text-sm text-white/50">最近 {logs.length} 条管理员操作。</p>
      </header>

      <div className="overflow-hidden rounded-xl border border-white/10 bg-ink-800/50">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-white/10 bg-ink-900/60 text-[10px] uppercase tracking-wider text-white/35">
            <tr>
              <th className="px-4 py-3">时间</th>
              <th className="px-4 py-3">操作人</th>
              <th className="px-4 py-3">动作</th>
              <th className="px-4 py-3">目标</th>
              <th className="px-4 py-3">详情</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {logs.map((log) => (
              <tr key={log.id}>
                <td className="whitespace-nowrap px-4 py-3 text-[10px] text-white/35">{log.createdAt.toLocaleString("zh-CN")}</td>
                <td className="px-4 py-3 text-white/60">{log.actorName ?? log.actorId}</td>
                <td className="px-4 py-3 font-mono text-[10px] text-sakura-300">{log.action}</td>
                <td className="px-4 py-3 text-[10px] text-white/45">{log.targetType}{log.targetId === null ? "" : " · " + log.targetId.slice(0, 10)}</td>
                <td className="max-w-md truncate px-4 py-3 text-[10px] text-white/35" title={JSON.stringify(log.detail)}>{detailText(log.detail)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
