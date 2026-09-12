import Link from "next/link";
import { notFound } from "next/navigation";
import { spellTargeting } from "@touhou/rules";
import { adminSetRoomMagicEnabledAction, adminSyncRoomMagicAction } from "@/server/actions/admin";
import { loadRoomMagicDiagnostics } from "@/server/modules/magic";
import { prisma } from "@/server/db/prisma";
import { magicSpellEffectLabels } from "@/shared/magic";

export const dynamic = "force-dynamic";

export default async function AdminRoomMagicPage({
  params,
  searchParams
}: {
  params: { roomId: string };
  searchParams: { saved?: string; error?: string; count?: string };
}) {
  const diagnostics = await loadRoomMagicDiagnostics(params.roomId);
  if (diagnostics === null) notFound();
  const roomRow = await prisma.room.findUnique({
    where: { id: params.roomId },
    select: { ruleOverride: true }
  });

  const effectiveSpells = diagnostics.effectiveMagic.spells;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <Link href="/admin/magic" className="text-xs text-white/40 transition hover:text-white/70">← 魔法管理</Link>
        <h1 className="mt-2 text-2xl font-semibold">{diagnostics.room.name}</h1>
        <p className="mt-1 text-sm text-white/50">
          {diagnostics.room.system} · {diagnostics.room.status} · 房间开关{" "}
          {diagnostics.room.magicEnabled ? "已开启" : "未开启"}
        </p>
      </header>

      {searchParams.saved === undefined ? null : (
        <p className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-200">
          操作已保存：{searchParams.saved}
          {searchParams.count === undefined ? "" : "（同步 " + searchParams.count + " 条法术）"}
        </p>
      )}
      {searchParams.error === undefined ? null : (
        <p className="rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-200">
          操作失败：{searchParams.error}
        </p>
      )}

      <section className="grid gap-3">
        {diagnostics.issues.map((issue) => (
          <p key={issue} className="rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-200">
            未生效原因：{issue}
          </p>
        ))}
        {diagnostics.warnings.map((warning) => (
          <p key={warning} className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-200">
            诊断：{warning}
          </p>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
          <h2 className="text-sm font-medium text-white/80">1. 房间开关</h2>
          <p className="mt-1 text-[11px] text-white/40">
            控制是否把团本 structured.magic 合并进 Room.ruleOverride。关闭后最终规则包不会带团本魔法。
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className={diagnostics.room.magicEnabled ? "text-xs text-emerald-300" : "text-xs text-white/45"}>
              Room.magicEnabled = {String(diagnostics.room.magicEnabled)}
            </span>
            <form action={adminSetRoomMagicEnabledAction}>
              <input type="hidden" name="roomId" value={params.roomId} />
              <input type="hidden" name="enabled" value={diagnostics.room.magicEnabled ? "0" : "1"} />
              <button
                type="submit"
                className="rounded-lg border border-purple-400/40 px-3 py-1.5 text-xs text-purple-200 transition hover:bg-purple-400/10"
              >
                {diagnostics.room.magicEnabled ? "关闭房间魔法" : "开启房间魔法"}
              </button>
            </form>
            <Link href={"/rooms/" + params.roomId + "/prepare"} className="text-xs text-white/40 transition hover:text-white/70">
              去准备页 →
            </Link>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
          <h2 className="text-sm font-medium text-white/80">2. 团本 structured.magic</h2>
          <p className="mt-1 text-[11px] text-white/40">
            模板/导出的团本里如果有 spells 数据，会在这里显示；没有则说明导入时没有生成结构化魔法。
          </p>
          <p className="mt-3 text-xs text-white/60">
            {diagnostics.moduleMagic.title ?? diagnostics.room.selectedModuleTitle ?? "未选择团本"}
          </p>
          <p className="mt-1 text-[11px] text-white/40">
            解析法术：{diagnostics.moduleMagic.spellCount} 条
            {diagnostics.moduleMagic.moduleId === null ? " · 未选择团本" : diagnostics.moduleMagic.loaded ? "" : " · 没有 structured.magic"}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <form action={adminSyncRoomMagicAction}>
              <input type="hidden" name="roomId" value={params.roomId} />
              <button
                type="submit"
                className="rounded-lg border border-spirit-400/40 px-3 py-1.5 text-xs text-spirit-300 transition hover:bg-spirit-400/10"
              >
                从团本重新同步
              </button>
            </form>
            {diagnostics.moduleMagic.moduleId === null ? null : (
              <Link href={"/admin/modules"} className="text-xs text-white/40 transition hover:text-white/70">
                查看团本管理 →
              </Link>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
          <h2 className="text-sm font-medium text-white/80">3. Room.ruleOverride.magic</h2>
          <p className="mt-1 text-[11px] text-white/40">
            由「启用魔法规则 / 从团本同步」写入；如果 enabled=false，它会覆盖绑定规则包里的魔法配置。
          </p>
          <p className="mt-3 text-xs text-white/60">
            enabled = {String(diagnostics.roomOverrideMagic.enabled)} · spells = {diagnostics.roomOverrideMagic.spellCount}
          </p>
        </div>

        <div className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
          <h2 className="text-sm font-medium text-white/80">4. 最终生效规则包</h2>
          <p className="mt-1 text-[11px] text-white/40">
            战斗页 / 施法面板实际读取的就是这一层。来源：{diagnostics.effectiveMagic.source}
            {diagnostics.effectiveMagic.hasRoomOverride ? " · 含房间覆盖" : ""}
          </p>
          <p className="mt-3 text-xs text-white/60">
            magic.enabled = {String(diagnostics.effectiveMagic.enabled)} · spells = {diagnostics.effectiveMagic.spellCount}
          </p>
          {diagnostics.effectiveMagic.error === null ? null : (
            <p className="mt-2 rounded border border-red-400/30 bg-red-400/10 px-2 py-1 text-[11px] text-red-200">
              {diagnostics.effectiveMagic.error}
            </p>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <h2 className="text-sm font-medium text-white/80">最终生效法术（{effectiveSpells.length}）</h2>
        {effectiveSpells.length === 0 ? (
          <p className="mt-3 text-xs text-white/35">当前没有生效法术。</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-white/10 text-[10px] uppercase tracking-wider text-white/35">
                <tr>
                  <th className="px-2 py-2">ID</th>
                  <th className="px-2 py-2">名称</th>
                  <th className="px-2 py-2">技能</th>
                  <th className="px-2 py-2">MP</th>
                  <th className="px-2 py-2">SAN</th>
                  <th className="px-2 py-2">目标</th>
                  <th className="px-2 py-2">效果</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {effectiveSpells.map((spell) => (
                  <tr key={spell.id}>
                    <td className="px-2 py-2 font-mono text-[10px] text-white/55">{spell.id}</td>
                    <td className="px-2 py-2 text-white/80">{spell.name}</td>
                    <td className="px-2 py-2 font-mono text-[10px] text-white/55">{spell.skill}</td>
                    <td className="px-2 py-2 font-mono text-[10px] text-white/55">{spell.mpCost}</td>
                    <td className="px-2 py-2 font-mono text-[10px] text-white/55">{spell.sanCost}</td>
                    <td className="px-2 py-2 text-[10px] text-white/55">
                      {spell.target} / {spellTargeting(spell)}
                    </td>
                    <td className="px-2 py-2 text-[10px] text-white/55">
                      {magicSpellEffectLabels(spell).join("；") || (spell.damage ?? "无直接效果")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <h2 className="text-sm font-medium text-white/80">Room.ruleOverride 原始 JSON</h2>
        <pre className="mt-3 max-h-96 overflow-auto rounded-lg border border-white/10 bg-ink-900/60 p-3 font-mono text-[10px] leading-5 text-white/55">
          {JSON.stringify(roomRow?.ruleOverride ?? {}, null, 2)}
        </pre>
      </section>
    </div>
  );
}
