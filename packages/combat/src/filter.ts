import { participantConditions } from "./conditions";
import type { ChaseState, CombatState, LogEntry } from "./types";

export type ViewerRole = "KP" | "PLAYER" | "SPECTATOR";

export interface Viewer {
  readonly userId: string;
  readonly role: ViewerRole;
  /** 该玩家在本场战斗中操控的角色；旁观者为 null。 */
  readonly characterId: string | null;
  /** 同一玩家可操控多个角色时使用；与 characterId 取并集。 */
  readonly characterIds?: readonly string[];
  /** 房间配置允许玩家互见角色属性时为 true。KP 始终可见。 */
  readonly canSeePartyStats?: boolean;
}

/** 战斗视图里的局内状态（核心状态由战斗标记派生，自定义状态来自持久层）。 */
export interface ConditionView {
  readonly id: string;
  readonly type: string;
  readonly unit: string;
  readonly remaining: number;
  readonly visibility: string;
  readonly sourceActorId: string | null;
  readonly controllerId: string | null;
  readonly note: string | null;
}

export interface ParticipantView {
  readonly id: string;
  readonly name: string;
  readonly kind: "PLAYER" | "NPC";
  readonly faction: string | null;
  readonly isSelf: boolean;
  /** 当前视角用户是否实际能操控这个单位（含夺舍产生的控制权转移）。 */
  readonly controlledByViewer: boolean;
  readonly isReady: boolean;
  readonly defeated: boolean;
  /** COC7 重伤 / 倒地 / 昏迷 / 濒死 / 死亡状态。 */
  readonly majorWound: boolean;
  readonly prone: boolean;
  readonly unconscious: boolean;
  readonly dying: boolean;
  readonly dead: boolean;
  readonly hp: number | null;
  readonly maxHp: number | null;
  readonly hpText: string | null;
  readonly mp: number | null;
  readonly san: number | null;
  readonly dp: number | null;
  /** 千幻抄擦弹点数；仅对可见单位下发。 */
  readonly grazePoints: number | null;
  readonly armor: number | null;
  readonly maxArmor: number | null;
  readonly isSummon: boolean;
  /** 夺舍充能池剩余量；null 表示未被夺舍。 */
  readonly possessCharges: number | null;
  /** 局内状态（核心状态 + 自定义状态）的可见部分。 */
  readonly conditions: readonly ConditionView[];
  readonly statusEffects: readonly string[];
  readonly stunActions: number;
  readonly controlActions: number;
  /** 被擒抱者 id；null 表示未被擒抱。 */
  readonly grappledBy: string | null;
  /** 是否已被缴械。 */
  readonly disarmed: boolean;
  /** INITIATIVE 先攻修正（准备火器 +50 等）。 */
  readonly initiativeMod: number;
  readonly hasDeclaration: boolean;
  readonly declarationHp: number | null;
  /** 当前展开符卡的名字；未识别时隐藏。 */
  readonly declarationName: string | null;
  /** 当前展开符卡对应的卡牌 id；前端据此匹配弹幕演出。 */
  readonly declarationCardId: string | null;
  readonly atbValue: number;
  readonly atbMax: number;
  readonly speed: number;
  readonly skills: Readonly<Record<string, number>> | null;
  /** 千幻抄能力等级（类别 id -> Lv）；仅对可见单位下发，DP 伤害公式需要。 */
  readonly abilityLevels: Readonly<Record<string, number>> | null;
  /** 是否已使用 LSC（不能再使用符卡）。 */
  readonly lscUsed: boolean;
  /** LSC 是否已被击破（气绝 / DP 上限 0）。 */
  readonly lscBroken: boolean;
}

export interface ChaseParticipantView {
  readonly id: string;
  readonly name: string;
  readonly side: "PREY" | "CHASER";
  readonly position: number;
  readonly baseMov: number;
  readonly mov: number;
  readonly actionPoints: number;
  readonly maxActionPoints: number;
  readonly speedResult: string;
  readonly withdrawn: boolean;
}

export interface ChaseView {
  readonly status: ChaseState["status"];
  readonly round: number;
  readonly activeActorId: string | null;
  readonly trackLength: number;
  readonly participants: readonly ChaseParticipantView[];
  readonly ending: string | null;
}

export interface SpellcardBattleSideView {
  readonly side: string;
  readonly usable: number;
  readonly used: number;
  readonly remaining: number;
  readonly alive: number;
}

export interface DpView {
  /** participantId -> 本轮声明的 DP。 */
  readonly declared: Readonly<Record<string, number>>;
  /** 本轮行动顺序（按声明 DP 从高到低）。 */
  readonly order: readonly string[];
  /** 当前正在行动的 participantId；宣言阶段为 null。 */
  readonly currentActorId: string | null;
}

