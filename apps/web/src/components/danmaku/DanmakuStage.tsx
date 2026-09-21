"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CombatView } from "@touhou/combat";
import type { DanmakuPattern } from "@/shared/danmaku/schema";
import type { CombatSpellCardOption } from "@/shared/danmaku/spellcards";
import { fallbackDanmakuPattern } from "@/shared/danmaku/presets";
import DanmakuCanvas from "./DanmakuCanvas";

interface Props {
  readonly view: CombatView | null;
  readonly spellCardsByParticipant: Readonly<Record<string, readonly CombatSpellCardOption[]>>;
}

interface OneShot {
  readonly key: number;
  readonly name: string;
  readonly pattern: DanmakuPattern;
}

type Participant = CombatView["participants"][number];

function declarationIdentity(participant: Participant): string {
  return participant.declarationCardId ?? participant.declarationName ?? participant.id;
}

function barPercent(value: number | null, max: number | null): number {
  if (value === null || max === null || max <= 0) return 0;
  return Math.max(0, Math.min(100, (value / max) * 100));
}

/**
 * 战斗弹幕演出层 —— 东方花映冢式「一人一边」对决布局。
 *
 * 左侧固定为我方（自己的角色 / 玩家阵营），右侧为敌方，
 * 各占半个大舞台；有符卡展开的一方播放卡面弹幕，另一方播放待机弹幕。
 * 所有动画都是本地模拟，不参与伤害、ATB、检定和任何战斗判定。
 */
