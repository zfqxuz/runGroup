import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PRESET_TIERS, RARITIES } from "@touhou/rules";
import { createCustomNpcAction, createPresetNpcAction } from "@/server/actions/npc";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";
import { loadEffectivePack } from "@/server/rules/loader";
import { NPC_ATTRIBUTE_KEYS } from "@/shared/npc";

export const dynamic = "force-dynamic";

const TIER_LABELS: Record<string, string> = {
  MINION: "杂兵",
  STANDARD: "标准",
  ELITE: "精英",
  BOSS: "Boss"
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

export default async function NewNpcPage({
  params,
  searchParams
}: {
  params: { id: string };
  searchParams?: { error?: string };
}) {
  const session = await auth();
  if (session === null) redirect("/login");
  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId: params.id, userId: session.user.id } },
    include: { room: true }
  });
  if (membership === null) notFound();
  if ((membership.role === "KP") === false) notFound();
  const room = membership.room;
  const effective = await loadEffectivePack({
    id: room.id,
    system: room.system,
    rulePackVersionId: room.rulePackVersionId,
    ruleOverride: room.ruleOverride
  });
  const presets = effective.compiled.presets;
  const skills = effective.compiled.skills;
  const races = Object.entries(effective.compiled.pack.races);
  const error = searchParams?.error;

  const inputClass =
    "w-full rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-sakura-500";
  const labelClass = "flex flex-col gap-1.5";
  const spanClass = "text-xs text-white/50";

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-6 py-12">
      <header>
        <Link href={"/rooms/" + room.id} className="text-xs text-white/40 transition hover:text-white/70">
          ← 返回房间
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">准备 NPC / Boss</h1>
        <p className="mt-1 text-sm text-white/50">
          从预设直接加入，或按本房规则自建。生成的是本场专属卡，不会进入个人卡库。
        </p>
      </header>

      {error === undefined ? null : (
        <p className="rounded-lg border border-red-400/30 bg-red-400/5 px-4 py-3 text-sm text-red-300">
          {error}
        </p>
      )}

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-white/80">从预设挑选</h2>
            <p className="mt-1 text-[11px] text-white/35">
              {effective.compiled.id}@{effective.compiled.version} · 共 {presets.length} 个预设
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {presets.map((preset) => (
            <article key={preset.id} className="flex flex-col gap-3 rounded-lg border border-white/10 bg-ink-900/60 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-medium text-white/85">{preset.name}</h3>
                <span className="rounded border border-sakura-500/30 px-1.5 py-0.5 text-[10px] text-sakura-400">
                  {TIER_LABELS[preset.tier] ?? preset.tier}
                </span>
                <span className="rounded border border-white/15 px-1.5 py-0.5 text-[10px] text-white/40">
                  {preset.rarity}
                </span>
              </div>
              {preset.subtitle === undefined ? null : (
                <p className="text-[11px] text-white/40">{preset.subtitle}</p>
              )}
              {preset.description === undefined ? null : (
                <p className="text-xs text-white/55">{preset.description}</p>
              )}
              <p className="font-mono text-[10px] text-white/30">
                HP {preset.maxHp ?? "?"} · MP {preset.maxMp ?? "?"} · SAN {preset.maxSan ?? "?"} · DP {preset.maxDp ?? "?"}
              </p>
              <p className="text-[11px] text-white/35">
                技能：{Object.keys(preset.skills).length} 项
                {preset.race === null ? "" : " · 种族 " + preset.race}
              </p>
              <form action={createPresetNpcAction} className="mt-auto">
                <input type="hidden" name="roomId" value={room.id} />
                <input type="hidden" name="presetId" value={preset.id} />
                <button
                  type="submit"
                  className="w-full rounded-lg border border-sakura-500/40 px-3 py-2 text-xs text-sakura-400 transition hover:bg-sakura-500/10"
                >
                  加入本场
                </button>
              </form>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <h2 className="text-sm font-medium text-white/80">自建 NPC / Boss</h2>
        <form action={createCustomNpcAction} className="mt-4 flex flex-col gap-5">
          <input type="hidden" name="roomId" value={room.id} />
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={labelClass}>
              <span className={spanClass}>名字</span>
              <input name="name" required maxLength={50} className={inputClass} />
            </label>
            <label className={labelClass}>
              <span className={spanClass}>副标题（可空）</span>
              <input name="subtitle" maxLength={60} className={inputClass} />
            </label>
            <label className={"sm:col-span-2 " + labelClass}>
              <span className={spanClass}>描述（可空）</span>
              <input name="description" maxLength={500} className={inputClass} />
            </label>
            <label className={labelClass}>
              <span className={spanClass}>强度</span>
              <select name="tier" defaultValue="STANDARD" className={inputClass}>
                {PRESET_TIERS.map((tier) => (
                  <option key={tier} value={tier}>{TIER_LABELS[tier] ?? tier}</option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              <span className={spanClass}>稀有度</span>
              <select name="rarity" defaultValue="COMMON" className={inputClass}>
                {RARITIES.map((rarity) => (
                  <option key={rarity} value={rarity}>{rarity}</option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              <span className={spanClass}>种族（可空）</span>
              <select name="race" defaultValue="" className={inputClass}>
                <option value="">（无）</option>
                {races.map(([id, race]) => (
                  <option key={id} value={id}>{race.name}</option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              <span className={spanClass}>标签（逗号分隔，可空）</span>
              <input name="tags" maxLength={200} className={inputClass} />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {NPC_ATTRIBUTE_KEYS.map((key) => (
              <label key={key} className={labelClass}>
                <span className={spanClass}>{ATTRIBUTE_LABELS[key] ?? key}</span>
                <input
                  name={"attr_" + key}
                  type="number"
                  min={0}
                  max={999}
                  defaultValue={50}
                  required
                  className={inputClass}
                />
              </label>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            <label className={labelClass}>
              <span className={spanClass}>HP</span>
              <input name="maxHp" type="number" min={1} max={9999} defaultValue={10} required className={inputClass} />
            </label>
            <label className={labelClass}>
              <span className={spanClass}>MP</span>
              <input name="maxMp" type="number" min={0} max={99999} defaultValue={50} required className={inputClass} />
            </label>
            <label className={labelClass}>
              <span className={spanClass}>SAN</span>
              <input name="maxSan" type="number" min={0} max={999} defaultValue={50} required className={inputClass} />
            </label>
            <label className={labelClass}>
              <span className={spanClass}>DP</span>
              <input name="maxDp" type="number" min={0} max={99999} defaultValue={50} required className={inputClass} />
            </label>
          </div>

          <label className={labelClass}>
            <span className={spanClass}>技能（每行一个，格式 技能ID:数值）</span>
            <textarea
              name="skills"
              rows={4}
              placeholder="DANMAKU:60, DODGE:40"
              className={inputClass + " font-mono text-xs"}
            />
          </label>
          <details className="rounded-lg border border-white/10 bg-ink-900/50 px-3 py-2">
            <summary className="cursor-pointer text-xs text-white/45">查看本包技能 ID</summary>
            <div className="mt-2 flex max-h-52 flex-wrap gap-x-3 gap-y-1 overflow-y-auto">
              {skills.map((skill) => (
                <span key={skill.id} className="font-mono text-[11px] text-white/40">
                  {skill.id} · {skill.name}
                </span>
              ))}
            </div>
          </details>

          <button
            type="submit"
            className="self-start rounded-lg bg-sakura-500 px-6 py-3 text-sm font-medium text-ink-900 transition hover:bg-sakura-400"
          >
            创建本场 NPC
          </button>
        </form>
      </section>
    </main>
  );
}