export interface CombatView {
  readonly id: string;
  readonly tick: number;
  readonly round: number;
  readonly phase: CombatState["phase"];

  readonly mode: CombatState["mode"];
  readonly initiativeOrder: readonly string[];
  readonly activeActorId: string | null;
  /** DP 模式的一轮状态；其他模式为 null。 */
  readonly dp: DpView | null;
  /** 符卡战每方 SC 余量；非符卡战为 null。 */
  readonly spellcardBattle: readonly SpellcardBattleSideView[] | null;
  readonly participants: readonly ParticipantView[];
  readonly log: readonly LogEntry[];
  readonly pendingIds: readonly string[];
  /** 正在等待应对窗口的行动：actor 对 target 出手。 */
  readonly pendingReactions: readonly { readonly actorId: string; readonly targetId: string }[];
  /** 追逐状态；null 表示当前不在追逐中。 */
  readonly chase: ChaseView | null;
  /** U-6：战斗绑定场景的网格信息；由服务端 viewForUser 附加。 */
  readonly sceneGrid?: {
    readonly width: number;
    readonly height: number;
    readonly gridSize: number;
    readonly gridType: string;
  } | null;
  /** U-6：participant.id → 当前场景 Token 坐标；由服务端 viewForUser 附加。 */
  readonly tokens?: Readonly<Record<string, { readonly x: number; readonly y: number }>>;
}

/** 把精确 HP 转成文字描述，供 PL 视角使用。 */
export function describeHp(current: number, max: number): string {
  if (max <= 0) return "未知";
  if (current <= 0) return "濒死";
  const ratio = current / max;
  if (ratio < 0.25) return "重伤";
  if (ratio < 0.5) return "受伤";
  if (ratio < 1) return "轻伤";
  return "完好";
}

/**
 * 服务端构造战斗视图的**唯一**入口。
 *
 * 原则：客户端收到的数据里不存在它不该看到的字段 ——
 * 不是「发过去再隐藏」，而是根本不发。
 */
