import {
  compile as compileExpr,
  FormulaError,
  type CompiledExpr
} from "@touhou/formula";
import { RulePackError } from "./errors";
import {
  CORE_ACTION_COSTS,
  RulePackSchema,
  type DamageRules,
  type RulePack
} from "./schema";
import { ATTRIBUTE_KEYS, DERIVED_KEYS, type CheckResult, type DefenseType } from "./types";

export interface CompiledAtb {
  readonly tickMs: number;
  readonly max: CompiledExpr;
  readonly speed: CompiledExpr;
  readonly actionCost: Readonly<Record<string, CompiledExpr>>;
  readonly tieBreak: "DEX_DESC" | "RANDOM";
}

export interface CompiledDamageRules {
  readonly pipeline: DamageRules["pipeline"];
  readonly defend: { readonly cost: CompiledExpr; readonly reduceMultiplier: CompiledExpr };
  readonly dodge: { readonly cost: CompiledExpr; readonly grazeMpGainRatio: CompiledExpr };
  readonly counter: { readonly cost: CompiledExpr; readonly failDamageRatio: CompiledExpr };
}

export interface CompiledRace {
  readonly attrMods: Readonly<Record<string, CompiledExpr>>;
  readonly derivedOverrides: Readonly<Record<string, CompiledExpr>>;
  readonly skillBonuses: Readonly<Record<string, CompiledExpr>>;
  readonly flags: readonly string[];
}

export interface CompiledStatusEffect {
  readonly stack: "STACK" | "REFRESH" | "REPLACE";
  readonly maxStacks: number;
  readonly durationTicks: CompiledExpr;
  readonly speedMultiplier?: CompiledExpr;
  readonly damageMultiplier?: CompiledExpr;
}

export interface CompiledSkill {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly base: CompiledExpr;
  readonly description: string | undefined;
}

export interface CompiledSkillPoints {
  readonly occupation: CompiledExpr;
  readonly interest: CompiledExpr;
  readonly maxAtCreation: CompiledExpr;
}

export interface CompiledCombat {
  readonly mode: 'INITIATIVE' | 'ATB';
  /** INITIATIVE 的排序依据公式；ATB 为 null。 */
  readonly initiativeKey: CompiledExpr | null;
  readonly tieBreak: 'KEY_DESC' | 'RANDOM' | 'KP';
  readonly kpAdjustsOrder: boolean;
  readonly events: Readonly<Record<string, { readonly label: string; readonly defaultEnabled: boolean }>>;
}

export interface CompiledRulePack {
  readonly pack: RulePack;
  readonly id: string;
  readonly system: "COC7" | "TOUHOU";
  readonly version: string;
  readonly constantNames: readonly string[];
  readonly derivedOrder: readonly string[];
  readonly derived: Readonly<Record<string, CompiledExpr>>;
  readonly check: Readonly<Record<string, CompiledExpr>>;
  readonly atb: CompiledAtb;
  readonly damage: CompiledDamageRules;
  readonly races: Readonly<Record<string, CompiledRace>>;
  readonly skills: readonly CompiledSkill[];
  readonly skillPoints: CompiledSkillPoints;
  readonly combat: CompiledCombat;
  readonly statusEffects: Readonly<Record<string, CompiledStatusEffect>>;
}

export type { CheckResult, DefenseType };

/** 拓扑排序：derived 之间可以互相引用，但必须无环。 */
function topoSort(graph: ReadonlyMap<string, readonly string[]>): string[] {
  const order: string[] = [];
  const state = new Map<string, 1 | 2>();

  const visit = (key: string, path: readonly string[]): void => {
    const current = state.get(key);
    if (current === 2) return;
    if (current === 1) {
      throw new RulePackError(
        "DERIVED_CYCLE",
        `derived 公式存在循环依赖: ${[...path, key].join(" -> ")}`,
        { cycle: [...path, key] }
      );
    }
    state.set(key, 1);
    for (const dependency of graph.get(key) ?? []) {
      if (graph.has(dependency)) visit(dependency, [...path, key]);
    }
    state.set(key, 2);
    order.push(key);
  };

  for (const key of graph.keys()) visit(key, []);
  return order;
}

