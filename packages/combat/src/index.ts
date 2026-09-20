export * from "./types";
export {
  chaseAttackIssue,
  chaseBaseMov,
  chaseCurrentActorId,
  chaseEndTurn,
  chaseMove,
  chaseSpeedCheckTarget,
  chaseWithdraw,
  chaseWithdrawIssue,
  endChase,
  findChaseParticipant,
  resolveChaseAttack,
  startChase
} from "./chase";
export type {
  ChaseAttackInput,
  ChaseAttackResolution,
  ChaseMoveResult,
  ChaseTurnResult,
  ChaseWithdrawResult,
  StartChaseOptions,
  StartChaseResult
} from "./chase";
export {
  addParticipant,
  advanceToNextEvent,
  applyForcedSkips,
  applyStatus,
  beginInitiativeRound,
  buildInitiativeOrder,
  checkEnd,
  currentActorId,
  endTurn,
  expireBarriers,
  setInitiativeOrder,
  createCombat,
  endCombat,
  expandDamageBonus,
  findParticipant,
  nextRollRng,
  pushLog,
  readyParticipants,
  recomputeSpeed,
  recoverTouhouLscLimits,
  resolveImmediateAction,
  resolveDyingChecks,
  resolveInitiativeTurn,
  reactionTargetIdsForAction,
  resolvePending,
  resolveRoundRaceAbilities,
  resolveSpellcardImmediate,
  spellcardBattleSummary,
  submitAction
} from "./combat";
export type {
  AdvanceResult,
  CombatInit,
  DefenseReaction,
  ParticipantInit,
  ResolveResult,
  SpellcardBattleSideSummary
} from "./combat";
export type { SummonTemplate } from "./types";
export {
  armorConditionOf,
  conditionByType,
  coreConditionsFromParticipant,
  loadParticipantConditions,
  participantConditions,
  persistableConditions,
  possessConditionOf,
  possessInitFromConditions
} from "./conditions";
export {
  beginDpRound,
  currentDpActorId,
  declareDp,
  dpRegenFor,
  dpTurnOrder,
  endDpTurn,
  resolveDpTurn,
  grantDpWaitBonus,
  markDpActed
} from "./dp";

export { rngFor } from "./rng";
export {
  isThrownOutOfRange,
  matchRangeBand,
  pointBlankBonusDice,
  thrownRangeFeet
} from "./range";
export type { RangeBandLike, RangeMatchResult } from "./range";
export { describeHp, filterCombatForViewer } from "./filter";
export type { CombatView, ParticipantView, Viewer, ViewerRole } from "./filter";
