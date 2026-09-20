"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { io, type Socket } from "socket.io-client";
import type { CombatView, ParticipantView } from "@touhou/combat";
import DanmakuStage from "@/components/danmaku/DanmakuStage";
import { gridDistanceFeet } from "@/shared/scene-geometry";
import type { CombatItemOption } from "@/shared/combat-items";
import { magicEffectLabel } from "@/shared/magic";
import type { CombatSpellCardOption } from "@/shared/danmaku/spellcards";
import type {
  Ack,
  CombatActionPayload,
  CombatJoinAck,
  CombatReactionPayload,
  CombatUpdate
} from "@/shared/socket";

interface SkillOption {
  readonly id: string;
  readonly name: string;
}

export interface CombatAttackOption {
  readonly skillId: string;
  readonly damage: string;
  readonly damageType?: "BLUNT" | "IMPALING" | "NONE";
  readonly damageBands?: readonly {
    readonly label: string;
    readonly expression: string;
    readonly maxFeet: number | "DEX" | null;
  }[];
  readonly shots?: readonly number[];
  readonly weaponName: string | null;
  readonly source: "WEAPON" | "UNARMED" | "DEFAULT";
}

interface MagicSpellOption {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly mpCost: string;
  readonly sanCost: string;
  readonly damage?: string;
  readonly target: "SELF" | "ONE" | "ALL";
  readonly targeting: "SELF" | "ALLY" | "ENEMY" | "ANY";
  readonly effects: readonly string[];
}

interface Props {
  readonly roomId: string;
  readonly combatId: string;
  readonly isKP: boolean;
  readonly skillOptions: readonly SkillOption[];
  readonly system: "COC7" | "TOUHOU";
  readonly canCounter: boolean;
  readonly canOutOfRule: boolean;
  readonly canCastMagic: boolean;
  readonly canCastSpellcard: boolean;
  readonly magicSpells: readonly MagicSpellOption[];
  readonly attackOptionsByParticipant: Readonly<Record<string, readonly CombatAttackOption[]>>;
  readonly spellIdsByParticipant: Readonly<Record<string, readonly string[]>>;
  readonly spellCardsByParticipant: Readonly<Record<string, readonly CombatSpellCardOption[]>>;
  readonly itemOptionsByParticipant: Readonly<Record<string, readonly CombatItemOption[]>>;
  readonly portraits: Readonly<Record<string, string>>;
}

const REACTION_LABELS: Record<CombatReactionPayload["type"], string> = {
  PASS: "不应对",
  DEFEND: "防御",
  DODGE: "闪避",
  COUNTER: "反击",
  SEEK_COVER: "寻找掩体",
  FLEE: "逃跑"
};

type ConnState = "connecting" | "online" | "offline";
type ReactionDraft = { type: CombatReactionPayload["type"]; skill: string };

function percent(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, (value / max) * 100));
}

function hpPercent(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, (value / max) * 100));
}

