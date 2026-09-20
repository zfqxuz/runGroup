export {
  RulePackSchema,
  RulePackOverlaySchema,
  MagicEffectSchema,
  MagicRulesSchema,
  MagicSpellSchema,
  RaceSchema,
  RaceAbilitySchema,
  ElementSchema,
  ElementRulesSchema,
  AbilityCategorySchema,
  AbilityRulesSchema,
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
  PresetCharacterSchema,
  PresetAttributesSchema,
  PRESET_TIERS,
  parseRulePack
} from "./schema";

export type {
  RulePack,
  RulePackInput,
  RulePackOverlay,
  Race,
  RaceAbility,
  Element,
  ElementRules,
  AbilityCategory,
  AbilityRules,
  StatusEffectRule,
  DamageRules,
  SpellCardRules,
  ActionCostKey,
  PipelineStep,
  CombatMode,
  CombatRules,
  CombatEventRule,
  PresetTier,
  PresetAttributes,
  PresetCharacter,
  PresetCharacterInput,
  MagicRules,
  MagicSpell
} from "./schema";

export {
  GAME_CONDITION_UNITS,
  CORE_CONDITION_TYPES,
  KNOWN_CUSTOM_CONDITION_TYPES,
  GAME_CONDITION_VISIBILITIES,
  GameConditionSchema,
  GameConditionDurationSchema,
  parseConditions,
  makeCondition,
  newConditionId,
  emptyDuration,
  isCoreCondition,
  findCondition,
  findConditions,
  hasCondition,
  upsertCondition,
  removeConditionById,
  removeConditions,
  tickConditions,
  possessChargeRemaining
} from "./conditions";

export type {
  GameCondition,
  GameConditionInput,
  GameConditionUnit,
  GameConditionVisibility,
  GameConditionDuration,
  CoreConditionType,
  MakeConditionInput,
  TickConditionsResult
} from "./conditions";

export { RulePackError } from "./errors";
export type { RulePackErrorCode } from "./errors";

export {
  ATTRIBUTE_KEYS,
  DERIVED_KEYS,
  CHECK_RESULTS,
  CHECK_RANK,
  CHECK_DIFFICULTIES,
  DEFENSE_TYPES
} from "./types";

export type {
  AttributeKey,
  AttributeSet,
  DerivedKey,
  DerivedStats,
  CheckResult,
  CheckDifficulty,
  DefenseType
} from "./types";

export { compileParsedRulePack, compileRulePack } from "./compile";
export type {
  CompiledAtb,
  CompiledDamageRules,
  CompiledRace,
  CompiledRaceAbility,
  CompiledRulePack,
  CompiledStatusEffect
} from "./compile";

export { computeDerived, isSuccess, meetsDifficulty, resolveCheck, resolveOpposed, REQUIRED_CHECK_RANK } from "./engine";
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

export { isGrowthCheckPassed, resolveGrowthChecks } from "./growth";

export {
  TOUHOU_WAKE_MINUTES,
  resolveTouhouEmergencyCare,
  resolveTouhouMpRecovery,
  resolveTouhouNaturalHealing,
  touhouMovement
} from "./touhou";
export type {
  TouhouEmergencyCareInput,
  TouhouEmergencyCareOutcome,
  TouhouMovementInput,
  TouhouMpRecoveryInput,
  TouhouMpRecoveryOutcome,
  TouhouNaturalHealingInput,
  TouhouNaturalHealingOutcome
} from "./touhou";

export {
  abilityCostForLevel,
  abilityLevelForPoints,
  abilityPointBudget,
  abilitySpellCountIssue,
  abilitySpendTotal,
  abilityTotalCost,
  validateAbilitySpend
} from "./abilities";
export type { GrowthCheckInput, GrowthCheckOptions, GrowthCheckResult } from "./growth";

export { spellEffectsOf, spellTargeting, isHostileSpell, canCastOutsideCombat, outOfCombatBlockReason } from "./magic";
export { spendMagicPoints } from "./resources";
export { MADNESS_BOUT_TABLE, MANIAS, PHOBIAS, rollMadnessBout, rollSanityLoss, resolveSanityCheck } from "./sanity";
export type { MadnessBoutEntry, MadnessBoutResult, SanityCheckResult } from "./sanity";
export {
  resolveFirstAid,
  resolveMedicine,
  resolveNaturalHealing,
  resolveWeeklyMajorWoundRecovery
} from "./medical";
export type { MedicalAction, MedicalDifficulty, MedicalOutcome } from "./medical";
export type { MagicPointRules, MagicPointSpendResult } from "./resources";
export { MAGIC_TARGETINGS, MAGIC_EFFECT_TYPES } from "./schema";
export type { MagicEffect, MagicTargeting } from "./schema";
export {
  applyCoc7AgeAdjustment,
  checkCoc7AgeAllocation,
  coc7AgeAdjustment,
  coc7Build,
  coc7DamageBonus,
  coc7DamageBonusFromBuild,
  coc7MajorWound,
  coc7Movement
} from "./coc7";
export type {
  Coc7AgeAdjustment,
  Coc7AgeAllocation,
  Coc7AgeAllocationCheck,
  Coc7MovementInput,
  Coc7PhysicalAttribute
} from "./coc7";
