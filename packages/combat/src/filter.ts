import type { CombatState, LogEntry } from "./types";

export type ViewerRole = "KP" | "PLAYER" | "SPECTATOR";

export interface Viewer {
  readonly userId: string;
  readonly role: ViewerRole;
  /** 该玩家在本场战斗中操控的角色；旁观者为 null。 */
  readonly characterId: string | null;
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
  readonly hpText: string;
  readonly mp: number | null;
  readonly san: number | null;
  readonly dp: number | null;
  readonly statusEffects: readonly string[];
  readonly hasDeclaration: boolean;
  readonly declarationHp: number | null;
  readonly atbValue: number;
  readonly atbMax: number;
  readonly speed: number;
}

export interface CombatView {
  readonly id: string;
  readonly tick: number;
  readonly round: number;
  readonly phase: CombatState["phase"];
  readonly participants: readonly ParticipantView[];
  readonly log: readonly LogEntry[];
  readonly pendingIds: readonly string[];
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

  const participants: ParticipantView[] = state.participants.map((participant) => {
    const isSelf =
      viewer.characterId !== null && participant.characterId === viewer.characterId;
    const identified = isKP || isSelf || participant.isIdentified;
    const showNumbers = isKP || isSelf;
    const declaration = participant.declaration;

    return {
      id: participant.id,
      name: identified ? participant.name : "???",
      kind: participant.kind,
      faction: isKP ? participant.faction : null,
      isSelf,
      isReady: participant.isReady,
      defeated: participant.defeated,
      hp: showNumbers ? participant.hp : null,
      maxHp: showNumbers ? participant.maxHp : null,
      hpText: describeHp(participant.hp, participant.maxHp),
      mp: showNumbers ? participant.mp : null,
      san: showNumbers ? participant.san : null,
      dp: showNumbers ? participant.dp : null,
      statusEffects: participant.statusEffects.map((effect) =>
        effect.stacks > 1 ? `${effect.key} x${effect.stacks}` : effect.key
      ),
      hasDeclaration: declaration !== null,
      declarationHp: showNumbers ? (declaration?.hp ?? null) : null,
      atbValue: participant.atbValue,
      atbMax: participant.atbMax,
      speed: participant.speed
    };
  });

  return {
    id: state.id,
    tick: state.tick,
    round: state.round,
    phase: state.phase,
    participants,
    log: state.log,
    pendingIds: Object.keys(state.pending)
  };
}
