"use client";

import { useMemo, useState } from "react";
import {
  compileParsedRulePack,
  computeDerived,
  deepMerge,
  dpEconomySummary,
  dpRegenFromVars,
  type AttributeSet,
  type RulePack
} from "@touhou/rules";
import { setTouhouAttributeScaleAction } from "@/server/actions/room";

export interface DpEconomyCharacter {
  readonly id: string;
  readonly name: string;
  readonly attributes: AttributeSet;
}

interface Props {
  readonly roomId: string;
  readonly pack: RulePack;
  readonly characters: readonly DpEconomyCharacter[];
  readonly currentScale: number;
}

const PRESETS = [1, 2, 5, 10] as const;

const inputClass =
  "w-24 rounded-lg border border-white/15 bg-ink-900 px-2 py-1.5 text-sm outline-none focus:border-sakura-500";

/**
 * 东方模式专用：KP 调整「COC7 属性 → 千幻抄特性值」换算系数，
 * 并即时试算队伍在当前尺度下的 HP / MP / DP 与每回合行动次数。
 */
export default function RoomDpEconomyPanel(props: Props) {
  const [scale, setScale] = useState(props.currentScale);

  const rows = useMemo(() => {
    let compiled;
    try {
      const merged = deepMerge(props.pack, { const: { ATTR_SCALE: scale } }) as RulePack;
      compiled = compileParsedRulePack(merged);
    } catch {
      return [];
    }
    const samples: readonly DpEconomyCharacter[] =
      props.characters.length > 0
        ? props.characters
        : [
            {
              id: "sample",
              name: "示例角色",
              attributes: {
                str: 50, con: 50, siz: 60, dex: 55,
                app: 50, int: 60, pow: 40, edu: 70, luck: 45
              }
            }
          ];
    return samples.map((character) => {
      const outcome = computeDerived(compiled, { attributes: character.attributes });
      const vars = { ...outcome.attributes, ...outcome.derived };
      const regen = dpRegenFromVars(compiled, vars);
      const economy = dpEconomySummary({
        dpMax: outcome.derived.maxDp,
        dpRegen: regen,
        mp: outcome.derived.maxMp,
        actionCosts: compiled.pack.dp.actionCosts
      });
      return {
        id: character.id,
        name: character.name,
        hp: outcome.derived.maxHp,
        mp: outcome.derived.maxMp,
        dp: outcome.derived.maxDp,
        regen,
        danmakuPerRound: economy.danmakuPerRound,
        danmakuPerBattle: economy.danmakuPerBattle,
        checksPerRound: economy.rangedChecksPerRound,
        meleePerRound: economy.meleeChecksPerRound,
        abilityCasts: economy.abilityCastsPerMp
      };
    });
  }, [props.pack, props.characters, scale]);

  const changed = Math.abs(scale - props.currentScale) > 1e-9;

  return (
    <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
      <h2 className="text-sm font-medium text-white/80">千幻抄 DP 尺度（房间参数）</h2>
      <p className="mt-1 text-[11px] leading-relaxed text-white/35">
        特性值 = floor(COC7 属性 / 系数)。1 = 直接代入；10 ≈ 千幻抄原版量级。
        系数越大，HP / MP / DP 与伤害越低，DP 机制越有存在感。只影响东方模式。
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => setScale(preset)}
            className={
              Math.abs(scale - preset) < 1e-9
                ? "rounded-lg bg-sakura-500 px-3 py-1.5 text-xs text-sakura-400"
                : "rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/60 transition hover:border-white/30"
            }
          >
            ÷{preset}
          </button>
        ))}
        <label className="flex items-center gap-2 text-xs text-white/50">
          自定义
          <input
            type="number"
            min={0.1}
            max={100}
            step={0.1}
            value={scale}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isFinite(next) && next > 0) setScale(next);
            }}
            className={inputClass}
          />
        </label>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead className="text-white/40">
            <tr>
              <th className="py-1.5 pr-3 font-normal">角色</th>
              <th className="py-1.5 pr-3 font-normal">HP</th>
              <th className="py-1.5 pr-3 font-normal">MP</th>
              <th className="py-1.5 pr-3 font-normal">DP 上限</th>
              <th className="py-1.5 pr-3 font-normal">DP 回复</th>
              <th className="py-1.5 pr-3 font-normal">弹幕/回合</th>
              <th className="py-1.5 pr-3 font-normal">弹幕/场</th>
              <th className="py-1.5 pr-3 font-normal">3D 判定/回合</th>
              <th className="py-1.5 pr-3 font-normal">3D 近战/回合</th>
              <th className="py-1.5 font-normal">能力次数</th>
            </tr>
          </thead>
          <tbody className="text-white/75">
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-white/5">
                <td className="py-1.5 pr-3">{row.name}</td>
                <td className="py-1.5 pr-3">{row.hp}</td>
                <td className="py-1.5 pr-3">{row.mp}</td>
                <td className="py-1.5 pr-3">{row.dp}</td>
                <td className="py-1.5 pr-3">{row.regen}</td>
                <td className="py-1.5 pr-3">{row.danmakuPerRound}</td>
                <td className="py-1.5 pr-3">{row.danmakuPerBattle}</td>
                <td className="py-1.5 pr-3">{row.checksPerRound}</td>
                <td className="py-1.5 pr-3">{row.meleePerRound}</td>
                <td className="py-1.5">{row.abilityCasts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form action={setTouhouAttributeScaleAction} className="mt-4 flex items-center gap-3">
        <input type="hidden" name="roomId" value={props.roomId} />
        <input type="hidden" name="attrScale" value={String(scale)} />
        <button
          type="submit"
          className="rounded-lg bg-sakura-500 px-4 py-2 text-sm text-sakura-400 transition hover:opacity-90"
        >
          保存为房间参数
        </button>
        <span className="text-[11px] text-white/35">
          当前保存值：÷{props.currentScale}
          {changed ? "（预览已改，保存后对全房间生效）" : ""}
        </span>
      </form>
    </section>
  );
}
