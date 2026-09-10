"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { saveCard, type SaveCardResult } from "@/server/actions/card";
import {
  CARD_KIND_LABELS,
  ENHANCE_LABELS,
  ENHANCE_TYPES,
  RANGE_LABELS,
  type CardKind,
  type EnhanceType
} from "@/shared/card";

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
}

const inputClass =
  "w-full rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-sakura-500";

export default function CardBuilder(props: Props) {
  const router = useRouter();
  const [kind, setKind] = useState<CardKind>(props.isTouhou ? "SPELLCARD" : "WEAPON");
  const [name, setName] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const defaults = props.spellDefaults;
  const [mode, setMode] = useState<"DECLARATION" | "CONSUMPTION">("DECLARATION");
  const [danmaku, setDanmaku] = useState("");
  const [mpCost, setMpCost] = useState(defaults?.declarationMpCost ?? 10);
  const [hpRatio, setHpRatio] = useState(defaults?.hpRatio ?? 2);
  const [durationTicks, setDurationTicks] = useState(defaults?.durationTicks ?? 720);
  const [clearTargets, setClearTargets] = useState<"ALL" | "OTHERS_ONLY">(
    defaults?.clearTargets ?? "ALL"
  );
  const [enhanceType, setEnhanceType] = useState<EnhanceType>("DANMAKU");
  const [enhanceValue, setEnhanceValue] = useState(1.5);

  const [damage, setDamage] = useState("2d6");
  const [range, setRange] = useState<"MELEE" | "NEAR" | "FAR">("NEAR");
  const [accuracyMod, setAccuracyMod] = useState(0);

  const [effect, setEffect] = useState("");
  const [uses, setUses] = useState("1");
  const [sanCost, setSanCost] = useState("");

  const kinds: CardKind[] = props.isTouhou ? ["SPELLCARD", "WEAPON", "ITEM"] : ["WEAPON", "ITEM"];

  function buildStats(): unknown {
    if (kind === "SPELLCARD") {
      return {
        mode,
        danmaku,
        mpCost,
        hpRatio: mode === "DECLARATION" ? hpRatio : null,
        durationTicks: mode === "DECLARATION" ? durationTicks : null,
        clearTargets: mode === "DECLARATION" ? clearTargets : null,
        enhanceType,
        enhanceValue
      };
    }
    if (kind === "WEAPON") {
      return { damage, range, accuracyMod, mpCost };
    }
    return {
      effect,
      uses: uses.trim().length === 0 ? null : Number(uses),
      sanCost: sanCost.trim().length === 0 ? null : sanCost
    };
  }

  async function submit(): Promise<void> {
    setBusy(true);
    setMessage(null);
    const result: SaveCardResult = await saveCard({
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
    router.push(props.roomId === null ? "/cards" : "/rooms/" + props.roomId);
    router.refresh();
  }

  const tabClass = (active: boolean): string =>
    active
      ? "rounded-lg border border-sakura-500/50 bg-sakura-500/10 px-4 py-2 text-sm text-sakura-400"
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
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-white/50">灵力消耗</span>
              <input type="number" value={mpCost} onChange={(event) => setMpCost(Number(event.target.value) || 0)} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1.5 sm:col-span-2">
              <span className="text-xs text-white/50">弹幕描述</span>
              <input value={danmaku} onChange={(event) => setDanmaku(event.target.value)} placeholder="例：被诅咒的符札如暴雨般倾泻" className={inputClass} />
            </label>
          </div>

          {mode === "CONSUMPTION" ? null : (
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs text-white/50">独立 HP 倍率（最大 HP × N）</span>
                <input type="number" step="0.5" value={hpRatio} onChange={(event) => setHpRatio(Number(event.target.value) || 1)} className={inputClass} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs text-white/50">持续帧数</span>
                <input type="number" value={durationTicks} onChange={(event) => setDurationTicks(Number(event.target.value) || 1)} className={inputClass} />
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
        </section>
      ) : null}

      {kind === "WEAPON" ? (
        <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
          <h2 className="text-sm font-medium text-white/80">武器</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-white/50">伤害骰（如 2d6+3）</span>
              <input value={damage} onChange={(event) => setDamage(event.target.value)} className={inputClass + " font-mono"} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-white/50">射程</span>
              <select value={range} onChange={(event) => setRange(event.target.value === "MELEE" ? "MELEE" : event.target.value === "FAR" ? "FAR" : "NEAR")} className={inputClass}>
                {(["MELEE", "NEAR", "FAR"] as const).map((item) => (
                  <option key={item} value={item}>{RANGE_LABELS[item]}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-white/50">命中修正</span>
              <input type="number" value={accuracyMod} onChange={(event) => setAccuracyMod(Number(event.target.value) || 0)} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-white/50">灵力消耗</span>
              <input type="number" value={mpCost} onChange={(event) => setMpCost(Number(event.target.value) || 0)} className={inputClass} />
            </label>
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
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-white/50">可用次数（留空 = 无限）</span>
              <input value={uses} onChange={(event) => setUses(event.target.value)} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-white/50">理智消耗（如 1d3，留空 = 无）</span>
              <input value={sanCost} onChange={(event) => setSanCost(event.target.value)} className={inputClass + " font-mono"} />
            </label>
          </div>
        </section>
      ) : null}

      <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <div>
          <p className="text-sm text-white/70">保存后进入房间卡池，所有成员可见</p>
          {message === null ? null : <p className="mt-1 text-xs text-red-300">{message}</p>}
        </div>
        <button
          type="button"
          disabled={[busy, name.trim().length === 0].includes(true)}
          onClick={submit}
          className="rounded-lg bg-sakura-500 px-6 py-2.5 text-sm font-medium text-ink-900 transition hover:bg-sakura-400 disabled:opacity-40"
        >
          {busy ? "保存中…" : "保存卡牌"}
        </button>
      </section>
    </div>
  );
}
