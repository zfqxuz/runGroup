import Link from "next/link";
import { MAGIC_EFFECT_DEFINITIONS } from "@/shared/magic-effects";
import { magicEffectLabel } from "@/shared/magic";
import { MagicEffectSchema } from "@touhou/rules";

export const dynamic = "force-dynamic";

function exampleOf(type: string): unknown | null {
  const definition = MAGIC_EFFECT_DEFINITIONS.find((item) => item.type === type);
  if (definition === undefined) return null;
  const output: Record<string, unknown> = { type };
  for (const field of definition.fields) {
    if (field.defaultValue.length === 0 && field.required !== true) continue;
    output[field.key] = field.key === "keys" ? [] : field.defaultValue;
  }
  return output;
}

const combinationExample = [
  { type: "DAMAGE", amount: "1d6" },
  { type: "STUN", durationActions: "1" },
  { type: "ARMOR", amount: "2d6", durationTicks: "3" }
];

export default function AdminMagicEffectsPage() {
  return (
    <div className="flex flex-col gap-6">
      <header>
        <Link href="/admin/magic" className="text-xs text-white/40 transition hover:text-white/70">← 魔法管理</Link>
        <h1 className="mt-2 text-2xl font-semibold">魔法效果目录</h1>
        <p className="mt-1 text-sm text-white/50">
          这里是底层可枚举的基础能力。单个法术 = 从下面任选若干效果，按顺序组合成 <code>effects</code> 数组。
        </p>
      </header>

      <section className="rounded-xl border border-spirit-400/30 bg-spirit-400/5 p-4">
        <h2 className="text-sm font-medium text-spirit-300">组合示例</h2>
        <p className="mt-1 text-xs text-white/50">下面一条法术同时具有「伤害 + 眩晕 + 护甲」，战斗引擎会按数组顺序依次结算。</p>
        <pre className="mt-3 overflow-auto rounded-lg border border-white/10 bg-ink-900/60 p-3 text-[11px] text-white/65">
          {JSON.stringify({ id: "example", name: "示例组合法术", skill: "OCCULT", mpCost: "3", sanCost: "0", effects: combinationExample }, null, 2)}
        </pre>
        <p className="mt-2 text-[11px] text-white/40">
          组合预览：{combinationExample.map((effect) => magicEffectLabel(MagicEffectSchema.parse(effect))).join(" + ")}
        </p>
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        {MAGIC_EFFECT_DEFINITIONS.map((definition) => {
          const example = exampleOf(definition.type);
          const parsed = example === null ? null : MagicEffectSchema.safeParse(example);
          return (
            <div key={definition.type} className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-medium text-white/85">{definition.label}</h2>
                  <p className="mt-1 font-mono text-[10px] text-spirit-300">{definition.type}</p>
                </div>
                <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-white/40">
                  {definition.fields.length} 个参数
                </span>
              </div>
              <p className="mt-3 text-xs text-white/50">{definition.summary}</p>
              <div className="mt-3 flex flex-col gap-1">
                {definition.fields.map((field) => (
                  <p key={field.key} className="text-[11px] text-white/45">
                    <span className="font-mono text-white/65">{field.key}</span>
                    {" · "}
                    {field.label}
                    {field.required === true ? "（必填）" : "（可选）"}
                    {" · 默认 "}
                    <span className="font-mono text-white/60">{field.defaultValue || "空"}</span>
                  </p>
                ))}
              </div>
              {parsed?.success === true ? (
                <pre className="mt-3 overflow-auto rounded border border-white/10 bg-ink-900/50 p-2 text-[10px] text-white/55">
                  {JSON.stringify(parsed.data, null, 2)}
                </pre>
              ) : null}
            </div>
          );
        })}
      </section>
    </div>
  );
}
