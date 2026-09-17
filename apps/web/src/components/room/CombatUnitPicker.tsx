"use client";

import { useState } from "react";

export interface CombatUnitOption {
  readonly ref: string;
  readonly name: string;
  readonly kind: "NPC" | "PLAYER" | "CHARACTER";
  readonly subtitle: string | null;
  readonly hp: number;
  readonly sceneId?: string | null;
  readonly sceneName?: string | null;
  readonly activeCombatId?: string | null;
  readonly eligible?: boolean;
  readonly ineligibleReason?: string | null;
}

interface Props {
  readonly units: readonly CombatUnitOption[];
  readonly isKP: boolean;
  readonly defaultAllyRefs: readonly string[];
  readonly defaultEnemyRefs: readonly string[];
}

type Side = "ALLY" | "ENEMY" | "NONE";

function isEligible(unit: CombatUnitOption): boolean {
  return unit.eligible !== false;
}

function initialState(units: readonly CombatUnitOption[], allyRefs: readonly string[], enemyRefs: readonly string[]): Record<string, Side> {
  const state: Record<string, Side> = {};
  const byRef = new Map(units.map((unit) => [unit.ref, unit]));
  for (const unit of units) state[unit.ref] = "NONE";
  for (const ref of allyRefs) {
    const unit = byRef.get(ref);
    if (unit !== undefined && isEligible(unit)) state[ref] = "ALLY";
  }
  for (const ref of enemyRefs) {
    const unit = byRef.get(ref);
    if (unit !== undefined && isEligible(unit)) state[ref] = "ENEMY";
  }
  return state;
}

export default function CombatUnitPicker(props: Props) {
  const [sides, setSides] = useState<Record<string, Side>>(() => initialState(props.units, props.defaultAllyRefs, props.defaultEnemyRefs));

  function setSide(ref: string, side: Side): void {
    setSides((prev) => {
      const current = prev[ref] ?? "NONE";
      return { ...prev, [ref]: current === side ? "NONE" : side };
    });
  }

  const selectedScenes = new Set<string>();
  let selectedCount = 0;
  for (const unit of props.units) {
    if ((sides[unit.ref] ?? "NONE") === "NONE") continue;
    selectedCount += 1;
    if (unit.sceneId !== null && unit.sceneId !== undefined) selectedScenes.add(unit.sceneId);
  }
  const sceneConflict = selectedScenes.size > 1;

  return (
    <div className="grid gap-2">
      {props.units.map((unit) => {
        const side = sides[unit.ref] ?? "NONE";
        const eligible = isEligible(unit);
        return (
          <div
            key={unit.ref}
            className={
              "flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2.5 " +
              (eligible ? "border-white/10 bg-ink-900/60" : "border-white/5 bg-ink-900/30 opacity-60")
            }
          >
            <div className="min-w-0">
              <p className={eligible ? "truncate text-sm text-white/80" : "truncate text-sm text-white/45"}>
                {unit.name}
                <span className="ml-2 rounded border border-white/15 px-1.5 py-0.5 text-[10px] text-white/35">
                  {unit.kind === "NPC" ? "NPC" : "PLAYER"}
                </span>
                {unit.sceneName === null || unit.sceneName === undefined ? null : (
                  <span className="ml-2 rounded border border-sky-400/30 px-1.5 py-0.5 text-[10px] text-sky-200/70">
                    {unit.sceneName}
                  </span>
                )}
              </p>
              <p className="mt-0.5 truncate text-[11px] text-white/35">
                {unit.subtitle === null ? "" : unit.subtitle + " · "}HP {unit.hp}
                {eligible ? "" : " · " + (unit.ineligibleReason ?? "不可参战")}
              </p>
            </div>
            {eligible ? (
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => setSide(unit.ref, "ALLY")}
                  className={
                    "rounded border px-2 py-1 text-[11px] transition " +
                    (side === "ALLY"
                      ? "border-sky-400/60 bg-sky-400/15 text-sky-200"
                      : "border-white/15 text-white/50 hover:border-white/35")
                  }
                >
                  我方
                </button>
                {props.isKP ? (
                  <button
                    type="button"
                    onClick={() => setSide(unit.ref, "ENEMY")}
                    className={
                      "rounded border px-2 py-1 text-[11px] transition " +
                      (side === "ENEMY"
                        ? "border-red-400/60 bg-red-400/15 text-red-200"
                        : "border-white/15 text-white/50 hover:border-white/35")
                    }
                  >
                    敌方
                  </button>
                ) : null}
              </div>
            ) : (
              <span className="shrink-0 rounded border border-white/10 px-2 py-1 text-[10px] text-white/35">不可参战</span>
            )}
          </div>
        );
      })}
      {sceneConflict ? (
        <p className="rounded-lg border border-amber-400/40 bg-amber-400/5 px-3 py-2 text-xs text-amber-200">
          所选单位不在同一场景，无法开战；请先把他们移动到同一场景。
        </p>
      ) : null}
      {selectedCount > 0 && sceneConflict === false ? (
        <p className="text-[11px] text-white/35">已选 {selectedCount} 个单位，全部处于同一场景。</p>
      ) : null}
      {props.units.map((unit) => {
        const side = sides[unit.ref] ?? "NONE";
        if (isEligible(unit) === false) return null;
        if (side === "ALLY") return <input key={"ally-" + unit.ref} type="hidden" name="allies" value={unit.ref} />;
        if (side === "ENEMY") return <input key={"enemy-" + unit.ref} type="hidden" name="enemies" value={unit.ref} />;
        return null;
      })}
    </div>
  );
}
