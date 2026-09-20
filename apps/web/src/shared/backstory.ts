/**
 * 角色背景故事：从 Character.backstory（xlsx 导入写入的 JSON）宽容读取。
 * 旧角色 / 手工车卡没有这份数据时返回 null，页面直接不渲染该区块。
 */

export interface BackstoryExperience {
  readonly module: string;
  readonly change: string | null;
}

export interface BackstoryMythosExperience {
  readonly name: string;
  readonly result: string | null;
  readonly note: string | null;
  readonly cumulative: string | null;
}

export interface BackstorySpell {
  readonly index: string | null;
  readonly name: string;
  readonly cost: string | null;
  readonly effect: string | null;
}

export interface BackstoryCompanion {
  readonly name: string;
  readonly player: string | null;
  readonly note: string | null;
  readonly change: string | null;
  readonly module: string | null;
}

export interface CharacterBackstory {
  readonly appearance: string | null;
  readonly beliefs: string | null;
  readonly significantPeople: string | null;
  readonly meaningfulPlaces: string | null;
  readonly treasuredPossessions: string | null;
  readonly traits: string | null;
  readonly secrets: string | null;
  readonly scars: string | null;
  readonly phobias: string | null;
  readonly experiences: readonly BackstoryExperience[];
  readonly mythosExperiences: readonly BackstoryMythosExperience[];
  readonly spells: readonly string[];
  readonly spellDetails: readonly BackstorySpell[];
  readonly companions: readonly BackstoryCompanion[];
  /** 千幻抄能力等级：类别 id -> Lv。 */
  readonly abilities: Readonly<Record<string, number>>;
  /** 千幻抄能力实例的发动特性值覆盖（如属性使 {知性}/{感觉}）。 */
  readonly abilityAttributes: Readonly<Record<string, string>>;
  /** 已习得的常时能力条目：id -> Lv（妖力 / 特技）。 */
  readonly abilityDefinitions: Readonly<Record<string, number>>;
  /** 千幻抄车卡能力等级 A-D。 */
  readonly abilityTier: string | null;
}

function recordOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && Array.isArray(value) === false
    ? (value as Record<string, unknown>)
    : {};
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** 兼容字符串数组与 { name } 对象数组。 */
function namesOf(value: unknown): string[] {
  const output: string[] = [];
  for (const item of arrayOf(value)) {
    if (typeof item === "string") {
      const trimmed = item.trim();
      if (trimmed.length > 0) output.push(trimmed);
      continue;
    }
    const name = stringOrNull(recordOf(item).name);
    if (name !== null) output.push(name);
  }
  return output;
}

export function characterBackstoryOf(value: unknown): CharacterBackstory | null {
  const record = recordOf(value);
  const backstory: CharacterBackstory = {
    appearance: stringOrNull(record.appearance),
    beliefs: stringOrNull(record.beliefs),
    significantPeople: stringOrNull(record.significantPeople),
    meaningfulPlaces: stringOrNull(record.meaningfulPlaces),
    treasuredPossessions: stringOrNull(record.treasuredPossessions),
    traits: stringOrNull(record.traits),
    secrets: stringOrNull(record.secrets),
    scars: stringOrNull(record.scars),
    phobias: stringOrNull(record.phobias),
    experiences: arrayOf(record.experiences)
      .map((item) => {
        const entry = recordOf(item);
        const moduleName = stringOrNull(entry.module);
        if (moduleName === null) return null;
        return { module: moduleName, change: stringOrNull(entry.change) };
      })
      .filter((item): item is BackstoryExperience => item !== null),
    mythosExperiences: arrayOf(record.mythosExperiences ?? record.mythos)
      .map((item) => {
        const entry = recordOf(item);
        const name = stringOrNull(entry.name);
        if (name === null) return null;
        return {
          name,
          result: stringOrNull(entry.result),
          note: stringOrNull(entry.note),
          cumulative: stringOrNull(entry.cumulative)
        };
      })
      .filter((item): item is BackstoryMythosExperience => item !== null),
    companions: arrayOf(record.companions)
      .map((item) => {
        const entry = recordOf(item);
        const name = stringOrNull(entry.name);
        if (name === null) return null;
        return {
          name,
          player: stringOrNull(entry.player),
          note: stringOrNull(entry.note),
          change: stringOrNull(entry.change),
          module: stringOrNull(entry.module)
        };
      })
      .filter((item): item is BackstoryCompanion => item !== null),
    spells: namesOf(record.spells),
    abilities: (() => {
      const raw = recordOf(record.abilities);
      const output: Record<string, number> = {};
      for (const [key, value] of Object.entries(raw)) {
        if (typeof value === "number" && Number.isFinite(value) && value > 0) {
          output[key] = Math.max(0, Math.floor(value));
        }
      }
      return output;
    })(),
    abilityAttributes: (() => {
      const raw = recordOf(record.abilityAttributes);
      const output: Record<string, string> = {};
      for (const [key, value] of Object.entries(raw)) {
        if (typeof value === "string" && value.trim().length > 0) output[key] = value.trim();
      }
      return output;
    })(),
    abilityDefinitions: (() => {
      const raw = recordOf(record.abilityDefinitions);
      const output: Record<string, number> = {};
      for (const [key, value] of Object.entries(raw)) {
        if (typeof value === "number" && Number.isFinite(value) && value > 0) {
          output[key] = Math.max(1, Math.floor(value));
        }
      }
      return output;
    })(),
    abilityTier: stringOrNull(record.abilityTier),
    spellDetails: arrayOf(record.spellDetails)
      .map((item) => {
        const entry = recordOf(item);
        const name = stringOrNull(entry.name);
        if (name === null) return null;
        return {
          index: stringOrNull(entry.index),
          name,
          cost: stringOrNull(entry.cost),
          effect: stringOrNull(entry.effect)
        };
      })
      .filter((item): item is BackstorySpell => item !== null)
  };

  const fields = [
    backstory.appearance,
    backstory.beliefs,
    backstory.significantPeople,
    backstory.meaningfulPlaces,
    backstory.treasuredPossessions,
    backstory.traits,
    backstory.secrets,
    backstory.scars,
    backstory.phobias
  ];
  const hasAny =
    fields.some((field) => field !== null) ||
    backstory.experiences.length > 0 ||
    backstory.mythosExperiences.length > 0 ||
    backstory.spellDetails.length > 0 ||
    backstory.spells.length > 0 ||
    backstory.companions.length > 0 ||
    Object.keys(backstory.abilities).length > 0 ||
    Object.keys(backstory.abilityAttributes).length > 0 ||
    Object.keys(backstory.abilityDefinitions).length > 0 ||
    backstory.abilityTier !== null;
  return hasAny ? backstory : null;
}
