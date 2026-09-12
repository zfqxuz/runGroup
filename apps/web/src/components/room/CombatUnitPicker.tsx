"use client";

import { useState } from "react";

export interface CombatUnitOption {
  readonly ref: string;
  readonly name: string;
  readonly kind: "NPC" | "PLAYER" | "CHARACTER";
  readonly subtitle: string | null;
  readonly hp: number;
}

interface Props {
  readonly units: readonly CombatUnitOption[];
  readonly isKP: boolean;
  readonly defaultAllyRefs: readonly string[];
  readonly defaultEnemyRefs: readonly string[];
}

type Side = "ALLY" | "ENEMY" | "NONE";

function initialState(units: readonly CombatUnitOption[], allyRefs: readonly string[], enemyRefs: readonly string[]): Record<string, Side> {
  const state: Record<string, Side> = {};
  for (const unit of units) state[unit.ref] = "NONE";
  for (const ref of allyRefs) if (state[ref] !== undefined) state[ref] = "ALLY";
  for (const ref of enemyRefs) if (state[ref] !== undefined) state[ref] = "ENEMY";
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

  return (
    <div className="grid gap-2">
      {props.units.map((unit) => {
        const side = sides[unit.ref] ?? "NONE";
        return (
          <div key={unit.ref} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm text-white/80">
                {unit.name}
                <span className="ml-2 rounded border border-white/15 px-1.5 py-0.5 text-[10px] text-white/35">
                  {unit.kind === "NPC" ? "NPC" : "PLAYER"}
                </span>
              </p>
              <p className="mt-0.5 truncate text-[11px] text-white/35">
                {unit.subtitle === null ? "" : unit.subtitle + " · "}HP {unit.hp}
              </p>
            </div>
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
          </div>
        );
      })}
      {props.units.map((unit) => {
        const side = sides[unit.ref] ?? "NONE";
        if (side === "ALLY") return <input key={"ally-" + unit.ref} type="hidden" name="allies" value={unit.ref} />;
        if (side === "ENEMY") return <input key={"enemy-" + unit.ref} type="hidden" name="enemies" value={unit.ref} />;
        return null;
      })}
    </div>
  );
}
