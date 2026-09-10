export {
  RulePackSchema,
  RulePackOverlaySchema,
  RaceSchema,
  StatusEffectSchema,
  DamageRulesSchema,
  SpellCardRulesSchema,
  ExprSchema,
  DiceExprSchema,
  PIPELINE_STEPS,
  ACTION_COST_KEYS,
  CORE_ACTION_COSTS,
  RARITIES,
  COMBAT_MODES,
  CombatRulesSchema,
  CombatEventSchema,
  parseRulePack
} from "./schema";

export type {
  RulePack,
  RulePackInput,
  RulePackOverlay,
  Race,
  StatusEffectRule,
  DamageRules,
  SpellCardRules,
  ActionCostKey,
  PipelineStep,
  CombatMode,
  CombatRules,
  CombatEventRule
} from "./schema";

export { RulePackError } from "./errors";
export type { RulePackErrorCode } from "./errors";

export {
  ATTRIBUTE_KEYS,
  DERIVED_KEYS,
  CHECK_RESULTS,
  CHECK_RANK,
  DEFENSE_TYPES
} from "./types";

export type {
  AttributeKey,
  AttributeSet,
  DerivedKey,
  DerivedStats,
  CheckResult,
  DefenseType
} from "./types";

export { compileParsedRulePack, compileRulePack } from "./compile";
export type {
  CompiledAtb,
  CompiledDamageRules,
  CompiledRace,
  CompiledRulePack,
  CompiledStatusEffect
} from "./compile";

export { computeDerived, isSuccess, resolveCheck, resolveOpposed } from "./engine";
export type { CheckOutcome, DerivedInput, DerivedOutcome } from "./engine";

export { applyDamagePipeline } from "./damage";
export type { DamageInput, DamageOutcome } from "./damage";

export {
  computeAtbMax,
  computeBaseSpeed,
  damageMultiplierOf,
  resolveActionCost,
  speedMultiplierOf,
  msUntilReady,
  nextReadyTick,
  advanceTick,
  advanceTicks,
  ticksUntilReady,
  elapsedToTicks,
  readyOrder,
  consumeAction,
  schedule,
  ATB_SCALE,
  toMicro,
  fromMicro
} from "./atb";
export type { ActiveStatusEffect, AtbActor, AtbSchedule } from "./atb";

export { deepMerge, resolveRulePack } from "./merge";
export type { PackRegistry } from "./merge";

export { builtinRegistry, COC7_BASELINE, TOUHOU_EXT } from "./packs";
export { attributeTotal, checkPointBuy, rollAttributeSets } from "./attributes";
export type { AttributeSetOption, PointBuyCheck } from "./attributes";
