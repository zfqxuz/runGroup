"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { compile, cryptoRng, evaluate } from "@touhou/formula";
import {
  ATTRIBUTE_KEYS,
  applyCoc7AgeAdjustment,
  checkCoc7AgeAllocation,
  checkPointBuy,
  coc7AgeAdjustment,
  coc7Build,
  coc7DamageBonusFromBuild,
  coc7MajorWound,
  coc7Movement,
  compileParsedRulePack,
  computeDerived,
  rollAttributeSets,
  type AttributeKey,
  type AttributeSet,
  type AttributeSetOption,
  type Coc7AgeAllocation,
  type Coc7PhysicalAttribute,
  type RulePack
} from "@touhou/rules";
import { saveCharacter, updateCharacterAction, type SaveCharacterResult } from "@/server/actions/character";
import {
  creditRatingLabel,
  ERA_LABELS,
  hasFreeSkillChoice,
  isActualOccupationSkill,
  occupationChoiceLimits,
  occupationSkillAccess,
  occupationSlotCandidates,
  profileOccupationalSkillIds,
  type OccupationSkillAccess,
  type OccupationView
} from "@/shared/occupation";

export interface CharacterItemDraft {
  id?: string;
  kind: "WEAPON" | "ITEM" | "SPELLCARD";
  name: string;
  subtitle?: string | null;
  description?: string | null;
  stats: Record<string, unknown>;
  scope?: string;
}

export interface CharacterAvailableCard {
  readonly id: string;
  readonly kind: "WEAPON" | "ITEM" | "SPELLCARD";
  readonly name: string;
  readonly subtitle?: string | null;
  readonly stats: Record<string, unknown>;
  readonly scope?: string;
}

export interface CharacterEditorInitial {
  readonly id: string;
  readonly name: string;
  readonly playerName?: string | null;
  readonly gender?: string | null;
  readonly residence?: string | null;
  readonly race: string | null;
  readonly attributes: AttributeSet;
  readonly age: number | null;
  readonly ageAllocation: Coc7AgeAllocation;
  readonly occupationId: string | null;
  readonly occupationAdded: Record<string, number>;
  readonly interestAdded: Record<string, number>;
  readonly slotAssignments: Record<string, string[]>;
  readonly backstory: Record<string, unknown>;
  readonly assets: Record<string, unknown>;
  readonly items: readonly CharacterItemDraft[];
}

