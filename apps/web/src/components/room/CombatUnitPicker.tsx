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

export interface CombatUnitSpellcardOption {
  readonly cardId: string;
  readonly name: string;
  readonly mode: "DECLARATION" | "CONSUMPTION";
  readonly mpCost: number;
}

export interface SpellcardDeclarationRules {
  readonly perMember: number;
  readonly rounding: "CEIL" | "ROUND" | "FLOOR";
  readonly min: number;
}

interface Props {
  readonly units: readonly CombatUnitOption[];
  readonly isKP: boolean;
  readonly defaultAllyRefs: readonly string[];
  readonly defaultEnemyRefs: readonly string[];
  /** 每个单位（角色）已装备的 SC；用于战前宣言。 */
  readonly spellcardsByRef?: Readonly<Record<string, readonly CombatUnitSpellcardOption[]>>;
  /** 每方可用 SC 上限规则；缺省表示不做战前宣言。 */
  readonly spellcardRules?: SpellcardDeclarationRules | null;
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

function declarationCap(memberCount: number, rules: SpellcardDeclarationRules): number {
  if (memberCount <= 0) return 0;
  const raw = memberCount * rules.perMember;
  const rounded =
    rules.rounding === "ROUND" ? Math.round(raw) : rules.rounding === "FLOOR" ? Math.floor(raw) : Math.ceil(raw);
  return Math.max(rules.min, rounded);
}

export default function CombatUnitPicker(props: Props) {
  const [sides, setSides] = useState<Record<string, Side>>(() => initialState(props.units, props.defaultAllyRefs, props.defaultEnemyRefs));
  const [selectedCards, setSelectedCards] = useState<Record<string, boolean>>({});
  const rules = props.spellcardRules ?? null;

  function cardsOfRef(ref: string): readonly CombatUnitSpellcardOption[] {
    return props.spellcardsByRef?.[ref] ?? [];
  }

  function setSide(ref: string, side: Side): void {
    setSides((prev) => {
      const current = prev[ref] ?? "NONE";
      const next = current === side ? "NONE" : side;
      if (next === "NONE") {
        setSelectedCards((cards) => {
          const copy = { ...cards };
          for (const card of cardsOfRef(ref)) delete copy[card.cardId];
          return copy;
        });
      }
      return { ...prev, [ref]: next };
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

  function sideRefs(faction: "ALLY" | "ENEMY"): string[] {
    return props.units.filter((unit) => (sides[unit.ref] ?? "NONE") === faction).map((unit) => unit.ref);
  }

  function sideCards(faction: "ALLY" | "ENEMY"): CombatUnitSpellcardOption[] {
    const byId = new Map<string, CombatUnitSpellcardOption>();
    for (const ref of sideRefs(faction)) {
      for (const card of cardsOfRef(ref)) {
        if (byId.has(card.cardId) === false) byId.set(card.cardId, card);
      }
    }
    return [...byId.values()];
  }

  function sideCap(faction: "ALLY" | "ENEMY"): number {
    if (rules === null) return 0;
    const usableMembers = sideRefs(faction).filter((ref) => cardsOfRef(ref).length > 0).length;
    return declarationCap(usableMembers, rules);
  }

  function selectedCountFor(faction: "ALLY" | "ENEMY"): number {
    const ids = new Set(sideCards(faction).map((card) => card.cardId));
    return Object.entries(selectedCards).filter(([cardId, on]) => on && ids.has(cardId)).length;
  }

  function toggleCard(faction: "ALLY" | "ENEMY", cardId: string): void {
    const cap = sideCap(faction);
    setSelectedCards((prev) => {
      const current = prev[cardId] === true;
      if (current) return { ...prev, [cardId]: false };
      if (selectedCountFor(faction) >= cap) return prev;
      return { ...prev, [cardId]: true };
    });
  }

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
                {cardsOfRef(unit.ref).length === 0 ? "" : " · SC " + cardsOfRef(unit.ref).length + " 张"}
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

      {rules === null ? null : (
        <div className="mt-1 flex flex-col gap-3 rounded-xl border border-sakura-500/25 bg-sakura-500/5 p-3">
          <div>
            <p className="text-xs font-medium text-sakura-200">战前符卡宣言</p>
            <p className="mt-0.5 text-[11px] text-white/40">
              每方可用 SC 总数约为「能使用 SC 的人数 × {rules.perMember}」；未宣言的符卡本场不能发动。
            </p>
          </div>
          {(["ALLY", "ENEMY"] as const).map((faction) => {
            if (faction === "ENEMY" && props.isKP === false) return null;
            const cards = sideCards(faction);
            const cap = sideCap(faction);
            const chosen = selectedCountFor(faction);
            return (
              <div key={faction}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={"text-[11px] " + (faction === "ALLY" ? "text-sky-200" : "text-red-200")}>
                    {faction === "ALLY" ? "我方" : "敌方"}宣言
                  </span>
                  <span className="font-mono text-[11px] text-white/45">
                    已选 {chosen} / {cap}
                  </span>
                </div>
                {cards.length === 0 ? (
                  <p className="mt-1 text-[11px] text-white/35">
                    {sideRefs(faction).length === 0 ? "先选择该方单位。" : "该方单位没有装备符卡。"}
                  </p>
                ) : (
                  <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                    {cards.map((card) => {
                      const checked = selectedCards[card.cardId] === true;
                      const disabled = checked === false && chosen >= cap;
                      return (
                        <label
                          key={card.cardId}
                          className={
                            "flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] " +
                            (checked
                              ? "border-sakura-500/50 bg-sakura-500/10 text-sakura-100"
                              : disabled
                                ? "border-white/5 text-white/30"
                                : "border-white/10 text-white/65")
                          }
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={disabled}
                            onChange={() => toggleCard(faction, card.cardId)}
                          />
                          <span className="min-w-0 truncate">{card.name}</span>
                          <span className="ml-auto shrink-0 text-white/35">
                            {card.mode === "DECLARATION" ? "展开" : "消费"} · MP {card.mpCost}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {props.units.map((unit) => {
        const side = sides[unit.ref] ?? "NONE";
        if (isEligible(unit) === false) return null;
        if (side === "ALLY") return <input key={"ally-" + unit.ref} type="hidden" name="allies" value={unit.ref} />;
        if (side === "ENEMY") return <input key={"enemy-" + unit.ref} type="hidden" name="enemies" value={unit.ref} />;
        return null;
      })}
      {Object.entries(selectedCards).map(([cardId, on]) => {
        if (on === false) return null;
        const allyIds = new Set(sideCards("ALLY").map((card) => card.cardId));
        const enemyIds = new Set(sideCards("ENEMY").map((card) => card.cardId));
        if (allyIds.has(cardId)) return <input key={"ally-card-" + cardId} type="hidden" name="allyCards" value={cardId} />;
        if (enemyIds.has(cardId)) return <input key={"enemy-card-" + cardId} type="hidden" name="enemyCards" value={cardId} />;
        return null;
      })}
    </div>
  );
}
