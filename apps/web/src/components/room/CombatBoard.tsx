"use client";

import { useEffect, useRef, useState } from "react";
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

interface Props {
  readonly combatId: string;
  readonly isKP: boolean;
}

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
  const [skill, setSkill] = useState("DANMAKU");
  const [damage, setDamage] = useState("1d6");
  const [outName, setOutName] = useState("规则外法术");
  const [actorId, setActorId] = useState("");
  const [reaction, setReaction] = useState<CombatReactionRequest | null>(null);
  const [reactionType, setReactionType] = useState<CombatReactionPayload["type"]>("PASS");
  const [reactionSkill, setReactionSkill] = useState("DODGE");
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

  const participants = view?.participants ?? [];
  const alive = participants.filter((item) => item.defeated === false);
  const readyControlled = alive.filter((item) => {
    if (item.isReady === false) return false;
    return props.isKP ? item.kind === "NPC" || item.isSelf : item.isSelf;
  });
  const selectedActor = readyControlled.find((item) => item.id === actorId) ?? readyControlled[0] ?? null;
  const targetOptions = alive.filter((item) => item.id !== selectedActor?.id);
  const activeTargetId = targetOptions.some((item) => item.id === targetId) ? targetId : (targetOptions[0]?.id ?? "");
  const reactionTarget = reaction === null ? null : participants.find((item) => item.id === reaction.targetId) ?? null;
  const showReaction = reaction !== null && ((props.isKP && reactionTarget?.kind === "NPC") || reactionTarget?.isSelf === true);

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
      { combatId: props.combatId, targetId: reaction.targetId, reaction: { type: reactionType, skill: reactionSkill } },
      (result: Ack) => {
        if (result.ok === false) setError(result.error ?? "反应提交失败");
      }
    );
    setReaction(null);
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
                  </div>
                  <span className="shrink-0 text-[11px] text-white/45">
                    {item.hp === null ? item.hpText : "HP " + item.hp + "/" + item.maxHp}
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
                        {item.name} · HP {item.hp === null ? item.hpText : item.hp + "/" + item.maxHp}
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
                  <span className="text-[11px] text-white/40">技能 ID</span>
                  <input value={skill} onChange={(event) => setSkill(event.target.value)} className={inputClass} />
                </label>
                <label className="flex flex-col gap-1.5 sm:col-span-2">
                  <span className="text-[11px] text-white/40">伤害表达式</span>
                  <input value={damage} onChange={(event) => setDamage(event.target.value)} placeholder="2d6+3" className={inputClass + " font-mono"} />
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => emitAction({ kind: "DANMAKU", targetId: activeTargetId, skill, damage })}
                  className="rounded-lg bg-sakura-500 px-4 py-2 text-sm font-medium text-ink-900 transition hover:bg-sakura-400"
                >
                  攻击
                </button>
                <button type="button" onClick={() => emitAction({ kind: "DEFEND" })} className="rounded-lg border border-white/15 px-3 py-2 text-xs text-white/60 transition hover:border-white/35">防御姿态</button>
                <button type="button" onClick={() => emitAction({ kind: "DODGE" })} className="rounded-lg border border-white/15 px-3 py-2 text-xs text-white/60 transition hover:border-white/35">闪避姿态</button>
                <button type="button" onClick={() => emitAction({ kind: "COUNTER" })} className="rounded-lg border border-white/15 px-3 py-2 text-xs text-white/60 transition hover:border-white/35">消弹姿态</button>
                <button type="button" onClick={() => emitAction({ kind: "PASS" })} className="rounded-lg border border-white/15 px-3 py-2 text-xs text-white/60 transition hover:border-white/35">跳过</button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input value={outName} onChange={(event) => setOutName(event.target.value)} className={inputClass + " flex-1"} />
                <button type="button" onClick={() => emitAction({ kind: "OUT_OF_RULE", name: outName })} className="rounded-lg border border-purple-400/40 px-3 py-2 text-xs text-purple-300 transition hover:bg-purple-400/10">规则外施法</button>
              </div>
            </div>
          )}

          {showReaction ? (
            <div className="mt-4 rounded-lg border border-amber-400/40 bg-amber-400/5 p-3">
              <p className="text-xs text-amber-200">
                {reaction?.actorName} 攻击 {reaction?.targetName}，选择应对：
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <select value={reactionType} onChange={(event) => setReactionType(event.target.value as CombatReactionPayload["type"])} className={inputClass}>
                  <option value="PASS">不应对</option>
                  <option value="DEFEND">防御</option>
                  <option value="DODGE">闪避 / 擦弹</option>
                  <option value="COUNTER">消弹对抗</option>
                </select>
                <input value={reactionSkill} onChange={(event) => setReactionSkill(event.target.value)} className={inputClass} />
                <button type="button" onClick={submitReaction} className="rounded-lg bg-amber-400 px-3 py-2 text-xs font-medium text-ink-900 transition hover:bg-amber-300">提交应对</button>
              </div>
            </div>
          ) : null}

          {props.isKP ? (
            <button
              type="button"
              onClick={forceResolve}
              className="mt-4 rounded-lg border border-white/15 px-3 py-2 text-xs text-white/50 transition hover:border-white/35"
            >
              KP 强制结算（未行动按跳过）
            </button>
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
