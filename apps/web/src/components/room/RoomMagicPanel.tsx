"use client";

import { useMemo, useState } from "react";
import type { OutOfCombatMagicView } from "@/server/magic/out-of-combat";
import { castOutsideCombatAction } from "@/server/actions/magic";

interface Props {
  readonly roomId: string;
  readonly view: OutOfCombatMagicView;
  readonly message: string | null;
  readonly error: string | null;
}

const TARGETING_LABEL: Record<string, string> = {
  SELF: "自身",
  ALLY: "友方",
  ENEMY: "敌方",
  ANY: "任意"
};

/**
 * 战斗外施法面板。
 *
 * 只展示「当前视角自己持有」的法术；施法者必须在当前场景，且法术在当前场景存在合法目标。
 * 没有任何可用法术时整个面板不渲染。
 */
export default function RoomMagicPanel(props: Props) {
  const casters = props.view.casters;
  const [casterRef, setCasterRef] = useState(casters[0]?.ref ?? "");
  const caster = casters.find((item) => item.ref === casterRef) ?? casters[0] ?? null;
  const [spellId, setSpellId] = useState(caster?.spells[0]?.id ?? "");
  const spell = caster?.spells.find((item) => item.id === spellId) ?? caster?.spells[0] ?? null;
  const targetNameByRef = useMemo(
    () => new Map(props.view.targets.map((target) => [target.ref, target.name])),
    [props.view.targets]
  );

  if (caster === null || spell === null) return null;
  const legalTargets = spell.targetRefs.map((ref) => ({
    ref,
    name: targetNameByRef.get(ref) ?? ref,
    isSelf: ref === caster.ref
  }));

  return (
    <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-white/80">战斗外施法</h2>
          <p className="mt-0.5 text-[11px] text-white/35">
            仅显示当前视角自己持有的法术；施法者需在「{props.view.sceneName ?? "当前场景"}」，且存在合法目标。
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
            value={caster.ref}
            onChange={(event) => {
              const nextRef = event.target.value;
              setCasterRef(nextRef);
              const nextCaster = casters.find((item) => item.ref === nextRef);
              setSpellId(nextCaster?.spells[0]?.id ?? "");
            }}
            className="rounded-md border border-white/15 bg-ink-900 px-2 py-1.5 text-sm text-white/80"
          >
            {casters.map((item) => (
              <option key={item.ref} value={item.ref}>
                {item.name}
                {item.isSummon ? "（召唤物）" : ""} · HP {item.hp}/{item.maxHp}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-white/45">
          法术
          <select
            name="spellId"
            value={spell.id}
            onChange={(event) => setSpellId(event.target.value)}
            className="rounded-md border border-white/15 bg-ink-900 px-2 py-1.5 text-sm text-white/80"
          >
            {caster.spells.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}（{item.summary}）
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-white/45 sm:col-span-2">
          目标 · {TARGETING_LABEL[spell.targeting] ?? spell.targeting}
          <select
            name="targetRef"
            className="rounded-md border border-white/15 bg-ink-900 px-2 py-1.5 text-sm text-white/80"
          >
            {legalTargets.map((target) => (
              <option key={target.ref} value={target.ref}>
                {target.name}
                {target.isSelf ? "（自己）" : ""}
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
