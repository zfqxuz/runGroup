"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { io, type Socket } from "socket.io-client";
import type { CombatView } from "@touhou/combat";
import type {
  Ack,
  CombatActionPayload,
  CombatJoinAck,
  CombatReactionPayload,
  CombatReactionRequest,
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
  readonly combatId: string;
  readonly isKP: boolean;
  readonly skillOptions: readonly SkillOption[];
  readonly system: "COC7" | "TOUHOU";
  readonly canCounter: boolean;
  readonly canOutOfRule: boolean;
  readonly canCastMagic: boolean;
  readonly magicSpells: readonly MagicSpellOption[];
  readonly attackSkillsByParticipant: Readonly<Record<string, readonly string[]>>;
}

const REACTION_LABELS: Record<CombatReactionPayload["type"], string> = {
  PASS: "不应对",
  DEFEND: "防御",
  DODGE: "闪避",
  COUNTER: "消弹对抗"
};

type ConnState = "connecting" | "online" | "offline";

function percent(value: number, max: number): number {
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
  const [reaction, setReaction] = useState<CombatReactionRequest | null>(null);
  const [reactionType, setReactionType] = useState<CombatReactionPayload["type"]>("PASS");
  const [reactionSkill, setReactionSkill] = useState("DODGE");
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
    socket.on("combat:reaction-request", (request: CombatReactionRequest) => {
      if (cancelled) return;
      setReaction(request);
      setReactionType("PASS");
    });
    socket.on("combat:aborted", () => {
      if (cancelled === false) router.refresh();
    });
    socket.on("combat:ended", () => {
      if (cancelled === false) router.refresh();
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
      const timer = setTimeout(() => router.refresh(), 1200);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [view?.phase, router]);

  const participants = view?.participants ?? [];
  const alive = participants.filter((item) => item.defeated === false);
  const readyControlled = alive.filter((item) => {
    if (item.isReady === false) return false;
    return props.isKP ? item.kind === "NPC" || item.isSelf : item.isSelf;
  });
  const selectedActor = readyControlled.find((item) => item.id === actorId) ?? readyControlled[0] ?? null;
  const actorSkills = selectedActor?.skills ?? {};
  const selectedActorId = selectedActor === null ? "" : selectedActor.id;
  const allowedAttackSkillIds = props.attackSkillsByParticipant[selectedActorId] ?? [];
  const attackSkills = props.skillOptions.filter((option) => allowedAttackSkillIds.includes(option.id));
  const activeSkill = attackSkills.some((option) => option.id === skill) ? skill : (attackSkills[0]?.id ?? "");
  const targetOptions = alive.filter((item) => item.id !== selectedActor?.id);
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
  const reactionTarget = reaction === null ? null : participants.find((item) => item.id === reaction.targetId) ?? null;
  const showReaction = reaction !== null && ((props.isKP && reactionTarget?.kind === "NPC") || reactionTarget?.isSelf === true);
  const reactionActorSkills = reactionTarget?.skills ?? {};
  const reactionSkillIds = new Set<string>();
  if (reactionType === "DODGE") {
    reactionSkillIds.add("DODGE");
    if (props.system === "TOUHOU") reactionSkillIds.add("GRAZE");
  }
  const counterTargetId = reactionTarget === null ? "" : reactionTarget.id;
  if (reactionType === "COUNTER" && counterTargetId.length > 0) {
    for (const id of props.attackSkillsByParticipant[counterTargetId] ?? []) reactionSkillIds.add(id);
  }
  const reactionSkillOptions = props.skillOptions.filter(
    (option) =>
      reactionSkillIds.has(option.id) &&
      Object.prototype.hasOwnProperty.call(reactionActorSkills, option.id)
  );
  const activeReactionSkill = reactionSkillOptions.some((option) => option.id === reactionSkill)
    ? reactionSkill
    : (reactionSkillOptions[0]?.id ?? "");
  const reactionTypeOptions: readonly CombatReactionPayload["type"][] =
    reaction === null ? ["PASS", "DEFEND", "DODGE"] : reaction.options;

  function emitAction(action: CombatActionPayload): void {
    const socket = socketRef.current;
    if (socket === null || selectedActor === null) {
      setError("当前没有可行动单位");
      return;
    }
    socket.emit("combat:action", { combatId: props.combatId, actorId: selectedActor.id, action }, (result: Ack) => {
      if (result.ok === false) setError(result.error ?? "行动失败");
    });
  }

  function submitReaction(): void {
    const socket = socketRef.current;
    if (socket === null || reaction === null) return;
    socket.emit(
      "combat:reaction",
      {
        combatId: props.combatId,
        targetId: reaction.targetId,
        reaction: {
          type: reactionType,
          skill: activeReactionSkill.length > 0 ? activeReactionSkill : undefined
        }
      },
      (result: Ack) => {
        if (result.ok === false) setError(result.error ?? "反应提交失败");
      }
    );
    setReaction(null);
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

  const connLabel = conn === "online" ? "已连接" : conn === "connecting" ? "连接中" : "已断开";
  const inputClass =
    "rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-sakura-500";

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-ink-800/50 px-4 py-3">
          <div>
            <h2 className="text-sm font-medium text-white/80">
              {view === null ? "载入战斗..." : "战斗 · " + view.mode}
            </h2>
            <p className="mt-0.5 text-[11px] text-white/35">
              {view === null ? "" : "第 " + view.round + " 轮 · tick " + view.tick}
            </p>
          </div>
          <span className={"rounded-full border px-2 py-0.5 text-[11px] " + (conn === "online" ? "border-emerald-400/40 text-emerald-300" : "border-white/20 text-white/50")}>
            {connLabel}
          </span>
        </div>

        {view !== null && view.pendingReactions.length > 0 ? (
          <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-xs text-amber-100">
            {view.pendingReactions.map((pending) => {
              const actorName = participants.find((item) => item.id === pending.actorId)?.name ?? "???";
              const targetName = participants.find((item) => item.id === pending.targetId)?.name ?? "???";
              return (
                <p key={pending.actorId + ":" + pending.targetId}>
                  {actorName} 已对 {targetName} 行动，等待对方应对…{props.isKP ? "（KP 可强制结算）" : ""}
                </p>
              );
            })}
          </div>
        ) : null}

        <section className="rounded-xl border border-white/10 bg-ink-800/50 p-4">
          <h3 className="text-sm font-medium text-white/80">参战单位</h3>
          <ul className="mt-3 flex flex-col gap-2">
            {participants.map((item) => (
              <li
                key={item.id}
                className="rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2.5"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm text-white/80">{item.name}</span>
                    {item.isSelf ? (
                      <span className="rounded border border-sakura-500/40 px-1.5 py-0.5 text-[10px] text-sakura-400">你</span>
                    ) : null}
                    {item.isReady ? (
                      <span className="rounded border border-emerald-400/40 px-1.5 py-0.5 text-[10px] text-emerald-300">可行动</span>
                    ) : null}
                    {item.defeated ? (
                      <span className="rounded border border-red-400/40 px-1.5 py-0.5 text-[10px] text-red-300">已退场</span>
                    ) : null}
                    {(item.stunActions ?? 0) > 0 ? (
                      <span className="rounded border border-amber-400/40 px-1.5 py-0.5 text-[10px] text-amber-300">
                        眩晕×{item.stunActions}
                      </span>
                    ) : null}
                    {(item.controlActions ?? 0) > 0 ? (
                      <span className="rounded border border-purple-400/40 px-1.5 py-0.5 text-[10px] text-purple-300">
                        控制×{item.controlActions}
                      </span>
                    ) : null}
                    {item.statusEffects.map((effect) => (
                      <span key={effect} className="rounded border border-white/15 px-1.5 py-0.5 text-[10px] text-white/45">
                        {effect}
                      </span>
                    ))}
                  </div>
                  <span className="shrink-0 text-[11px] text-white/45">
                    {item.hp === null ? (item.hpText ?? "情报未知") : "HP " + item.hp + "/" + item.maxHp}
                  </span>
                </div>
                {view?.mode === "ATB" ? (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-spirit-400"
                      style={{ width: percent(item.atbValue, item.atbMax) + "%" }}
                    />
                  </div>
                ) : null}
                <p className="mt-1 text-[10px] text-white/30">
                  速度 {(item.speed / 1000).toFixed(2)} · 阵营 {item.faction ?? "未知"}
                </p>
              </li>
            ))}
          </ul>

          {view?.mode === "INITIATIVE" ? (
            <p className="mt-3 text-[11px] text-white/45">
              出手顺序：
              {view.initiativeOrder.map((id) => participants.find((item) => item.id === id)?.name ?? "???").join(" → ")}
            </p>
          ) : null}
        </section>

        <section className="rounded-xl border border-white/10 bg-ink-800/50 p-4">
          <h3 className="text-sm font-medium text-white/80">行动</h3>
          {selectedActor === null ? (
            <p className="mt-3 text-xs text-white/35">
              {props.isKP ? "没有可行动的 NPC。" : "还没有轮到你，或你已经行动过了。"}
            </p>
          ) : (
            <div className="mt-3 flex flex-col gap-3">
              {readyControlled.length > 1 ? (
                <label className="flex flex-col gap-1.5">
                  <span className="text-[11px] text-white/40">当前操作单位</span>
                  <select
                    value={selectedActor === null ? "" : selectedActor.id}
                    onChange={(event) => setActorId(event.target.value)}
                    className={inputClass}
                  >
                    {readyControlled.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} · HP {item.hp === null ? (item.hpText ?? "情报未知") : item.hp + "/" + item.maxHp}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <p className="text-xs text-white/60">
                当前行动：<span className="text-sakura-400">{selectedActor.name}</span>
              </p>
              <div className="grid gap-2 sm:grid-cols-3">
                <label className="flex flex-col gap-1.5 sm:col-span-2">
                  <span className="text-[11px] text-white/40">目标</span>
                  <select
                    value={activeTargetId}
                    onChange={(event) => setTargetId(event.target.value)}
                    className={inputClass}
                  >
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
                        {option.id} · {option.name} ({actorSkills[option.id] ?? "-"})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1.5 sm:col-span-2">
                  <span className="text-[11px] text-white/40">伤害表达式</span>
                  <input value={damage} onChange={(event) => setDamage(event.target.value)} placeholder="2d6+3" className={inputClass + " font-mono"} />
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={attackSkills.length === 0}
                  onClick={() => { if (attackSkills.length > 0) emitAction({ kind: "DANMAKU", targetId: activeTargetId, skill: activeSkill, damage }); }}
                  className="rounded-lg bg-sakura-500 px-4 py-2 text-sm font-medium text-ink-900 transition hover:bg-sakura-400 disabled:opacity-40"
                >
                  攻击
                </button>
                <button type="button" onClick={() => emitAction({ kind: "DEFEND" })} className="rounded-lg border border-white/15 px-3 py-2 text-xs text-white/60 transition hover:border-white/35">防御姿态</button>
                <button type="button" onClick={() => emitAction({ kind: "DODGE" })} className="rounded-lg border border-white/15 px-3 py-2 text-xs text-white/60 transition hover:border-white/35">闪避姿态</button>
                {props.canCounter ? (
                  <button type="button" onClick={() => emitAction({ kind: "COUNTER" })} className="rounded-lg border border-white/15 px-3 py-2 text-xs text-white/60 transition hover:border-white/35">消弹姿态</button>
                ) : null}
                <button type="button" onClick={() => emitAction({ kind: "PASS" })} className="rounded-lg border border-white/15 px-3 py-2 text-xs text-white/60 transition hover:border-white/35">跳过</button>
              </div>
              {props.canOutOfRule ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input value={outName} onChange={(event) => setOutName(event.target.value)} className={inputClass + " flex-1"} />
                  <button type="button" onClick={() => emitAction({ kind: "OUT_OF_RULE", name: outName })} className="rounded-lg border border-purple-400/40 px-3 py-2 text-xs text-purple-300 transition hover:bg-purple-400/10">规则外施法</button>
                </div>
              ) : null}
              {props.canCastMagic && selectedActor !== null ? (
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
                            {participant.name}
                            {participant.isSelf ? "（自己）" : ""}
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
                          ? selectedSpell.targeting === "ENEMY" ? "全体敌方" : selectedSpell.targeting === "ALLY" ? "全体友方" : "场上全体"
                          : selectedSpell.targeting === "ENEMY" ? "单体敌方" : selectedSpell.targeting === "ALLY" ? "单体友方" : "任意单体"}
                      {selectedSpell.effects.length === 0 ? "" : " · 效果：" + selectedSpell.effects.join(" + ")}
                    </p>
                  )}
                </div>
              ) : null}
            </div>
          )}

          {showReaction ? (
            <div className="mt-4 rounded-lg border border-amber-400/40 bg-amber-400/5 p-3">
              <p className="text-xs text-amber-200">
                {reaction?.actorName} 攻击 {reaction?.targetName}，选择应对：
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <select value={reactionType} onChange={(event) => setReactionType(event.target.value as CombatReactionPayload["type"])} className={inputClass}>
                  {reactionTypeOptions.map((type) => (
                    <option key={type} value={type}>
                      {REACTION_LABELS[type]}{type === "DODGE" && props.system === "TOUHOU" ? " / 擦弹" : ""}
                    </option>
                  ))}
                </select>
                {reactionSkillOptions.length === 0 ? null : (
                  <select value={activeReactionSkill} onChange={(event) => setReactionSkill(event.target.value)} className={inputClass}>
                    {reactionSkillOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name} ({reactionActorSkills[option.id] ?? "-"})
                      </option>
                    ))}
                  </select>
                )}
                <button type="button" onClick={submitReaction} className="rounded-lg bg-amber-400 px-3 py-2 text-xs font-medium text-ink-900 transition hover:bg-amber-300">提交应对</button>
              </div>
            </div>
          ) : null}

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
          {(view?.log ?? []).slice().reverse().map((entry) => (
            <li key={entry.seq} className="rounded-lg border border-white/5 bg-ink-900/50 px-3 py-2">
              <p className="text-[10px] text-white/30">tick {entry.tick} · {entry.kind}</p>
              <p className="mt-0.5 text-xs text-white/65">{entry.text}</p>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
