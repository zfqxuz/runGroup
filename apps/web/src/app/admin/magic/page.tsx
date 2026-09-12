import Link from "next/link";
import { loadModuleMagicInfo } from "@/server/modules/magic";
import { prisma } from "@/server/db/prisma";

export const dynamic = "force-dynamic";

function overrideMagicOf(ruleOverride: unknown): { enabled: boolean; spellCount: number } {
  if (ruleOverride === null || typeof ruleOverride !== "object" || Array.isArray(ruleOverride)) {
    return { enabled: false, spellCount: 0 };
  }
  const magic = (ruleOverride as Record<string, unknown>).magic;
  if (magic === null || typeof magic !== "object" || Array.isArray(magic)) {
    return { enabled: false, spellCount: 0 };
  }
  const record = magic as Record<string, unknown>;
  return {
    enabled: record.enabled === true,
    spellCount: Array.isArray(record.spells) ? record.spells.length : 0
  };
}

export default async function AdminMagicPage({
  searchParams
}: {
  searchParams: { saved?: string; error?: string };
}) {
  const rooms = await prisma.room.findMany({
    include: {
      selectedModule: { select: { id: true, title: true } },
      rulePack: { select: { version: true, pack: { select: { name: true } } } }
    },
    orderBy: { createdAt: "desc" },
    take: 200
  });

  const rows = await Promise.all(
    rooms.map(async (room) => {
      const moduleInfo = room.selectedModuleId === null ? null : await loadModuleMagicInfo(room.selectedModuleId);
      const override = overrideMagicOf(room.ruleOverride);
      return {
        id: room.id,
        name: room.name,
        system: room.system,
        status: room.status,
        magicEnabled: room.magicEnabled,
        moduleId: room.selectedModuleId,
        moduleTitle: room.selectedModule?.title ?? null,
        moduleSpellCount: moduleInfo?.spells.length ?? 0,
        overrideEnabled: override.enabled,
        overrideSpellCount: override.spellCount,
        rulePackLabel:
          room.rulePack === null
            ? "内置 / 未绑定"
            : room.rulePack.pack.name + " v" + room.rulePack.version
      };
    })
  );

  const enabledCount = rows.filter((row) => row.magicEnabled).length;
  const withModuleMagic = rows.filter((row) => row.moduleSpellCount > 0).length;
  const effectiveLikely = rows.filter((row) => row.magicEnabled && (row.moduleSpellCount > 0 || row.overrideSpellCount > 0)).length;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <Link href="/admin" className="text-xs text-white/40 transition hover:text-white/70">← 管理后台</Link>
        <h1 className="mt-2 text-2xl font-semibold">魔法管理</h1>
        <p className="mt-1 text-sm text-white/50">
          查看每个房间的魔法配置链路：房间开关 → 团本 structured.magic → Room.ruleOverride → 最终生效规则包。
        </p>
      </header>

      {searchParams.saved === undefined ? null : (
        <p className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-200">
          操作已保存：{searchParams.saved}
        </p>
      )}
      {searchParams.error === undefined ? null : (
        <p className="rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-200">
          操作失败：{searchParams.error}
        </p>
      )}

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-white/10 bg-ink-800/50 p-4">
          <p className="text-[11px] text-white/40">已开启魔法开关的房间</p>
          <p className="mt-1 text-2xl font-semibold text-purple-300">{enabledCount}</p>
          <p className="mt-1 text-[10px] text-white/30">Room.magicEnabled = true</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-ink-800/50 p-4">
          <p className="text-[11px] text-white/40">团本中解析出魔法的房间</p>
          <p className="mt-1 text-2xl font-semibold text-spirit-300">{withModuleMagic}</p>
          <p className="mt-1 text-[10px] text-white/30">selected module structured.magic 非空</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-ink-800/50 p-4">
          <p className="text-[11px] text-white/40">开关 + 有法术数据</p>
          <p className="mt-1 text-2xl font-semibold text-emerald-300">{effectiveLikely}</p>
          <p className="mt-1 text-[10px] text-white/30">还需要规则包版本 / 冲突检查确认最终生效</p>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-white/10 bg-ink-800/50">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-white/10 bg-ink-900/60 text-[10px] uppercase tracking-wider text-white/35">
            <tr>
              <th className="px-4 py-3">房间</th>
              <th className="px-4 py-3">魔法开关</th>
              <th className="px-4 py-3">选中团本</th>
              <th className="px-4 py-3">团本魔法</th>
              <th className="px-4 py-3">Room.ruleOverride</th>
              <th className="px-4 py-3">绑定规则包</th>
              <th className="px-4 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-xs text-white/35">还没有房间。</td>
              </tr>
            ) : null}
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-3">
                  <p className="font-medium text-white/80">{row.name}</p>
                  <p className="mt-0.5 text-[10px] text-white/30">{row.system} · {row.status}</p>
                </td>
                <td className="px-4 py-3">
                  {row.magicEnabled ? (
                    <span className="rounded-full border border-emerald-400/40 px-2 py-0.5 text-[10px] text-emerald-300">已开启</span>
                  ) : (
                    <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] text-white/40">未开启</span>
                  )}
                </td>
                <td className="px-4 py-3 text-[10px] text-white/55">{row.moduleTitle ?? "未选择"}</td>
                <td className="px-4 py-3 text-[10px] text-white/55">{row.moduleSpellCount} 条</td>
                <td className="px-4 py-3 text-[10px] text-white/55">
                  {row.overrideEnabled ? "启用" : "关闭"} · {row.overrideSpellCount} 条
                </td>
                <td className="px-4 py-3 text-[10px] text-white/45">{row.rulePackLabel}</td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={"/admin/magic/" + row.id}
                    className="rounded border border-spirit-400/40 px-2 py-1 text-[10px] text-spirit-300 transition hover:bg-spirit-400/10"
                  >
                    查看链路
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