interface Props {
  roomId: string | null;
  system: "COC7" | "TOUHOU";
  pack: RulePack;
  chargenMethod: string;
  era: string | null;
  occupations: readonly OccupationView[];
  /** CREATE = 新建角色；EDIT = 编辑已有角色。两者是同一套页面。 */
  mode?: "CREATE" | "EDIT";
  characterId?: string;
  initial?: CharacterEditorInitial | null;
  /** EDIT：是否重新套用 COC7 年龄补正（仅当角色存有原始属性时为 true）。 */
  applyAgeAdjustment?: boolean;
  /** 当前可用卡的候选列表（来自用户卡库）。 */
  availableCards?: readonly CharacterAvailableCard[];
  /** 卡牌创建 / 编辑完成后返回的地址。 */
  returnTo?: string;
  /** D-5：房间维护的专精候选（作为专精名称下拉候选，仍可自由输入）。 */
  specialtyCandidates?: readonly { readonly baseId: string; readonly name: string }[];
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

function toggleArrayValue<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

function emptyAttributes(): AttributeSet {
  const base: Record<string, number> = {};
  for (const key of ATTRIBUTE_KEYS) base[key] = 0;
  return base as unknown as AttributeSet;
}

function defaultAttributesForMethod(
  method: RulePack["attributes"]["methods"][number] | undefined
): AttributeSet {
  if (method === undefined || method.kind === "ROLL_SETS") return emptyAttributes();
  const value =
    method.kind === "POINT_BUY"
      ? Math.max(method.perAttributeMin, Math.min(method.perAttributeMax, 50))
      : 50;
  const base: Record<string, number> = {};
  for (const key of ATTRIBUTE_KEYS) base[key] = value;
  return base as unknown as AttributeSet;
}

function backstoryText(initial: CharacterEditorInitial | null, key: string): string {
  const value = initial?.backstory?.[key];
  return typeof value === "string" ? value : "";
}

function backstoryJson(initial: CharacterEditorInitial | null, key: string): string {
  const value = initial?.backstory?.[key];
  return JSON.stringify(Array.isArray(value) ? value : []);
}

function assetText(initial: CharacterEditorInitial | null, key: string): string {
  const value = initial?.assets?.[key];
  if (value === null || value === undefined) return "";
  return typeof value === "number" ? String(value) : typeof value === "string" ? value : "";
}

export default function CharacterBuilder(props: Props) {
  const router = useRouter();
  const initial = props.initial ?? null;
  const isEdit = props.mode === "EDIT";
  const applyAgeAdjustment = props.applyAgeAdjustment ?? true;
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState(initial?.name ?? "");
  const [playerName, setPlayerName] = useState(initial?.playerName ?? "");
  const [gender, setGender] = useState(initial?.gender ?? "");
  const [residence, setResidence] = useState(initial?.residence ?? "");
  const [race, setRace] = useState<string | null>(initial?.race ?? null);
  const initialMethod =
    props.pack.attributes.methods.find((item) => item.id === props.chargenMethod) ??
    props.pack.attributes.methods[0];
  const [attributes, setAttributes] = useState<AttributeSet>(
    () => initial?.attributes ?? defaultAttributesForMethod(initialMethod)
  );
  const [age, setAge] = useState<number>(initial?.age ?? 30);
  const [ageInput, setAgeInput] = useState<string>(String(initial?.age ?? 30));
  const [ageAllocation, setAgeAllocation] = useState<Coc7AgeAllocation>(initial?.ageAllocation ?? {});
  const [ageConfirmed, setAgeConfirmed] = useState(initial !== null);
  const [sets, setSets] = useState<AttributeSetOption[]>([]);
  const [selectedSet, setSelectedSet] = useState<number | null>(null);
  const [occupationId, setOccupationId] = useState<string>(initial?.occupationId ?? "");
  const [occupationAdded, setOccupationAdded] = useState<Record<string, number>>(initial?.occupationAdded ?? {});
  const [slotAssignments, setSlotAssignments] = useState<Record<string, string[]>>(initial?.slotAssignments ?? {});
  const [interestAdded, setInterestAdded] = useState<Record<string, number>>(initial?.interestAdded ?? {});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // 第二页（选填）：人物故事 / 财产 / 持有物品
  const [bsAppearance, setBsAppearance] = useState(() => backstoryText(initial, "appearance"));
  const [bsBeliefs, setBsBeliefs] = useState(() => backstoryText(initial, "beliefs"));
  const [bsSignificantPeople, setBsSignificantPeople] = useState(() => backstoryText(initial, "significantPeople"));
  const [bsMeaningfulPlaces, setBsMeaningfulPlaces] = useState(() => backstoryText(initial, "meaningfulPlaces"));
  const [bsTreasuredPossessions, setBsTreasuredPossessions] = useState(() => backstoryText(initial, "treasuredPossessions"));
  const [bsTraits, setBsTraits] = useState(() => backstoryText(initial, "traits"));
  const [bsSecrets, setBsSecrets] = useState(() => backstoryText(initial, "secrets"));
  const [bsScars, setBsScars] = useState(() => backstoryText(initial, "scars"));
  const [bsPhobias, setBsPhobias] = useState(() => backstoryText(initial, "phobias"));
  const [bsExperiences, setBsExperiences] = useState(() => backstoryJson(initial, "experiences"));
  const [bsMythos, setBsMythos] = useState(() => backstoryJson(initial, "mythosExperiences"));
  const [bsCompanions, setBsCompanions] = useState(() => backstoryJson(initial, "companions"));
  const [bsSpells, setBsSpells] = useState(() => backstoryJson(initial, "spellDetails"));
  const [assetFields, setAssetFields] = useState<Record<string, string>>(() => ({
    creditRating: assetText(initial, "creditRating"),
    livingStandard: assetText(initial, "livingStandard"),
    consumption: assetText(initial, "consumption"),
    otherAssetsValue: assetText(initial, "otherAssetsValue"),
    cash: assetText(initial, "cash"),
    cashUnit: assetText(initial, "cashUnit"),
    vehicle: assetText(initial, "vehicle"),
    residence: assetText(initial, "residence"),
    luxury: assetText(initial, "luxury"),
    securities: assetText(initial, "securities"),
    other: assetText(initial, "other")
  }));
  const [items, setItems] = useState<CharacterItemDraft[]>(() => (initial?.items ?? []).map((item) => ({ ...item })));
  const [extraAvailable, setExtraAvailable] = useState<CharacterAvailableCard[]>([]);
  const availableList = [...(props.availableCards ?? []), ...extraAvailable].filter((card) => items.every((item) => item.id !== card.id));
  const editorReturnTo = props.returnTo ?? (isEdit
    ? "/characters/" + String(props.characterId ?? initial?.id ?? "") + "/edit"
    : props.roomId === null
      ? "/characters/new"
      : "/rooms/" + props.roomId + "/characters/new");
  const cardEditHref = (cardId: string): string => "/cards/" + cardId + "/edit?returnTo=" + encodeURIComponent(editorReturnTo);
  const newCardHref = "/cards/new?returnTo=" + encodeURIComponent(editorReturnTo);
  const [skillQuery, setSkillQuery] = useState("");
  const [skillCategory, setSkillCategory] = useState<string>("ALL");
  const [skillIdentityFilters, setSkillIdentityFilters] = useState<("OCCUPATION" | "INTEREST")[]>([]);
  const [skillUsageFilters, setSkillUsageFilters] = useState<("POTENTIAL" | "ALLOCATED")[]>([]);
  const [specialtyBase, setSpecialtyBase] = useState("");
  const [specialtyName, setSpecialtyName] = useState("");

  const compiled = useMemo(() => compileParsedRulePack(props.pack), [props.pack]);
  const isCoc7 = props.system === "COC7";
  const ageAdjustment = useMemo(() => coc7AgeAdjustment(age), [age]);
  const ageCheck = useMemo(() => checkCoc7AgeAllocation(age, ageAllocation), [age, ageAllocation]);
  // 年龄补正只有在玩家一次性确认后才应用到后续计算；未确认前始终保留基础属性。
  const ageAppliedAttributes = useMemo(() => {
    if (isCoc7 === false || ageConfirmed === false || applyAgeAdjustment === false) return attributes;
    return applyCoc7AgeAdjustment(attributes, age, ageAllocation);
  }, [attributes, age, ageAllocation, ageConfirmed, isCoc7, applyAgeAdjustment]);
  const agePreviewAttributes = useMemo(
    () => (isCoc7 ? applyCoc7AgeAdjustment(attributes, age, ageAllocation) : attributes),
    [attributes, age, ageAllocation, isCoc7]
  );

  const method = useMemo(
    () =>
      props.pack.attributes.methods.find((item) => item.id === props.chargenMethod) ??
      props.pack.attributes.methods[0],
    [props.pack, props.chargenMethod]
  );
  const isStarterMode = method?.kind === "FIXED_ARRAY" && isEdit === false;
  const starterSkillOptions = useMemo(
    () => compiled.skills.filter((skill) => skill.id !== "CTHULHU_MYTHOS"),
    [compiled.skills]
  );
  const [starterRows, setStarterRows] = useState<ReadonlyArray<{ skillId: string; value: string }>>(() =>
    Array.from({ length: 8 }, () => ({ skillId: "", value: "" }))
  );
  const [starterCredit, setStarterCredit] = useState("40");
  const [starterInterests, setStarterInterests] = useState<readonly string[]>(["", "", "", ""]);

  const baseOutcome = useMemo(
    () => computeDerived(compiled, { attributes: ageAppliedAttributes, race, skills: { CTHULHU_MYTHOS: 0 } }),
    [compiled, ageAppliedAttributes, race]
  );

  const pointCheck = useMemo(
    () => (isEdit ? null : method?.kind === "POINT_BUY" ? checkPointBuy(method, attributes) : null),
    [isEdit, method, attributes]
  );

  const effectiveVars = baseOutcome.attributes as unknown as Record<string, number>;

  const skillBases = useMemo(() => {
    const map: Record<string, number> = {};
    for (const skill of compiled.skills) {
      map[skill.id] = Math.floor(
        evaluate(skill.base, { vars: effectiveVars, consts: props.pack.const })
      );
    }
    return map;
  }, [compiled, effectiveVars, props.pack.const]);

  // C-3：手工建卡时添加语言 / 科学 / 驾驶 / 生存 / 技艺 / 射击专精。
  // 复合 key（如 LANGUAGE_OTHER#拉丁语）不在规则包技能表里，这里合成展示行，
  // 让它们与普通技能一样参与职业点 / 兴趣点分配与保存。
  const specialtySkills = useMemo(() => {
    const keys = new Set<string>([...Object.keys(occupationAdded), ...Object.keys(interestAdded)]);
    const output: Array<{ id: string; name: string; category: string }> = [];
    for (const id of keys) {
      const hash = id.indexOf("#");
      if (hash <= 0) continue;
      if (compiled.skills.some((skill) => skill.id === id)) continue;
      const baseId = id.slice(0, hash);
      const specialty = id.slice(hash + 1);
      const baseSkill = compiled.skills.find((skill) => skill.id === baseId);
      if (baseSkill === undefined || specialty.trim().length === 0) continue;
      output.push({
        id,
        name: baseSkill.name + "（" + specialty + "）",
        category: baseSkill.category
      });
    }
    return output;
  }, [compiled.skills, interestAdded, occupationAdded]);

  const allSkills = useMemo(
    () => [...compiled.skills, ...specialtySkills],
    [compiled.skills, specialtySkills]
  );

  function skillBaseOf(skillId: string): number {
    const direct = skillBases[skillId];
    if (direct !== undefined) return direct;
    const hash = skillId.indexOf("#");
    if (hash > 0) return skillBases[skillId.slice(0, hash)] ?? 0;
    return 0;
  }

  const specialtyBaseOptions = useMemo(
    () =>
      [
        { label: "外语", baseId: "LANGUAGE_OTHER", placeholder: "拉丁语" },
        { label: "科学", baseId: "SCIENCE", placeholder: "生物学" },
        { label: "驾驶", baseId: "驾驶", placeholder: "汽车" },
        { label: "生存", baseId: "SURVIVAL", placeholder: "沙漠" },
        { label: "技艺", baseId: "ART_CRAFT", placeholder: "摄影" },
        { label: "射击", baseId: "FIREARMS_BOW", placeholder: "弩" }
      ].filter((item) => compiled.skills.some((skill) => skill.id === item.baseId)),
    [compiled.skills]
  );

  const selectedSpecialtyBaseId =
    specialtyBase.length > 0 ? specialtyBase : (specialtyBaseOptions[0]?.baseId ?? "");
  const specialtyNameCandidates = (props.specialtyCandidates ?? []).filter(
    (candidate) => candidate.baseId === selectedSpecialtyBaseId
  );

  const mythosTotal = useMemo(() => {
    const base = skillBases.CTHULHU_MYTHOS ?? 0;
    const raceBonus = baseOutcome.skillBonuses.CTHULHU_MYTHOS ?? 0;
    const allocated = (occupationAdded.CTHULHU_MYTHOS ?? 0) + (interestAdded.CTHULHU_MYTHOS ?? 0);
    return Math.max(0, base + raceBonus + allocated);
  }, [baseOutcome.skillBonuses.CTHULHU_MYTHOS, interestAdded.CTHULHU_MYTHOS, occupationAdded.CTHULHU_MYTHOS, skillBases.CTHULHU_MYTHOS]);

  // 重新计算一次，让 maxSan 读取到当前的 CTHULHU_MYTHOS。
  const outcome = useMemo(
    () => computeDerived(compiled, { attributes: ageAppliedAttributes, race, skills: { CTHULHU_MYTHOS: mythosTotal } }),
    [compiled, ageAppliedAttributes, mythosTotal, race]
  );

  const coc7Extras = useMemo(() => {
    if (isCoc7 === false) return null;
    const attrs = outcome.attributes;
    const build = coc7Build(attrs.str + attrs.siz);
    return {
      build,
      damageBonus: coc7DamageBonusFromBuild(build),
      mov: coc7Movement({ str: attrs.str, siz: attrs.siz, dex: attrs.dex, age }),
      majorWound: coc7MajorWound(outcome.derived.maxHp)
    };
  }, [age, isCoc7, outcome]);

  const selectedOccupation = useMemo(
    () => props.occupations.find((item) => item.id === occupationId) ?? null,
    [props.occupations, occupationId]
  );
  const selectedProfile = selectedOccupation?.skillProfile ?? null;
  const skillNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const skill of compiled.skills) map.set(skill.id, skill.name);
    return map;
  }, [compiled.skills]);

  const accessBySkillId = useMemo(() => {
    const map = new Map<string, OccupationSkillAccess>();
    const all = [...compiled.skills, ...specialtySkills];
    if (selectedOccupation === null) {
      for (const skill of all) map.set(skill.id, { kind: "NONE", group: null });
      return map;
    }
    if (selectedProfile !== null) {
      const occupational = profileOccupationalSkillIds(selectedProfile, slotAssignments);
      for (const skill of all) {
        map.set(
          skill.id,
          occupational.has(skill.id) ? { kind: "FIXED", group: null } : { kind: "NONE", group: null }
        );
      }
      return map;
    }
    for (const skill of all) {
      map.set(skill.id, occupationSkillAccess(selectedOccupation, skill.name));
    }
    return map;
  }, [compiled.skills, specialtySkills, selectedOccupation, selectedProfile, slotAssignments]);

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
  const creditRatingValue =
    (skillBases.CREDIT_RATING ?? 0) +
    (occupationAdded.CREDIT_RATING ?? 0) +
    (interestAdded.CREDIT_RATING ?? 0);
  const creditIssue =
    selectedOccupation === null ||
    (selectedOccupation.creditMin === null && selectedOccupation.creditMax === null)
      ? null
      : creditRatingValue < (selectedOccupation.creditMin ?? 0) ||
          creditRatingValue > (selectedOccupation.creditMax ?? 99)
        ? "信用评级必须在 " + (selectedOccupation.creditMin ?? 0) + "~" + (selectedOccupation.creditMax ?? 99) + " 之间（当前 " + creditRatingValue + "）"
        : null;
  const remainingOccupationPoints = Math.max(0, skillPool.occupation - usedOccupationPoints);
  const remainingInterestPoints = Math.max(0, skillPool.interest - usedInterestPoints);

  const filteredSkills = useMemo(() => {
    const query = skillQuery.trim().toLowerCase();
    return allSkills.filter((skill) => {
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
      // 只有职业数据明确指定的固定本职，或用户自己投入职业点选中的技能，才算本职；
      // 其余（包括还没选中的可选本职）一律按兴趣技能分类。
      const isOccupational = isActualOccupationSkill({ access, occupation });
      const isInterest = isOccupational === false;
      const isPotential = access.kind !== "NONE";
      const isAllocated = occupation > 0 || interest > 0;

      if (skillIdentityFilters.length > 0) {
        const identityMatched =
          (skillIdentityFilters.includes("OCCUPATION") && isOccupational) ||
          (skillIdentityFilters.includes("INTEREST") && isInterest);
        if (identityMatched === false) return false;
      }

      if (skillUsageFilters.length > 0) {
        const usageMatched =
          (skillUsageFilters.includes("POTENTIAL") && isPotential) ||
          (skillUsageFilters.includes("ALLOCATED") && isAllocated);
        if (usageMatched === false) return false;
      }

      return true;
    });
  }, [
    accessBySkillId,
    allSkills,
    interestAdded,
    occupationAdded,
    skillCategory,
    skillIdentityFilters,
    skillQuery,
    skillUsageFilters
  ]);

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
  const canRoll = isEdit ? false : method?.kind === "ROLL_SETS";
  const rolled = sets.length > 0;
  const attributesValid = (isEdit ? true : canRoll ? selectedSet !== null : pointCheck === null || pointCheck.valid) && (isCoc7 === false || ageConfirmed);
  const derivedReady = canRoll ? selectedSet !== null : true;

  function updateAttribute(key: AttributeKey, value: number): void {
    const numeric = Math.floor(Number(value));
    if (Number.isFinite(numeric) === false) return;
    setAttributes((prev) => ({
      ...prev,
      [key]: Math.max(props.pack.attributes.min, Math.min(props.pack.attributes.max, numeric))
    }) as AttributeSet);
  }

  function changeAgeInput(raw: string): void {
    setAgeInput(raw);
    // 只在输入已经是 15~90 的合法整数时提交；否则保留原年龄，避免输入 3 / 30 的过程中被直接夹到 15。
    const numeric = Number(raw);
    if (raw.trim().length === 0 || Number.isFinite(numeric) === false) return;
    const next = Math.floor(numeric);
    if (next < 15 || next > 90) return;
    setAge(next);
    setAgeAllocation({});
    setAgeConfirmed(false);
    setMessage(null);
  }

  function commitAgeInput(): void {
    const numeric = Number(ageInput);
    if (ageInput.trim().length === 0 || Number.isFinite(numeric) === false) {
      setAgeInput(String(age));
      return;
    }
    const next = Math.max(15, Math.min(90, Math.floor(numeric)));
    setAgeInput(String(next));
    setAge(next);
    setAgeAllocation({});
    setAgeConfirmed(false);
  }

  function setAgeDeduction(key: Coc7PhysicalAttribute, value: number): void {
    const numeric = Math.max(0, Math.floor(Number(value) || 0));
    setAgeAllocation((prev) => {
      const copy = { ...prev };
      if (numeric > 0) copy[key] = numeric;
      else delete copy[key];
      return copy;
    });
    setAgeConfirmed(false);
  }

  function rollDestiny(): void {
    if (method?.kind !== "ROLL_SETS") return;
    if (sets.length > 0) return;
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
    // 有结构化空位的职业：只有固定本职和已放入空位的技能才可加职业点。
    if (selectedProfile !== null) return false;
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
      const capLimit = Math.max(0, skillPool.occupationMax - skillBaseOf(skillId));
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
      const capLimit = Math.max(0, skillPool.interestMax - skillBaseOf(skillId));
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

  /** C-3：把「外语（X）」这类专精加入分配表，后续可按普通技能加点。 */
  function addSpecialty(): void {
    const base = specialtyBase.length > 0 ? specialtyBase : specialtyBaseOptions[0]?.baseId ?? "";
    const inner = specialtyName.trim().slice(0, 40);
    if (base.length === 0) {
      setMessage("当前规则包没有可添加专精的基础技能。");
      return;
    }
    if (inner.length === 0) {
      setMessage("请填写专精名称，例如 拉丁语 / 生物学 / 沙漠。");
      return;
    }
    const key = base + "#" + inner;
    if (compiled.skills.some((skill) => skill.id === key)) {
      setMessage("该专精已作为独立技能存在，无需重复添加。");
      return;
    }
    if (occupationAdded[key] === undefined && interestAdded[key] === undefined) {
      setInterestAdded((prev) => ({ ...prev, [key]: 0 }));
    }
    setSpecialtyName("");
    setMessage(null);
  }

  function changeOccupation(nextId: string): void {
    setOccupationId(nextId);
    setOccupationAdded({});
    setSlotAssignments({});
    setMessage(null);
    const nextOccupation = props.occupations.find((item) => item.id === nextId) ?? null;
    if (nextOccupation === null) return;
    // 新职业固定为本职的技能不能再保留兴趣点；其余“可选本职”保持“先填哪边算哪类”。
    setInterestAdded((prev) => {
      const copy = { ...prev };
      const profile = nextOccupation.skillProfile;
      if (profile !== null) {
        for (const item of profile.fixed) delete copy[item.skillId];
      } else {
        for (const skill of compiled.skills) {
          const access = occupationSkillAccess(nextOccupation, skill.name);
          if (access.kind === "FIXED") delete copy[skill.id];
        }
      }
      return copy;
    });
  }

  function applySlotAssignment(slotId: string, pickIndex: number, skillId: string): void {
    const profile = selectedProfile;
    if (profile === null) return;
    const slot = profile.slots.find((item) => item.id === slotId);
    if (slot === undefined) return;
    const current = [...(slotAssignments[slotId] ?? [])];
    while (current.length < slot.pick) current.push("");
    current[pickIndex] = skillId;
    const next = { ...slotAssignments, [slotId]: current.slice(0, slot.pick) };
    setSlotAssignments(next);

    // 取消空位后，该技能不能再吃职业点；放入空位后，该技能不能再吃兴趣点。
    const occupational = profileOccupationalSkillIds(profile, next);
    setOccupationAdded((prev) => {
      const copy = { ...prev };
      for (const id of Object.keys(copy)) {
        if (occupational.has(id) === false) delete copy[id];
      }
      return copy;
    });
    setInterestAdded((prev) => {
      const copy = { ...prev };
      for (const id of occupational) delete copy[id];
      return copy;
    });
    setMessage(null);
  }

  function starterError(): string | null {
    if (method?.kind !== "FIXED_ARRAY") return null;
    if (name.trim().length === 0) return "角色名不能为空。";
    const skillIds = starterRows.map((row) => row.skillId.trim());
    if (skillIds.some((id) => id.length === 0)) return "请为八项本职技能选择技能。";
    if (new Set(skillIds).size !== 8) return "八项本职技能不能重复。";
    if (skillIds.includes("CTHULHU_MYTHOS")) return "创建角色时不能选择克苏鲁神话。";
    const values = starterRows.map((row) => Math.floor(Number(row.value)));
    if (values.some((value) => Number.isFinite(value) === false || value <= 0)) return "请为八项本职技能填写九值中的最终数值。";
    const credit = Math.floor(Number(starterCredit));
    if (Number.isFinite(credit) === false || credit <= 0) return "信用评级需要填写九值中的一个数值。";
    const allValues = [...values, credit].sort((a, b) => a - b).join(",");
    const starterConfig = props.pack.chargen.starter;
    const expectedValues = starterConfig?.skillValues ?? [70, 60, 60, 50, 50, 50, 40, 40, 40];
    if (allValues !== [...expectedValues].sort((a, b) => a - b).join(",")) {
      return "九项技能值必须恰好是 " + expectedValues.join("/") + " 这九个数字。";
    }
    const interests = starterInterests.map((id) => id.trim()).filter((id) => id.length > 0);
    const expectedInterestCount = starterConfig?.interestCount ?? 4;
    if (interests.length !== expectedInterestCount) return "请恰好选择 " + expectedInterestCount + " 项个人兴趣技能。";
    if (new Set(interests).size !== interests.length) return "个人兴趣技能不能重复。";
    for (const id of interests) {
      if (skillIds.includes(id)) return "本职技能不能同时作为个人兴趣技能：" + id;
      if (id === "CREDIT_RATING" || id === "CTHULHU_MYTHOS") return "该技能不能作为个人兴趣技能：" + id;
    }
    const expectedAttributes = [...method.values].sort((a, b) => a - b).join(",");
    const actualAttributes = (["str", "con", "siz", "dex", "app", "int", "pow", "edu"] as const)
      .map((key) => attributes[key])
      .sort((a, b) => a - b)
      .join(",");
    if (expectedAttributes !== actualAttributes) {
      return "请把 " + method.values.join("/") + " 恰好分配到八项属性。";
    }
    return null;
  }

  function step1Error(): string | null {
    if (isStarterMode && isEdit === false) return starterError();
    if (isEdit) {
      if (name.trim().length === 0) return "角色名不能为空。";
      return creditIssue;
    }
    if (isCoc7 && ageConfirmed === false) return "请先完成并确认年龄补正。";
    if (creditIssue !== null) return creditIssue;
    if (name.trim().length === 0) return "角色名不能为空。";
    return null;
  }

  function goStep2(): void {
    const error = step1Error();
    if (error !== null) {
      setMessage(error);
      return;
    }
    setMessage(null);
    setStep(2);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function parseJsonArray(value: string): unknown[] {
    const text = value.trim();
    if (text.length === 0) return [];
    try {
      const parsed: unknown = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function collectBackstory(): Record<string, unknown> {
    const spellDetails = parseJsonArray(bsSpells);
    return {
      appearance: bsAppearance.trim() || null,
      beliefs: bsBeliefs.trim() || null,
      significantPeople: bsSignificantPeople.trim() || null,
      meaningfulPlaces: bsMeaningfulPlaces.trim() || null,
      treasuredPossessions: bsTreasuredPossessions.trim() || null,
      traits: bsTraits.trim() || null,
      secrets: bsSecrets.trim() || null,
      scars: bsScars.trim() || null,
      phobias: bsPhobias.trim() || null,
      experiences: parseJsonArray(bsExperiences),
      mythosExperiences: parseJsonArray(bsMythos),
      companions: parseJsonArray(bsCompanions),
      spellDetails,
      spells: spellDetails
        .map((item) => (item !== null && typeof item === "object" ? (item as { name?: unknown }).name : undefined))
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    };
  }

  function collectAssets(): Record<string, unknown> {
    const output: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(assetFields)) {
      const trimmed = value.trim();
      if (trimmed.length === 0) continue;
      output[key] = key === "cash" ? Number(trimmed) : trimmed;
    }
    return output;
  }

  function itemEffects(item: CharacterItemDraft): unknown[] {
    return Array.isArray(item.stats.effects) ? item.stats.effects : [];
  }

  function effectSummary(item: CharacterItemDraft): string {
    return itemEffects(item)
      .map((effect) => {
        if (effect === null || typeof effect !== "object") return "";
        const record = effect as Record<string, unknown>;
        const type = typeof record.type === "string" ? record.type : "";
        const amount = record.amount === undefined ? "" : String(record.amount);
        return amount.length === 0 ? type : type + " " + amount;
      })
      .filter((text) => text.length > 0)
      .join(" + ");
  }

  function addAvailableCard(card: CharacterAvailableCard): void {
    setItems((current) => [
      ...current,
      {
        id: card.id,
        kind: card.kind,
        name: card.name,
        subtitle: card.subtitle ?? null,
        description: null,
        stats: card.stats,
        scope: card.scope
      }
    ]);
  }

  function removeItem(index: number): void {
    setItems((current) => {
      const removed = current[index];
      if (removed !== undefined && removed.scope === "COMPENDIUM" && removed.id !== undefined) {
        setExtraAvailable((list) =>
          list.some((card) => card.id === removed.id)
            ? list
            : [...list, { id: removed.id as string, kind: removed.kind, name: removed.name, subtitle: removed.subtitle ?? null, stats: removed.stats, scope: removed.scope }]
        );
      }
      return current.filter((_item, i) => i !== index);
    });
  }

  async function submit(): Promise<void> {
    const error = step1Error();
    if (error !== null) {
      setMessage(error);
      setStep(1);
      return;
    }
    setBusy(true);
    setMessage(null);

    const skills: Record<string, number> = {};
    let starterSkillsPayload:
      | { readonly values: Record<string, number>; readonly interests: readonly string[] }
      | null = null;
    if (isStarterMode && isEdit === false) {
      for (const row of starterRows) {
        const skillId = row.skillId.trim();
        const value = Math.floor(Number(row.value));
        if (skillId.length > 0 && Number.isFinite(value) && value > 0) skills[skillId] = value;
      }
      const credit = Math.floor(Number(starterCredit));
      if (Number.isFinite(credit) && credit > 0) skills.CREDIT_RATING = credit;
      const interests = starterInterests.map((id) => id.trim()).filter((id) => id.length > 0);
      const interestBonus = props.pack.chargen.starter?.interestBonus ?? 20;
      for (const skillId of interests) {
        skills[skillId] = skillBaseOf(skillId) + interestBonus;
      }
      starterSkillsPayload = {
        values: {
          ...Object.fromEntries(
            starterRows
              .map((row) => [row.skillId.trim(), Math.floor(Number(row.value))] as const)
              .filter(([skillId, value]) => skillId.length > 0 && Number.isFinite(value))
          ),
          ...(Number.isFinite(credit) && credit > 0 ? { CREDIT_RATING: credit } : {})
        },
        interests
      };
    } else {
      for (const skill of allSkills) {
        const total = skillBaseOf(skill.id) + (occupationAdded[skill.id] ?? 0) + (interestAdded[skill.id] ?? 0);
        if (total > 0) skills[skill.id] = total;
      }
    }

    const payload = {
      roomId: props.roomId,
      system: props.system,
      name,
      race,
      attributes: attributes as unknown as Record<string, number>,
      skills,
      chargenMethod: method?.id ?? "",
      occupationId: isStarterMode ? null : selectedOccupation?.id ?? null,
      skillAllocation:
        isStarterMode && isEdit === false
          ? null
          : {
              occupation: occupationAdded,
              interest: interestAdded,
              slots: selectedProfile === null ? undefined : slotAssignments
            },
      slotAssignments: isStarterMode ? null : selectedProfile === null ? null : slotAssignments,
      starterSkills: starterSkillsPayload,
      era: props.era,
      age: isCoc7 ? age : null,
      ageAllocation: isCoc7 ? ageAllocation : null,
      profile: {
        playerName: playerName.trim() || null,
        gender: gender.trim() || null,
        residence: residence.trim() || null
      },
      backstory: collectBackstory(),
      assets: collectAssets(),
      items: items
        .filter((item) => item.id !== undefined && item.id.length > 0)
        .map((item) => ({
          id: item.id as string,
          kind: item.kind,
          name: item.name,
          subtitle: item.subtitle ?? null,
          description: item.description ?? null,
          stats: item.stats
        }))
    };

    const result: SaveCharacterResult = isEdit && props.characterId !== undefined
      ? await updateCharacterAction({ ...payload, characterId: props.characterId })
      : await saveCharacter(payload);

    setBusy(false);
    if (result.ok === false) {
      setMessage(result.error ?? "保存失败");
      return;
    }
    if (isEdit && props.characterId !== undefined) {
      router.push("/characters/" + props.characterId);
    } else {
      router.push(props.roomId === null ? "/characters" : "/rooms/" + props.roomId);
    }
    router.refresh();
  }

  const choiceLimits = selectedOccupation === null ? null : occupationChoiceLimits(selectedOccupation);
  const choiceCounts = currentChoiceCounts();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className={step === 1 ? "rounded-lg bg-sakura-500 px-3 py-1.5 font-medium text-white" : "rounded-lg border border-white/15 px-3 py-1.5 text-white/50"}>
          角色基本属性与技能
        </span>
        <span className="text-white/30">→</span>
        <span className={step === 2 ? "rounded-lg bg-sakura-500 px-3 py-1.5 font-medium text-white" : "rounded-lg border border-white/15 px-3 py-1.5 text-white/50"}>
          人物故事 / 财产 / 持有物
        </span>
      </div>
      {step === 1 ? (
        <>
      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <h2 className="text-sm font-medium text-white/80">基本信息</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-white/50">角色名</span>
            <input value={name} onChange={(event) => setName(event.target.value)} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-white/50">玩家名</span>
            <input value={playerName} onChange={(event) => setPlayerName(event.target.value)} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-white/50">性别</span>
            <input value={gender} onChange={(event) => setGender(event.target.value)} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-white/50">住地</span>
            <input value={residence} onChange={(event) => setResidence(event.target.value)} className={inputClass} />
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
                {selectedOccupation.creditMin === null && selectedOccupation.creditMax === null ? null : (
                  <p className={"mt-1 text-[11px] " + (creditIssue === null ? "text-emerald-300/80" : "text-amber-300")}>
                    信用评级范围 {selectedOccupation.creditText ?? (selectedOccupation.creditMin ?? 0) + "-" + (selectedOccupation.creditMax ?? 99)}
                    {" · 当前 " + creditRatingValue}
                    {creditIssue === null ? "" : "（未满足，保存前必须调整）"}
                  </p>
                )}
                {selectedProfile === null ? (
                  <>
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
                      <p className="mt-1 text-[10px] text-amber-300/80">含自选技能位，请按 KP 要求分配。</p>
                    ) : null}
                  </>
                ) : (
                  <div className="mt-3 rounded-lg border border-sakura-500/25 bg-sakura-500/5 p-3">
                    <p className="text-[11px] font-medium text-sakura-200">
                      先选择技能才能使用职业点；未选择则按兴趣点计算。
                    </p>
                    {selectedProfile.fixed.length === 0 ? null : (
                      <p className="mt-1 text-[10px] leading-relaxed text-white/45">
                        固定本职：{selectedProfile.fixed.map((item) => skillNameById.get(item.skillId) ?? item.label).join("、")}
                      </p>
                    )}
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {selectedProfile.slots.map((slot) => {
                        const picks = slotAssignments[slot.id] ?? [];
                        const candidates = occupationSlotCandidates(slot, compiled.skills.map((skill) => skill.id));
                        const pickedCount = picks.filter((id) => typeof id === "string" && id.length > 0).length;
                        const slotLabel =
                          slot.kind === "FREE"
                            ? "任意特长"
                            : slot.kind === "SOCIAL"
                              ? slot.symbol + " 社交技能"
                              : slot.kind === "MULTI"
                                ? slot.symbol + " 多选"
                                : slot.symbol + " 二选一";
                        return (
                          <div
                            key={slot.id}
                            className="rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2.5"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-xs text-white/70">{slotLabel}</p>
                              <span className="font-mono text-[10px] text-white/40">
                                {pickedCount}/{slot.pick}
                              </span>
                            </div>
                            <div className="mt-2 space-y-1.5">
                              {Array.from({ length: slot.pick }).map((_, pickIndex) => (
                                <select
                                  key={pickIndex}
                                  value={picks[pickIndex] ?? ""}
                                  onChange={(event) => applySlotAssignment(slot.id, pickIndex, event.target.value)}
                                  className="h-9 w-full rounded-lg border border-white/15 bg-ink-900 px-2 text-xs text-white/80 outline-none focus:border-sakura-500"
                                >
                                  <option value="">（未选择）</option>
                                  {candidates.map((candidate) => (
                                    <option key={candidate.skillId} value={candidate.skillId}>
                                      {skillNameById.get(candidate.skillId) ?? candidate.label}
                                    </option>
                                  ))}
                                </select>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-white/80">
              属性 · {method?.label ?? "未知方式"}
            </h2>
            <p className="mt-1 text-[11px] text-white/40">
              {canRoll
                ? "每组只能掷一次；从 5 组结果中选择 1 组，不可手动修改。"
                : method?.kind === "POINT_BUY"
                  ? "直接填写九维属性，系统会校验总和与范围。"
                  : method?.kind === "FIXED_ARRAY"
                    ? "把固定数组 " + method.values.join("/") + " 恰好分配到八项；幸运单独掷 3D6×5。"
                    : "直接填写九维属性。"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {pointCheck === null ? null : (
              <span
                className={
                  "rounded-full border px-3 py-1 font-mono text-xs " +
                  (pointCheck.valid
                    ? "border-emerald-400/40 text-emerald-300"
                    : "border-amber-400/40 text-amber-300")
                }
              >
                已用 {pointCheck.total} ·{" "}
                {pointCheck.remaining === 0
                  ? "已满"
                  : pointCheck.remaining > 0
                    ? "剩余 " + pointCheck.remaining
                    : "超出 " + Math.abs(pointCheck.remaining)}
              </span>
            )}
            {canRoll ? (
              <button
                type="button"
                disabled={rolled}
                onClick={rollDestiny}
                className="rounded-lg bg-sakura-500 px-4 py-2 text-xs font-medium text-white transition hover:bg-sakura-400 disabled:cursor-not-allowed disabled:bg-white/15 disabled:text-white/35"
              >
                {rolled ? "已掷完（只能掷一次）" : "掷 5 组"}
              </button>
            ) : method?.kind === "FIXED_ARRAY" ? (
              <button
                type="button"
                onClick={() => {
                  const next: Record<string, number> = { ...attributes };
                  method.values.forEach((value, index) => {
                    const key = ATTRIBUTE_KEYS[index];
                    if (key !== undefined) next[key] = value;
                  });
                  setAttributes(next as unknown as AttributeSet);
                }}
                className="rounded-lg border border-sakura-500/40 px-3 py-2 text-xs text-sakura-300 transition hover:bg-sakura-500/10"
              >
                按顺序填入固定数组
              </button>
            ) : null}
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {ATTRIBUTE_KEYS.map((key) => {
            const raw = attributes[key];
            const effective = outcome.attributes[key];
            // 属性始终可直接编辑：掷骰 / 点购只是辅助，不再锁定输入。
            const editable = true;
            return (
              <div key={key} className="rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2">
                <p className="text-xs text-white/50">{ATTRIBUTE_LABELS[key]}</p>
                <div className="mt-2">
                  {editable ? (
                    <input
                      name={"attr_" + key}
                      type="number"
                      min={method?.kind === "POINT_BUY" ? method.perAttributeMin : props.pack.attributes.min}
                      max={method?.kind === "POINT_BUY" ? method.perAttributeMax : props.pack.attributes.max}
                      value={raw}
                      onChange={(event) => updateAttribute(key, Number(event.target.value) || 0)}
                      className="h-11 w-full rounded-lg border border-white/20 bg-ink-900 px-2 text-center font-mono text-lg font-semibold text-white outline-none focus:border-sakura-500"
                    />
                  ) : (
                    <div className="flex h-11 items-center justify-center rounded-lg border border-white/10 bg-black/20 font-mono text-lg font-semibold text-white/80">
                      {rolled && selectedSet !== null ? raw : "—"}
                    </div>
                  )}
                  <p className="mt-1 text-center font-mono text-[10px] text-white/35">
                    困难 {Math.floor(raw / 2)} · 极限 {Math.floor(raw / 5)}
                  </p>
                </div>
                {canRoll && rolled === false ? null : effective === raw ? null : (
                  <p className="mt-1 text-[11px] text-sakura-300">年龄 / 种族修正后 {effective}</p>
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

        {canRoll && rolled === false ? (
          <p className="mt-3 rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
            掷出 5 组属性后，点击「选用」锁定一组。
          </p>
        ) : null}

        {rolled === false ? null : (
          <div className="mt-5 overflow-x-auto">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-xs text-white/55">
                {selectedSet === null ? "请从以下 5 组中选择 1 组：" : "已选择第 " + (selectedSet + 1) + " 组；可重新选择其他组。"}
              </p>
            </div>
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
                      <td key={key} className="py-1.5 text-center font-mono text-white/75">
                        {option.attributes[key]}
                      </td>
                    ))}
                    <td className="py-1.5 text-right font-mono text-white/50">{option.total}</td>
                    <td className="py-1.5 pl-3 text-right">
                      <button
                        type="button"
                        onClick={() => pickSet(option.index)}
                        className={
                          "rounded-md border px-2 py-1 text-[11px] transition " +
                          (selectedSet === option.index
                            ? "border-emerald-400/50 bg-emerald-400/10 text-emerald-300"
                            : "border-sakura-500/40 text-sakura-400 hover:bg-sakura-500/10")
                        }
                      >
                        {selectedSet === option.index ? "已选用" : "选用"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {isCoc7 ? (
        <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-sm font-medium text-white/80">年龄补正</h2>
              <p className="mt-1 text-[11px] text-white/40">按规则分配扣减；改年龄可重新分配。</p>
            </div>
            <label className="flex items-center gap-2">
              <span className="text-xs text-white/50">年龄</span>
              <input
                type="number"
                min={15}
                max={90}
                value={ageInput}
                disabled={ageConfirmed}
                onChange={(event) => changeAgeInput(event.target.value)}
                onBlur={commitAgeInput}
                className="h-10 w-24 rounded-lg border border-white/20 bg-ink-900 px-2 text-center font-mono text-sm text-white outline-none focus:border-sakura-500 disabled:opacity-60"
              />
            </label>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2">
              <p className="text-[11px] text-white/40">玩家分配扣减</p>
              <p className="mt-1 font-mono text-lg text-white/85">
                {ageCheck.total} / {ageCheck.expected}
              </p>
              <p className="mt-0.5 text-[10px] text-white/35">
                {ageAdjustment.deductionAttributes.length === 0
                  ? "本年龄段无属性扣减"
                  : "可扣：" + ageAdjustment.deductionAttributes.map((key) => ATTRIBUTE_LABELS[key]).join(" / ")}
              </p>
            </div>
            <div className="rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2">
              <p className="text-[11px] text-white/40">系统自动执行</p>
              <p className="mt-1 text-xs leading-relaxed text-white/75">
                APP {ageAdjustment.appPenalty > 0 ? "-" + ageAdjustment.appPenalty : "不变"} · EDU{" "}
                {ageAdjustment.eduPenalty > 0 ? "-" + ageAdjustment.eduPenalty : ageAdjustment.eduChecks + " 次成长判定"} · MOV{" "}
                {ageAdjustment.movePenalty > 0 ? "-" + ageAdjustment.movePenalty : "不变"}
                {ageAdjustment.luckRolls > 1 ? " · 幸运掷两次取高" : ""}
              </p>
            </div>
            <div className="rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2">
              <p className="text-[11px] text-white/40">年龄修正后预览</p>
              <p className="mt-1 text-xs leading-relaxed text-white/60">
                {(["str", "con", "siz", "dex", "app", "edu"] as AttributeKey[]).map((key) => {
                  const before = attributes[key];
                  const after = agePreviewAttributes[key];
                  return (
                    <span key={key} className="mr-2 font-mono">
                      {key.toUpperCase()} {before}
                      {after === before ? "" : "→" + after}
                    </span>
                  );
                })}
              </p>
            </div>
          </div>

          {ageAdjustment.deductionTotal > 0 ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {ageAdjustment.deductionAttributes.map((key) => (
                <label
                  key={key}
                  className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2"
                >
                  <span className="text-xs text-white/60">{ATTRIBUTE_LABELS[key]}</span>
                  <input
                    type="number"
                    min={0}
                    max={99}
                    value={ageAllocation[key] ?? 0}
                    disabled={ageConfirmed}
                    onChange={(event) => setAgeDeduction(key, Number(event.target.value))}
                    className="h-9 w-20 rounded-lg border border-white/20 bg-ink-900 px-2 text-center font-mono text-sm text-white outline-none focus:border-sakura-500 disabled:opacity-60"
                  />
                </label>
              ))}
            </div>
          ) : null}

          {ageCheck.ok === false && ageAdjustment.deductionTotal > 0 ? (
            <p className="mt-2 text-[11px] text-amber-300">{ageCheck.errors.join("；")}</p>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {ageConfirmed ? (
              <>
                <span className="rounded-lg border border-emerald-400/40 bg-emerald-400/10 px-3 py-1.5 text-xs text-emerald-300">
                  年龄补正已确认并锁定。
                </span>
                <button
                  type="button"
                  onClick={() => setAgeConfirmed(false)}
                  className="rounded-lg border border-white/20 px-3 py-1.5 text-xs text-white/60 transition hover:text-white"
                >
                  重新分配
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={ageCheck.ok === false}
                onClick={() => setAgeConfirmed(true)}
                className="rounded-lg bg-sakura-500 px-4 py-2 text-xs font-medium text-white transition hover:bg-sakura-400 disabled:cursor-not-allowed disabled:bg-white/15 disabled:text-white/35"
              >
                {ageAdjustment.deductionTotal > 0 ? "确认年龄扣减分配" : "确认年龄补正（无属性扣减）"}
              </button>
            )}
          </div>
        </section>
      ) : null}

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <h2 className="text-sm font-medium text-white/80">衍生属性</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          {(["maxHp", "maxMp", "maxSan", "maxDp"] as const).map((key) => (
            <div
              key={key}
              className="rounded-lg border border-spirit-400/20 bg-spirit-400/5 px-3 py-3 text-center"
            >
              <p className="text-xs text-white/40">{DERIVED_LABELS[key]}</p>
              <p className="mt-1 text-2xl font-semibold text-spirit-400">
                {derivedReady ? outcome.derived[key] : "—"}
              </p>
            </div>
          ))}
        </div>
        {coc7Extras === null ? null : (
          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            {[
              ["伤害加值 DB", coc7Extras.damageBonus],
              ["体格 Build", (coc7Extras.build > 0 ? "+" : "") + coc7Extras.build],
              ["移动力 MOV", String(coc7Extras.mov)],
              ["重伤值", String(coc7Extras.majorWound)]
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-3 text-center"
              >
                <p className="text-xs text-white/40">{label}</p>
                <p className="mt-1 text-xl font-semibold text-amber-300">{derivedReady ? value : "—"}</p>
              </div>
            ))}
          </div>
        )}
        {outcome.flags.length === 0 ? null : (
          <p className="mt-3 text-[11px] text-white/35">
            种族特性：{outcome.flags.join(" · ")}
          </p>
        )}
      </section>

      {isStarterMode ? (
        <section className="rounded-xl border border-sakura-500/25 bg-sakura-500/5 p-5">
          <h2 className="text-base font-semibold text-white/90">入门版固定技能分配</h2>
          <p className="mt-1 text-[11px] text-white/45">
            把 {props.pack.chargen.starter?.skillValues.join("/") ?? "70/60/60/50/50/50/40/40/40"} 九值分配给八项本职与信用评级；结果忽略人物卡基础值。
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {starterRows.map((row, index) => (
              <div key={index} className="grid grid-cols-[1fr_92px] gap-2">
                <select
                  value={row.skillId}
                  onChange={(event) =>
                    setStarterRows((prev) =>
                      prev.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, skillId: event.target.value } : item
                      )
                    )
                  }
                  className={inputClass}
                >
                  <option value="">选择本职技能</option>
                  {starterSkillOptions.map((skill) => (
                    <option key={skill.id} value={skill.id}>{skill.name}</option>
                  ))}
                </select>
                <input
                  type="number"
                  value={row.value}
                  onChange={(event) =>
                    setStarterRows((prev) =>
                      prev.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, value: event.target.value } : item
                      )
                    )
                  }
                  placeholder="最终值"
                  className={inputClass + " font-mono"}
                />
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs text-white/55">信用评级</span>
            <input
              type="number"
              value={starterCredit}
              onChange={(event) => setStarterCredit(event.target.value)}
              className={inputClass + " max-w-[120px] font-mono"}
            />
          </div>
          <div className="mt-4">
            <p className="text-xs text-white/55">
              个人兴趣技能（每项基础 +{props.pack.chargen.starter?.interestBonus ?? 20}）
            </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {Array.from({ length: props.pack.chargen.starter?.interestCount ?? 4 }).map((_item, index) => (
                <select
                  key={index}
                  value={starterInterests[index] ?? ""}
                  onChange={(event) =>
                    setStarterInterests((prev) =>
                      prev.map((item, itemIndex) => (itemIndex === index ? event.target.value : item))
                    )
                  }
                  className={inputClass}
                >
                  <option value="">选择兴趣技能</option>
                  {starterSkillOptions
                    .filter((skill) => skill.id !== "CREDIT_RATING" && starterRows.every((row) => row.skillId !== skill.id))
                    .map((skill) => (
                      <option key={skill.id} value={skill.id}>{skill.name}</option>
                    ))}
                </select>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <section className={"rounded-xl border border-white/10 bg-ink-800/50 p-5" + (isStarterMode ? " hidden" : "")}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-[260px] flex-1">
            <h2 className="text-base font-semibold text-white/90">技能分配</h2>
            <p className="mt-1 text-[11px] text-white/40">本职技能用职业点，其余用兴趣点；同一技能不能混用。</p>
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
            尚未选择职业，当前只能使用兴趣点。
          </p>
        ) : null}

        {specialtyBaseOptions.length === 0 ? null : (
          <div className="mt-4 flex flex-wrap items-end gap-2 rounded-xl border border-spirit-400/25 bg-spirit-400/5 p-3">
            <div className="min-w-[180px]">
              <p className="text-[11px] font-medium text-spirit-200">添加专精（外语 / 科学 / 驾驶 / 生存 / 技艺 / 射击）</p>
              <p className="mt-0.5 text-[10px] text-white/40">以复合 key 保存，例如 外语（拉丁语）→ LANGUAGE_OTHER#拉丁语；添加后在下方按兴趣点分配。</p>
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-white/35">基础技能</span>
              <select
                value={selectedSpecialtyBaseId}
                onChange={(event) => setSpecialtyBase(event.target.value)}
                className={inputClass}
              >
                {specialtyBaseOptions.map((option) => (
                  <option key={option.baseId} value={option.baseId}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-white/35">专精名称</span>
              <input
                value={specialtyName}
                onChange={(event) => setSpecialtyName(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") addSpecialty(); }}
                list={specialtyNameCandidates.length > 0 ? "specialty-name-candidates" : undefined}
                placeholder={specialtyBaseOptions.find((option) => option.baseId === selectedSpecialtyBaseId)?.placeholder ?? "专精"}
                className={inputClass + " w-44"}
              />
              <datalist id="specialty-name-candidates">
                {specialtyNameCandidates.map((candidate) => (
                  <option key={candidate.baseId + "#" + candidate.name} value={candidate.name} />
                ))}
              </datalist>
            </label>
            <button
              type="button"
              onClick={addSpecialty}
              className="rounded-lg border border-spirit-400/40 px-4 py-2 text-xs text-spirit-200 transition hover:bg-spirit-400/10"
            >
              添加专精
            </button>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-ink-900/60 p-3">
          <input
            value={skillQuery}
            onChange={(event) => setSkillQuery(event.target.value)}
            placeholder="搜索技能"
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
            <span className="px-1.5 text-[10px] text-white/30">用途</span>
            {([
              ["POTENTIAL", "可选本职"],
              ["ALLOCATED", "已加点"]
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setSkillUsageFilters((prev) => toggleArrayValue(prev, value))}
                className={
                  "rounded-md px-2.5 py-1 text-[11px] transition " +
                  (skillUsageFilters.includes(value) ? "bg-white/15 text-white" : "text-white/45 hover:text-white/80")
                }
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-black/20 p-1">
            <span className="px-1.5 text-[10px] text-white/30">类型</span>
            {([
              ["OCCUPATION", "本职"],
              ["INTEREST", "兴趣"]
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setSkillIdentityFilters((prev) => toggleArrayValue(prev, value))}
                className={
                  "rounded-md px-2.5 py-1 text-[11px] transition " +
                  (skillIdentityFilters.includes(value) ? "bg-white/15 text-white" : "text-white/45 hover:text-white/80")
                }
              >
                {label}
              </button>
            ))}
          </div>
          {skillIdentityFilters.length + skillUsageFilters.length === 0 ? null : (
            <button
              type="button"
              onClick={() => {
                setSkillIdentityFilters([]);
                setSkillUsageFilters([]);
              }}
              className="rounded-md border border-white/15 px-2.5 py-1 text-[11px] text-white/45 transition hover:text-white"
            >
              清空筛选
            </button>
          )}
          <span className="ml-auto font-mono text-[11px] text-white/35">
            {filteredSkills.length} / {allSkills.length} 项
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
                  const base = skillBaseOf(skill.id);
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
                    <div key={skill.id} data-skill-id={skill.id} className="rounded-xl border border-white/10 bg-ink-900/70 p-3">
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
                          <p className="mt-0.5 text-xs text-white/55">
                            基础 <span className="font-mono text-white/75">{base}</span>
                            <span className="ml-2">
                              困难 {Math.floor(total / 2)} · 极限 {Math.floor(total / 5)}
                            </span>
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-[10px] text-white/40">总计</p>
                          <p className="font-mono text-xl font-semibold text-amber-300">{total}</p>
                          {skill.id === "CREDIT_RATING" ? (
                            <p className="text-[10px] text-amber-200/75">{creditRatingLabel(total)}</p>
                          ) : null}
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <label className="flex flex-col gap-1">
                          <span className="flex items-center justify-between text-[10px] text-sakura-300/90">
                            <span>本职加点</span>
                            <span className="font-mono text-white/30">上限 {maxOccupationAdd + base}</span>
                          </span>
                          <input
                            data-testid="skill-occupation"
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
                            data-testid="skill-interest"
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
          <p className="text-sm text-white/70"></p>
          {message === null ? null : (
            <p className="mt-1 text-xs text-red-300">{message}</p>
          )}
        </div>
        <button
          type="button"
          onClick={goStep2}
          className="rounded-lg bg-sakura-500 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-sakura-400"
        >
          下一步
        </button>
      </section>
        </>
      ) : (
        <>
      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <h2 className="text-sm font-medium text-white/80">人物故事（选填）</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-white/50">角色外貌</span>
            <textarea name="bs_appearance" rows={2} value={bsAppearance} onChange={(event) => setBsAppearance(event.target.value)} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-white/50">思想与信念</span>
            <textarea name="bs_beliefs" rows={2} value={bsBeliefs} onChange={(event) => setBsBeliefs(event.target.value)} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-white/50">重要之人</span>
            <textarea name="bs_significantPeople" rows={2} value={bsSignificantPeople} onChange={(event) => setBsSignificantPeople(event.target.value)} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-white/50">意义非凡之地</span>
            <textarea name="bs_meaningfulPlaces" rows={2} value={bsMeaningfulPlaces} onChange={(event) => setBsMeaningfulPlaces(event.target.value)} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-white/50">宝贵之物</span>
            <textarea name="bs_treasuredPossessions" rows={2} value={bsTreasuredPossessions} onChange={(event) => setBsTreasuredPossessions(event.target.value)} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-white/50">特质</span>
            <textarea name="bs_traits" rows={2} value={bsTraits} onChange={(event) => setBsTraits(event.target.value)} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-white/50">难言之隐</span>
            <textarea name="bs_secrets" rows={2} value={bsSecrets} onChange={(event) => setBsSecrets(event.target.value)} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-white/50">伤口和疤痕</span>
            <textarea name="bs_scars" rows={2} value={bsScars} onChange={(event) => setBsScars(event.target.value)} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-white/50">恐惧症和狂躁症</span>
            <textarea name="bs_phobias" rows={2} value={bsPhobias} onChange={(event) => setBsPhobias(event.target.value)} className={inputClass} />
          </label>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-white/50">调查员经历</span>
            <textarea name="bs_experiences" rows={3} value={bsExperiences} onChange={(event) => setBsExperiences(event.target.value)} className={inputClass + " font-mono text-[11px]"} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-white/50">神话相关</span>
            <textarea name="bs_mythosExperiences" rows={3} value={bsMythos} onChange={(event) => setBsMythos(event.target.value)} className={inputClass + " font-mono text-[11px]"} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-white/50">调查员伙伴</span>
            <textarea name="bs_companions" rows={3} value={bsCompanions} onChange={(event) => setBsCompanions(event.target.value)} className={inputClass + " font-mono text-[11px]"} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-white/50">法术一览</span>
            <textarea name="bs_spellDetails" rows={3} value={bsSpells} onChange={(event) => setBsSpells(event.target.value)} className={inputClass + " font-mono text-[11px]"} />
          </label>
        </div>
      </section>

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <h2 className="text-sm font-medium text-white/80">财产（选填）</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {([
            ["信用评级", "creditRating"],
            ["生活水平", "livingStandard"],
            ["消费水平", "consumption"],
            ["其他资产", "otherAssetsValue"],
            ["现金", "cash"],
            ["现金单位", "cashUnit"],
            ["交通工具", "vehicle"],
            ["住所", "residence"],
            ["奢侈品", "luxury"],
            ["股票 / 证券", "securities"],
            ["其他", "other"]
          ] as const).map(([label, key]) => (
            <label key={key} className="flex flex-col gap-1.5">
              <span className="text-xs text-white/50">{label}</span>
              <input
                name={"asset_" + key}
                value={assetFields[key] ?? ""}
                onChange={(event) => setAssetFields((current) => ({ ...current, [key]: event.target.value }))}
                className={inputClass}
              />
            </label>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-medium text-white/80">持有物品（选填）</h2>
            <p className="mt-1 text-[11px] text-white/40">从卡库选择；卡牌属性请在卡牌编辑页修改。</p>
          </div>
          <div className="flex gap-2">
            <a href={newCardHref} target="_blank" rel="noreferrer" className="rounded-lg border border-sakura-500/40 px-3 py-1.5 text-xs text-sakura-400 transition hover:bg-sakura-500/10">新建卡牌</a>
            <button type="button" onClick={() => router.refresh()} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/60 transition hover:border-white/35">刷新卡库</button>
          </div>
        </div>

        {items.length === 0 ? (
          <p className="mt-3 text-xs text-white/35">还没有持有物品。</p>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {items.map((item, index) => (
              <li key={item.id ?? "item-" + String(index)} data-testid="item-card" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/15 bg-ink-900/60 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm text-white/80">{item.name}</p>
                  <p className="mt-0.5 text-[11px] text-white/40">
                    {item.kind === "WEAPON" ? "武器" : item.kind === "SPELLCARD" ? "符卡" : "道具"}
                    {effectSummary(item).length === 0 ? "" : " · " + effectSummary(item)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  {item.id === undefined ? null : (
                    <a href={cardEditHref(item.id)} target="_blank" rel="noreferrer" className="rounded-md border border-sakura-500/40 px-2 py-1 text-[11px] text-sakura-400 transition hover:bg-sakura-500/10">编辑卡牌</a>
                  )}
                  <button type="button" onClick={() => removeItem(index)} className="rounded-md border border-white/15 px-2 py-1 text-[11px] text-white/50 transition hover:border-white/35 hover:text-white">卸下</button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 border-t border-white/10 pt-3">
          <p className="text-[11px] text-white/40">当前可用卡（{availableList.length}）</p>
          {availableList.length === 0 ? (
            <p className="mt-2 text-xs text-white/35">
              卡库没有可加入的卡，
              <a href={newCardHref} target="_blank" rel="noreferrer" className="ml-1 text-sakura-400 hover:underline">去卡牌编辑页创建</a>
            </p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2">
              {availableList.map((card) => (
                <li key={card.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-ink-900/40 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-white/75">{card.name}</p>
                    <p className="mt-0.5 text-[11px] text-white/40">{card.kind === "WEAPON" ? "武器" : card.kind === "SPELLCARD" ? "符卡" : "道具"}</p>
                  </div>
                  <button type="button" data-testid="item-add" onClick={() => addAvailableCard(card)} className="shrink-0 rounded-md border border-emerald-400/40 px-2 py-1 text-[11px] text-emerald-300 transition hover:bg-emerald-400/10">加入</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <div>
          <p className="text-sm text-white/70">第二页都是选填，可以直接提交。</p>
          {message === null ? null : (
            <p className="mt-1 text-xs text-red-300">{message}</p>
          )}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setStep(1)} className="rounded-lg border border-white/15 px-5 py-2.5 text-sm text-white/70 transition hover:border-white/35">
            上一步
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={submit}
            className="rounded-lg bg-sakura-500 px-6 py-2.5 text-sm font-medium text-white transition hover:bg-sakura-400 disabled:opacity-40"
          >
            {busy ? "提交中…" : isEdit ? "保存修改" : props.roomId === null ? "创建角色" : "提交给 KP 审核"}
          </button>
        </div>
      </section>
        </>
      )}
    </div>
  );
}
