"use client";

import { useState } from "react";
import {
  abilityTotalCost,
  touhouAbilityGrowthCost,
  touhouAttributeGrowthCost,
  touhouSkillGrowthCost,
  type AbilityCategory
} from "@touhou/rules";
import { grantTouhouGrowthAction, spendTouhouGrowthAction } from "@/server/actions/touhou-growth";

export interface TouhouGrowthCharacterView {
  readonly id: string;
  readonly name: string;
  readonly attributes: Readonly<Record<string, number>>;
  readonly skills: Readonly<Record<string, number>>;
  readonly abilities: Readonly<Record<string, number>>;
  readonly points: {
    readonly granted: { readonly attribute: number; readonly skill: number; readonly ability: number; readonly hpCoefficient: number; readonly spellcard: number };
    readonly spent: { readonly attribute: number; readonly skill: number; readonly ability: number };
    readonly spentByAbility: Readonly<Record<string, number>>;
    readonly hpCoefficient: number;
    readonly spellcardPool: number;
  };
}

export interface TouhouGrowthRulesView {
  readonly growthRanks: Readonly<Record<string, { readonly attribute: number; readonly skill: number; readonly ability: number; readonly hpCoefficient: number; readonly spellcard: number }>>;
  readonly categories: Readonly<Record<string, { readonly id: string; readonly name: string; readonly costTable: readonly number[] }>>;
}

interface Props {
  readonly roomId: string;
  readonly returnTo: string;
  readonly isKP: boolean;
  readonly rules: TouhouGrowthRulesView;
  readonly characters: readonly TouhouGrowthCharacterView[];
  readonly notice: string | null;
  readonly error: string | null;
}

const ATTRIBUTE_LABELS: Record<string, string> = {
  str: "力量 STR", con: "体质 CON", siz: "体型 SIZ", dex: "敏捷 DEX",
  app: "外貌 APP", int: "智力 INT", pow: "意志 POW", edu: "教育 EDU", luck: "幸运 LUCK"
};

const NOTICE_LABELS: Record<string, string> = {
  granted: "已分配成长等级。",
  spent: "成长点已消费，角色数值已更新。"
};

const ERROR_LABELS: Record<string, string> = {
  "touhou-growth": "成长操作失败：请检查成长点、等级或目标。"
};

function remaining(pools: TouhouGrowthCharacterView["points"], key: "attribute" | "skill" | "ability"): number {
  return Math.max(0, Math.floor(pools.granted[key] - pools.spent[key]));
}

