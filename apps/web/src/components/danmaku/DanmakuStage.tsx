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

function declarationIdentity(participant: CombatView["participants"][number]): string {
  return participant.declarationCardId ?? participant.declarationName ?? participant.id;
}

/**
 * 战斗弹幕演出层。
 *
 * 数据来源：CombatView（当前展开符卡、declaration HP）+ 战斗日志（消费型符卡触发）。
 * 所有动画都是本地模拟；不参与伤害、ATB、检定和任何战斗判定。
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

  const activeCard = useMemo(() => {
    if (activeParticipant === null) return null;
    const cardId = activeParticipant.declarationCardId;
    if (cardId !== null) return cardList.find((card) => card.cardId === cardId) ?? null;
    const name = activeParticipant.declarationName;
    return name === null ? null : (cardList.find((card) => card.name === name) ?? null);
  }, [activeParticipant, cardList]);

  const activePattern = useMemo<DanmakuPattern | null>(() => {
    if (identity === null) return null;
    const cardPattern = activeCard?.pattern;
    if (cardPattern !== null && cardPattern !== undefined) return cardPattern;
    return fallbackDanmakuPattern(identity);
  }, [activeCard, identity]);

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
      ? "战斗演出 · 待机"
      : activeParticipant.declarationName === null
        ? "符卡展开中"
        : "符卡 · " + activeParticipant.declarationName;

  return (
    <div className="relative h-[230px] w-full overflow-hidden rounded-xl border border-white/10 bg-ink-900 sm:h-[300px]">
      {oneShot === null ? (
        <DanmakuCanvas
          key={activeParticipant === null ? "idle" : "declare-" + activeParticipant.id + "-" + (identity ?? "")}
          pattern={activePattern}
          mode="loop"
          className="block h-full w-full"
        />
      ) : (
        <DanmakuCanvas
          key={"consume-" + oneShot.key}
          pattern={oneShot.pattern}
          mode="once"
          className="block h-full w-full"
          onDone={() => setOneShot(null)}
        />
      )}

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-3">
        <div className="rounded-lg border border-white/15 bg-ink-900/75 px-2.5 py-1.5">
          <p className={"text-xs font-medium " + (oneShot === null ? "text-white/70" : "text-sakura-300")}>
            {oneShot === null ? label : oneShot.name + " · 发动"}
          </p>
          <p className="mt-0.5 text-[10px] text-white/35">纯视觉演出 · 不参与判定</p>
        </div>
        {activeParticipant?.declarationHp !== null && activeParticipant?.declarationHp !== undefined ? (
          <span className="rounded-lg border border-sakura-500/40 bg-ink-900/75 px-2.5 py-1.5 font-mono text-[11px] text-sakura-200">
            符卡 HP {activeParticipant.declarationHp}
          </span>
        ) : null}
      </div>

      {breakFlash ? <div className="pointer-events-none absolute inset-0 bg-white/20" /> : null}
    </div>
  );
}
