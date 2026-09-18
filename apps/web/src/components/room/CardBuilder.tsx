"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { saveCard, type SaveCardResult } from "@/server/actions/card";
import DanmakuPatternEditor from "@/components/danmaku/DanmakuPatternEditor";
import MagicEffectComposer from "@/components/module/MagicEffectComposer";
import {
  CARD_KIND_LABELS,
  CARD_TARGETINGS,
  CARD_TARGETING_LABELS,
  CARD_TARGET_SCOPES,
  CARD_TARGET_SCOPE_LABELS,
  CARD_USABLE_IN,
  allowedEffectTypesForKind,
  disallowedEffectTypesForKind,
  ENHANCE_LABELS,
  ENHANCE_TYPES,
  RANGE_LABELS,
  WEAPON_TYPES,
  weaponTypeDefinition,
  type CardKind,
  type EnhanceType
} from "@/shared/card";
import { createDefaultDanmakuPattern } from "@/shared/danmaku/presets";
import type { DanmakuPattern } from "@/shared/danmaku/schema";

interface SpellDefaults {
  hpRatio: number;
  durationTicks: number;
  consumptionMpCost: number;
  declarationMpCost: number;
  clearTargets: "ALL" | "OTHERS_ONLY";
}

interface Props {
  roomId: string | null;
  system: string;
  isTouhou: boolean;
  spellDefaults: SpellDefaults | null;
  /** 保存后返回的地址（角色编辑页里打开卡牌编辑时用）。 */
  returnTo?: string | null;
  /** 传入表示编辑已有卡。 */
  initial?: {
    readonly cardId: string;
    readonly kind: CardKind;
    readonly name: string;
    readonly subtitle: string;
    readonly description: string;
    readonly stats: Record<string, unknown>;
  } | null;
}

function recordOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && Array.isArray(value) === false
    ? (value as Record<string, unknown>)
    : {};
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

const inputClass =
  "w-full rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-sakura-500";

