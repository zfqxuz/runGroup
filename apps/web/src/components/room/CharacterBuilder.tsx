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
  isOccupationSkill,
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

const inputClass =
  "w-full rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-sakura-500";

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
      )
    }),
    [compiled.skillPoints.maxAtCreation, effectiveVars, props.pack.const, raceInterest, selectedOccupation]
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

  const raceOptions = Object.entries(props.pack.races);
  const raceInfo = race === null ? null : props.pack.races[race];
  const canRoll = method?.kind === "ROLL_SETS";
  const pointValid = pointCheck === null || pointCheck.valid;

  function updateAttribute(key: AttributeKey, value: number): void {
    setAttributes((prev) => ({ ...prev, [key]: value }) as AttributeSet);
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

  function canUseOccupation(skillId: string): boolean {
    if (selectedOccupation === null) return false;
    if (occupationFreeChoice) return true;
    const skill = compiled.skills.find((item) => item.id === skillId);
    if (skill === undefined) return false;
    return isOccupationSkill(selectedOccupation, skill.name);
  }

  function adjustSkill(skillId: string, field: "occupation" | "interest", delta: number): void {
    const base = skillBases[skillId] ?? 0;
    const currentOccupation = occupationAdded[skillId] ?? 0;
    const currentInterest = interestAdded[skillId] ?? 0;
    const nextOccupation = field === "occupation" ? currentOccupation + delta : currentOccupation;
    const nextInterest = field === "interest" ? currentInterest + delta : currentInterest;
    if (nextOccupation < 0 || nextInterest < 0) return;
    if (base + nextOccupation + nextInterest > skillPool.maxAtCreation) return;
    if (field === "occupation") {
      if (delta > 0 && canUseOccupation(skillId) === false) return;
      if (delta > 0 && usedOccupationPoints + delta > skillPool.occupation) return;
      setOccupationAdded((prev) => ({ ...prev, [skillId]: nextOccupation }));
      return;
    }
    if (delta > 0 && usedInterestPoints + delta > skillPool.interest) return;
    setInterestAdded((prev) => ({ ...prev, [skillId]: nextInterest }));
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
    "h-8 w-8 rounded-md border border-white/15 text-white/60 transition hover:border-white/35 hover:text-white";

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
                onChange={(event) => {
                  setOccupationId(event.target.value);
                  setOccupationAdded({});
                }}
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
                <p className="text-xs text-white/40">{ATTRIBUTE_LABELS[key]}</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <button
                    type="button"
                    className={stepButton}
                    onClick={() => updateAttribute(key, Math.max(props.pack.attributes.min, raw - 5))}
                  >
                    −
                  </button>
                  <input
                    type="number"
                    value={raw}
                    onChange={(event) => updateAttribute(key, Number(event.target.value) || 0)}
                    className="w-full rounded-md border border-white/15 bg-ink-900 px-2 py-1 text-center font-mono text-sm outline-none focus:border-sakura-500"
                  />
                  <button
                    type="button"
                    className={stepButton}
                    onClick={() => updateAttribute(key, Math.min(props.pack.attributes.max, raw + 5))}
                  >
                    +
                  </button>
                </div>
                {effective === raw ? null : (
                  <p className="mt-1 text-[11px] text-sakura-400">种族修正后 {effective}</p>
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-white/80">技能 · {compiled.skills.length} 项</h2>
          <span className="rounded-full border border-white/15 px-3 py-1 font-mono text-xs text-white/60">
            职业 {usedOccupationPoints}/{skillPool.occupation} · 兴趣 {usedInterestPoints}/{skillPool.interest} · 单项上限 {skillPool.maxAtCreation}
          </span>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {compiled.skills.map((skill) => {
            const base = skillBases[skill.id] ?? 0;
            const occupation = occupationAdded[skill.id] ?? 0;
            const interest = interestAdded[skill.id] ?? 0;
            const total = base + occupation + interest;
            const occupationEnabled = selectedOccupation === null ? false : canUseOccupation(skill.id);
            return (
              <div key={skill.id} className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-1 truncate text-xs text-white/70">
                    <span className="truncate">{skill.name}</span>
                    {occupationEnabled ? (
                      <span className="shrink-0 rounded border border-sakura-500/40 px-1 text-[9px] text-sakura-400">本职</span>
                    ) : null}
                  </p>
                  <p className="font-mono text-[10px] text-white/30">
                    {base} + 职{occupation} + 趣{interest} = {total}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <div className="flex items-center gap-0.5">
                    <span className="text-[9px] text-white/35">职</span>
                    <button type="button" disabled={occupationEnabled === false || occupation <= 0} className="h-5 w-5 rounded border border-white/15 text-white/50 transition enabled:hover:border-white/35 enabled:hover:text-white disabled:opacity-20" onClick={() => adjustSkill(skill.id, "occupation", -5)}>−</button>
                    <button type="button" disabled={occupationEnabled === false} className="h-5 w-5 rounded border border-white/15 text-white/50 transition enabled:hover:border-white/35 enabled:hover:text-white disabled:opacity-20" onClick={() => adjustSkill(skill.id, "occupation", 5)}>+</button>
                  </div>
                  <div className="flex items-center gap-0.5">
                    <span className="text-[9px] text-white/35">趣</span>
                    <button type="button" disabled={interest <= 0} className="h-5 w-5 rounded border border-white/15 text-white/50 transition enabled:hover:border-white/35 enabled:hover:text-white disabled:opacity-20" onClick={() => adjustSkill(skill.id, "interest", -5)}>−</button>
                    <button type="button" className="h-5 w-5 rounded border border-white/15 text-white/50 transition hover:border-white/35 hover:text-white" onClick={() => adjustSkill(skill.id, "interest", 5)}>+</button>
                  </div>
                </div>
              </div>
            );
          })}
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
