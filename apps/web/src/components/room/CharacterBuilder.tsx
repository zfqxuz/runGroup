"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { compile, cryptoRng, evaluate } from "@touhou/formula";
import {
  ATTRIBUTE_KEYS,
  checkPointBuy,
  compileParsedRulePack,
  computeDerived,
  rollAttributeSets,
  type AttributeKey,
  type AttributeSet,
  type AttributeSetOption,
  type RulePack
} from "@touhou/rules";
import { saveCharacter, type SaveCharacterResult } from "@/server/actions/character";
import {
  ERA_LABELS,
  hasFreeSkillChoice,
  occupationChoiceLimits,
  occupationSkillAccess,
  type OccupationSkillAccess,
  type OccupationView
} from "@/shared/occupation";

interface Props {
  roomId: string | null;
  system: "COC7" | "TOUHOU";
  pack: RulePack;
  chargenMethod: string;
  era: string | null;
  occupations: readonly OccupationView[];
}

const ATTRIBUTE_LABELS: Record<string, string> = {
  str: "力量 STR",
  con: "体质 CON",
  siz: "体型 SIZ",
  dex: "敏捷 DEX",
  app: "外貌 APP",
  int: "智力 INT",
  pow: "意志 POW",
  edu: "教育 EDU",
  luck: "幸运 LUCK"
};

const DERIVED_LABELS: Record<string, string> = {
  maxHp: "生命 HP",
  maxMp: "灵力 MP",
  maxSan: "理智 SAN",
  maxDp: "骰池 DP"
};

const SKILL_CATEGORY_ORDER = ["COMBAT", "PHYSICAL", "KNOWLEDGE", "SOCIAL", "TECH", "MAGIC", "OTHER"] as const;

const SKILL_CATEGORY_LABELS: Record<string, string> = {
  COMBAT: "战斗",
  PHYSICAL: "身体",
  KNOWLEDGE: "知识",
  SOCIAL: "社交",
  TECH: "技术",
  MAGIC: "法术",
  OTHER: "其他"
};

const inputClass =
  "w-full rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm text-white outline-none placeholder:text-white/25 focus:border-sakura-500";

function emptyAttributes(): AttributeSet {
  const base: Record<string, number> = {};
  for (const key of ATTRIBUTE_KEYS) base[key] = 0;
  return base as unknown as AttributeSet;
}

