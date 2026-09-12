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

export interface ParticipantView {
  readonly id: string;
  readonly name: string;
  readonly kind: "PLAYER" | "NPC";
  readonly faction: string | null;
  readonly isSelf: boolean;
  readonly isReady: boolean;
  readonly defeated: boolean;
  readonly hp: number | null;
  readonly maxHp: number | null;
  readonly hpText: string | null;
  readonly mp: number | null;
  readonly san: number | null;
  readonly dp: number | null;
  readonly statusEffects: readonly string[];
  readonly stunActions: number;
  readonly controlActions: number;
  readonly hasDeclaration: boolean;
  readonly declarationHp: number | null;
  readonly atbValue: number;
  readonly atbMax: number;
  readonly speed: number;
  readonly skills: Readonly<Record<string, number>> | null;
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
}

export interface ChaseView {
  readonly status: ChaseState["status"];
  readonly round: number;
  readonly activeActorId: string | null;
  readonly trackLength: number;
  readonly participants: readonly ChaseParticipantView[];
  readonly ending: string | null;
}

export interface CombatView {
  readonly id: string;
  readonly tick: number;
  readonly round: number;
  readonly phase: CombatState["phase"];

  readonly mode: CombatState["mode"];
  readonly initiativeOrder: readonly string[];
  readonly activeActorId: string | null;
  readonly participants: readonly ParticipantView[];
  readonly log: readonly LogEntry[];
  readonly pendingIds: readonly string[];
  /** 正在等待应对窗口的行动：actor 对 target 出手。 */
  readonly pendingReactions: readonly { readonly actorId: string; readonly targetId: string }[];
  /** 追逐状态；null 表示当前不在追逐中。 */
  readonly chase: ChaseView | null;
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

    return {
      id: participant.id,
      name: identityKnown ? participant.name : "???",
      kind: participant.kind,
      faction: isKP ? participant.faction : null,
      isSelf,
      isReady: participant.isReady,
      defeated: participant.defeated,
      hp: showNumbers ? participant.hp : null,
      maxHp: showNumbers ? participant.maxHp : null,
      hpText: showNumbers ? describeHp(participant.hp, participant.maxHp) : null,
      mp: showNumbers ? participant.mp : null,
      san: showNumbers ? participant.san : null,
      dp: showNumbers ? participant.dp : null,
      statusEffects: showNumbers
        ? participant.statusEffects.map((effect) =>
            effect.stacks > 1 ? `${effect.key} x${effect.stacks}` : effect.key
          )
        : [],
      stunActions: isKP || isSelf ? participant.stunActions ?? 0 : 0,
      controlActions: isKP || isSelf ? participant.controlActions ?? 0 : 0,
      hasDeclaration: declaration !== null,
      declarationHp: showNumbers ? (declaration?.hp ?? null) : null,
      atbValue: participant.atbValue,
      atbMax: participant.atbMax,
      speed: participant.speed,
      skills: showNumbers ? participant.skills : null
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

  return {
    id: state.id,
    tick: state.tick,
    round: state.round,
    phase: state.phase,

    mode: state.mode,
    initiativeOrder: [...state.initiativeOrder],
    activeActorId: state.mode === "INITIATIVE" ? state.initiativeOrder[state.activeIndex] ?? null : null,
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
              speedResult: participant.speedResult
            }))
          }
  };
}