/** 单个角色的成长面板：消费成长点 + KP 分配等级。 */
function CharacterGrowthCard(props: {
  readonly roomId: string;
  readonly returnTo: string;
  readonly isKP: boolean;
  readonly rules: TouhouGrowthRulesView;
  readonly character: TouhouGrowthCharacterView;
}) {
  const { character, rules } = props;
  const categories = Object.values(rules.categories);
  const [kind, setKind] = useState<"ATTRIBUTE" | "SKILL" | "ABILITY">("ATTRIBUTE");
  const [attributeKey, setAttributeKey] = useState("str");
  const [skillId, setSkillId] = useState(Object.keys(character.skills)[0] ?? "");
  const [abilityId, setAbilityId] = useState(categories[0]?.id ?? "");

  const attrRemaining = remaining(character.points, "attribute");
  const skillRemaining = remaining(character.points, "skill");
  const abilityRemaining = remaining(character.points, "ability");

  const attributeCost = touhouAttributeGrowthCost(character.attributes[attributeKey] ?? 0, (character.attributes[attributeKey] ?? 0) + 1);
  const skillCost = touhouSkillGrowthCost(character.skills[skillId] ?? 0, (character.skills[skillId] ?? 0) + 1);
  const abilityCategory = rules.categories[abilityId];
  const abilityCost = abilityCategory === undefined
    ? 0
    : touhouAbilityGrowthCost(abilityCategory as AbilityCategory, character.abilities[abilityId] ?? 0, (character.abilities[abilityId] ?? 0) + 1);

  const activeCost = kind === "ATTRIBUTE" ? attributeCost : kind === "SKILL" ? skillCost : abilityCost;
  const activeRemaining = kind === "ATTRIBUTE" ? attrRemaining : kind === "SKILL" ? skillRemaining : abilityRemaining;
  const targetValue = kind === "ATTRIBUTE" ? attributeKey : kind === "SKILL" ? skillId : abilityId;
  const canSpend = activeCost > 0 && activeCost <= activeRemaining && targetValue.length > 0;

  const tierOptions = Object.keys(rules.growthRanks);

  return (
    <div className="rounded-lg border border-white/10 bg-ink-900/50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-white/80">{character.name}</p>
        <div className="flex flex-wrap gap-1.5 text-[10px]">
          <span className="rounded border border-sky-400/30 px-1.5 py-0.5 text-sky-200">特性值 {attrRemaining}/{Math.floor(character.points.granted.attribute)}</span>
          <span className="rounded border border-emerald-400/30 px-1.5 py-0.5 text-emerald-200">技能 {skillRemaining}/{Math.floor(character.points.granted.skill)}</span>
          <span className="rounded border border-purple-400/30 px-1.5 py-0.5 text-purple-200">能力 {abilityRemaining}/{Math.floor(character.points.granted.ability)}</span>
          <span className="rounded border border-amber-400/30 px-1.5 py-0.5 text-amber-200">HP系数 {character.points.hpCoefficient.toFixed(1)}</span>
          <span className="rounded border border-rose-400/30 px-1.5 py-0.5 text-rose-200">SC池 {character.points.spellcardPool.toFixed(1)}</span>
        </div>
      </div>

      <form action={spendTouhouGrowthAction} className="mt-2 flex flex-wrap items-end gap-2">
        <input type="hidden" name="roomId" value={props.roomId} />
        <input type="hidden" name="returnTo" value={props.returnTo} />
        <input type="hidden" name="characterId" value={character.id} />
        <input type="hidden" name="target" value={targetValue} />
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-white/35">成长类型</span>
          <select name="kind" value={kind} onChange={(event) => setKind(event.target.value as typeof kind)} className="rounded border border-white/15 bg-ink-900 px-2 py-1 text-xs text-white">
            <option value="ATTRIBUTE">特性值</option>
            <option value="SKILL">技能</option>
            <option value="ABILITY">能力</option>
          </select>
        </label>
        {kind === "ATTRIBUTE" ? (
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-white/35">目标特性</span>
            <select value={attributeKey} onChange={(event) => setAttributeKey(event.target.value)} className="rounded border border-white/15 bg-ink-900 px-2 py-1 text-xs text-white">
              {Object.keys(ATTRIBUTE_LABELS).map((key) => (
                <option key={key} value={key}>{ATTRIBUTE_LABELS[key]}（{character.attributes[key] ?? 0}）</option>
              ))}
            </select>
          </label>
        ) : null}
        {kind === "SKILL" ? (
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-white/35">目标技能</span>
            <select value={skillId} onChange={(event) => setSkillId(event.target.value)} className="rounded border border-white/15 bg-ink-900 px-2 py-1 text-xs text-white">
              {Object.keys(character.skills).length === 0 ? <option value="">没有可成长技能</option> : null}
              {Object.entries(character.skills).map(([id, value]) => (
                <option key={id} value={id}>{id}（{value}）</option>
              ))}
            </select>
          </label>
        ) : null}
        {kind === "ABILITY" ? (
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-white/35">目标能力</span>
            <select value={abilityId} onChange={(event) => setAbilityId(event.target.value)} className="rounded border border-white/15 bg-ink-900 px-2 py-1 text-xs text-white">
              {categories.map((category) => (
                <option key={category.id} value={category.id}>{category.name}（Lv{character.abilities[category.id] ?? 0}）</option>
              ))}
            </select>
          </label>
        ) : null}
        <span className="rounded border border-white/15 px-2 py-1 font-mono text-[11px] text-white/55">花费 {activeCost} 点</span>
        <button type="submit" disabled={canSpend === false} className="rounded bg-sakura-500 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-sakura-400 disabled:opacity-40">
          成长 +1
        </button>
      </form>

      {props.isKP ? (
        <form action={grantTouhouGrowthAction} className="mt-2 flex flex-wrap items-end gap-2 border-t border-white/10 pt-2">
          <input type="hidden" name="roomId" value={props.roomId} />
          <input type="hidden" name="returnTo" value={props.returnTo} />
          <input type="hidden" name="characterId" value={character.id} />
          {([
            ["attributeGrade", "特性值"],
            ["skillGrade", "技能"],
            ["abilityGrade", "能力"],
            ["hpSpellcardGrade", "HP&SC"]
          ] as const).map(([name, label]) => (
            <label key={name} className="flex flex-col gap-1">
              <span className="text-[10px] text-white/35">{label}等级</span>
              <select name={name} defaultValue="C" className="rounded border border-white/15 bg-ink-900 px-2 py-1 text-xs text-white">
                {tierOptions.map((tier) => (
                  <option key={tier} value={tier}>{tier}</option>
                ))}
              </select>
            </label>
          ))}
          <button type="submit" className="rounded border border-amber-400/40 px-3 py-1.5 text-xs text-amber-200 transition hover:bg-amber-400/10">
            KP 分配成长等级
          </button>
        </form>
      ) : null}
    </div>
  );
}

export default function TouhouGrowthPanel(props: Props) {
  if (props.characters.length === 0) return null;
  const noticeText = props.notice === null ? null : NOTICE_LABELS[props.notice] ?? props.notice;
  const errorText = props.error === null ? null : ERROR_LABELS[props.error] ?? props.error;
  return (
    <section className="rounded-xl border border-sky-400/25 bg-sky-400/5 p-5">
      <h2 className="text-sm font-medium text-white/80">千幻抄成长</h2>
      <p className="mt-1 text-[11px] text-white/40">
        特性值 n→n+1 花 n+1 点；技能升到 L 花 L 点（5 级后固定 5 点）；能力沿用开卡消费表；妖术 / 锻炼单项受成长能力点 60% 限制。
      </p>
      {noticeText === null ? null : (
        <p className="mt-3 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-[11px] text-emerald-200">{noticeText}</p>
      )}
      {errorText === null ? null : (
        <p className="mt-3 rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-[11px] text-red-200">{errorText}</p>
      )}
      <div className="mt-3 flex flex-col gap-2">
        {props.characters.map((character) => (
          <CharacterGrowthCard key={character.id} roomId={props.roomId} returnTo={props.returnTo} isKP={props.isKP} rules={props.rules} character={character} />
        ))}
      </div>
    </section>
  );
}