export default function DanmakuStage(props: Props) {
  const [oneShot, setOneShot] = useState<OneShot | null>(null);
  const [breakFlash, setBreakFlash] = useState(false);
  const lastLogSeqRef = useRef<number | null>(null);
  const previousDeclarationRef = useRef<string | null>(null);

  const cardList = useMemo(
    () => Object.values(props.spellCardsByParticipant).flat(),
    [props.spellCardsByParticipant]
  );

  const activeParticipant = props.view?.participants.find((participant) => participant.hasDeclaration) ?? null;
  const identity = activeParticipant === null ? null : declarationIdentity(activeParticipant);

  // ---------- 花映冢式分边 ----------
  const sides = useMemo(() => {
    const participants = props.view?.participants ?? [];
    const living = participants.filter((participant) => participant.defeated === false);
    const pool = living.length > 0 ? living : participants;
    // 服务端下发的相对侧别最可靠：A = 己方，B = 对手。
    // 旧快照没有 duelSide 时，退回按「自己 / 玩家 / NPC」粗略分边。
    const hasDuelSide = pool.some((participant) => participant.duelSide !== null);
    const usPool = hasDuelSide
      ? pool.filter((participant) => participant.duelSide === "A")
      : pool.filter(
          (participant) =>
            participant.isSelf ||
            (participant.faction !== null && participant.faction === "PC") ||
            (participant.faction === null && participant.kind === "PLAYER")
        );
    let us = usPool;
    const themPool = hasDuelSide
      ? pool.filter((participant) => participant.duelSide === "B")
      : pool.filter((participant) => usPool.includes(participant) === false);
    let them = themPool;
    if (us.length === 0 || them.length === 0) {
      // KP 视角或纯 NPC 对局：按当前展开符卡的一方分边，保证舞台始终有左右两边。
      const anchor = activeParticipant ?? pool[0] ?? null;
      if (anchor !== null) {
        us = pool.filter((participant) => participant.id === anchor.id);
        them = pool.filter((participant) => participant.id !== anchor.id);
      }
    }
    const featured = (list: readonly Participant[]): Participant | null =>
      list.find((participant) => participant.hasDeclaration) ??
      list.find((participant) => participant.defeated === false) ??
      list[0] ??
      null;
    return { us: featured(us), them: featured(them) };
  }, [props.view, activeParticipant]);

  function patternFor(participant: Participant | null): DanmakuPattern {
    if (participant === null) return fallbackDanmakuPattern("idle");
    if (participant.hasDeclaration) {
      const cardId = participant.declarationCardId;
      const card = cardId === null ? null : cardList.find((item) => item.cardId === cardId) ?? null;
      const cardPattern = card?.pattern;
      if (cardPattern !== null && cardPattern !== undefined) return cardPattern;
      return fallbackDanmakuPattern(participant.declarationName ?? participant.id);
    }
    const key = participant.name === "???" ? participant.id : participant.name;
    return fallbackDanmakuPattern(key);
  }

  const usPattern = useMemo(() => patternFor(sides.us), [sides.us, cardList]);
  const themPattern = useMemo(() => patternFor(sides.them), [sides.them, cardList]);

  // 消费型符卡：日志里出现 CONSUME 时在整个舞台播一次。
  useEffect(() => {
    const view = props.view;
    if (view === null) return;
    const logs = view.log;
    const newestSeq = logs.length === 0 ? 0 : (logs[logs.length - 1]?.seq ?? 0);
    if (lastLogSeqRef.current === null) {
      lastLogSeqRef.current = newestSeq;
      return;
    }
    const previousSeq = lastLogSeqRef.current;
    lastLogSeqRef.current = newestSeq;
    for (const entry of logs) {
      if (entry.seq <= previousSeq) continue;
      if (entry.kind !== "SPELLCARD" || entry.data?.event !== "CONSUME") continue;
      const cardId = typeof entry.data.cardId === "string" ? entry.data.cardId : null;
      const rawName = typeof entry.data.name === "string" ? entry.data.name : "消费型符卡";
      const actor = view.participants.find((participant) => participant.id === entry.actorId);
      const name = actor !== undefined && actor.name === "???" ? "消费型符卡" : rawName;
      const card = cardId === null ? null : cardList.find((item) => item.cardId === cardId) ?? null;
      const pattern = card?.pattern ?? fallbackDanmakuPattern(cardId ?? name);
      setOneShot({ key: entry.seq, name, pattern });
    }
  }, [props.view, cardList]);

  useEffect(() => {
    const previous = previousDeclarationRef.current;
    previousDeclarationRef.current = identity;
    if (previous === null || identity !== null) return;
    setBreakFlash(true);
    const timeout = window.setTimeout(() => setBreakFlash(false), 900);
    return () => window.clearTimeout(timeout);
  }, [identity]);

  const label =
    activeParticipant === null
      ? "弹幕对决 · 待机"
      : activeParticipant.declarationName === null
        ? "符卡展开中"
        : "符卡 · " + activeParticipant.declarationName;

  return (
    <section
      data-testid="danmaku-duel"
      className="relative overflow-hidden rounded-2xl border border-sakura-500/25 bg-gradient-to-b from-ink-800 to-ink-950 shadow-[0_0_40px_rgba(236,72,153,0.08)]">
      {/* 舞台标题 */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-ink-900/70 px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-white/85">弹幕对决</span>
          <span className="rounded-full border border-sakura-500/40 bg-sakura-500/10 px-2 py-0.5 text-[10px] text-sakura-200">
            {label}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-white/35">
          <span>纯视觉演出</span>
          {oneShot === null ? null : <span className="text-sakura-300">{oneShot.name} · 发动</span>}
        </div>
      </div>

      {/* 左右两半的舞台 */}
      <div className="relative grid h-[52vh] min-h-[380px] w-full grid-cols-1 md:grid-cols-2">
        <DuelSide
          side="us"
          participant={sides.us}
          pattern={usPattern}
          activeDeclaration={activeParticipant !== null && sides.us !== null && activeParticipant.id === sides.us.id}
          declarationHp={activeParticipant !== null && sides.us !== null && activeParticipant.id === sides.us.id ? activeParticipant.declarationHp : null}
        />
        <DuelSide
          side="them"
          participant={sides.them}
          pattern={themPattern}
          activeDeclaration={activeParticipant !== null && sides.them !== null && activeParticipant.id === sides.them.id}
          declarationHp={activeParticipant !== null && sides.them !== null && activeParticipant.id === sides.them.id ? activeParticipant.declarationHp : null}
        />

        {/* 中央 VS 分隔 */}
        <div className="pointer-events-none absolute inset-y-0 left-1/2 hidden w-px -translate-x-1/2 bg-gradient-to-b from-transparent via-sakura-500/60 to-transparent md:block" />
        <div className="pointer-events-none absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 rounded-full border border-sakura-500/50 bg-ink-950/90 px-2.5 py-1 text-[11px] font-semibold tracking-widest text-sakura-200 md:block">
          VS
        </div>
      </div>

      {/* 消费型符卡：全舞台覆盖播放一次 */}
      {oneShot === null ? null : (
        <div
          data-testid="danmaku-oneshot"
          data-pattern={oneShot.pattern.layers.map((layer) => layer.type).join(",")}
          className="pointer-events-none absolute inset-0 z-20 bg-ink-950/70"
        >
          <DanmakuCanvas
            key={"consume-" + oneShot.key}
            pattern={oneShot.pattern}
            mode="once"
            className="block h-full w-full"
            onDone={() => setOneShot(null)}
          />
          <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
            <span className="rounded-lg border border-sakura-400/60 bg-ink-900/85 px-3 py-1 text-xs font-medium text-sakura-200">
              {oneShot.name} · 发动
            </span>
          </div>
        </div>
      )}

      {breakFlash ? <div className="pointer-events-none absolute inset-0 z-30 bg-white/20" /> : null}
    </section>
  );
}

interface DuelSideProps {
  readonly side: "us" | "them";
  readonly participant: Participant | null;
  readonly pattern: DanmakuPattern;
  readonly activeDeclaration: boolean;
  readonly declarationHp: number | null;
}

function DuelSide(props: DuelSideProps) {
  const { participant } = props;
  const isUs = props.side === "us";
  const accent = isUs ? "text-sky-200" : "text-red-200";
  const border = isUs ? "border-sky-400/25" : "border-red-400/25";
  const ring = props.activeDeclaration ? "ring-1 ring-sakura-400/50" : "";

  return (
    <div
      data-testid={"danmaku-side-" + props.side}
      data-pattern={props.pattern.layers.map((layer) => layer.type).join(",")}
      className={"relative overflow-hidden border-b md:border-b-0 " + border + " " + ring + (isUs ? " md:border-r" : "")}
    >
      <DanmakuCanvas
        key={(participant?.id ?? props.side) + "-" + (props.activeDeclaration ? "declare" : "idle")}
        pattern={participant === null ? null : props.pattern}
        mode="loop"
        className="block h-full w-full"
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
        <div className="min-w-0 rounded-lg border border-white/15 bg-ink-950/75 px-2.5 py-1.5">
          <p className={"truncate text-xs font-medium " + accent}>
            {isUs ? "我方" : "敌方"} · {participant?.name ?? "待机"}
          </p>
          <div className="mt-1 flex items-center gap-2">
            <span className="font-mono text-[10px] text-white/55">
              HP {participant?.hp ?? "?"}
              {participant?.maxHp === null || participant?.maxHp === undefined ? "" : "/" + participant.maxHp}
            </span>
            <span className="font-mono text-[10px] text-sakura-200">DP {participant?.dp ?? "?"}</span>
          </div>
        </div>
        {props.declarationHp === null ? null : (
          <span className="shrink-0 rounded-lg border border-sakura-500/40 bg-ink-950/80 px-2.5 py-1.5 font-mono text-[10px] text-sakura-200">
            符卡 HP {props.declarationHp}
          </span>
        )}
      </div>

      {/* 底部状态条 */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-gradient-to-t from-ink-950/85 to-transparent px-3 pb-2 pt-6">
        <div className="h-1 overflow-hidden rounded-full bg-white/10">
          <div
            className={"h-full rounded-full " + (isUs ? "bg-sky-400" : "bg-red-400")}
            style={{ width: barPercent(participant?.hp ?? null, participant?.maxHp ?? null) + "%" }}
          />
        </div>
        <div className="flex items-center justify-between text-[10px] text-white/45">
          <span>{participant?.hasDeclaration === true ? "符卡展开中" : "待机弹幕"}</span>
          <span>{participant?.isReady === true ? "就绪" : ""}</span>
        </div>
      </div>

      {props.activeDeclaration ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-sakura-400 to-transparent" />
      ) : null}
    </div>
  );
}
