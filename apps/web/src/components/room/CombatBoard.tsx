"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { io, type Socket } from "socket.io-client";
import type { CombatView, ParticipantView } from "@touhou/combat";
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
  readonly magicSpells: readonly MagicSpellOption[];
  readonly attackSkillsByParticipant: Readonly<Record<string, readonly string[]>>;
  /** combatParticipant.id -> 立绘 / 头像 URL。 */
  readonly portraits: Readonly<Record<string, string>>;
}

const REACTION_LABELS: Record<CombatReactionPayload["type"], string> = {
  PASS: "不应对",
  DEFEND: "防御",
  DODGE: "闪避",
  COUNTER: "反击"
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
  const [damage, setDamage] = useState("1d6");
  const [outName, setOutName] = useState("规则外法术");
  const [spellId, setSpellId] = useState("");
  const [spellTargetId, setSpellTargetId] = useState("");
  const [actorId, setActorId] = useState("");
  const [chaseTargetId, setChaseTargetId] = useState("");
  const [chaseSkill, setChaseSkill] = useState("");
  const [chaseDamage, setChaseDamage] = useState("1d6");
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
        setError("无法获取连接票据，请刷新页面");
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
  const chaseActiveParticipant =
    chase === null || chase.activeActorId === null
      ? null
      : chase.participants.find((item) => item.id === chase.activeActorId) ?? null;

  function isControlled(item: ParticipantView): boolean {
    return item.isSelf || (props.isKP && item.kind === "NPC");
  }

  function isChaseControlled(participantId: string): boolean {
    const item = participants.find((participant) => participant.id === participantId);
    return item !== undefined && isControlled(item);
  }

  const actionable = chaseActive ? [] : alive.filter((item) => item.isReady && isControlled(item));
  const selectedActor = chaseActive ? null : (actionable.find((item) => item.id === actorId) ?? actionable[0] ?? null);
  const selectedActorId = selectedActor === null ? "" : selectedActor.id;
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

  const actorSkills = selectedActor?.skills ?? {};
  const allowedAttackSkillIds = props.attackSkillsByParticipant[selectedActorId] ?? [];
  const attackSkills = props.skillOptions.filter((option) => allowedAttackSkillIds.includes(option.id));
  const activeSkill = attackSkills.some((option) => option.id === skill) ? skill : (attackSkills[0]?.id ?? "");
  const targetOptions = alive.filter((item) => item.id !== selectedActorId);
  const activeTargetId = targetOptions.some((item) => item.id === targetId) ? targetId : (targetOptions[0]?.id ?? "");
  const activeSpell = props.magicSpells.some((item) => item.id === spellId) ? spellId : (props.magicSpells[0]?.id ?? "");
  const selectedSpell = props.magicSpells.find((item) => item.id === activeSpell) ?? null;
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
  const chaseActorIdForSkills = chaseActiveParticipant?.id ?? "";
  const chaseAttackSkillIds = props.attackSkillsByParticipant[chaseActorIdForSkills] ?? [];
  const chaseAttackSkills = props.skillOptions.filter((option) =>
    chaseAttackSkillIds.includes(option.id)
  );
  const activeChaseSkill = chaseAttackSkills.some((option) => option.id === chaseSkill)
    ? chaseSkill
    : (chaseAttackSkills[0]?.id ?? "");

  function reactionLabel(type: CombatReactionPayload["type"]): string {
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
    return reactionOptions[targetIdValue] ?? defaultReactionOptions();
  }

  function reactionDraftFor(targetIdValue: string): ReactionDraft {
    const options = reactionOptionsFor(targetIdValue);
    const existing = reactionDrafts[targetIdValue];
    if (existing !== undefined && options.includes(existing.type)) return existing;
    return { type: options[0] ?? "PASS", skill: "" };
  }

  function reactionSkillOptionsFor(targetIdValue: string, type: CombatReactionPayload["type"]): readonly SkillOption[] {
    const target = participants.find((item) => item.id === targetIdValue);
    const skills = target?.skills ?? {};
    if (type === "DODGE") {
      const ids = props.system === "TOUHOU" ? ["DODGE", "GRAZE"] : ["DODGE"];
      return props.skillOptions.filter(
        (option) => ids.includes(option.id) && Object.prototype.hasOwnProperty.call(skills, option.id)
      );
    }
    if (type === "COUNTER") {
      const ids = props.attackSkillsByParticipant[targetIdValue] ?? [];
      return props.skillOptions.filter(
        (option) => ids.includes(option.id) && Object.prototype.hasOwnProperty.call(skills, option.id)
      );
    }
    return [];
  }

  function emitAction(action: CombatActionPayload): void {
    const socket = socketRef.current;
    if (socket === null || socket.connected === false) {
      setError("连接已断开，请刷新页面后重试");
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
      setError("连接已断开，请刷新页面后重试");
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
      setError("连接已断开，请刷新页面后重试");
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
      setError("连接已断开，请刷新页面后重试");
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
      setError("连接已断开，请刷新页面后重试");
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
        damage: chaseDamage
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
      setError("连接已断开，请刷新页面后重试");
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
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-ink-800/50 px-4 py-3">
          <div>
            <h2 className="text-sm font-medium text-white/80">
              {view === null ? "载入战斗..." : "战斗 · " + view.mode}
            </h2>
            <p className="mt-0.5 text-[11px] text-white/35">
              {view === null ? "" : "第 " + view.round + " 轮 · tick " + view.tick + (activeActor === null ? "" : " · 当前 " + activeActor.name)}
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
              <span className="text-[11px] text-white/45">
                地点 {chase.trackLength} 格 · 逃离者到达最后一格，或追方全部放弃即脱身
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
                          className="rounded-lg bg-emerald-400 px-3 py-1.5 text-xs font-medium text-ink-900 transition hover:bg-emerald-300 disabled:opacity-40"
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
                        同地点冲突：追上不会自动掉血。攻击消耗 1 行动点，按普通攻击检定结算，目标可以闪避 / 反击。
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
                          <input
                            value={chaseDamage}
                            onChange={(event) => setChaseDamage(event.target.value)}
                            placeholder="1d6 / 1d4+db"
                            className={inputClass + " w-28 font-mono"}
                          />
                          <button
                            type="button"
                            disabled={
                              chaseActiveParticipant.actionPoints < 1 ||
                              chaseAttackSkills.length === 0 ||
                              activeChaseTargetId.length === 0
                            }
                            onClick={emitChaseAttack}
                            className="rounded-lg bg-red-400 px-4 py-1.5 text-xs font-medium text-ink-900 transition hover:bg-red-300 disabled:opacity-40"
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
                        <span className="rounded border border-sakura-500/50 bg-sakura-500/10 px-1.5 py-0.5 text-[10px] text-sakura-200">当前行动</span>
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
                        {hiddenStats ? "HP ？？？ · 数值未公开" : "HP " + (item.hpText ?? "情报未知")}
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
            <p className="mt-3 text-[11px] text-white/45">
              出手顺序：
              {view.initiativeOrder.map((id) => participants.find((item) => item.id === id)?.name ?? "???").join(" → ")}
            </p>
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
                        className="rounded-lg bg-amber-400 px-3 py-2 text-xs font-medium text-ink-900 transition hover:bg-amber-300"
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
                      : "等待 " + activeActor.name + " 行动；你没有可操作单位，只能旁观。"}
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
                  <span className="text-[11px] text-white/40">伤害表达式</span>
                  <input
                    value={damage}
                    onChange={(event) => setDamage(event.target.value)}
                    placeholder="2d6+3 / 1d4+db"
                    className={inputClass + " font-mono"}
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={attackSkills.length === 0}
                  onClick={() => emitAction({ kind: "DANMAKU", targetId: activeTargetId, skill: activeSkill, damage })}
                  className="rounded-lg bg-sakura-500 px-4 py-2 text-sm font-medium text-ink-900 transition hover:bg-sakura-400 disabled:opacity-40"
                >
                  攻击
                </button>
                {props.system === "TOUHOU" ? (
                  <button type="button" onClick={() => emitAction({ kind: "DEFEND" })} className="rounded-lg border border-white/15 px-3 py-2 text-xs text-white/60 transition hover:border-white/35">防御姿态</button>
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
              {props.canOutOfRule ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input value={outName} onChange={(event) => setOutName(event.target.value)} className={inputClass + " flex-1"} />
                  <button type="button" onClick={() => emitAction({ kind: "OUT_OF_RULE", name: outName })} className="rounded-lg border border-purple-400/40 px-3 py-2 text-xs text-purple-300 transition hover:bg-purple-400/10">规则外施法</button>
                </div>
              ) : null}
              {props.canCastMagic ? (
                <div className="flex flex-col gap-2 rounded-lg border border-purple-400/30 bg-purple-400/5 p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <select value={activeSpell} onChange={(event) => setSpellId(event.target.value)} className={inputClass + " flex-1"}>
                      {props.magicSpells.map((spell) => (
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
                      className="rounded-lg bg-purple-400 px-4 py-2 text-sm font-medium text-ink-900 transition hover:bg-purple-300 disabled:opacity-40"
                    >
                      施法
                    </button>
                  </div>
                  {selectedSpell === null ? null : (
                    <p className="text-[10px] text-purple-200/70">
                      目标：{selectedSpell.target === "SELF" || selectedSpell.targeting === "SELF"
                        ? "自己"
                        : selectedSpell.target === "ALL"
                          ? selectedSpell.targeting === "ENEMY" ? "全体敌方（AOE，所有目标都要应对）" : selectedSpell.targeting === "ALLY" ? "全体友方" : "场上全体"
                          : selectedSpell.targeting === "ENEMY" ? "单体敌方" : selectedSpell.targeting === "ALLY" ? "单体友方" : "任意单体"}
                      {selectedSpell.effects.length === 0 ? "" : " · 效果：" + selectedSpell.effects.join(" + ")}
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
                KP 强制结算（未行动按跳过）
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