export function filterCombatForViewer(state: CombatState, viewer: Viewer): CombatView {
  const isKP = viewer.role === "KP";
  const canSeePartyStats = viewer.canSeePartyStats === true;
  const identifiedIds = new Set<string>();

  const participants: ParticipantView[] = state.participants.map((participant) => {
    const controlledIds = new Set<string>();
    if (viewer.characterId !== null) controlledIds.add(viewer.characterId);
    for (const id of viewer.characterIds ?? []) controlledIds.add(id);
    const isSelf = participant.characterId !== null && controlledIds.has(participant.characterId);
    const identityKnown = participant.kind === "PLAYER" || isKP || isSelf || participant.isPublic;
    // 只有 KP、本人、KP 公开的 NPC/Boss，或房间开启玩家互见时，才下发精确数值。
    const showNumbers =
      isKP ||
      isSelf ||
      participant.isPublic ||
      (participant.kind === "PLAYER" && canSeePartyStats);
    if (identityKnown) identifiedIds.add(participant.id);
    const declaration = participant.declaration;
    const visibleDeclaration = declaration !== null && identityKnown ? declaration : null;

    return {
      id: participant.id,
      name: identityKnown ? participant.name : "???",
      kind: participant.kind,
      faction: isKP ? participant.faction : null,
      isSelf,
      controlledByViewer: false,
      isReady: participant.isReady,
      defeated: participant.defeated,
      majorWound: participant.majorWound === true,
      prone: participant.prone === true,
      unconscious: participant.unconscious === true,
      dying: participant.dying === true,
      dead: participant.dead === true,
      hp: showNumbers ? participant.hp : null,
      maxHp: showNumbers ? participant.maxHp : null,
      hpText: showNumbers ? describeHp(participant.hp, participant.maxHp) : null,
      mp: showNumbers ? participant.mp : null,
      san: showNumbers ? participant.san : null,
      dp: showNumbers ? participant.dp : null,
      grazePoints: showNumbers ? Math.max(0, Math.floor(participant.grazePoints ?? 0)) : null,
      armor: showNumbers ? participant.armor : null,
      maxArmor: showNumbers ? participant.maxArmor : null,
      isSummon: participant.summonedBy !== null && participant.summonedBy !== undefined,
      possessCharges: participant.possessedBy === null || participant.possessedBy === undefined
        ? null
        : Math.max(0, Math.floor(participant.possessCharges ?? 0)),
      conditions: participantConditions(participant, state.round)
        .filter((condition) => {
          if (isKP || isSelf) return true;
          if (condition.visibility === "PUBLIC") return true;
          if (condition.visibility === "PARTY" && (participant.kind === "PLAYER" || canSeePartyStats)) return true;
          return false;
        })
        .map((condition) => ({
          id: condition.id,
          type: condition.type,
          unit: condition.duration.unit,
          remaining: condition.duration.remaining,
          visibility: condition.visibility,
          sourceActorId: condition.sourceActorId ?? null,
          controllerId: condition.controllerId ?? null,
          note: condition.duration.note ?? null
        })),
      statusEffects: showNumbers
        ? participant.statusEffects.map((effect) =>
            effect.stacks > 1 ? `${effect.key} x${effect.stacks}` : effect.key
          )
        : [],
      stunActions: isKP || isSelf ? participant.stunActions ?? 0 : 0,
      controlActions: isKP || isSelf ? participant.controlActions ?? 0 : 0,
      grappledBy: participant.grappledBy ?? null,
      disarmed: participant.disarmed === true,
      initiativeMod: isKP ? participant.initiativeMod ?? 0 : 0,
      hasDeclaration: declaration !== null,
      declarationHp: showNumbers ? (declaration?.hp ?? null) : null,
      declarationName: visibleDeclaration?.name ?? null,
      declarationCardId: visibleDeclaration?.cardId ?? null,
      atbValue: participant.atbValue,
      atbMax: participant.atbMax,
      speed: participant.speed,
      skills: showNumbers ? participant.skills : null,
      abilityLevels: showNumbers ? { ...(participant.abilityLevels ?? {}) } : null,
      lscUsed: showNumbers ? participant.lscUsed === true : false,
      lscBroken: showNumbers ? participant.lscBroken === true : false
    };
  });

  const hiddenNames = new Set(
    state.participants.filter((participant) => identifiedIds.has(participant.id) === false).map((participant) => participant.name)
  );
  const log: LogEntry[] = state.log.map((entry) => {
    if (hiddenNames.size === 0) return entry;
    let text = entry.text;
    for (const name of hiddenNames) text = text.split(name).join("???");
    return { ...entry, text };
  });

  const dpCurrentActorId =
    state.mode === "DP" && state.phase === "AWAITING_ACTION"
      ? state.initiativeOrder[state.activeIndex] ?? null
      : null;

  return {
    id: state.id,
    tick: state.tick,
    round: state.round,
    phase: state.phase,

    mode: state.mode,
    initiativeOrder: [...state.initiativeOrder],
    activeActorId:
      state.mode === "INITIATIVE"
        ? state.initiativeOrder[state.activeIndex] ?? null
        : dpCurrentActorId,
    dp:
      state.mode === "DP"
        ? {
            declared: { ...(state.dp?.declared ?? {}) },
            order: [...state.initiativeOrder],
            currentActorId: dpCurrentActorId
          }
        : null,
    spellcardBattle:
      state.spellcardBattle === null || state.spellcardBattle === undefined || state.spellcardBattle.declaredCardIds === undefined
        ? null
        : (() => {
            const sides = new Set(state.participants.map((participant) => participant.faction ?? "ALLY"));
            const output: SpellcardBattleSideView[] = [];
            for (const side of sides) {
              const members = state.participants.filter((participant) => (participant.faction ?? "ALLY") === side);
              const usable = Math.max(0, Math.floor(state.spellcardBattle?.sideUsable[side] ?? 0));
              const used = members.reduce((sum, participant) => sum + participant.usedSpellCards.length, 0);
              output.push({
                side,
                usable,
                used,
                remaining: Math.max(0, usable - used),
                alive: members.filter((participant) => participant.defeated === false).length
              });
            }
            return output;
          })(),
    participants,
    log,
    pendingIds: Object.keys(state.pending),
    pendingReactions: [],
    chase:
      state.chase === null
        ? null
        : {
            status: state.chase.status,
            round: state.chase.round,
            activeActorId: state.chase.order[state.chase.activeIndex] ?? null,
            trackLength: state.chase.trackLength,
            ending: state.chase.ending,
            participants: state.chase.participants.map((participant) => ({
              id: participant.id,
              name: identifiedIds.has(participant.id) ? participant.name : "???",
              side: participant.side,
              position: participant.position,
              baseMov: participant.baseMov,
              mov: participant.mov,
              actionPoints: participant.actionPoints,
              maxActionPoints: participant.maxActionPoints,
              speedResult: participant.speedResult,
              withdrawn: participant.withdrawn === true
            }))
          }
  };
}
