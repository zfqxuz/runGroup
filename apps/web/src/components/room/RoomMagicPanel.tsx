"use client";

import { useState } from "react";
import type { MagicSpellOption, MagicUnitOption } from "@/server/magic/out-of-combat";
import { castOutsideCombatAction } from "@/server/actions/magic";

interface Props {
  readonly roomId: string;
  readonly casters: readonly MagicUnitOption[];
  readonly targets: readonly MagicUnitOption[];
  readonly spells: readonly MagicSpellOption[];
  readonly message: string | null;
  readonly error: string | null;
}

/** 战斗外施法面板：只列出不依赖战斗结算的法术。 */
export default function RoomMagicPanel(props: Props) {
  const [spellId, setSpellId] = useState(props.spells[0]?.id ?? "");
  if (props.spells.length === 0 || props.casters.length === 0) return null;
  const spell = props.spells.find((item) => item.id === spellId) ?? props.spells[0]!;

  return (
    <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-white/80">战斗外施法</h2>
          <p className="mt-0.5 text-[11px] text-white/35">
            只允许治疗 / 回复 / 护甲 / 状态 / 净化 / 召唤 / 夺舍这类不依赖战斗轮次的法术。
          </p>
        </div>
      </header>
      {props.error === null ? null : (
        <p className="mt-3 rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-2 text-xs text-red-300">
          {props.error}
        </p>
      )}
      {props.message === null ? null : (
        <p className="mt-3 rounded-lg border border-emerald-400/30 bg-emerald-400/5 px-3 py-2 text-xs text-emerald-300">
          {props.message}
        </p>
      )}
      <form action={castOutsideCombatAction} className="mt-3 grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="roomId" value={props.roomId} />
        <label className="flex flex-col gap-1 text-[11px] text-white/45">
          施法者
          <select
            name="casterRef"
            className="rounded-md border border-white/15 bg-ink-900 px-2 py-1.5 text-sm text-white/80"
            defaultValue={props.casters[0]!.ref}
          >
            {props.casters.map((unit) => (
              <option key={unit.ref} value={unit.ref}>
                {unit.name}
                {unit.isSummon ? "（召唤物）" : ""} · HP {unit.hp}/{unit.maxHp}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-white/45">
          目标
          <select
            name="targetRef"
            className="rounded-md border border-white/15 bg-ink-900 px-2 py-1.5 text-sm text-white/80"
            defaultValue={props.targets[0]!.ref}
          >
            {props.targets.map((unit) => (
              <option key={unit.ref} value={unit.ref}>
                {unit.name}
                {unit.isSummon ? "（召唤物）" : ""} · HP {unit.hp}/{unit.maxHp}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-white/45 sm:col-span-2">
          法术
          <select
            name="spellId"
            value={spellId}
            onChange={(event) => setSpellId(event.target.value)}
            className="rounded-md border border-white/15 bg-ink-900 px-2 py-1.5 text-sm text-white/80"
          >
            {props.spells.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}（{item.summary}）
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-3 sm:col-span-2">
          <button
            type="submit"
            className="rounded-md border border-sky-400/50 bg-sky-400/10 px-3 py-1.5 text-xs text-sky-200 transition hover:bg-sky-400/20"
          >
            施放「{spell.name}」
          </button>
          <span className="text-[11px] text-white/35">
            MP {spell.mpCost} / SAN {spell.sanCost}
          </span>
        </div>
      </form>
    </section>
  );
}