export default function CombatBoard(props: Props) {
  const [view, setView] = useState<CombatView | null>(null);
  const [conn, setConn] = useState<ConnState>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [targetId, setTargetId] = useState("");
  const [skill, setSkill] = useState("");
  const [maneuver, setManeuver] = useState<"DISARM" | "TRIP" | "GRAPPLE">("TRIP");
  const [rangeBand, setRangeBand] = useState(0);
  const [shotCount, setShotCount] = useState(1);
  const [pointBlank, setPointBlank] = useState(false);
  const [chaseRangeBand, setChaseRangeBand] = useState(0);
  const [chaseShotCount, setChaseShotCount] = useState(1);
  const [outName, setOutName] = useState("规则外法术");
  const [spellId, setSpellId] = useState("");
  const [spellTargetId, setSpellTargetId] = useState("");
  const [spellCardId, setSpellCardId] = useState("");
  const [spellCardTargetId, setSpellCardTargetId] = useState("");
  const [itemCardId, setItemCardId] = useState("");
  const [itemTargetId, setItemTargetId] = useState("");
  const [actorId, setActorId] = useState("");
  const [chaseTargetId, setChaseTargetId] = useState("");
  const [routineDrafts, setRoutineDrafts] = useState<
    Array<{ targetId: string; skill: string; rangeBand: number; shots: number; pointBlank: boolean }>
  >([]);
  const [chaseSkill, setChaseSkill] = useState("");
  const [reactionOptions, setReactionOptions] = useState<Record<string, readonly CombatReactionPayload["type"][]>>({});
  const [reactionDrafts, setReactionDrafts] = useState<Record<string, ReactionDraft>>({});
  const router = useRouter();
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    let cancelled = false;
    const socket = io({ path: "/api/socket", autoConnect: false, transports: ["websocket"] });
    socketRef.current = socket;

    async function bootstrap(): Promise<void> {
      const response = await fetch("/api/socket-ticket", { method: "POST" });
      const payload = (await response.json()) as { ok: boolean; ticket?: string };
      if (cancelled) return;
      if (payload.ok === false || payload.ticket === undefined) {
        setConn("offline");
        setError("连接失败，请刷新页面重试。");
        return;
      }
      socket.auth = { ticket: payload.ticket };
      socket.connect();
    }

    function joinCombat(): void {
      socket.emit("combat:join", props.combatId, (result: CombatJoinAck) => {
        if (cancelled) return;
        if (result.ok === false) {
          setError(result.error ?? "加入战斗失败");
          return;
        }
        if (result.view !== undefined) setView(result.view);
      });
    }

    socket.on("connect", () => {
      if (cancelled) return;
      setConn("online");
      joinCombat();
    });
    socket.on("combat:update", (update: CombatUpdate) => {
      if (cancelled) return;
      if (update.combatId === props.combatId) setView(update.view);
    });
    socket.on("combat:reaction-request", (request: { targetId: string; options: readonly CombatReactionPayload["type"][] }) => {
      if (cancelled) return;
      setReactionOptions((prev) => ({ ...prev, [request.targetId]: request.options }));
      setReactionDrafts((prev) => {
        if (prev[request.targetId] !== undefined) return prev;
        return { ...prev, [request.targetId]: { type: "PASS", skill: "" } };
      });
    });
    socket.on("combat:aborted", () => {
      if (cancelled === false) router.push("/rooms/" + props.roomId + "?combat=aborted");
    });
    socket.on("combat:ended", () => {
      if (cancelled === false) router.push("/rooms/" + props.roomId + "?combat=ended");
    });
    socket.on("disconnect", () => {
      if (cancelled === false) setConn("offline");
    });
    socket.on("connect_error", () => {
      if (cancelled === false) setConn("offline");
    });
    void bootstrap();

    return () => {
      cancelled = true;
      socket.removeAllListeners();
      socket.close();
    };
  }, [props.combatId]);

  useEffect(() => {
    if (view?.phase === "ENDED") {
      const timer = setTimeout(() => router.push("/rooms/" + props.roomId + "?combat=ended"), 1200);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [view?.phase, router, props.roomId]);

  const participants = view?.participants ?? [];
  const alive = participants.filter((item) => item.defeated === false);
  const chase = view?.chase ?? null;
  const chaseActive = chase !== null && chase.status === "ACTIVE";

  /** U-6：按战斗场景地图网格计算两个参战单位之间的实际英尺距离。 */
  function participantDistance(actorIdValue: string, targetIdValue: string): number | null {
    const tokens = view?.tokens;
    const grid = view?.sceneGrid;
    if (tokens === undefined || tokens === null || grid === undefined || grid === null) return null;
    const actorToken = tokens[actorIdValue];
    const targetToken = tokens[targetIdValue];
    if (actorToken === undefined || targetToken === undefined) return null;
    return gridDistanceFeet(actorToken, targetToken, grid, 5);
  }
  const chaseActiveParticipant =
    chase === null || chase.activeActorId === null
      ? null
      : chase.participants.find((item) => item.id === chase.activeActorId) ?? null;

  function isControlled(item: ParticipantView): boolean {
    return item.isSelf || item.controlledByViewer || (props.isKP && item.kind === "NPC");
  }

  function isChaseControlled(participantId: string): boolean {
    const item = participants.find((participant) => participant.id === participantId);
    return item !== undefined && isControlled(item);
  }

  const actionable = chaseActive ? [] : alive.filter((item) => item.isReady && isControlled(item));
  const selectedActor = chaseActive ? null : (actionable.find((item) => item.id === actorId) ?? actionable[0] ?? null);
  const selectedActorId = selectedActor === null ? "" : selectedActor.id;
  const selectedActorHasFirearm =
    selectedActor !== null &&
    (props.attackOptionsByParticipant[selectedActor.id] ?? []).some((option) =>
      option.skillId.startsWith("FIREARMS_")
    );
  const selectedActorReadyWeapon = (selectedActor?.initiativeMod ?? 0) > 0;
  const selectedActorHasBrawl = (props.attackOptionsByParticipant[selectedActorId] ?? []).some(
    (option) => option.skillId === "FIGHTING_BRAWL"
  );
  const activeActorId = view?.mode === "INITIATIVE" ? view.activeActorId : null;
  const activeActor = participants.find((item) => item.id === activeActorId) ?? null;

  const pendingReactions = view?.pendingReactions ?? [];
  const pendingTargetIds = new Set(pendingReactions.map((item) => item.targetId));
  const myPendingReactions = pendingReactions.filter((item) => {
    const target = participants.find((participant) => participant.id === item.targetId);
    return target !== undefined && isControlled(target);
  });
  const otherPendingReactions = pendingReactions.filter((item) => {
    const target = participants.find((participant) => participant.id === item.targetId);
    return target !== undefined && isControlled(target) === false;
  });

  function attackSkillsFor(participantId: string): readonly string[] {
    return (props.attackOptionsByParticipant[participantId] ?? []).map((option) => option.skillId);
  }

  function attackOptionFor(participantId: string, skillId: string): CombatAttackOption | null {
    return (
      (props.attackOptionsByParticipant[participantId] ?? []).find(
        (option) => option.skillId === skillId
      ) ?? null
    );
  }

  function addRoutineStep(): void {
    if (selectedActor === null) return;
    setRoutineDrafts((prev) => [
      ...prev,
      {
        targetId: targetOptions[0]?.id ?? "",
        skill: attackSkills[0]?.id ?? "",
        rangeBand: 0,
        shots: 1,
        pointBlank: false
      }
    ]);
  }

  function updateRoutineStep(
    index: number,
    patch: Partial<{ targetId: string; skill: string; rangeBand: number; shots: number; pointBlank: boolean }>
  ): void {
    setRoutineDrafts((prev) => prev.map((step, stepIndex) => (stepIndex === index ? { ...step, ...patch } : step)));
  }

  function removeRoutineStep(index: number): void {
    setRoutineDrafts((prev) => prev.filter((_step, stepIndex) => stepIndex !== index));
  }

  function emitRoutine(): void {
    if (selectedActor === null || routineDrafts.length === 0) return;
    const first = routineDrafts[0];
    if (first === undefined) return;
    emitAction({
      kind: "DANMAKU",
      targetId: first.targetId,
      skill: first.skill,
      routine: routineDrafts.map((step) => ({
        targetId: step.targetId,
        skill: step.skill,
        rangeBand: step.rangeBand,
        shots: step.shots,
        pointBlank: step.pointBlank
      }))
    });
    setRoutineDrafts([]);
  }

  const actorSkills = selectedActor?.skills ?? {};
  const allowedAttackSkillIds = attackSkillsFor(selectedActorId);
  const attackSkills = props.skillOptions.filter((option) => allowedAttackSkillIds.includes(option.id));
  const activeSkill = attackSkills.some((option) => option.id === skill) ? skill : (attackSkills[0]?.id ?? "");
  const activeAttackOption = selectedActor === null ? null : attackOptionFor(selectedActor.id, activeSkill);
  const activeAttackBands =
    activeAttackOption?.damageBands !== undefined && activeAttackOption.damageBands.length > 0
      ? activeAttackOption.damageBands
      : [{ label: "普通", expression: activeAttackOption?.damage ?? "1d6", maxFeet: null }];
  const activeAttackBandIndex =
    rangeBand >= 0 && rangeBand < activeAttackBands.length ? rangeBand : 0;
  const activeAttackShots = activeAttackOption?.shots ?? [1];
  const activeAttackShotCount = activeAttackShots.includes(shotCount)
    ? shotCount
    : activeAttackShots[0] ?? 1;
  const activeAttackDamage = activeAttackBands[activeAttackBandIndex]?.expression ?? activeAttackOption?.damage ?? "1d6";
  const activeAttackSourceLabel =
    activeAttackOption?.weaponName ?? (activeAttackOption?.source === "UNARMED" ? "徒手" : "默认攻击");
  const targetOptions = alive.filter((item) => item.id !== selectedActorId);
  const activeTargetId = targetOptions.some((item) => item.id === targetId) ? targetId : (targetOptions[0]?.id ?? "");
  const activeDistanceFeet = participantDistance(selectedActorId, activeTargetId);
  const allowedSpellIds =
    selectedActor === null ? [] : props.spellIdsByParticipant[selectedActor.id] ?? [];
  const actorMagicSpells = props.magicSpells.filter((spell) => allowedSpellIds.includes(spell.id));
  const activeSpell = actorMagicSpells.some((item) => item.id === spellId) ? spellId : (actorMagicSpells[0]?.id ?? "");
  const selectedSpell = actorMagicSpells.find((item) => item.id === activeSpell) ?? null;
  const actorSpellCards =
    selectedActor === null ? [] : (props.spellCardsByParticipant[selectedActor.id] ?? []);
  const activeSpellCardId = actorSpellCards.some((item) => item.cardId === spellCardId)
    ? spellCardId
    : (actorSpellCards[0]?.cardId ?? "");
  const selectedSpellCard =
    actorSpellCards.find((item) => item.cardId === activeSpellCardId) ?? null;
  const spellcardEffectTargets =
    selectedSpellCard === null || selectedActor === null || selectedSpellCard.effects.length === 0
      ? []
      : selectedSpellCard.targetScope === "SELF" || selectedSpellCard.targeting === "SELF"
        ? [selectedActor]
        : selectedSpellCard.targetScope === "ALL"
          ? []
          : alive.filter((participant) => {
              if (selectedSpellCard.targeting === "ENEMY") {
                return participant.id !== selectedActor.id && participant.kind !== selectedActor.kind;
              }
              if (selectedSpellCard.targeting === "ALLY") {
                return participant.id === selectedActor.id || participant.kind === selectedActor.kind;
              }
              return true;
            });
  const activeSpellCardTargetId = spellcardEffectTargets.some((participant) => participant.id === spellCardTargetId)
    ? spellCardTargetId
    : (spellcardEffectTargets[0]?.id ?? "");
  const spellTargetOptions = selectedSpell === null || selectedActor === null
    ? []
    : selectedSpell.target === "SELF" || selectedSpell.targeting === "SELF"
      ? [selectedActor]
      : selectedSpell.target === "ALL"
        ? []
        : alive.filter((participant) => {
            if (selectedSpell.targeting === "ENEMY") {
              return participant.id !== selectedActor.id && participant.kind !== selectedActor.kind;
            }
            if (selectedSpell.targeting === "ALLY") {
              return participant.id === selectedActor.id || participant.kind === selectedActor.kind;
            }
            return true;
          });
  const activeSpellTargetId = spellTargetOptions.some((participant) => participant.id === spellTargetId)
    ? spellTargetId
    : (spellTargetOptions[0]?.id ?? "");

  const actorItems = selectedActor === null ? [] : (props.itemOptionsByParticipant[selectedActor.id] ?? []);
  const activeItemCardId = actorItems.some((item) => item.cardId === itemCardId)
    ? itemCardId
    : (actorItems[0]?.cardId ?? "");
  const selectedItem = actorItems.find((item) => item.cardId === activeItemCardId) ?? null;
  const itemTargetOptions =
    selectedItem === null || selectedActor === null
      ? []
      : selectedItem.targetScope === "SELF" || selectedItem.targeting === "SELF"
        ? [selectedActor]
        : selectedItem.targetScope === "ALL"
          ? []
          : alive.filter((participant) => {
              if (selectedItem.targeting === "ENEMY") {
                return participant.id !== selectedActor.id && participant.kind !== selectedActor.kind;
              }
              if (selectedItem.targeting === "ALLY") {
                return participant.id === selectedActor.id || participant.kind === selectedActor.kind;
              }
              return true;
            });
  const activeItemTargetId = itemTargetOptions.some((participant) => participant.id === itemTargetId)
    ? itemTargetId
    : (itemTargetOptions[0]?.id ?? "");

  const chaseCanControl =
    chaseActiveParticipant !== null && isChaseControlled(chaseActiveParticipant.id);
  const chaseAttackPending = pendingReactions.length > 0;
  const chaseTargetOptions =
    chase === null || chaseActiveParticipant === null
      ? []
      : chase.participants.filter((item) => {
          if (item.id === chaseActiveParticipant.id) return false;
          if (item.side === chaseActiveParticipant.side) return false;
          if (item.withdrawn) return false;
          if (item.position !== chaseActiveParticipant.position) return false;
          const combat = participants.find((participant) => participant.id === item.id);
          return combat !== undefined && combat.defeated === false;
        });
  const activeChaseTargetId = chaseTargetOptions.some((item) => item.id === chaseTargetId)
    ? chaseTargetId
    : (chaseTargetOptions[0]?.id ?? "");
  const chaseDistanceFeet =
    chaseActiveParticipant === null ? null : participantDistance(chaseActiveParticipant.id, activeChaseTargetId);
  const chaseNearestDistanceFeet = (() => {
    if (chaseActiveParticipant === null || chase === null) return null;
    let nearest: number | null = null;
    for (const item of chase.participants) {
      if (item.id === chaseActiveParticipant.id || item.side === chaseActiveParticipant.side || item.withdrawn) continue;
      const distance = participantDistance(chaseActiveParticipant.id, item.id);
      if (distance !== null && (nearest === null || distance < nearest)) nearest = distance;
    }
    return nearest;
  })();
  const chaseActorIdForSkills = chaseActiveParticipant?.id ?? "";
  const chaseAttackSkillIds = attackSkillsFor(chaseActorIdForSkills);
  const chaseAttackSkills = props.skillOptions.filter((option) =>
    chaseAttackSkillIds.includes(option.id)
  );
  const activeChaseSkill = chaseAttackSkills.some((option) => option.id === chaseSkill)
    ? chaseSkill
    : (chaseAttackSkills[0]?.id ?? "");
  const activeChaseAttackOption =
    chaseActiveParticipant === null ? null : attackOptionFor(chaseActiveParticipant.id, activeChaseSkill);
  const activeChaseBands =
    activeChaseAttackOption?.damageBands !== undefined && activeChaseAttackOption.damageBands.length > 0
      ? activeChaseAttackOption.damageBands
      : [{ label: "普通", expression: activeChaseAttackOption?.damage ?? "1d6", maxFeet: null }];
  const activeChaseBandIndex =
    chaseRangeBand >= 0 && chaseRangeBand < activeChaseBands.length ? chaseRangeBand : 0;
  const activeChaseShots = activeChaseAttackOption?.shots ?? [1];
  const activeChaseShotCount = activeChaseShots.includes(chaseShotCount)
    ? chaseShotCount
    : activeChaseShots[0] ?? 1;
  const activeChaseDamage = activeChaseBands[activeChaseBandIndex]?.expression ?? activeChaseAttackOption?.damage ?? "1d6";
  const activeChaseSourceLabel =
    activeChaseAttackOption?.weaponName ?? (activeChaseAttackOption?.source === "UNARMED" ? "徒手" : "默认攻击");

  function reactionLabel(type: CombatReactionPayload["type"]): string {
    if (type === "FLEE") return "逃跑（进入追逐）";
    if (type === "COUNTER") return props.system === "TOUHOU" ? "消弹对抗" : "反击";
    return REACTION_LABELS[type];
  }

  function defaultReactionOptions(): readonly CombatReactionPayload["type"][] {
    if (props.system === "COC7") {
      return props.canCounter ? ["PASS", "DODGE", "COUNTER"] : ["PASS", "DODGE"];
    }
    return props.canCounter ? ["PASS", "DEFEND", "DODGE", "COUNTER"] : ["PASS", "DEFEND", "DODGE"];
  }

  function reactionOptionsFor(targetIdValue: string): readonly CombatReactionPayload["type"][] {
    const types = reactionOptions[targetIdValue] ?? defaultReactionOptions();
    if (types.includes("COUNTER") && reactionSkillOptionsFor(targetIdValue, "COUNTER").length === 0) {
      return types.filter((type) => type !== "COUNTER");
    }
    return types;
  }

  function reactionDraftFor(targetIdValue: string): ReactionDraft {
    const options = reactionOptionsFor(targetIdValue);
    const existing = reactionDrafts[targetIdValue];
    if (existing !== undefined && options.includes(existing.type)) return existing;
    return { type: options[0] ?? "PASS", skill: "" };
  }

  function reactionSkillOptionsFor(targetIdValue: string, type: CombatReactionPayload["type"]): readonly SkillOption[] {
    if (type === "DODGE") {
      const ids = props.system === "TOUHOU" ? ["DODGE", "GRAZE"] : ["DODGE"];
      return props.skillOptions.filter((option) => ids.includes(option.id));
    }
    if (type === "COUNTER") {
      const ids =
        props.system === "COC7"
          ? (props.attackOptionsByParticipant[targetIdValue] ?? [])
              .map((option) => option.skillId)
              .filter((skillId) => skillId.startsWith("FIGHTING_"))
          : attackSkillsFor(targetIdValue);
      return props.skillOptions.filter((option) => ids.includes(option.id));
    }
    return [];
  }

  function moveInitiativeOrder(actorId: string, delta: number): void {
    const socket = socketRef.current;
    if (socket === null || view === null) return;
    const order = [...view.initiativeOrder];
    const index = order.indexOf(actorId);
    const nextIndex = index + delta;
    if (index < 0 || nextIndex < 0 || nextIndex >= order.length) return;
    const [moved] = order.splice(index, 1);
    if (moved === undefined) return;
    order.splice(nextIndex, 0, moved);
    socket.emit("combat:initiative-order", { combatId: props.combatId, order }, (result: Ack) => {
      if (result.ok === false) setError(result.error ?? "调整先攻顺序失败");
    });
  }

  function toggleReadyWeapon(): void {
    const socket = socketRef.current;
    if (socket === null || selectedActor === null) return;
    socket.emit(
      "combat:ready-weapon",
      { combatId: props.combatId, actorId: selectedActor.id, ready: selectedActorReadyWeapon === false },
      (result: Ack) => {
        if (result.ok === false) setError(result.error ?? "准备火器失败");
      }
    );
  }

  function emitAction(action: CombatActionPayload): void {
    const socket = socketRef.current;
    if (socket === null || socket.connected === false) {
      setError("连接已断开，请刷新后重试。");
      return;
    }
    if (selectedActor === null) {
      setError("当前没有可操作单位");
      return;
    }
    if (action.kind === "DANMAKU" && (action.targetId ?? "").length === 0) {
      setError("请先选择攻击目标");
      return;
    }
    setError(null);
    socket.emit("combat:action", { combatId: props.combatId, actorId: selectedActor.id, action }, (result: Ack) => {
      if (result.ok === false) setError(result.error ?? "行动失败");
    });
  }

  function emitChaseMove(steps: number): void {
    const socket = socketRef.current;
    if (socket === null || socket.connected === false) {
      setError("连接已断开，请刷新后重试。");
      return;
    }
    const actorIdForMove = chase?.activeActorId ?? null;
    if (actorIdForMove === null) return;
    setError(null);
    socket.emit(
      "combat:chase-move",
      { combatId: props.combatId, actorId: actorIdForMove, steps },
      (result: Ack) => {
        if (result.ok === false) setError(result.error ?? "追逐移动失败");
      }
    );
  }

  function emitChaseEndTurn(): void {
    const socket = socketRef.current;
    if (socket === null || socket.connected === false) {
      setError("连接已断开，请刷新后重试。");
      return;
    }
    const actorIdForTurn = chase?.activeActorId ?? null;
    if (actorIdForTurn === null) return;
    setError(null);
    socket.emit(
      "combat:chase-end-turn",
      { combatId: props.combatId, actorId: actorIdForTurn },
      (result: Ack) => {
        if (result.ok === false) setError(result.error ?? "结束追逐回合失败");
      }
    );
  }

  function emitChaseWithdraw(): void {
    const socket = socketRef.current;
    if (socket === null || socket.connected === false) {
      setError("连接已断开，请刷新后重试。");
      return;
    }
    const actorIdForWithdraw = chase?.activeActorId ?? null;
    if (actorIdForWithdraw === null) return;
    setError(null);
    socket.emit(
      "combat:chase-withdraw",
      { combatId: props.combatId, actorId: actorIdForWithdraw },
      (result: Ack) => {
        if (result.ok === false) setError(result.error ?? "放弃追逐失败");
      }
    );
  }

  function emitChaseAttack(): void {
    const socket = socketRef.current;
    if (socket === null || socket.connected === false) {
      setError("连接已断开，请刷新后重试。");
      return;
    }
    const actorIdForAttack = chase?.activeActorId ?? null;
    if (actorIdForAttack === null) return;
    if (activeChaseTargetId.length === 0) {
      setError("当前地点没有可攻击的敌对目标");
      return;
    }
    if (activeChaseSkill.length === 0) {
      setError("当前单位没有可用攻击技能");
      return;
    }
    setError(null);
    socket.emit(
      "combat:chase-attack",
      {
        combatId: props.combatId,
        actorId: actorIdForAttack,
        targetId: activeChaseTargetId,
        skill: activeChaseSkill,
        damage: activeChaseDamage,
        rangeBand: activeChaseBandIndex,
        shots: activeChaseShotCount
      },
      (result: Ack) => {
        if (result.ok === false) setError(result.error ?? "追逐攻击失败");
      }
    );
  }

  function setReactionDraft(targetIdValue: string, patch: Partial<ReactionDraft>): void {
    const current = reactionDraftFor(targetIdValue);
    setReactionDrafts((prev) => ({ ...prev, [targetIdValue]: { ...current, ...patch } }));
  }

  function submitReaction(targetIdValue: string): void {
    const socket = socketRef.current;
    if (socket === null || socket.connected === false) {
      setError("连接已断开，请刷新后重试。");
      return;
    }
    const draft = reactionDraftFor(targetIdValue);
    let skillValue = draft.skill;
    if (draft.type === "DODGE" && skillValue.length === 0) skillValue = "DODGE";
    if (draft.type === "COUNTER") {
      const options = reactionSkillOptionsFor(targetIdValue, "COUNTER");
      if (skillValue.length === 0) skillValue = options[0]?.id ?? "";
      if (skillValue.length === 0) {
        setError("没有可用反击技能");
        return;
      }
    }
    setError(null);
    socket.emit(
      "combat:reaction",
      {
        combatId: props.combatId,
        targetId: targetIdValue,
        reaction: { type: draft.type, skill: skillValue.length > 0 ? skillValue : undefined }
      },
      (result: Ack) => {
        if (result.ok === false) {
          setError(result.error ?? "反应提交失败");
          return;
        }
        setReactionDrafts((prev) => {
          const next = { ...prev };
          delete next[targetIdValue];
          return next;
        });
      }
    );
  }

  function abortCombat(): void {
    const socket = socketRef.current;
    if (socket === null) return;
    if (window.confirm("确定中止当前战斗吗？") === false) return;
    socket.emit("combat:abort", { combatId: props.combatId }, (result: Ack) => {
      if (result.ok === false) {
        setError(result.error ?? "中止失败");
        return;
      }
      router.refresh();
    });
  }

  function forceResolve(): void {
    const socket = socketRef.current;
    if (socket === null) return;
    socket.emit("combat:force-resolve", { combatId: props.combatId }, (result: Ack) => {
      if (result.ok === false) setError(result.error ?? "强制结算失败");
    });
  }

  function cardClass(item: ParticipantView): string {
    if (item.defeated) return "border-white/10 bg-ink-900/40 opacity-60";
    const controlled = isControlled(item);
    if (pendingTargetIds.has(item.id) && controlled) {
      return "border-amber-400/70 bg-amber-400/10 ring-2 ring-amber-400/25";
    }
    if (controlled && item.isReady) {
      return "border-emerald-400/60 bg-emerald-400/10 ring-2 ring-emerald-400/20";
    }
    if (activeActorId === item.id) {
      return "border-sakura-500/60 bg-sakura-500/10 ring-2 ring-sakura-500/25";
    }
    return "border-white/10 bg-ink-900/60";
  }

  function logBadge(entry: CombatView["log"][number]): { label: string; className: string } {
    const rollType = entry.data?.rollType;
    if (rollType === "ATTACK") return { label: "攻击检定", className: "border-sakura-500/40 text-sakura-300" };
    if (rollType === "DODGE") return { label: props.system === "COC7" ? "闪避检定" : "擦弹检定", className: "border-sky-400/40 text-sky-200" };
    if (rollType === "COUNTER") return { label: props.system === "COC7" ? "反击对抗" : "消弹对抗", className: "border-purple-400/40 text-purple-200" };
    if (rollType === "DAMAGE_ROLL") return { label: "伤害骰", className: "border-amber-400/40 text-amber-200" };
    if (rollType === "DAMAGE_SETTLE") return { label: "伤害结算", className: "border-red-400/40 text-red-200" };
    if (entry.kind === "CHECK") return { label: "检定", className: "border-sky-400/30 text-sky-200" };
    if (entry.kind === "DAMAGE") return { label: "伤害", className: "border-red-400/30 text-red-200" };
    if (entry.kind === "ACTION") return { label: "行动", className: "border-white/20 text-white/50" };
    if (entry.kind === "STATUS") return { label: "状态", className: "border-purple-400/30 text-purple-200" };
    if (entry.kind === "SPELLCARD") return { label: "法术", className: "border-purple-400/30 text-purple-200" };
    if (entry.kind === "DEFEAT") return { label: "退场", className: "border-red-400/40 text-red-300" };
    return { label: "系统", className: "border-white/20 text-white/45" };
  }

  const connLabel = conn === "online" ? "已连接" : conn === "connecting" ? "连接中" : "已断开";
  const inputClass =
    "rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-sakura-500";

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
      {props.canCastSpellcard ? (
        <div className="lg:col-span-2">
          <DanmakuStage view={view} spellCardsByParticipant={props.spellCardsByParticipant} />
        </div>
      ) : null}

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-ink-800/50 px-4 py-3">
          <div>
            <h2 className="text-sm font-medium text-white/80">
              {view === null ? "载入战斗..." : "战斗 · " + view.mode}
            </h2>
            <p className="mt-0.5 text-[11px] text-white/35">
              {view === null ? "" : "第 " + view.round + " 轮 " + view.tick + (activeActor === null ? "" : " · 当前 " + activeActor.name)}
            </p>
          </div>
          <span className={"rounded-full border px-2 py-0.5 text-[11px] " + (conn === "online" ? "border-emerald-400/40 text-emerald-300" : "border-white/20 text-white/50")}>
            {connLabel}
          </span>
        </div>

        {pendingReactions.length === 0 ? null : (
          <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-xs text-amber-100">
            {myPendingReactions.length > 0 ? (
              <p className="font-medium text-amber-200">轮到你应对了，请在下方选择应对方式。</p>
            ) : (
              <p>正在等待其他单位应对…{props.isKP ? "（KP 可强制结算）" : ""}</p>
            )}
            <p className="mt-1 text-[11px] text-amber-100/70">
              {pendingReactions.map((pending) => {
                const actorName = participants.find((item) => item.id === pending.actorId)?.name ?? "???";
                const targetName = participants.find((item) => item.id === pending.targetId)?.name ?? "???";
                return actorName + " → " + targetName;
              }).join("；")}
            </p>
          </div>
        )}

        {chase === null ? null : (
          <section className="rounded-xl border border-emerald-400/30 bg-emerald-400/5 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium text-emerald-200">追逐 · 第 {chase.round} 轮</h3>
              <span className="flex flex-wrap items-center gap-2 text-[11px] text-white/45">
                <span>地点 {chase.trackLength} 格 · 逃离者到达最后一格，或追方全部放弃即脱身</span>
                {chaseNearestDistanceFeet === null ? null : (
                  <span className="rounded border border-cyan-400/40 px-2 py-0.5 text-[10px] text-cyan-200" data-testid="chase-distance">
                    最近敌人地图距离 {chaseNearestDistanceFeet} 英尺
                  </span>
                )}
              </span>
            </div>
            <div className="mt-3 flex gap-2 overflow-x-auto pb-2">
              {Array.from({ length: chase.trackLength }).map((_, position) => {
                const here = chase.participants.filter(
                  (item) => item.withdrawn === false && item.position === position
                );
                return (
                  <div
                    key={position}
                    className={
                      "min-w-[120px] rounded-lg border px-2 py-2 " +
                      (here.length > 0 ? "border-white/20 bg-ink-900/70" : "border-white/5 bg-ink-900/30")
                    }
                  >
                    <p className="text-[10px] text-white/30">
                      {position === chase.trackLength - 1 ? "出口" : "地点 " + position}
                    </p>
                    <div className="mt-1 flex flex-col gap-1">
                      {here.map((item) => {
                        const current = chase.activeActorId === item.id;
                        return (
                          <span
                            key={item.id}
                            className={
                              "rounded px-1.5 py-0.5 text-[10px] " +
                              (item.side === "PREY"
                                ? "bg-amber-400/15 text-amber-200"
                                : "bg-red-400/15 text-red-200") +
                              (current ? " ring-1 ring-emerald-300" : "")
                            }
                          >
                            {item.side === "PREY" ? "逃 " : "追 "}
                            {item.name} · AP {item.actionPoints}/{item.maxActionPoints}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            {chase.participants.some((item) => item.withdrawn) ? (
              <p className="mt-1 text-[11px] text-white/45">
                已退出：
                {chase.participants
                  .filter((item) => item.withdrawn)
                  .map((item) => item.name)
                  .join("、")}
              </p>
            ) : null}
            {chase.status === "ACTIVE" ? (
              chaseActiveParticipant === null ? null : (
                <div className="mt-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-white/70">
                      {chaseActiveParticipant.name} 的回合 · MOV {chaseActiveParticipant.mov} · 剩余 AP{" "}
                      {chaseActiveParticipant.actionPoints}/{chaseActiveParticipant.maxActionPoints}
                    </span>
                    {chaseCanControl ? (
                      <>
                        <button
                          type="button"
                          disabled={chaseActiveParticipant.actionPoints < 1 || chaseActiveParticipant.position <= 0}
                          onClick={() => emitChaseMove(-1)}
                          className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/70 transition hover:border-white/35 disabled:opacity-40"
                        >
                          后退 1 格
                        </button>
                        <button
                          type="button"
                          disabled={
                            chaseActiveParticipant.actionPoints < 1 ||
                            chaseActiveParticipant.position >= chase.trackLength - 1
                          }
                          onClick={() => emitChaseMove(1)}
                          className="rounded-lg bg-emerald-400 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-300 disabled:opacity-40"
                        >
                          前进 1 格
                        </button>
                        <button
                          type="button"
                          onClick={emitChaseEndTurn}
                          className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/70 transition hover:border-white/35"
                        >
                          结束回合
                        </button>
                        <button
                          type="button"
                          onClick={emitChaseWithdraw}
                          className="rounded-lg border border-red-400/40 px-3 py-1.5 text-xs text-red-200 transition hover:border-red-300"
                        >
                          {chaseActiveParticipant.side === "PREY" ? "放弃逃跑 / 投降" : "放弃追逐"}
                        </button>
                      </>
                    ) : (
                      <span className="text-[11px] text-white/40">等待该单位行动</span>
                    )}
                  </div>
                  {chaseCanControl ? (
                    <div className="mt-3 rounded-lg border border-red-400/25 bg-red-400/5 p-3">
                      <p className="text-[11px] text-red-200/80">
                        同地点攻击消耗 1 行动点，目标可闪避或反击。
                      </p>
                      {chaseAttackPending ? (
                        <p className="mt-2 text-xs text-amber-200">
                          攻击已发出，正在等待目标应对…（KP 可强制结算）
                        </p>
                      ) : chaseTargetOptions.length === 0 ? (
                        <p className="mt-2 text-[11px] text-white/40">
                          当前地点没有敌对目标；先移动到目标所在地点。
                        </p>
                      ) : (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <select
                            value={activeChaseTargetId}
                            onChange={(event) => setChaseTargetId(event.target.value)}
                            className={inputClass}
                          >
                            {chaseTargetOptions.map((item) => {
                              const combat = participants.find((participant) => participant.id === item.id);
                              const hpText =
                                combat !== undefined && combat.hp !== null ? " · HP " + combat.hp : "";
                              return (
                                <option key={item.id} value={item.id}>
                                  {item.name}
                                  {hpText}
                                </option>
                              );
                            })}
                          </select>
                          {chaseDistanceFeet === null ? null : (
                            <span className="text-[10px] text-cyan-200" data-testid="chase-target-distance">
                              目标地图距离 {chaseDistanceFeet} 英尺
                            </span>
                          )}
                          <select
                            value={activeChaseSkill}
                            onChange={(event) => setChaseSkill(event.target.value)}
                            className={inputClass}
                            disabled={chaseAttackSkills.length === 0}
                          >
                            {chaseAttackSkills.length === 0 ? (
                              <option value="">当前无可用攻击技能</option>
                            ) : null}
                            {chaseAttackSkills.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.id} · {option.name}
                              </option>
                            ))}
                          </select>
                          <label className="flex min-w-[120px] flex-col gap-0.5">
                            <span className="text-[10px] text-white/35">
                              伤害 · {activeChaseSourceLabel}
                            </span>
                            <input
                              value={activeChaseDamage}
                              readOnly
                              title="伤害由实际装备决定"
                              className={inputClass + " w-28 cursor-not-allowed font-mono opacity-70"}
                            />
                          </label>
                          {activeChaseBands.length > 1 ? (
                            <label className="flex min-w-[120px] flex-col gap-0.5">
                              <span className="text-[10px] text-white/35">距离档</span>
                              <select
                                value={activeChaseBandIndex}
                                onChange={(event) => setChaseRangeBand(Number(event.target.value))}
                                className={inputClass}
                              >
                                {activeChaseBands.map((band, index) => (
                                  <option key={band.label + index} value={index}>
                                    {band.label} · {band.expression}
                                  </option>
                                ))}
                              </select>
                            </label>
                          ) : null}
                          {activeChaseShots.length > 1 ? (
                            <label className="flex min-w-[120px] flex-col gap-0.5">
                              <span className="text-[10px] text-white/35">射击次数</span>
                              <select
                                value={activeChaseShotCount}
                                onChange={(event) => setChaseShotCount(Number(event.target.value))}
                                className={inputClass}
                              >
                                {activeChaseShots.map((count) => (
                                  <option key={count} value={count}>{count} 发{count > 1 ? "（每发惩罚骰）" : ""}</option>
                                ))}
                              </select>
                            </label>
                          ) : null}
                          <button
                            type="button"
                            disabled={
                              chaseActiveParticipant.actionPoints < 1 ||
                              chaseAttackSkills.length === 0 ||
                              activeChaseTargetId.length === 0
                            }
                            onClick={emitChaseAttack}
                            className="rounded-lg bg-red-400 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-red-300 disabled:opacity-40"
                          >
                            攻击同地点目标（1 AP）
                          </button>
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              )
            ) : (
              <p className="mt-2 text-xs text-white/60">{chase.ending ?? "追逐已结束"}</p>
            )}
          </section>
        )}

        <section className="rounded-xl border border-white/10 bg-ink-800/50 p-4">
          <h3 className="text-sm font-medium text-white/80">参战单位</h3>
          <div className="mt-3 flex gap-3 overflow-x-auto pb-2">
            {participants.map((item) => {
              const controlled = isControlled(item);
              const awaiting = pendingTargetIds.has(item.id);
              const canActNow = chaseActive === false && controlled && item.isReady;
              const current = chaseActive === false && (activeActorId === item.id || (view?.mode === "ATB" && item.isReady));
              const hiddenStats = item.kind === "PLAYER" && item.isSelf === false && item.hp === null;
              const portrait = props.portraits[item.id];
              return (
                <div
                  key={item.id}
                  className={"w-[250px] shrink-0 rounded-xl border px-3 py-3 transition " + cardClass(item)}
                >
                  {portrait === undefined ? (
                    <div className="mb-3 flex h-32 w-full items-center justify-center rounded-lg border border-white/10 bg-ink-900/70 text-2xl font-semibold text-white/25">
                      {item.name.slice(0, 1)}
                    </div>
                  ) : (
                    <img src={portrait} alt={item.name} className="mb-3 h-32 w-full rounded-lg border border-white/15 object-cover" />
                  )}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-white/85">{item.name}</span>
                      {item.isSelf ? (
                        <span className="rounded border border-sakura-500/40 px-1.5 py-0.5 text-[10px] text-sakura-300">你</span>
                      ) : null}
                      {canActNow ? (
                        <span className="rounded border border-emerald-400/40 px-1.5 py-0.5 text-[10px] text-emerald-300">可行动</span>
                      ) : null}
                      {current ? (
                        <span className="rounded bg-sakura-500 px-1.5 py-0.5 text-[10px] text-sakura-200">当前行动</span>
                      ) : null}
                      {awaiting ? (
                        <span className="rounded border border-amber-400/50 bg-amber-400/10 px-1.5 py-0.5 text-[10px] text-amber-200">等待应对</span>
                      ) : null}
                      {item.defeated ? (
                        <span className="rounded border border-red-400/40 px-1.5 py-0.5 text-[10px] text-red-300">已退场</span>
                      ) : null}
                      {controlled === false && item.defeated === false ? (
                        <span className="rounded border border-white/15 px-1.5 py-0.5 text-[10px] text-white/35">旁观</span>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-2">
                    {item.hp === null ? (
                      <p className="text-[11px] text-white/45">
                        {hiddenStats ? "HP ？？？" : "HP " + (item.hpText ?? "情报未知")}
                      </p>
                    ) : (
                      <>
                        <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                          <div
                            className={
                              "h-full rounded-full " +
                              (hpPercent(item.hp, item.maxHp ?? 0) <= 25
                                ? "bg-red-400"
                                : hpPercent(item.hp, item.maxHp ?? 0) <= 50
                                  ? "bg-amber-400"
                                  : "bg-emerald-400")
                            }
                            style={{ width: hpPercent(item.hp, item.maxHp ?? 0) + "%" }}
                          />
                        </div>
                        <p className="mt-1 font-mono text-[11px] text-white/55">HP {item.hp}/{item.maxHp}</p>
                      </>
                    )}
                  </div>
                  {view?.mode === "ATB" ? (
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full rounded-full bg-spirit-400" style={{ width: percent(item.atbValue, item.atbMax) + "%" }} />
                    </div>
                  ) : null}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {item.dead ? (
                      <span className="rounded border border-red-500/60 bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-300">死亡</span>
                    ) : null}
                    {item.dying ? (
                      <span className="rounded border border-red-400/60 bg-red-400/10 px-1.5 py-0.5 text-[10px] text-red-200">濒死</span>
                    ) : null}
                    {item.majorWound && item.dead === false ? (
                      <span className="rounded border border-orange-400/50 bg-orange-400/10 px-1.5 py-0.5 text-[10px] text-orange-200">重伤</span>
                    ) : null}
                    {item.prone ? (
                      <span className="rounded border border-white/20 px-1.5 py-0.5 text-[10px] text-white/50">倒地</span>
                    ) : null}
                    {item.grappledBy !== null ? (
                      <span className="rounded border border-fuchsia-400/45 bg-fuchsia-400/10 px-1.5 py-0.5 text-[10px] text-fuchsia-200">被擒抱</span>
                    ) : null}
                    {item.disarmed ? (
                      <span className="rounded border border-white/20 px-1.5 py-0.5 text-[10px] text-white/50">被缴械</span>
                    ) : null}
                    {item.unconscious && item.dying === false && item.dead === false ? (
                      <span className="rounded border border-sky-400/50 bg-sky-400/10 px-1.5 py-0.5 text-[10px] text-sky-200">昏迷</span>
                    ) : null}
                    {(item.stunActions ?? 0) > 0 ? (
                      <span className="rounded border border-amber-400/40 px-1.5 py-0.5 text-[10px] text-amber-300">眩晕×{item.stunActions}</span>
                    ) : null}
                    {(item.controlActions ?? 0) > 0 ? (
                      <span className="rounded border border-purple-400/40 px-1.5 py-0.5 text-[10px] text-purple-300">控制×{item.controlActions}</span>
                    ) : null}
                    {item.statusEffects.map((effect) => (
                      <span key={effect} className="rounded border border-white/15 px-1.5 py-0.5 text-[10px] text-white/45">{effect}</span>
                    ))}
                  </div>
                  <p className="mt-2 text-[10px] text-white/30">
                    {hiddenStats ? "速度 ？？？" : "速度 " + (item.speed / 1000).toFixed(2)}
                    {item.faction === null ? "" : " · 阵营 " + item.faction}
                    {item.hasDeclaration ? " · 符卡展开" + (hiddenStats || item.declarationHp === null ? " HP ？？？" : " HP " + item.declarationHp) : ""}
                  </p>
                </div>
              );
            })}
          </div>
          {view?.mode === "INITIATIVE" ? (
            <div className="mt-3 flex flex-wrap items-center gap-1 text-[11px] text-white/45">
              <span>出手顺序：</span>
              {view.initiativeOrder.map((id, index) => (
                <span key={id} className="inline-flex items-center gap-0.5 rounded border border-white/10 px-1.5 py-0.5">
                  {participants.find((item) => item.id === id)?.name ?? "???"}
                  {props.isKP ? (
                    <>
                      <button
                        type="button"
                        disabled={index === 0}
                        onClick={() => moveInitiativeOrder(id, -1)}
                        title="提前"
                        className="rounded px-1 text-white/40 hover:bg-white/10 hover:text-white disabled:opacity-20"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        disabled={index === view.initiativeOrder.length - 1}
                        onClick={() => moveInitiativeOrder(id, 1)}
                        title="后移"
                        className="rounded px-1 text-white/40 hover:bg-white/10 hover:text-white disabled:opacity-20"
                      >
                        ↓
                      </button>
                    </>
                  ) : null}
                </span>
              ))}
            </div>
          ) : null}
        </section>

        {myPendingReactions.length > 0 ? (
          <section className="rounded-xl border border-amber-400/40 bg-amber-400/5 p-4">
            <h3 className="text-sm font-medium text-amber-200">你需要应对（{myPendingReactions.length}）</h3>
            <div className="mt-3 flex flex-col gap-3">
              {myPendingReactions.map((pending) => {
                const target = participants.find((item) => item.id === pending.targetId);
                const attackerName = participants.find((item) => item.id === pending.actorId)?.name ?? "???";
                const targetName = target?.name ?? "???";
                const draft = reactionDraftFor(pending.targetId);
                const skillOptions = reactionSkillOptionsFor(pending.targetId, draft.type);
                const selectedSkill = skillOptions.some((option) => option.id === draft.skill)
                  ? draft.skill
                  : (skillOptions[0]?.id ?? "");
                return (
                  <div key={pending.targetId} className="rounded-lg border border-amber-400/40 bg-ink-900/60 p-3">
                    <p className="text-xs text-amber-100">
                      {attackerName} 攻击 {targetName}，请选择 <span className="font-medium">{targetName}</span> 的应对：
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <select
                        value={draft.type}
                        onChange={(event) => setReactionDraft(pending.targetId, { type: event.target.value as CombatReactionPayload["type"], skill: "" })}
                        className={inputClass}
                      >
                        {reactionOptionsFor(pending.targetId).map((type) => (
                          <option key={type} value={type}>{reactionLabel(type)}</option>
                        ))}
                      </select>
                      {skillOptions.length === 0 ? null : (
                        <select
                          value={selectedSkill}
                          onChange={(event) => setReactionDraft(pending.targetId, { skill: event.target.value })}
                          className={inputClass}
                        >
                          {skillOptions.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.name}（{target?.skills?.[option.id] ?? "-"}）
                            </option>
                          ))}
                        </select>
                      )}
                      <button
                        type="button"
                        onClick={() => submitReaction(pending.targetId)}
                        className="rounded-lg bg-amber-400 px-3 py-2 text-xs font-medium text-white transition hover:bg-amber-300"
                      >
                        提交应对
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        {otherPendingReactions.length === 0 ? null : (
          <p className="rounded-lg border border-white/10 bg-ink-900/50 px-3 py-2 text-[11px] text-white/40">
            其他单位正在应对：{otherPendingReactions.map((pending) => {
              const actorName = participants.find((item) => item.id === pending.actorId)?.name ?? "???";
              const targetName = participants.find((item) => item.id === pending.targetId)?.name ?? "???";
              return actorName + " → " + targetName;
            }).join("；")}
          </p>
        )}

        <section className="rounded-xl border border-white/10 bg-ink-800/50 p-4">
          <h3 className="text-sm font-medium text-white/80">行动</h3>
          {selectedActor === null ? (
            <p className="mt-3 text-xs text-white/40">
              {chaseActive
                ? "追逐进行中，请使用上方追逐面板移动、攻击或结束回合。"
                : myPendingReactions.length > 0
                  ? "请先完成上方的应对。"
                  : activeActor === null
                    ? "当前没有可行动的参战单位。"
                    : isControlled(activeActor)
                      ? "当前单位还没就绪，请等待结算。"
                      : "等待 " + activeActor.name + " 你没有可操作单位，只能旁观。"}
            </p>
          ) : (
            <div className="mt-3 flex flex-col gap-3">
              <div className="rounded-lg border border-emerald-400/30 bg-emerald-400/5 px-3 py-2">
                <p className="text-xs text-emerald-200">
                  当前行动：<span className="font-medium">{selectedActor.name}</span>
                  {selectedActor.isSelf ? "（你的角色）" : "（你操控的 NPC）"}
                </p>
                {actionable.length > 1 ? (
                  <select
                    value={selectedActor.id}
                    onChange={(event) => setActorId(event.target.value)}
                    className={inputClass + " mt-2"}
                  >
                    {actionable.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} · HP {item.hp === null ? (item.hpText ?? "情报未知") : item.hp + "/" + item.maxHp}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <label className="flex flex-col gap-1.5 sm:col-span-2">
                  <span className="text-[11px] text-white/40">目标</span>
                  <select value={activeTargetId} onChange={(event) => setTargetId(event.target.value)} className={inputClass}>
                    {targetOptions.map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                  {activeDistanceFeet === null ? null : (
                    <span className="text-[10px] text-cyan-200" data-testid="combat-distance">
                      地图距离 {activeDistanceFeet} 英尺{activeAttackBands.length > 1 ? "（服务端按实际距离自动选档）" : ""}
                    </span>
                  )}
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[11px] text-white/40">技能</span>
                  <select
                    value={activeSkill}
                    onChange={(event) => setSkill(event.target.value)}
                    className={inputClass}
                    disabled={attackSkills.length === 0}
                  >
                    {attackSkills.length === 0 ? <option value="">当前无可用攻击技能</option> : null}
                    {attackSkills.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.id} · {option.name}（{actorSkills[option.id] ?? "-"}）
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1.5 sm:col-span-2">
                  <span className="text-[11px] text-white/40">
                    伤害 · {activeAttackSourceLabel}（由角色实际装备决定，不可修改）
                  </span>
                  <input
                    value={activeAttackDamage}
                    readOnly
                    title="伤害由实际装备决定"
                    className={inputClass + " cursor-not-allowed font-mono opacity-70"}
                  />
                </label>
                {activeAttackBands.length > 1 ? (
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[11px] text-white/40">距离档</span>
                    <select
                      value={activeAttackBandIndex}
                      onChange={(event) => setRangeBand(Number(event.target.value))}
                      className={inputClass}
                    >
                      {activeAttackBands.map((band, index) => (
                        <option key={band.label + index} value={index}>
                          {band.label} · {band.expression}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {activeAttackOption?.skillId.startsWith("FIREARMS_") ? (
                  <label className="flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-2 text-xs text-white/65">
                    <input
                      type="checkbox"
                      checked={pointBlank}
                      onChange={(event) => setPointBlank(event.target.checked)}
                    />
                    近距离点射（+1 奖励骰）
                  </label>
                ) : null}
                {activeAttackShots.length > 1 ? (
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[11px] text-white/40">射击次数</span>
                    <select
                      value={activeAttackShotCount}
                      onChange={(event) => setShotCount(Number(event.target.value))}
                      className={inputClass}
                    >
                      {activeAttackShots.map((count) => (
                        <option key={count} value={count}>{count} 发{count > 1 ? "（每发惩罚骰）" : ""}</option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={attackSkills.length === 0}
                  onClick={() =>
                    emitAction({
                      kind: "DANMAKU",
                      targetId: activeTargetId,
                      skill: activeSkill,
                      damage: activeAttackDamage,
                      rangeBand: activeAttackBandIndex,
                      shots: activeAttackShotCount,
                      pointBlank
                    })
                  }
                  className="rounded-lg bg-sakura-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-sakura-400 disabled:opacity-40"
                >
                  攻击
                </button>
                {props.system === "COC7" && selectedActorHasBrawl ? (
                  <>
                    <select
                      value={maneuver}
                      onChange={(event) =>
                        setManeuver(
                          event.target.value === "DISARM" || event.target.value === "GRAPPLE"
                            ? event.target.value
                            : "TRIP"
                        )
                      }
                      className={inputClass + " max-w-[150px]"}
                    >
                      <option value="TRIP">战技：踢倒</option>
                      <option value="DISARM">战技：缴械</option>
                      <option value="GRAPPLE">战技：擒拿</option>
                    </select>
                    <button
                      type="button"
                      disabled={activeTargetId.length === 0}
                      onClick={() =>
                        emitAction({ kind: "MANEUVER", maneuver, targetId: activeTargetId })
                      }
                      className="rounded-lg border border-sky-400/40 px-3 py-2 text-xs text-sky-200 transition hover:bg-sky-400/10 disabled:opacity-40"
                    >
                      使用战技
                    </button>
                  </>
                ) : null}
                {props.system === "COC7" && selectedActorHasFirearm ? (
                  <button
                    type="button"
                    onClick={toggleReadyWeapon}
                    className={
                      "rounded-lg border px-3 py-2 text-xs transition " +
                      (selectedActorReadyWeapon
                        ? "border-amber-400/60 bg-amber-400/10 text-amber-200"
                        : "border-white/15 text-white/60 hover:border-white/35")
                    }
                  >
                    {selectedActorReadyWeapon ? "取消准备火器" : "准备火器（先攻 +50）"}
                  </button>
                ) : null}
                {props.system === "TOUHOU" ? (
                  <button type="button" onClick={() => emitAction({ kind: "DEFEND" })} className="rounded-lg border border-white/15 px-3 py-2 text-xs text-white/60 transition hover:border-white/35">防御姿态</button>
                ) : null}
                {props.system === "TOUHOU" && (selectedActor?.grazePoints ?? 0) > 0 ? (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-400/30 bg-sky-400/5 px-2 py-1.5 text-[11px] text-sky-100">
                    <span className="font-mono">擦弹 {selectedActor?.grazePoints ?? 0}</span>
                    <button
                      type="button"
                      disabled={(selectedActor?.grazePoints ?? 0) < 5}
                      onClick={() => emitAction({ kind: "PASS", grazeSpend: "MP" })}
                      className="rounded border border-sky-400/40 px-2 py-1 transition hover:bg-sky-400/10 disabled:opacity-40"
                    >
                      回灵 5:1
                    </button>
                    <button
                      type="button"
                      disabled={(selectedActor?.grazePoints ?? 0) < 1}
                      onClick={() => emitAction({ kind: "PASS", grazeSpend: "MELEE_DAMAGE" })}
                      className="rounded border border-sky-400/40 px-2 py-1 transition hover:bg-sky-400/10 disabled:opacity-40"
                    >
                      近战强化 1:1
                    </button>
                    <button
                      type="button"
                      disabled={(selectedActor?.grazePoints ?? 0) < 2}
                      onClick={() => emitAction({ kind: "PASS", grazeSpend: "RANGED_DAMAGE" })}
                      className="rounded border border-sky-400/40 px-2 py-1 transition hover:bg-sky-400/10 disabled:opacity-40"
                    >
                      射击强化 2:1
                    </button>
                  </div>
                ) : null}
                <button type="button" onClick={() => emitAction({ kind: "DODGE" })} className="rounded-lg border border-white/15 px-3 py-2 text-xs text-white/60 transition hover:border-white/35">
                  {props.system === "COC7" ? "闪避姿态" : "闪避 / 擦弹姿态"}
                </button>
                {props.canCounter ? (
                  <button type="button" onClick={() => emitAction({ kind: "COUNTER" })} className="rounded-lg border border-white/15 px-3 py-2 text-xs text-white/60 transition hover:border-white/35">
                    {props.system === "COC7" ? "反击姿态" : "消弹姿态"}
                  </button>
                ) : null}
                <button type="button" onClick={() => emitAction({ kind: "PASS" })} className="rounded-lg border border-white/15 px-3 py-2 text-xs text-white/60 transition hover:border-white/35">跳过</button>
                <button
                  type="button"
                  onClick={() => emitAction({ kind: "FLEE" })}
                  className="rounded-lg border border-amber-400/40 px-3 py-2 text-xs text-amber-200 transition hover:bg-amber-400/10"
                >
                  逃跑 / 发起追逐
                </button>
              </div>

              {props.system === "COC7" && attackSkills.length > 0 ? (
                <details className="rounded-lg border border-white/10 bg-ink-900/50 p-3">
                  <summary className="cursor-pointer text-[11px] text-white/55">
                    多目标 / 多技能攻击 routine（U-3，同一行动内换技能 / 换目标 / 连射）
                  </summary>
                  <div className="mt-2 flex flex-col gap-2">
                    {routineDrafts.length === 0 ? (
                      <p className="text-[11px] text-white/35">还没有步骤。点击“添加攻击步骤”开始。</p>
                    ) : (
                      routineDrafts.map((step, index) => {
                        const stepOption = attackOptionFor(selectedActorId, step.skill);
                        const stepBands = stepOption?.damageBands ?? [];
                        const stepShots = stepOption?.shots ?? [1];
                        return (
                          <div key={index} className="flex flex-wrap items-end gap-2 rounded-lg border border-white/10 bg-ink-900/60 p-2">
                            <span className="pb-1 text-[10px] text-white/35">#{index + 1}</span>
                            <label className="flex flex-col gap-0.5">
                              <span className="text-[10px] text-white/35">目标</span>
                              <select
                                data-testid={"routine-target-" + index}
                                value={step.targetId}
                                onChange={(event) => updateRoutineStep(index, { targetId: event.target.value })}
                                className={inputClass + " max-w-[160px]"}
                              >
                                {targetOptions.map((item) => (
                                  <option key={item.id} value={item.id}>{item.name}</option>
                                ))}
                              </select>
                            </label>
                            <label className="flex flex-col gap-0.5">
                              <span className="text-[10px] text-white/35">技能</span>
                              <select
                                data-testid={"routine-skill-" + index}
                                value={step.skill}
                                onChange={(event) => updateRoutineStep(index, { skill: event.target.value, rangeBand: 0, shots: 1 })}
                                className={inputClass + " max-w-[200px]"}
                              >
                                {attackSkills.map((option) => (
                                  <option key={option.id} value={option.id}>{option.name}</option>
                                ))}
                              </select>
                            </label>
                            {stepBands.length > 1 ? (
                              <label className="flex flex-col gap-0.5">
                                <span className="text-[10px] text-white/35">距离档</span>
                                <select
                                  data-testid={"routine-band-" + index}
                                  value={step.rangeBand}
                                  onChange={(event) => updateRoutineStep(index, { rangeBand: Number(event.target.value) })}
                                  className={inputClass}
                                >
                                  {stepBands.map((band, bandIndex) => (
                                    <option key={band.label + bandIndex} value={bandIndex}>{band.label} · {band.expression}</option>
                                  ))}
                                </select>
                              </label>
                            ) : null}
                            {stepShots.length > 1 ? (
                              <label className="flex flex-col gap-0.5">
                                <span className="text-[10px] text-white/35">射击数</span>
                                <select
                                  data-testid={"routine-shots-" + index}
                                  value={step.shots}
                                  onChange={(event) => updateRoutineStep(index, { shots: Number(event.target.value) })}
                                  className={inputClass}
                                >
                                  {stepShots.map((count) => (
                                    <option key={count} value={count}>{count} 发</option>
                                  ))}
                                </select>
                              </label>
                            ) : null}
                            {stepOption?.skillId.startsWith("FIREARMS_") ? (
                              <label className="flex items-center gap-1 pb-1 text-[11px] text-white/60">
                                <input
                                  type="checkbox"
                                  checked={step.pointBlank}
                                  onChange={(event) => updateRoutineStep(index, { pointBlank: event.target.checked })}
                                />
                                近距离点射
                              </label>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => removeRoutineStep(index)}
                              className="rounded border border-red-400/40 px-2 py-1 text-[10px] text-red-300 transition hover:bg-red-400/10"
                            >
                              移除
                            </button>
                          </div>
                        );
                      })
                    )}
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={addRoutineStep}
                        className="rounded-lg border border-spirit-400/40 px-3 py-1.5 text-xs text-spirit-200 transition hover:bg-spirit-400/10"
                      >
                        添加攻击步骤
                      </button>
                      <button
                        type="button"
                        disabled={routineDrafts.length === 0}
                        onClick={emitRoutine}
                        className="rounded-lg bg-spirit-400 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-spirit-300 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        执行多目标 routine
                      </button>
                    </div>
                  </div>
                </details>
              ) : null}

              {props.canCastSpellcard && actorSpellCards.length > 0 ? (
                <div className="flex flex-col gap-2 rounded-lg border border-sakura-500/30 bg-sakura-500/5 p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={activeSpellCardId}
                      onChange={(event) => setSpellCardId(event.target.value)}
                      className={inputClass + " flex-1"}
                    >
                      {actorSpellCards.map((card) => (
                        <option key={card.cardId} value={card.cardId}>
                          {card.name}（{card.mode === "DECLARATION" ? "展开" : "消费"} · MP {card.mpCost}）
                        </option>
                      ))}
                    </select>
                    {spellcardEffectTargets.length > 1 ? (
                      <select
                        value={activeSpellCardTargetId}
                        onChange={(event) => setSpellCardTargetId(event.target.value)}
                        className={inputClass}
                      >
                        {spellcardEffectTargets.map((participant) => (
                          <option key={participant.id} value={participant.id}>
                            {participant.name}{participant.id === selectedActorId ? "（自己）" : ""}
                          </option>
                        ))}
                      </select>
                    ) : null}
                    <button
                      type="button"
                      disabled={
                        activeSpellCardId.length === 0 ||
                        (selectedSpellCard?.mode === "DECLARATION" && selectedActor?.hasDeclaration === true)
                      }
                      onClick={() =>
                        emitAction({
                          kind: "SPELLCARD",
                          spellCardId: activeSpellCardId,
                          ...(activeSpellCardTargetId.length > 0 ? { targetId: activeSpellCardTargetId } : {})
                        })
                      }
                      className="rounded-lg bg-sakura-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-sakura-400 disabled:opacity-40"
                    >
                      释放符卡
                    </button>
                  </div>
                  {selectedSpellCard === null ? null : (
                    <p className="text-[10px] text-sakura-200/70">
                      {selectedSpellCard.mode === "DECLARATION"
                        ? "展开型：独立 HP，展开时结算卡面效果；强化 " + selectedSpellCard.enhanceType + " 行动，击破时清弹。"
                        : "消费型：发动一次、结算卡面效果并消弹，演出播放一次。"}
                      {selectedSpellCard.mode === "DECLARATION" && selectedActor !== null && selectedSpellCard.hpRatio !== null
                        ? " 独立 HP 约 " + Math.max(1, Math.round((selectedActor.maxHp ?? 0) * selectedSpellCard.hpRatio)) + "。"
                        : ""}
                    </p>
                  )}
                </div>
              ) : null}
              {props.canOutOfRule ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input value={outName} onChange={(event) => setOutName(event.target.value)} className={inputClass + " flex-1"} />
                  <button type="button" onClick={() => emitAction({ kind: "OUT_OF_RULE", name: outName })} className="rounded-lg border border-purple-400/40 px-3 py-2 text-xs text-purple-300 transition hover:bg-purple-400/10">规则外施法</button>
                </div>
              ) : null}
              {props.canCastMagic && actorMagicSpells.length > 0 ? (
                <div className="flex flex-col gap-2 rounded-lg border border-purple-400/30 bg-purple-400/5 p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <select value={activeSpell} onChange={(event) => setSpellId(event.target.value)} className={inputClass + " flex-1"}>
                      {actorMagicSpells.map((spell) => (
                        <option key={spell.id} value={spell.id}>
                          {spell.name}（MP {spell.mpCost} / SAN {spell.sanCost}{spell.effects.length === 0 ? "" : " / " + spell.effects.join(" + ")}）
                        </option>
                      ))}
                    </select>
                    {selectedSpell !== null && selectedSpell.target === "ONE" && selectedSpell.targeting !== "SELF" ? (
                      <select value={activeSpellTargetId} onChange={(event) => setSpellTargetId(event.target.value)} className={inputClass}>
                        {spellTargetOptions.map((participant) => (
                          <option key={participant.id} value={participant.id}>
                            {participant.name}{participant.isSelf ? "（自己）" : ""}
                          </option>
                        ))}
                      </select>
                    ) : null}
                    <button
                      type="button"
                      disabled={selectedSpell === null || (selectedSpell.target === "ONE" && selectedSpell.targeting !== "SELF" && activeSpellTargetId.length === 0)}
                      onClick={() => {
                        if (selectedSpell === null) return;
                        const castTargetId =
                          selectedSpell.target === "SELF" || selectedSpell.targeting === "SELF"
                            ? selectedActor.id
                            : selectedSpell.target === "ALL"
                              ? null
                              : activeSpellTargetId;
                        emitAction({ kind: "MAGIC", targetId: castTargetId, spellId: activeSpell, name: selectedSpell.name });
                      }}
                      className="rounded-lg bg-purple-400 px-4 py-2 text-sm font-medium text-white transition hover:bg-purple-300 disabled:opacity-40"
                    >
                      施法
                    </button>
                  </div>
                  {selectedSpell === null ? null : (
                    <p className="text-[10px] text-purple-200/70">
                      目标：{selectedSpell.target === "SELF" || selectedSpell.targeting === "SELF"
                        ? "自己"
                        : selectedSpell.target === "ALL"
                          ? selectedSpell.targeting === "ENEMY" ? "全体敌方" : selectedSpell.targeting === "ALLY" ? "全体友方" : "场上全体"
                          : selectedSpell.targeting === "ENEMY" ? "单体敌方" : selectedSpell.targeting === "ALLY" ? "单体友方" : "任意单体"}
                      {selectedSpell.effects.length === 0 ? "" : " · 效果：" + selectedSpell.effects.join(" + ")}
                    </p>
                  )}
                </div>
              ) : null}
              {actorItems.length > 0 ? (
                <div className="flex flex-col gap-2 rounded-lg border border-emerald-400/30 bg-emerald-400/5 p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <select value={activeItemCardId} onChange={(event) => setItemCardId(event.target.value)} className={inputClass + " flex-1"}>
                      {actorItems.map((item) => (
                        <option key={item.cardId} value={item.cardId}>
                          {item.name}（{item.effects.map((effect) => magicEffectLabel(effect)).join(" + ")}
                          {item.cost.mp > 0 ? " · MP " + item.cost.mp : ""}
                          {item.cost.san === null ? "" : " · SAN " + item.cost.san}
                          {item.cost.uses === null ? "" : " · 剩 " + item.cost.uses + " 次"}
                          {item.cost.cooldownRounds > 0 ? " · CD " + item.cost.cooldownRounds + " 轮" : ""}）
                        </option>
                      ))}
                    </select>
                    {selectedItem !== null && selectedItem.targetScope !== "ALL" && selectedItem.targetScope !== "SELF" && selectedItem.targeting !== "SELF" ? (
                      <select value={activeItemTargetId} onChange={(event) => setItemTargetId(event.target.value)} className={inputClass}>
                        {itemTargetOptions.map((participant) => (
                          <option key={participant.id} value={participant.id}>{participant.name}{participant.isSelf ? "（自己）" : ""}</option>
                        ))}
                      </select>
                    ) : null}
                    <button
                      type="button"
                      disabled={selectedItem === null || (selectedItem.targetScope === "ONE" && selectedItem.targeting !== "SELF" && activeItemTargetId.length === 0)}
                      onClick={() => {
                        if (selectedItem === null) return;
                        const target =
                          selectedItem.targetScope === "SELF" || selectedItem.targeting === "SELF"
                            ? selectedActor.id
                            : selectedItem.targetScope === "ALL"
                              ? null
                              : activeItemTargetId;
                        emitAction({ kind: "ITEM", itemCardId: selectedItem.cardId, targetId: target });
                      }}
                      className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-400 disabled:opacity-40"
                    >
                      使用道具
                    </button>
                  </div>
                  {selectedItem === null ? null : (
                    <p className="text-[10px] text-emerald-200/70">
                      目标：{selectedItem.targetScope === "SELF" || selectedItem.targeting === "SELF"
                        ? "自己"
                        : selectedItem.targetScope === "ALL"
                          ? selectedItem.targeting === "ENEMY" ? "全体敌方" : selectedItem.targeting === "ALLY" ? "全体友方" : "场上全体"
                          : selectedItem.targeting === "ENEMY" ? "单体敌方" : selectedItem.targeting === "ALLY" ? "单体友方" : "任意单体"}
                      {" · 效果：" + selectedItem.effects.map((effect) => magicEffectLabel(effect)).join(" + ")}
                    </p>
                  )}
                </div>
              ) : null}
            </div>
          )}

          {props.isKP ? (
            <>
              <button
                type="button"
                onClick={forceResolve}
                className="mt-4 rounded-lg border border-white/15 px-3 py-2 text-xs text-white/50 transition hover:border-white/35"
              >
                KP 强制结算
              </button>
              <button
                type="button"
                onClick={abortCombat}
                className="mt-2 rounded-lg border border-red-400/30 px-3 py-2 text-xs text-red-300 transition hover:bg-red-400/10"
              >
                中止战斗
              </button>
            </>
          ) : null}
        </section>
      </section>

      <aside className="rounded-xl border border-white/10 bg-ink-800/50 p-4">
        <h3 className="text-sm font-medium text-white/80">战斗日志</h3>
        {error === null ? null : (
          <p className="mt-2 rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-2 text-xs text-red-300">{error}</p>
        )}
        <ul className="mt-3 flex max-h-[680px] flex-col gap-2 overflow-y-auto">
          {(view?.log ?? []).slice().reverse().map((entry) => {
            const badge = logBadge(entry);
            return (
              <li key={entry.seq} className="rounded-lg border border-white/5 bg-ink-900/50 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className={"rounded border px-1.5 py-0.5 text-[10px] " + badge.className}>{badge.label}</span>
                  <span className="font-mono text-[10px] text-white/25">tick {entry.tick}</span>
                </div>
                <p className="mt-1 text-xs text-white/65">{entry.text}</p>
              </li>
            );
          })}
        </ul>
      </aside>
    </div>
  );
}