export default function CardBuilder(props: Props) {
  const router = useRouter();
  const defaults = props.spellDefaults;
  const initial = props.initial ?? null;
  const stats0 = recordOf(initial?.stats);
  const cost0 = recordOf(stats0.cost);

  const [kind, setKind] = useState<CardKind>(initial?.kind ?? (props.isTouhou ? "SPELLCARD" : "WEAPON"));
  const [name, setName] = useState(initial?.name ?? "");
  const [subtitle, setSubtitle] = useState(initial?.subtitle ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [mode, setMode] = useState<"DECLARATION" | "CONSUMPTION">(
    stringOr(stats0.mode, "DECLARATION") === "CONSUMPTION" ? "CONSUMPTION" : "DECLARATION"
  );
  const [danmaku, setDanmaku] = useState(stringOr(stats0.danmaku, ""));
  const [mpCost, setMpCost] = useState(numberOr(stats0.mpCost, defaults?.declarationMpCost ?? 10));
  const [hpRatio, setHpRatio] = useState(numberOr(stats0.hpRatio, defaults?.hpRatio ?? 2));
  const [clearTargets, setClearTargets] = useState<"ALL" | "OTHERS_ONLY">(
    stringOr(stats0.clearTargets, defaults?.clearTargets ?? "ALL") === "OTHERS_ONLY" ? "OTHERS_ONLY" : "ALL"
  );
  const [enhanceType, setEnhanceType] = useState<EnhanceType>(
    (["DANMAKU", "MELEE", "SPELL", "AREA"] as const).includes(stringOr(stats0.enhanceType, "DANMAKU") as EnhanceType)
      ? (stringOr(stats0.enhanceType, "DANMAKU") as EnhanceType)
      : "DANMAKU"
  );
  const [enhanceValue, setEnhanceValue] = useState(numberOr(stats0.enhanceValue, 1.5));
  const [pattern, setPattern] = useState<DanmakuPattern>(() => {
    const raw = stats0.pattern;
    if (raw !== null && typeof raw === "object" && Array.isArray(raw) === false) return raw as DanmakuPattern;
    return createDefaultDanmakuPattern();
  });

  const [weaponType, setWeaponType] = useState(stringOr(stats0.weaponType, "BRAWL"));
  const [accuracyMod, setAccuracyMod] = useState(numberOr(stats0.accuracyMod, 0));

  const [effect, setEffect] = useState(stringOr(stats0.effect, ""));
  const [uses, setUses] = useState(stats0.uses === null || stats0.uses === undefined ? "" : String(stats0.uses));
  const [sanCost, setSanCost] = useState(stringOr(stats0.sanCost, ""));

  // 通用效果 / 目标 / 消耗（魔法、道具、符卡、武器共用）
  const [effectsJson, setEffectsJson] = useState(() =>
    JSON.stringify(Array.isArray(stats0.effects) ? stats0.effects : [])
  );
  const [targeting, setTargeting] = useState<string>(
    (CARD_TARGETINGS as readonly string[]).includes(stringOr(stats0.targeting, "ENEMY"))
      ? stringOr(stats0.targeting, "ENEMY")
      : "ENEMY"
  );
  const [targetScope, setTargetScope] = useState<string>(
    (CARD_TARGET_SCOPES as readonly string[]).includes(stringOr(stats0.targetScope, "ONE"))
      ? stringOr(stats0.targetScope, "ONE")
      : "ONE"
  );
  const [costMp, setCostMp] = useState(numberOr(cost0.mp, numberOr(stats0.mpCost, 0)));
  const [costSan, setCostSan] = useState(stringOr(cost0.san, ""));
  const [costUses, setCostUses] = useState(cost0.uses === null || cost0.uses === undefined ? "" : String(cost0.uses));
  const [cooldownRounds, setCooldownRounds] = useState(numberOr(cost0.cooldownRounds, 0));
  const [usableIn, setUsableIn] = useState<readonly ("FIELD" | "COMBAT")[]>(() => {
    const raw = stats0.usableIn;
    if (Array.isArray(raw)) {
      const filtered = raw.filter((item): item is "FIELD" | "COMBAT" => item === "FIELD" || item === "COMBAT");
      if (filtered.length > 0) return filtered;
    }
    return ["COMBAT"];
  });

  const kinds: CardKind[] = props.isTouhou ? ["SPELLCARD", "WEAPON", "ITEM"] : ["WEAPON", "ITEM"];

  function parseEffects(): unknown[] {
    try {
      const parsed: unknown = JSON.parse(effectsJson);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function genericStats(): Record<string, unknown> {
    return {
      effects: parseEffects(),
      targeting,
      targetScope,
      cost: {
        mp: costMp,
        san: costSan.trim().length === 0 ? null : costSan.trim(),
        uses: costUses.trim().length === 0 ? null : Number(costUses),
        cooldownRounds
      },
      usableIn
    };
  }

  function buildStats(): unknown {
    const generic = genericStats();
    if (kind === "SPELLCARD") {
      return {
        ...generic,
        mode,
        danmaku,
        mpCost: costMp,
        hpRatio: mode === "DECLARATION" ? hpRatio : null,
        durationTicks: null,
        clearTargets: mode === "DECLARATION" ? clearTargets : null,
        enhanceType,
        enhanceValue,
        pattern
      };
    }
    if (kind === "WEAPON") {
      // 伤害 / 射程 / 技能由武器类型自动带出。
      const definition = weaponTypeDefinition(weaponType);
      return {
        ...generic,
        weaponType,
        damage: definition.damage,
        range: definition.range,
        skillId: definition.skillId,
        accuracyMod,
        mpCost: costMp
      };
    }
    return {
      ...generic,
      effect,
      uses: costUses.trim().length === 0 ? null : Number(costUses),
      sanCost: costSan.trim().length === 0 ? null : costSan
    };
  }

  async function submit(): Promise<void> {
    setBusy(true);
    setMessage(null);
    const result: SaveCardResult = await saveCard({
      cardId: initial?.cardId,
      roomId: props.roomId,
      system: props.system,
      kind,
      name,
      subtitle: subtitle.trim().length === 0 ? null : subtitle.trim(),
      description: description.trim().length === 0 ? null : description.trim(),
      stats: buildStats()
    });
    setBusy(false);
    if (result.ok === false) {
      setMessage(result.error ?? "保存失败");
      return;
    }
    router.push(props.returnTo ?? (props.roomId === null ? "/cards" : "/rooms/" + props.roomId));
    router.refresh();
  }

  const disallowedEffects = disallowedEffectTypesForKind(
    kind,
    (Array.isArray(parseEffects()) ? parseEffects() : [])
      .map((effect) => {
        const type = recordOf(effect).type;
        return { type: typeof type === "string" ? type : "" };
      })
  );

  const tabClass = (active: boolean): string =>
    active
      ? "rounded-lg bg-sakura-500 px-4 py-2 text-sm text-sakura-400"
      : "rounded-lg border border-white/15 px-4 py-2 text-sm text-white/50 transition hover:border-white/30 hover:text-white/80";

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <h2 className="text-sm font-medium text-white/80">卡牌类型</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {kinds.map((item) => (
            <button key={item} type="button" onClick={() => setKind(item)} className={tabClass(item === kind)}>
              {CARD_KIND_LABELS[item]}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <h2 className="text-sm font-medium text-white/80">基本信息</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-white/50">卡名</span>
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="例：梦想封印" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-white/50">副标题（可留空）</span>
            <input value={subtitle} onChange={(event) => setSubtitle(event.target.value)} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="text-xs text-white/50">说明（可留空）</span>
            <input value={description} onChange={(event) => setDescription(event.target.value)} className={inputClass} />
          </label>
        </div>
      </section>

      {kind === "SPELLCARD" ? (
        <section className="rounded-xl border border-sakura-500/20 bg-sakura-500/5 p-5">
          <h2 className="text-sm font-medium text-sakura-400">符卡</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-white/50">符卡类型</span>
              <select
                value={mode}
                onChange={(event) => {
                  const next = event.target.value === "CONSUMPTION" ? "CONSUMPTION" : "DECLARATION";
                  setMode(next);
                  setMpCost(next === "CONSUMPTION" ? (defaults?.consumptionMpCost ?? 30) : (defaults?.declarationMpCost ?? 10));
                }}
                className={inputClass}
              >
                <option value="DECLARATION">展开型 · 有独立 HP，可被击破</option>
                <option value="CONSUMPTION">消费型 · 瞬间发动，每场一次</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5 sm:col-span-2">
              <span className="text-xs text-white/50">符卡说明（战斗日志展示用）</span>
              <input value={danmaku} onChange={(event) => setDanmaku(event.target.value)} placeholder="例：被诅咒的符札如暴雨般倾泻" className={inputClass} />
            </label>
          </div>

          {mode === "CONSUMPTION" ? null : (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs text-white/50">独立 HP 倍率（最大 HP × N）</span>
                <input type="number" step="0.5" value={hpRatio} onChange={(event) => setHpRatio(Number(event.target.value) || 1)} className={inputClass} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs text-white/50">被击破时清弹范围</span>
                <select value={clearTargets} onChange={(event) => setClearTargets(event.target.value === "OTHERS_ONLY" ? "OTHERS_ONLY" : "ALL")} className={inputClass}>
                  <option value="ALL">全场弹幕</option>
                  <option value="OTHERS_ONLY">仅他人弹幕</option>
                </select>
              </label>
            </div>
          )}

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-white/50">强化方向</span>
              <select value={enhanceType} onChange={(event) => setEnhanceType(event.target.value as EnhanceType)} className={inputClass}>
                {ENHANCE_TYPES.map((item) => (
                  <option key={item} value={item}>{ENHANCE_LABELS[item]}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-white/50">强化数值</span>
              <input type="number" step="0.1" value={enhanceValue} onChange={(event) => setEnhanceValue(Number(event.target.value) || 0)} className={inputClass} />
            </label>
          </div>

          <div className="mt-4">
            <DanmakuPatternEditor value={pattern} onChange={setPattern} />
          </div>
        </section>
      ) : null}

      {kind === "WEAPON" ? (
        <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
          <h2 className="text-sm font-medium text-white/80">武器</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 sm:col-span-2">
              <span className="text-xs text-white/50">武器类型（伤害 / 射程 / 使用技能由系统自动带出）</span>
              <select value={weaponType} onChange={(event) => setWeaponType(event.target.value)} className={inputClass}>
                {WEAPON_TYPES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label} · {item.skillId} · {item.damage} · {RANGE_LABELS[item.range]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-white/50">命中修正</span>
              <input type="number" value={accuracyMod} onChange={(event) => setAccuracyMod(Number(event.target.value) || 0)} className={inputClass} />
            </label>
            <div className="rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2">
              <p className="text-[11px] text-white/45">自动结果</p>
              <p className="mt-1 font-mono text-sm text-white/80">
                {weaponTypeDefinition(weaponType).damage} · {RANGE_LABELS[weaponTypeDefinition(weaponType).range]} · {weaponTypeDefinition(weaponType).skillId}
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {kind === "ITEM" ? (
        <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
          <h2 className="text-sm font-medium text-white/80">道具</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 sm:col-span-2">
              <span className="text-xs text-white/50">效果</span>
              <input value={effect} onChange={(event) => setEffect(event.target.value)} placeholder="例：回复 1d4 点生命" className={inputClass} />
            </label>
          </div>
        </section>
      ) : null}

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <h2 className="text-sm font-medium text-white/80">通用效果 / 消耗</h2>
        <p className="mt-1 text-[11px] text-white/45">魔法、道具、符卡、武器共用同一套效果；数值各自填写。</p>
        <div className="mt-4">
          <MagicEffectComposer
            name="card-effects"
            initialEffects={Array.isArray(stats0.effects) ? stats0.effects : []}
            onChange={setEffectsJson}
            allowedTypes={allowedEffectTypesForKind(kind)}
          />
        </div>
        {disallowedEffects.length === 0 ? null : (
          <p className="mt-2 rounded border border-red-400/40 px-2 py-1 text-[11px] text-red-300">
            当前卡类型不能用这些效果：{disallowedEffects.join("、")}（请更换或删除）
          </p>
        )}
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-white/50">目标阵营</span>
            <select value={targeting} onChange={(event) => setTargeting(event.target.value)} className={inputClass}>
              {CARD_TARGETINGS.map((item) => (
                <option key={item} value={item}>{CARD_TARGETING_LABELS[item]}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-white/50">作用范围</span>
            <select value={targetScope} onChange={(event) => setTargetScope(event.target.value)} className={inputClass}>
              {CARD_TARGET_SCOPES.map((item) => (
                <option key={item} value={item}>{CARD_TARGET_SCOPE_LABELS[item]}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-white/50">灵力 / MP 消耗</span>
            <input type="number" value={costMp} onChange={(event) => setCostMp(Number(event.target.value) || 0)} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-white/50">SAN 消耗（如 1d3）</span>
            <input value={costSan} onChange={(event) => setCostSan(event.target.value)} className={inputClass + " font-mono"} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-white/50">使用次数（留空 = 无限）</span>
            <input value={costUses} onChange={(event) => setCostUses(event.target.value)} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-white/50">冷却轮次</span>
            <input type="number" value={cooldownRounds} onChange={(event) => setCooldownRounds(Number(event.target.value) || 0)} className={inputClass} />
          </label>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="text-xs text-white/50">可用场景</span>
            <div className="flex items-center gap-3 text-xs text-white/60">
              {CARD_USABLE_IN.map((item) => (
                <label key={item} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={usableIn.includes(item)}
                    onChange={(event) =>
                      setUsableIn((current) =>
                        event.target.checked ? [...new Set([...current, item])] : current.filter((value) => value !== item)
                      )
                    }
                  />
                  {item === "COMBAT" ? "战斗内" : "战斗外"}
                </label>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <div>
          <p className="text-sm text-white/70">保存后进入房间卡池，所有成员可见</p>
          {message === null ? null : <p className="mt-1 text-xs text-red-300">{message}</p>}
        </div>
        <button
          type="button"
          disabled={[busy, name.trim().length === 0].includes(true)}
          onClick={submit}
          className="rounded-lg bg-sakura-500 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-sakura-400 disabled:opacity-40"
        >
          {busy ? "保存中…" : "保存卡牌"}
        </button>
      </section>
    </div>
  );
}