export function compileRulePack(input: unknown): CompiledRulePack {
  const parsed = RulePackSchema.safeParse(input);
  if (!parsed.success) {
    throw new RulePackError("SCHEMA_INVALID", "RulePack 未通过 schema 校验", {
      issues: parsed.error.issues
    });
  }
  return compileParsedRulePack(parsed.data);
}

const CHECK_FORMULA_KEYS = [
  "criticalAt",
  "extremeDivisor",
  "hardDivisor",
  "fumbleFlat",
  "fumbleSkillBelow",
  "fumbleRangeFrom"
] as const;

export function compileParsedRulePack(pack: RulePack): CompiledRulePack {
  const constantNames = Object.keys(pack.const).sort();
  const attributeVars: readonly string[] = [...ATTRIBUTE_KEYS];
  const baseVars: readonly string[] = [...ATTRIBUTE_KEYS, ...DERIVED_KEYS];
  const derivedKeys = Object.keys(pack.derived);
  const derivedVars: readonly string[] = [...ATTRIBUTE_KEYS, ...derivedKeys];
  const combatVars: readonly string[] = [...ATTRIBUTE_KEYS, ...DERIVED_KEYS, "atbMax"];
  const checkVars: readonly string[] = ["target", "roll"];

  const wrap = <T>(what: string, run: () => T): T => {
    try {
      return run();
    } catch (error) {
      if (error instanceof FormulaError) {
        throw new RulePackError("FORMULA_INVALID", `[${what}] ${error.message}`, {
          code: error.code,
          expression: error.source,
          position: error.position
        });
      }
      throw error;
    }
  };

  const compileMap = (
    what: string,
    source: Readonly<Record<string, string>>,
    vars: readonly string[]
  ): Record<string, CompiledExpr> => {
    const out: Record<string, CompiledExpr> = {};
    for (const [key, expression] of Object.entries(source)) {
      out[key] = wrap(`${what}.${key}`, () =>
        compileExpr(expression, { vars, consts: constantNames })
      );
    }
    return out;
  };

  const derived = compileMap("derived", pack.derived, derivedVars);
  const dependencies = new Map<string, string[]>();
  for (const [key, expression] of Object.entries(derived)) {
    dependencies.set(
      key,
      expression.vars.filter((name) => name in derived)
    );
  }
  const derivedOrder = topoSort(dependencies);

  const checkSource: Record<string, string> = {};
  for (const key of CHECK_FORMULA_KEYS) {
    checkSource[key] = pack.check[key];
  }
  const check = compileMap("check", checkSource, checkVars);

  for (const action of CORE_ACTION_COSTS) {
    if (pack.atb.actionCost[action] === undefined) {
      throw new RulePackError(
        "MISSING_ACTION_COST",
        `atb.actionCost 缺少 "${action}" 的消耗定义`,
        { action }
      );
    }
  }

  const atb: CompiledAtb = {
    tickMs: pack.atb.tickMs,
    max: wrap("atb.max", () =>
      compileExpr(pack.atb.max, { vars: baseVars, consts: constantNames })
    ),
    speed: wrap("atb.speed", () =>
      compileExpr(pack.atb.speed, { vars: baseVars, consts: constantNames })
    ),
    actionCost: compileMap("atb.actionCost", pack.atb.actionCost, combatVars),
    tieBreak: pack.atb.tieBreak
  };

  const damage: CompiledDamageRules = {
    pipeline: pack.damage.pipeline,
    defend: {
      cost: wrap("damage.defend.cost", () =>
        compileExpr(pack.damage.defend.cost, { vars: combatVars, consts: constantNames })
      ),
      reduceMultiplier: wrap("damage.defend.reduceMultiplier", () =>
        compileExpr(pack.damage.defend.reduceMultiplier, {
          vars: baseVars,
          consts: constantNames
        })
      )
    },
    dodge: {
      cost: wrap("damage.dodge.cost", () =>
        compileExpr(pack.damage.dodge.cost, { vars: combatVars, consts: constantNames })
      ),
      grazeMpGainRatio: wrap("damage.dodge.grazeMpGainRatio", () =>
        compileExpr(pack.damage.dodge.grazeMpGainRatio, {
          vars: baseVars,
          consts: constantNames
        })
      )
    },
    counter: {
      cost: wrap("damage.counter.cost", () =>
        compileExpr(pack.damage.counter.cost, { vars: combatVars, consts: constantNames })
      ),
      failDamageRatio: wrap("damage.counter.failDamageRatio", () =>
        compileExpr(pack.damage.counter.failDamageRatio, {
          vars: baseVars,
          consts: constantNames
        })
      )
    }
  };

  const races: Record<string, CompiledRace> = {};
  for (const [raceKey, race] of Object.entries(pack.races)) {
    races[raceKey] = {
      attrMods: compileMap(`races.${raceKey}.attrMods`, race.attrMods, attributeVars),
      derivedOverrides: compileMap(
        `races.${raceKey}.derivedOverrides`,
        race.derivedOverrides,
        baseVars
      ),
      skillBonuses: compileMap(
        `races.${raceKey}.skillBonuses`,
        race.skillBonuses,
        attributeVars
      ),
      flags: race.flags
    };
  }

  const skillPoints: CompiledSkillPoints = {
    occupation: wrap("skillPoints.occupation", () =>
      compileExpr(pack.skillPoints.occupation, { vars: attributeVars, consts: constantNames })
    ),
    interest: wrap("skillPoints.interest", () =>
      compileExpr(pack.skillPoints.interest, { vars: attributeVars, consts: constantNames })
    ),
    maxAtCreation: wrap("skillPoints.maxAtCreation", () =>
      compileExpr(pack.skillPoints.maxAtCreation, { vars: attributeVars, consts: constantNames })
    )
  };

  const combatEvents: Record<string, { label: string; defaultEnabled: boolean }> = {};
  for (const [eventId, rule] of Object.entries(pack.combat.events)) {
    combatEvents[eventId] = { label: rule.label, defaultEnabled: rule.defaultEnabled };
  }
  const combatInit = pack.combat.initiative;
  const combat: CompiledCombat = {
    mode: pack.combat.mode,
    initiativeKey:
      combatInit === undefined
        ? null
        : wrap('combat.initiative.key', () =>
            compileExpr(combatInit.key, { vars: baseVars, consts: constantNames })
          ),
    tieBreak: combatInit?.tieBreak ?? 'KEY_DESC',
    kpAdjustsOrder: combatInit?.kpAdjustsOrder ?? false,
    events: combatEvents
  };

  const skills: CompiledSkill[] = pack.skills.map((skill) => ({
    id: skill.id,
    name: skill.name,
    category: skill.category,
    base: wrap(`skills.${skill.id}`, () =>
      compileExpr(skill.base, { vars: attributeVars, consts: constantNames })
    ),
    description: skill.description
  }));

  const statusEffects: Record<string, CompiledStatusEffect> = {};
  for (const [effectKey, effect] of Object.entries(pack.statusEffects)) {
    const speedSource = effect.speedMultiplier;
    const damageSource = effect.damageMultiplier;
    statusEffects[effectKey] = {
      stack: effect.stack,
      maxStacks: effect.maxStacks,
      durationTicks: wrap(`statusEffects.${effectKey}.durationTicks`, () =>
        compileExpr(effect.durationTicks, { vars: combatVars, consts: constantNames })
      ),
      speedMultiplier: speedSource
        ? wrap(`statusEffects.${effectKey}.speedMultiplier`, () =>
            compileExpr(speedSource, { vars: combatVars, consts: constantNames })
          )
        : undefined,
      damageMultiplier: damageSource
        ? wrap(`statusEffects.${effectKey}.damageMultiplier`, () =>
            compileExpr(damageSource, { vars: combatVars, consts: constantNames })
          )
        : undefined
    };
  }

  return {
    pack,
    id: pack.id,
    system: pack.system,
    version: pack.version,
    constantNames,
    derivedOrder,
    derived,
    check,
    atb,
    damage,
    races,
    skills,
    skillPoints,
    combat,
    statusEffects
  };
}