export default function CharacterBuilder(props: Props) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [race, setRace] = useState<string | null>(null);
  const [attributes, setAttributes] = useState<AttributeSet>(emptyAttributes);
  const [sets, setSets] = useState<AttributeSetOption[]>([]);
  const [selectedSet, setSelectedSet] = useState<number | null>(null);
  const [occupationId, setOccupationId] = useState<string>("");
  const [occupationAdded, setOccupationAdded] = useState<Record<string, number>>({});
  const [interestAdded, setInterestAdded] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [skillQuery, setSkillQuery] = useState("");
  const [skillCategory, setSkillCategory] = useState<string>("ALL");
  const [skillFilter, setSkillFilter] = useState<"ALL" | "OCCUPATION" | "ALLOCATED">("ALL");

  const compiled = useMemo(() => compileParsedRulePack(props.pack), [props.pack]);

  const method = useMemo(
    () =>
      props.pack.attributes.methods.find((item) => item.id === props.chargenMethod) ??
      props.pack.attributes.methods[0],
    [props.pack, props.chargenMethod]
  );

  const outcome = useMemo(
    () => computeDerived(compiled, { attributes, race }),
    [compiled, attributes, race]
  );

  const pointCheck = useMemo(
    () => (method?.kind === "POINT_BUY" ? checkPointBuy(method, attributes) : null),
    [method, attributes]
  );

  const effectiveVars = outcome.attributes as unknown as Record<string, number>;

  const skillBases = useMemo(() => {
    const map: Record<string, number> = {};
    for (const skill of compiled.skills) {
      map[skill.id] = Math.floor(
        evaluate(skill.base, { vars: effectiveVars, consts: props.pack.const })
      );
    }
    return map;
  }, [compiled, effectiveVars, props.pack.const]);

  const selectedOccupation = useMemo(
    () => props.occupations.find((item) => item.id === occupationId) ?? null,
    [props.occupations, occupationId]
  );

  const accessBySkillId = useMemo(() => {
    const map = new Map<string, OccupationSkillAccess>();
    for (const skill of compiled.skills) {
      map.set(
        skill.id,
        selectedOccupation === null ? { kind: "NONE", group: null } : occupationSkillAccess(selectedOccupation, skill.name)
      );
    }
    return map;
  }, [compiled.skills, selectedOccupation]);

  const raceInterest = useMemo(() => {
    if (race === null) return compiled.skillPoints.interest;
    const source = props.pack.races[race]?.interestPoints;
    if (source === undefined) return compiled.skillPoints.interest;
    return compile(source, { vars: [...ATTRIBUTE_KEYS] });
  }, [compiled.skillPoints.interest, props.pack.races, race]);

  const skillPool = useMemo(
    () => ({
      occupation: selectedOccupation === null
        ? 0
        : Math.floor(
          evaluate(
            compile(selectedOccupation.pointsFormula, { vars: [...ATTRIBUTE_KEYS] }),
            { vars: effectiveVars, consts: props.pack.const }
          )
        ),
      interest: Math.floor(
        evaluate(raceInterest, { vars: effectiveVars, consts: props.pack.const })
      ),
      maxAtCreation: Math.floor(
        evaluate(compiled.skillPoints.maxAtCreation, { vars: effectiveVars, consts: props.pack.const })
      ),
      occupationMax: Math.floor(
        evaluate(compiled.skillPoints.occupationMax, { vars: effectiveVars, consts: props.pack.const })
      ),
      interestMax: Math.floor(
        evaluate(compiled.skillPoints.interestMax, { vars: effectiveVars, consts: props.pack.const })
      )
    }),
    [compiled.skillPoints.interestMax, compiled.skillPoints.maxAtCreation, compiled.skillPoints.occupationMax, effectiveVars, props.pack.const, raceInterest, selectedOccupation]
  );

  const usedOccupationPoints = useMemo(
    () => Object.values(occupationAdded).reduce((sum, value) => sum + value, 0),
    [occupationAdded]
  );
  const usedInterestPoints = useMemo(
    () => Object.values(interestAdded).reduce((sum, value) => sum + value, 0),
    [interestAdded]
  );
  const occupationFreeChoice = selectedOccupation === null ? false : hasFreeSkillChoice(selectedOccupation);
  const remainingOccupationPoints = Math.max(0, skillPool.occupation - usedOccupationPoints);
  const remainingInterestPoints = Math.max(0, skillPool.interest - usedInterestPoints);

  const filteredSkills = useMemo(() => {
    const query = skillQuery.trim().toLowerCase();
    return compiled.skills.filter((skill) => {
      if (
        query.length > 0 &&
        skill.name.toLowerCase().includes(query) === false &&
        skill.id.toLowerCase().includes(query) === false
      ) {
        return false;
      }
      if (skillCategory !== "ALL" && skill.category !== skillCategory) return false;
      const access = accessBySkillId.get(skill.id) ?? { kind: "NONE" as const, group: null };
      const occupation = occupationAdded[skill.id] ?? 0;
      const interest = interestAdded[skill.id] ?? 0;
      if (skillFilter === "OCCUPATION" && access.kind === "NONE") return false;
      if (skillFilter === "ALLOCATED" && occupation === 0 && interest === 0) return false;
      return true;
    });
  }, [accessBySkillId, compiled.skills, interestAdded, occupationAdded, skillCategory, skillFilter, skillQuery]);

  const groupedSkills = useMemo(
    () =>
      SKILL_CATEGORY_ORDER.map((category) => ({
        key: category,
        label: SKILL_CATEGORY_LABELS[category] ?? category,
        skills: filteredSkills.filter((skill) => skill.category === category)
      })).filter((group) => group.skills.length > 0),
    [filteredSkills]
  );

  const raceOptions = Object.entries(props.pack.races);
  const raceInfo = race === null ? null : props.pack.races[race];
  const canRoll = method?.kind === "ROLL_SETS";
  const pointValid = pointCheck === null || pointCheck.valid;

  function updateAttribute(key: AttributeKey, value: number): void {
    const numeric = Math.floor(Number(value));
    if (Number.isFinite(numeric) === false) return;
    setAttributes((prev) => ({
      ...prev,
      [key]: Math.max(props.pack.attributes.min, Math.min(props.pack.attributes.max, numeric))
    }) as AttributeSet);
  }

  function rollDestiny(): void {
    if (method?.kind !== "ROLL_SETS") return;
    setSets(rollAttributeSets(method, cryptoRng));
    setSelectedSet(null);
    setAttributes(emptyAttributes());
    setMessage(null);
  }

  function pickSet(index: number): void {
    const option = sets[index];
    if (option === undefined) return;
    setAttributes(option.attributes);
    setSelectedSet(index);
  }

  function accessOf(skillId: string): OccupationSkillAccess {
    return accessBySkillId.get(skillId) ?? { kind: "NONE", group: null };
  }

  function currentChoiceCounts(allocation: Record<string, number> = occupationAdded): {
    readonly social: Set<string>;
    readonly free: Set<string>;
    readonly categories: Map<string, Set<string>>;
  } {
    const social = new Set<string>();
    const free = new Set<string>();
    const categories = new Map<string, Set<string>>();
    if (selectedOccupation === null) return { social, free, categories };
    for (const skill of compiled.skills) {
      if ((allocation[skill.id] ?? 0) <= 0) continue;
      const access = accessBySkillId.get(skill.id) ?? { kind: "NONE", group: null };
      if (access.kind === "SOCIAL") social.add(skill.id);
      else if (access.kind === "FREE") free.add(skill.id);
      else if (access.kind === "CATEGORY" && access.group !== null) {
        const set = categories.get(access.group) ?? new Set<string>();
        set.add(skill.id);
        categories.set(access.group, set);
      }
    }
    return { social, free, categories };
  }

  function canAddOccupationChoice(
    skillId: string,
    access: OccupationSkillAccess,
    allocation: Record<string, number> = occupationAdded
  ): boolean {
    if (access.kind === "NONE") return false;
    if ((allocation[skillId] ?? 0) > 0) return true;
    if (access.kind === "FIXED") return true;
    const limits = selectedOccupation === null
      ? { free: 0, social: 0, categories: {} as Record<string, number> }
      : occupationChoiceLimits(selectedOccupation);
    const counts = currentChoiceCounts(allocation);
    if (access.kind === "SOCIAL") return counts.social.size < limits.social;
    if (access.kind === "FREE") return limits.free > 0 && counts.free.size < limits.free;
    if (access.kind === "CATEGORY" && access.group !== null) {
      return (counts.categories.get(access.group)?.size ?? 0) < (limits.categories[access.group] ?? 1);
    }
    return true;
  }

  function setOccupationValue(skillId: string, raw: number): void {
    const desired = Math.max(0, Math.floor(Number(raw) || 0));
    const access = accessOf(skillId);
    if (access.kind === "NONE") return;
    if ((interestAdded[skillId] ?? 0) > 0) return;

    setOccupationAdded((prev) => {
      const current = prev[skillId] ?? 0;
      if (desired > current && canAddOccupationChoice(skillId, access, prev) === false) return prev;
      const used = Object.values(prev).reduce((sum, value) => sum + value, 0);
      const poolLimit = Math.max(0, skillPool.occupation - (used - current));
      const capLimit = Math.max(0, skillPool.occupationMax - (skillBases[skillId] ?? 0));
      const next = Math.min(desired, poolLimit, capLimit);
      const copy = { ...prev };
      if (next > 0) copy[skillId] = next;
      else delete copy[skillId];
      return copy;
    });
  }

  function setInterestValue(skillId: string, raw: number): void {
    const desired = Math.max(0, Math.floor(Number(raw) || 0));
    const access = accessOf(skillId);
    if (access.kind === "FIXED") return;

    setInterestAdded((prev) => {
      if ((occupationAdded[skillId] ?? 0) > 0) return prev;
      const current = prev[skillId] ?? 0;
      const used = Object.values(prev).reduce((sum, value) => sum + value, 0);
      const poolLimit = Math.max(0, skillPool.interest - (used - current));
      const capLimit = Math.max(0, skillPool.interestMax - (skillBases[skillId] ?? 0));
      const next = Math.min(desired, poolLimit, capLimit);
      const copy = { ...prev };
      if (next > 0) copy[skillId] = next;
      else delete copy[skillId];
      return copy;
    });
  }

  function clearSkillAllocation(skillId: string): void {
    setOccupationAdded((prev) => {
      if (prev[skillId] === undefined) return prev;
      const copy = { ...prev };
      delete copy[skillId];
      return copy;
    });
    setInterestAdded((prev) => {
      if (prev[skillId] === undefined) return prev;
      const copy = { ...prev };
      delete copy[skillId];
      return copy;
    });
  }

  function changeOccupation(nextId: string): void {
    setOccupationId(nextId);
    setOccupationAdded({});
    setMessage(null);
    const nextOccupation = props.occupations.find((item) => item.id === nextId) ?? null;
    if (nextOccupation === null) return;
    // 新职业固定为本职的技能不能再保留兴趣点；其余“可选本职”保持“先填哪边算哪类”。
    setInterestAdded((prev) => {
      const copy = { ...prev };
      for (const skill of compiled.skills) {
        const access = occupationSkillAccess(nextOccupation, skill.name);
        if (access.kind === "FIXED") delete copy[skill.id];
      }
      return copy;
    });
  }

  async function submit(): Promise<void> {
    setBusy(true);
    setMessage(null);

    const skills: Record<string, number> = {};
    for (const skill of compiled.skills) {
      const total = (skillBases[skill.id] ?? 0) + (occupationAdded[skill.id] ?? 0) + (interestAdded[skill.id] ?? 0);
      if (total > 0) skills[skill.id] = total;
    }

    const result: SaveCharacterResult = await saveCharacter({
      roomId: props.roomId,
      system: props.system,
      name,
      race,
      attributes: attributes as unknown as Record<string, number>,
      skills,
      chargenMethod: method?.id ?? "",
      occupationId: selectedOccupation?.id ?? null,
      skillAllocation: {
        occupation: occupationAdded,
        interest: interestAdded
      },
      era: props.era
    });

    setBusy(false);
    if (result.ok === false) {
      setMessage(result.error ?? "保存失败");
      return;
    }
    router.push(props.roomId === null ? "/characters" : "/rooms/" + props.roomId);
    router.refresh();
  }

  const stepButton =
    "h-8 min-w-8 rounded-md border border-white/15 px-1.5 text-[11px] text-white/60 transition hover:border-white/35 hover:text-white";

  const choiceLimits = selectedOccupation === null ? null : occupationChoiceLimits(selectedOccupation);
  const choiceCounts = currentChoiceCounts();

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <h2 className="text-sm font-medium text-white/80">基本信息</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-white/50">角色名</span>
            <input value={name} onChange={(event) => setName(event.target.value)} className={inputClass} />
          </label>
          {raceOptions.length > 0 ? (
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-white/50">种族</span>
              <select
                value={race ?? ""}
                onChange={(event) => setRace(event.target.value.length > 0 ? event.target.value : null)}
                className={inputClass}
              >
                <option value="">（未选择）</option>
                {raceOptions.map(([id, info]) => (
                  <option key={id} value={id}>{info.name}</option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        {raceInfo === null || raceInfo === undefined ? null : (
          <p className="mt-3 text-xs leading-relaxed text-white/40">{raceInfo.description}</p>
        )}
        {props.occupations.length === 0 ? null : (
          <div className="mt-5 border-t border-white/10 pt-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-white/50">职业</span>
              <select
                value={occupationId}
                onChange={(event) => changeOccupation(event.target.value)}
                className={inputClass}
              >
                <option value="">（未选择职业）</option>
                {props.occupations.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {ERA_LABELS[item.era] ?? item.era}
                  </option>
                ))}
              </select>
            </label>
            {selectedOccupation === null ? (
              <p className="mt-2 text-[11px] text-white/35">
                选择职业后才能使用职业点。兴趣点不受职业限制。
              </p>
            ) : (
              <div className="mt-3 rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2.5">
                <p className="text-xs text-white/60">
                  {selectedOccupation.name} · 职业点 {skillPool.occupation} · 信用范围 {selectedOccupation.creditText ?? "—"}
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-white/40">
                  本职与可选：{selectedOccupation.skillsText}
                </p>
                {choiceLimits === null ? null : (
                  <div className="mt-1.5 flex flex-wrap gap-2 font-mono text-[10px] text-white/45">
                    {choiceLimits.free > 0 ? (
                      <span>任意可选 {choiceCounts.free.size}/{choiceLimits.free}</span>
                    ) : null}
                    {choiceLimits.social > 0 ? (
                      <span>社交可选 {choiceCounts.social.size}/{choiceLimits.social}</span>
                    ) : null}
                    {Object.entries(choiceLimits.categories).map(([group, limit]) => (
                      <span key={group}>{group}可选 {choiceCounts.categories.get(group)?.size ?? 0}/{limit}</span>
                    ))}
                  </div>
                )}
                {occupationFreeChoice ? (
                  <p className="mt-1 text-[10px] text-amber-300/80">含自选技能位，自选部分请按 KP 审核意见分配。</p>
                ) : null}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-white/80">
            属性 · {method?.label ?? "未知方式"}
          </h2>
          <div className="flex items-center gap-3">
            {pointCheck === null ? null : (
              <span
                className={
                  pointCheck.remaining === 0
                    ? "rounded-full border border-emerald-400/40 px-3 py-1 font-mono text-xs text-emerald-300"
                    : "rounded-full border border-amber-400/40 px-3 py-1 font-mono text-xs text-amber-300"
                }
              >
                已用 {pointCheck.total} · 剩余 {pointCheck.remaining}
              </span>
            )}
            {canRoll ? (
              <button
                type="button"
                onClick={rollDestiny}
                className="rounded-lg bg-sakura-500 px-4 py-2 text-xs font-medium text-ink-900 transition hover:bg-sakura-400"
              >
                {sets.length === 0 ? "掷天命 5" : "重新掷 5 组"}
              </button>
            ) : null}
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {ATTRIBUTE_KEYS.map((key) => {
            const raw = attributes[key];
            const effective = outcome.attributes[key];
            return (
              <div key={key} className="rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2">
                <p className="text-xs text-white/50">{ATTRIBUTE_LABELS[key]}</p>
                <div className="mt-2 flex items-center justify-center gap-1">
                  <button type="button" className={stepButton} onClick={() => updateAttribute(key, raw - 5)}>−5</button>
                  <button type="button" className={stepButton} onClick={() => updateAttribute(key, raw - 1)}>−1</button>
                  <input
                    type="number"
                    value={raw}
                    onChange={(event) => updateAttribute(key, Number(event.target.value) || 0)}
                    className="h-9 w-16 rounded-md border border-white/20 bg-ink-900 px-1 text-center font-mono text-lg font-semibold text-white outline-none focus:border-sakura-500"
                  />
                  <button type="button" className={stepButton} onClick={() => updateAttribute(key, raw + 1)}>+1</button>
                  <button type="button" className={stepButton} onClick={() => updateAttribute(key, raw + 5)}>+5</button>
                </div>
                {effective === raw ? null : (
                  <p className="mt-1 text-[11px] text-sakura-300">种族修正后 {effective}</p>
                )}
              </div>
            );
          })}
        </div>

        {pointCheck !== null && pointCheck.valid === false ? (
          <ul className="mt-3 space-y-1">
            {pointCheck.errors.slice(0, 4).map((error) => (
              <li key={error} className="text-[11px] text-red-300">· {error}</li>
            ))}
          </ul>
        ) : null}

        {sets.length === 0 ? null : (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-white/40">
                  <th className="py-2 text-left font-normal">组</th>
                  {ATTRIBUTE_KEYS.map((key) => (
                    <th key={key} className="py-2 text-center font-normal">
                      {key.toUpperCase()}
                    </th>
                  ))}
                  <th className="py-2 text-right font-normal">合计</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sets.map((option) => (
                  <tr
                    key={option.index}
                    className={selectedSet === option.index ? "bg-sakura-500/10" : ""}
                  >
                    <td className="py-1.5 text-white/60">#{option.index + 1}</td>
                    {ATTRIBUTE_KEYS.map((key) => (
                      <td key={key} className="py-1.5 text-center font-mono text-white/70">
                        {option.attributes[key]}
                      </td>
                    ))}
                    <td className="py-1.5 text-right font-mono text-white/50">{option.total}</td>
                    <td className="py-1.5 pl-3 text-right">
                      <button
                        type="button"
                        onClick={() => pickSet(option.index)}
                        className="rounded-md border border-sakura-500/40 px-2 py-1 text-[11px] text-sakura-400 transition hover:bg-sakura-500/10"
                      >
                        选用
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <h2 className="text-sm font-medium text-white/80">衍生属性（实时计算）</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          {(["maxHp", "maxMp", "maxSan", "maxDp"] as const).map((key) => (
            <div
              key={key}
              className="rounded-lg border border-spirit-400/20 bg-spirit-400/5 px-3 py-3 text-center"
            >
              <p className="text-xs text-white/40">{DERIVED_LABELS[key]}</p>
              <p className="mt-1 text-2xl font-semibold text-spirit-400">
                {outcome.derived[key]}
              </p>
            </div>
          ))}
        </div>
        {outcome.flags.length === 0 ? null : (
          <p className="mt-3 text-[11px] text-white/35">
            种族特性：{outcome.flags.join(" · ")}
          </p>
        )}
      </section>

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-[260px] flex-1">
            <h2 className="text-base font-semibold text-white/90">技能分配</h2>
            <p className="mt-1 text-xs leading-relaxed text-white/50">
              职业写明的本职 + 你自行选中的本职只能用职业点；其余技能都视为兴趣，只能用兴趣点。同一技能不能混用两种点数；填了一边后另一边会锁定，点右侧「清空」可改。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-lg border border-sakura-500/35 bg-sakura-500/10 px-3 py-2 font-mono text-xs text-sakura-200">
              职业点剩余 <span className="text-lg font-semibold text-sakura-300">{remainingOccupationPoints}</span> / {skillPool.occupation}
            </span>
            <span className="rounded-lg border border-sky-400/35 bg-sky-400/10 px-3 py-2 font-mono text-xs text-sky-200">
              兴趣点剩余 <span className="text-lg font-semibold text-sky-300">{remainingInterestPoints}</span> / {skillPool.interest}
            </span>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-white/40">
          <span>本职上限 {skillPool.occupationMax}</span>
          <span className="text-white/15">|</span>
          <span>兴趣上限 {skillPool.interestMax}</span>
          <span className="text-white/15">|</span>
          <span>已加点 {Object.keys(occupationAdded).length + Object.keys(interestAdded).length} 项</span>
        </div>

        {selectedOccupation === null ? (
          <p className="mt-3 rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
            还没选择职业。当前所有技能加点都按兴趣点计算，不能使用职业点。
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-ink-900/60 p-3">
          <input
            value={skillQuery}
            onChange={(event) => setSkillQuery(event.target.value)}
            placeholder="搜索技能名 / ID"
            className="h-9 min-w-[180px] flex-1 rounded-lg border border-white/15 bg-ink-900 px-3 text-sm text-white/80 outline-none placeholder:text-white/25 focus:border-sakura-500"
          />
          <select
            value={skillCategory}
            onChange={(event) => setSkillCategory(event.target.value)}
            className="h-9 rounded-lg border border-white/15 bg-ink-900 px-3 text-xs text-white/75 outline-none focus:border-sakura-500"
          >
            <option value="ALL">全部类别</option>
            {SKILL_CATEGORY_ORDER.map((category) => (
              <option key={category} value={category}>{SKILL_CATEGORY_LABELS[category] ?? category}</option>
            ))}
          </select>
          <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-black/20 p-1">
            {([
              ["ALL", "全部"],
              ["OCCUPATION", "本职 / 可选"],
              ["ALLOCATED", "已加点"]
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setSkillFilter(value)}
                className={
                  "rounded-md px-2.5 py-1 text-[11px] transition " +
                  (skillFilter === value ? "bg-white/15 text-white" : "text-white/45 hover:text-white/80")
                }
              >
                {label}
              </button>
            ))}
          </div>
          <span className="ml-auto font-mono text-[11px] text-white/35">
            {filteredSkills.length} / {compiled.skills.length} 项
          </span>
        </div>

        <div className="mt-4 flex flex-col gap-5">
          {groupedSkills.length === 0 ? (
            <p className="rounded-lg border border-white/10 bg-ink-900/60 px-3 py-6 text-center text-xs text-white/35">
              没有匹配的技能
            </p>
          ) : null}
          {groupedSkills.map((group) => (
            <div key={group.key}>
              <div className="mb-2 flex items-center gap-2">
                <h3 className="text-xs font-semibold tracking-wide text-white/60">{group.label}</h3>
                <span className="font-mono text-[10px] text-white/25">{group.skills.length} 项</span>
              </div>
              <div className="grid gap-2 lg:grid-cols-2">
                {group.skills.map((skill) => {
                  const base = skillBases[skill.id] ?? 0;
                  const occupation = occupationAdded[skill.id] ?? 0;
                  const interest = interestAdded[skill.id] ?? 0;
                  const total = base + occupation + interest;
                  const access = accessOf(skill.id);
                  const isFixed = access.kind === "FIXED";
                  const isPotential = access.kind !== "NONE";
                  const maxOccupationAdd = Math.max(0, skillPool.occupationMax - base);
                  const maxInterestAdd = Math.max(0, skillPool.interestMax - base);
                  const choiceAllowed = isPotential && canAddOccupationChoice(skill.id, access);
                  const occupationEnabled =
                    isPotential &&
                    interest === 0 &&
                    (occupation > 0 || (choiceAllowed && remainingOccupationPoints > 0 && maxOccupationAdd > 0));
                  const interestEnabled =
                    isFixed === false &&
                    occupation === 0 &&
                    (interest > 0 || (remainingInterestPoints > 0 && maxInterestAdd > 0));
                  const badge =
                    isFixed || occupation > 0
                      ? "本职"
                      : isPotential
                        ? (interest > 0 ? "兴趣" : "可选本职")
                        : interest > 0
                          ? "兴趣"
                          : null;

                  return (
                    <div key={skill.id} className="rounded-xl border border-white/10 bg-ink-900/70 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="truncate text-sm font-medium text-white/90">{skill.name}</span>
                            {badge === null ? null : (
                              <span
                                className={
                                  "shrink-0 rounded border px-1.5 py-0.5 text-[10px] " +
                                  (badge === "本职"
                                    ? "border-sakura-500/50 bg-sakura-500/10 text-sakura-300"
                                    : badge === "可选本职"
                                      ? "border-spirit-400/45 bg-spirit-400/10 text-spirit-300"
                                      : "border-sky-400/40 bg-sky-400/10 text-sky-200")
                                }
                              >
                                {badge}
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 text-[11px] text-white/40">
                            基础 <span className="font-mono text-white/70">{base}</span>
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-[10px] text-white/40">总计</p>
                          <p className="font-mono text-xl font-semibold text-amber-300">{total}</p>
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <label className="flex flex-col gap-1">
                          <span className="flex items-center justify-between text-[10px] text-sakura-300/90">
                            <span>本职加点</span>
                            <span className="font-mono text-white/30">上限 {maxOccupationAdd + base}</span>
                          </span>
                          <input
                            type="number"
                            min={0}
                            step={1}
                            value={occupation}
                            disabled={occupationEnabled === false}
                            onChange={(event) => setOccupationValue(skill.id, Number(event.target.value))}
                            className="h-9 rounded-lg border border-sakura-500/30 bg-ink-900 px-2 text-center font-mono text-sm text-sakura-100 outline-none focus:border-sakura-400 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-black/20 disabled:text-white/25"
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="flex items-center justify-between text-[10px] text-sky-300/90">
                            <span>兴趣加点</span>
                            <span className="font-mono text-white/30">上限 {maxInterestAdd + base}</span>
                          </span>
                          <input
                            type="number"
                            min={0}
                            step={1}
                            value={interest}
                            disabled={interestEnabled === false}
                            onChange={(event) => setInterestValue(skill.id, Number(event.target.value))}
                            className="h-9 rounded-lg border border-sky-400/30 bg-ink-900 px-2 text-center font-mono text-sm text-sky-100 outline-none focus:border-sky-300 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-black/20 disabled:text-white/25"
                          />
                        </label>
                      </div>

                      <div className="mt-2 flex items-center justify-between gap-2">
                        <p className="font-mono text-[11px] text-white/45">
                          基础 {base} + 职 <span className="text-sakura-300">{occupation}</span> + 趣 <span className="text-sky-300">{interest}</span> = <span className="text-white/80">{total}</span>
                        </p>
                        {occupation > 0 || interest > 0 ? (
                          <button
                            type="button"
                            onClick={() => clearSkillAllocation(skill.id)}
                            className="text-[10px] text-white/30 transition hover:text-white/70"
                          >
                            清空
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <div>
          <p className="text-sm text-white/70">
            {props.roomId === null ? "保存到我的角色库" : "保存后将提交给本房 KP 审核"}
          </p>
          {message === null ? null : (
            <p className="mt-1 text-xs text-red-300">{message}</p>
          )}
        </div>
        <button
          type="button"
          disabled={[busy, name.trim().length === 0, pointValid === false].includes(true)}
          onClick={submit}
          className="rounded-lg bg-sakura-500 px-6 py-2.5 text-sm font-medium text-ink-900 transition hover:bg-sakura-400 disabled:opacity-40"
        >
          {busy ? "保存中…" : "保存角色卡"}
        </button>
      </section>
    </div>
  );
}
