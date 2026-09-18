"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { io, type Socket } from "socket.io-client";
import { normalizeDiceExpression } from "@touhou/formula";
import RoomMemberRoster, {
  type RosterCardOption,
  type RosterClueOption
} from "@/components/room/RoomMemberRoster";
import type {
  Ack,
  ChatChannel,
  ChatMessage,
  CombatLifecycle,
  DiceVisibility,
  JoinAck,
  RoomAdvancementUpdate,
  RoomMemberView,
  RoomRefresh,
  RoomStateUpdate,
  RoomUpdate,
  TradeOfferSummary
} from "@/shared/socket";

interface Props {
  roomId: string;
  currentUserId: string;
  isKP: boolean;
  initialMembers: readonly RoomMemberView[];
  initialMessages: readonly ChatMessage[];
  initialGameStateVersion: number;
  initialCombatId: string | null;
  readonly roomStatus: string;
  readonly characterVisibility: string;
  readonly allowPlayerCombatRequest: boolean;
  readonly initialTrades: readonly TradeOfferSummary[];
  readonly tradeCards: readonly RosterCardOption[];
  readonly shareableClues: readonly RosterClueOption[];
  /** 技能检定模式可选的玩家角色与技能（已按本职优先、成功率降序） */
  readonly skillCheckCharacters: readonly {
    readonly id: string;
    readonly name: string;
    readonly skills: readonly {
      readonly id: string;
      readonly name: string;
      readonly value: number;
      readonly occupational: boolean;
    }[];
  }[];
  /** KP 分屏右侧固定使用玩家可见性，忽略 socket 返回的 KP 视角成员列表。 */
  readonly playerPerspective: boolean;
}

type ConnState = "connecting" | "online" | "offline";

export default function RoomPlay(props: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    props.playerPerspective
      ? props.initialMessages.filter((message) => message.channel !== "KP_ONLY")
      : [...props.initialMessages]
  );
  const [members, setMembers] = useState<RoomMemberView[]>([...props.initialMembers]);
  const [channel, setChannel] = useState<ChatChannel>("OOC");
  const [whisperTargetId, setWhisperTargetId] = useState("");
  const [text, setText] = useState("");
  const [diceMode, setDiceMode] = useState<"CHECK" | "FREE" | "SANITY">("CHECK");
  const [sanitySuccessLoss, setSanitySuccessLoss] = useState("0");
  const [sanityFailureLoss, setSanityFailureLoss] = useState("1d6");
  const [sanityReason, setSanityReason] = useState("");
  const [checkDifficulty, setCheckDifficulty] = useState<"REGULAR" | "HARD" | "EXTREME">("REGULAR");
  const [checkBonusDice, setCheckBonusDice] = useState(0);
  const [checkPenaltyDice, setCheckPenaltyDice] = useState(0);
  const [diceExpr, setDiceExpr] = useState("1d100");
  const [checkCharacterId, setCheckCharacterId] = useState(props.skillCheckCharacters[0]?.id ?? "");
  const [skillQuery, setSkillQuery] = useState("");
  const [skillId, setSkillId] = useState("");
  const [skillDropdownOpen, setSkillDropdownOpen] = useState(false);
  const [favoriteSkillIds, setFavoriteSkillIds] = useState<Record<string, boolean>>({});
  const [diceVisibility, setDiceVisibility] = useState<DiceVisibility>("PUBLIC");
  const [conn, setConn] = useState<ConnState>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const skillComboRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const messageCountRef = useRef(messages.length);
  const router = useRouter();

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

    socket.on("connect", () => {
      if (cancelled) return;
      setConn("online");
      socket.emit("room:join", props.roomId, (result: JoinAck) => {
        if (cancelled) return;
        if (result.ok === false) {
          setError(result.error ?? "加入房间失败");
          return;
        }
        if (result.messages !== undefined) {
          setMessages(
            props.playerPerspective
              ? result.messages.filter((message) => message.channel !== "KP_ONLY")
              : [...result.messages]
          );
        }
        if (result.members !== undefined && props.playerPerspective === false) {
          setMembers([...result.members]);
        }
        const stateVersion = result.gameState?.version ?? null;
        if (stateVersion !== props.initialGameStateVersion) router.refresh();
        if ((result.activeCombatId ?? null) !== props.initialCombatId) router.refresh();
      });
    });

    socket.on("chat:message", (message: ChatMessage) => {
      if (props.playerPerspective && message.channel === "KP_ONLY") return;
      setMessages((prev) => [...prev, message]);
    });

    socket.on("room:state:update", (payload: RoomStateUpdate) => {
      if (cancelled) return;
      if (payload.roomId === props.roomId) router.refresh();
    });
    socket.on("room:advancement:update", (payload: RoomAdvancementUpdate) => {
      if (cancelled) return;
      if (payload.roomId === props.roomId) router.refresh();
    });
    socket.on("room:update", (payload: RoomUpdate) => {
      if (cancelled) return;
      if (payload.roomId === props.roomId) router.refresh();
    });
    socket.on("room:refresh", (payload: RoomRefresh) => {
      if (cancelled) return;
      if (payload.roomId === props.roomId) router.refresh();
    });
    socket.on("combat:started", (payload: CombatLifecycle) => {
      if (cancelled) return;
      if (payload.roomId !== props.roomId) return;
      // 同房间可同时存在多场战斗：只刷新出新的战斗 tab，不强制把所有人拉进同一场。
      router.refresh();
    });
    socket.on("combat:ended", (payload: CombatLifecycle) => {
      if (cancelled) return;
      if (payload.roomId === props.roomId) router.refresh();
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
  }, [props.roomId, props.initialGameStateVersion, props.initialCombatId, props.playerPerspective, router]);

  useEffect(() => {
    const list = listRef.current;
    if (list === null) return;
    list.scrollTop = list.scrollHeight;
  }, []);

  useEffect(() => {
    if (messageCountRef.current === messages.length) return;
    messageCountRef.current = messages.length;
    const list = listRef.current;
    if (list === null) return;
    list.scrollTop = list.scrollHeight;
  }, [messages.length]);

  const selectedCheckCharacter =
    props.skillCheckCharacters.find((item) => item.id === checkCharacterId) ??
    props.skillCheckCharacters[0] ??
    null;
  const normalizedSkillQuery = skillQuery.trim().toLowerCase();
  const visibleSkillOptions = selectedCheckCharacter === null
    ? []
    : selectedCheckCharacter.skills
        .filter((skill) => {
          if (normalizedSkillQuery.length === 0) return true;
          return (
            skill.name.toLowerCase().includes(normalizedSkillQuery) ||
            skill.id.toLowerCase().includes(normalizedSkillQuery)
          );
        })
        .slice()
        .sort((a, b) => {
          const favoriteA = favoriteSkillIds[a.id] === true ? 1 : 0;
          const favoriteB = favoriteSkillIds[b.id] === true ? 1 : 0;
          if (favoriteA !== favoriteB) return favoriteB - favoriteA;
          if (a.occupational !== b.occupational) return a.occupational ? -1 : 1;
          if (a.value !== b.value) return b.value - a.value;
          if (a.name < b.name) return -1;
          if (a.name > b.name) return 1;
          return 0;
        });
  const effectiveSkillId = visibleSkillOptions.some((skill) => skill.id === skillId)
    ? skillId
    : (visibleSkillOptions[0]?.id ?? "");
  const effectiveSkill = visibleSkillOptions.find((skill) => skill.id === effectiveSkillId) ?? null;

  useEffect(() => {
    if (selectedCheckCharacter === null) return;
    try {
      const raw = window.localStorage.getItem("skill-favorites:" + props.roomId + ":" + selectedCheckCharacter.id);
      setFavoriteSkillIds(raw === null ? {} : (JSON.parse(raw) as Record<string, boolean>));
    } catch {
      setFavoriteSkillIds({});
    }
  }, [props.roomId, selectedCheckCharacter?.id]);

  useEffect(() => {
    function onDocumentMouseDown(event: MouseEvent): void {
      const target = event.target as Node | null;
      if (target === null || skillComboRef.current === null || skillComboRef.current.contains(target)) return;
      setSkillDropdownOpen(false);
    }
    document.addEventListener("mousedown", onDocumentMouseDown);
    return () => document.removeEventListener("mousedown", onDocumentMouseDown);
  }, []);

  function toggleSkillFavorite(id: string): void {
    if (selectedCheckCharacter === null) return;
    setFavoriteSkillIds((prev) => {
      const next = { ...prev, [id]: prev[id] !== true };
      try {
        window.localStorage.setItem(
          "skill-favorites:" + props.roomId + ":" + selectedCheckCharacter.id,
          JSON.stringify(next)
        );
      } catch {
        // localStorage 不可用时仅保留当前会话收藏。
      }
      return next;
    });
  }

  function rollSkillCheck(): void {
    const socket = socketRef.current;
    if (socket === null || socket.connected === false) {
      setError("连接已断开，请刷新后重试。");
      return;
    }
    if (selectedCheckCharacter === null || effectiveSkillId.length === 0) {
      setError("请先选择角色和技能");
      return;
    }
    setError(null);
    socket.emit(
      "dice:skill-check",
      {
        roomId: props.roomId,
        characterId: selectedCheckCharacter.id,
        skillId: effectiveSkillId,
        visibility: diceVisibility,
        difficulty: checkDifficulty,
        bonusDice: checkBonusDice,
        penaltyDice: checkPenaltyDice
      },
      (result: Ack) => {
        if (result.ok === false) {
          setError(result.error ?? "技能检定失败");
        } else {
          setError(null);
        }
      }
    );
  }

  function rollSanityCheck(): void {
    const socket = socketRef.current;
    if (socket === null || socket.connected === false) {
      setError("连接已断开，请刷新后重试。");
      return;
    }
    if (selectedCheckCharacter === null) {
      setError("请先选择角色");
      return;
    }
    setError(null);
    socket.emit(
      "dice:sanity-check",
      {
        roomId: props.roomId,
        characterId: selectedCheckCharacter.id,
        successLoss: sanitySuccessLoss.trim() || "0",
        failureLoss: sanityFailureLoss.trim() || "1d6",
        reason: sanityReason.trim(),
        visibility: diceVisibility
      },
      (result: Ack) => {
        if (result.ok === false) setError(result.error ?? "理智检定失败");
      }
    );
  }

  function rollMadnessBout(): void {
    const socket = socketRef.current;
    if (socket === null || socket.connected === false) {
      setError("连接已断开，请刷新后重试。");
      return;
    }
    if (selectedCheckCharacter === null) {
      setError("请先选择角色");
      return;
    }
    setError(null);
    socket.emit(
      "dice:madness-bout",
      { roomId: props.roomId, characterId: selectedCheckCharacter.id, visibility: diceVisibility },
      (result: Ack) => {
        if (result.ok === false) setError(result.error ?? "疯狂发作掷骰失败");
      }
    );
  }

  function rollRealityCheck(): void {
    const socket = socketRef.current;
    if (socket === null || socket.connected === false) {
      setError("连接已断开，请刷新后重试。");
      return;
    }
    if (selectedCheckCharacter === null) {
      setError("请先选择角色");
      return;
    }
    setError(null);
    socket.emit(
      "dice:reality-check",
      {
        roomId: props.roomId,
        characterId: selectedCheckCharacter.id,
        successLoss: sanitySuccessLoss.trim() || "0",
        failureLoss: sanityFailureLoss.trim() || "1d6",
        reason: sanityReason.trim(),
        visibility: diceVisibility
      },
      (result: Ack) => {
        if (result.ok === false) setError(result.error ?? "现实检定失败");
      }
    );
  }

  function send(): void {
    const socket = socketRef.current;
    const value = text.trim();
    if (socket === null || value.length === 0) return;
    if (channel === "WHISPER" && whisperTargetId.length === 0) {
      setError("请选择悄悄话对象");
      return;
    }
    socket.emit(
      "chat:send",
      {
        roomId: props.roomId,
        channel,
        text: value,
        targetId: channel === "WHISPER" ? whisperTargetId : null
      },
      (result: Ack) => {
        if (result.ok === false) setError(result.error ?? "发送失败");
      }
    );
    setText("");
  }

  function roll(): void {
    const socket = socketRef.current;
    if (socket === null || socket.connected === false) {
      setError("连接已断开，请刷新后重试。");
      return;
    }
    if (diceMode === "CHECK") {
      rollSkillCheck();
      return;
    }
    const expression = normalizeDiceExpression(diceExpr).slice(0, 120);
    if (expression.length === 0) {
      setError("请输入骰子，例如 1d100");
      return;
    }
    setError(null);
    socket.emit(
      "dice:roll",
      { roomId: props.roomId, expression, visibility: diceVisibility },
      (result: Ack) => {
        if (result.ok === false) {
          setError(result.error ?? "掷骰失败");
        } else {
          setError(null);
        }
      }
    );
  }

  const connLabel = conn === "online" ? "已连接" : conn === "connecting" ? "连接中" : "已断开";
  const connClass =
    conn === "online"
      ? "border-emerald-400/40 text-emerald-300"
      : conn === "connecting"
        ? "border-white/20 text-white/50"
        : "border-red-400/40 text-red-300";
  const inputClass =
    "rounded-lg border border-white/15 bg-ink-800 px-3 py-2 text-sm outline-none focus:border-sakura-500";

  return (
    <>
      <section className="relative flex h-[420px] min-h-0 flex-col overflow-hidden rounded-xl border border-white/10 bg-ink-800/50 sm:h-[480px] lg:h-[560px] xl:h-[620px]">
        <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <h2 className="text-sm font-medium text-white/80">跑团日志</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMembersOpen((value) => value === false)}
              className={
                "rounded-full border px-2.5 py-0.5 text-[11px] transition " +
                (membersOpen ? "border-spirit-400/50 text-spirit-300" : "border-white/15 text-white/50 hover:border-white/35")
              }
            >
              成员 {members.length}
            </button>
            <span className={"rounded-full border px-2 py-0.5 text-[11px] " + connClass}>{connLabel}</span>
          </div>
        </header>

        <ul ref={listRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4">
          {messages.length === 0 ? (
            <li className="py-10 text-center text-sm text-white/30">还没有消息，说点什么吧</li>
          ) : (
            messages.map((message) => (
              <li key={message.id} className="text-sm">
                <div className="flex items-baseline gap-2">
                  <span className="font-medium text-white/80">{message.displayName}</span>
                  {message.channel === "KP_ONLY" ? (
                    <span className="rounded border border-sakura-500/40 px-1 text-[10px] text-sakura-400">KP</span>
                  ) : null}
                  {message.channel === "WHISPER" ? (
                    <span className="rounded border border-spirit-400/40 px-1 text-[10px] text-spirit-300">悄悄话</span>
                  ) : null}
                  <span className="font-mono text-[10px] text-white/25">{message.createdAt.slice(11, 19)}</span>
                </div>
                {message.kind === "DICE" && message.dice !== null ? (
                  <div className="mt-1 rounded-lg border border-spirit-400/25 bg-spirit-400/5 px-3 py-2">
                    <p className="font-mono text-sm text-spirit-400">{message.text}</p>
                    <p className="mt-1 font-mono text-[11px] text-white/35">
                      {message.dice.terms.join("  ")} · 范围 {message.dice.min}~{message.dice.max}
                    </p>
                  </div>
                ) : (
                  <p className="mt-1 whitespace-pre-wrap break-words text-white/70">{message.text}</p>
                )}
              </li>
            ))
          )}
        </ul>

        {membersOpen ? (
          <div className="absolute right-0 top-0 z-30 flex h-full w-72 flex-col border-l border-white/10 bg-ink-900/95 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
              <span className="text-xs text-white/60">房间成员</span>
              <button
                type="button"
                onClick={() => setMembersOpen(false)}
                className="rounded border border-white/15 px-2 py-0.5 text-[10px] text-white/45 transition hover:border-white/35"
              >
                收起
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              <RoomMemberRoster
                roomId={props.roomId}
                currentUserId={props.currentUserId}
                isKP={props.isKP}
                roomStatus={props.roomStatus}
                characterVisibility={props.characterVisibility}
                allowPlayerCombatRequest={props.allowPlayerCombatRequest}
                activeCombatId={props.initialCombatId}
                members={members}
                tradeCards={props.tradeCards}
                shareableClues={props.shareableClues}
                trades={props.initialTrades}
                onWhisper={(userId) => {
                  setChannel("WHISPER");
                  setWhisperTargetId(userId);
                }}
              />
            </div>
          </div>
        ) : null}
      </section>

      <div className="rounded-xl border border-white/10 bg-ink-800/50 p-3 lg:col-span-3">
        {error === null ? null : <p className="mb-2 text-xs text-red-300">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <select
            value={channel}
            onChange={(event) => setChannel(event.target.value as ChatChannel)}
            className="rounded-lg border border-white/15 bg-ink-800 px-2 py-2 text-xs outline-none"
          >
            <option value="OOC">OOC</option>
            <option value="IC">IC</option>
            <option value="WHISPER">悄悄话</option>
            {props.isKP ? <option value="KP_ONLY">KP</option> : null}
          </select>
          {channel === "WHISPER" ? (
            <select
              value={whisperTargetId}
              onChange={(event) => setWhisperTargetId(event.target.value)}
              className="rounded-lg border border-white/15 bg-ink-800 px-2 py-2 text-xs outline-none"
            >
              <option value="">选择悄悄话对象</option>
              {members
                .filter((member) => member.userId === props.currentUserId ? false : true)
                .map((member) => (
                  <option key={member.userId} value={member.userId}>{member.displayName}</option>
                ))}
            </select>
          ) : null}
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") send(); }}
            placeholder="说点什么（回车发送）"
            className={inputClass + " min-w-[200px] flex-1"}
          />
          <button
            type="button"
            onClick={send}
            className="rounded-lg bg-sakura-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-sakura-400"
          >
            发送
          </button>
        </div>

        <div className="mt-2 flex w-full flex-wrap items-center gap-2">
          <select
            value={diceMode}
            onChange={(event) => {
              setDiceMode(
                event.target.value === "FREE"
                  ? "FREE"
                  : event.target.value === "SANITY"
                    ? "SANITY"
                    : "CHECK"
              );
              if (error !== null) setError(null);
            }}
            className="rounded-lg border border-white/15 bg-ink-800 px-2 py-2 text-xs outline-none"
          >
            <option value="CHECK">技能检定</option>
            <option value="SANITY">理智检定</option>
            <option value="FREE">自由掷骰</option>
          </select>

          {diceMode === "CHECK" ? (
            <>
              {props.skillCheckCharacters.length === 0 ? (
                <span className="text-[11px] text-white/35">当前没有可进行技能检定的角色。</span>
              ) : (
                <>
                  {props.skillCheckCharacters.length > 1 ? (
                    <select
                      value={selectedCheckCharacter?.id ?? ""}
                      onChange={(event) => {
                        setCheckCharacterId(event.target.value);
                        setSkillId("");
                      }}
                      className="rounded-lg border border-white/15 bg-ink-800 px-2 py-2 text-xs outline-none"
                    >
                      {props.skillCheckCharacters.map((character) => (
                        <option key={character.id} value={character.id}>{character.name}</option>
                      ))}
                    </select>
                  ) : null}
                  <div ref={skillComboRef} className="relative min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => {
                        setSkillDropdownOpen((open) => open === false);
                        setSkillQuery("");
                      }}
                      className="flex w-full items-center justify-between gap-2 rounded-lg border border-white/15 bg-ink-800 px-3 py-2 text-left text-xs outline-none hover:border-white/30"
                    >
                      <span className="truncate">
                        {effectiveSkill === null
                          ? "选择技能"
                          : (favoriteSkillIds[effectiveSkill.id] === true ? "★ " : "") +
                            (effectiveSkill.occupational ? "本职 · " : "") +
                            effectiveSkill.name +
                            "（" + effectiveSkill.value + "）"}
                      </span>
                      <span className="text-white/35">▾</span>
                    </button>
                    {skillDropdownOpen ? (
                      <div className="absolute left-0 top-full z-50 mt-1 w-full rounded-lg border border-white/15 bg-ink-900 p-2 shadow-2xl">
                        <input
                          autoFocus
                          value={skillQuery}
                          onChange={(event) => setSkillQuery(event.target.value)}
                          onKeyDown={(event) => { if (event.key === "Enter") rollSkillCheck(); }}
                          placeholder="搜索技能"
                          className="w-full rounded border border-white/15 bg-ink-800 px-2 py-1.5 text-xs outline-none focus:border-spirit-400"
                        />
                        <div className="mt-2 max-h-72 overflow-y-auto">
                          {visibleSkillOptions.length === 0 ? (
                            <p className="px-2 py-2 text-[11px] text-white/35">没有匹配技能</p>
                          ) : (
                            visibleSkillOptions.map((skill) => (
                              <div key={skill.id} className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-white/5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSkillId(skill.id);
                                    setSkillDropdownOpen(false);
                                  }}
                                  className="min-w-0 flex-1 truncate rounded px-2 py-1.5 text-left text-xs text-white/70"
                                >
                                  {favoriteSkillIds[skill.id] === true ? "★ " : ""}
                                  {skill.occupational ? "本职 · " : ""}
                                  {skill.name}（{skill.value}）
                                </button>
                                <button
                                  type="button"
                                  onClick={() => toggleSkillFavorite(skill.id)}
                                  title={favoriteSkillIds[skill.id] === true ? "取消收藏" : "收藏技能"}
                                  className="rounded px-2 py-1 text-sm text-amber-300 transition hover:bg-amber-400/10"
                                >
                                  {favoriteSkillIds[skill.id] === true ? "★" : "☆"}
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <span className="rounded border border-white/15 px-2 py-1 font-mono text-[11px] text-white/50">1d100</span>
                  <select
                    value={checkDifficulty}
                    onChange={(event) =>
                      setCheckDifficulty(event.target.value === "HARD" || event.target.value === "EXTREME" ? event.target.value : "REGULAR")
                    }
                    className="rounded-lg border border-white/15 bg-ink-800 px-2 py-2 text-xs outline-none"
                    title="检定难度"
                  >
                    <option value="REGULAR">常规</option>
                    <option value="HARD">困难</option>
                    <option value="EXTREME">极难</option>
                  </select>
                  <select
                    value={checkBonusDice}
                    onChange={(event) => setCheckBonusDice(Number(event.target.value))}
                    className="rounded-lg border border-white/15 bg-ink-800 px-2 py-2 text-xs outline-none"
                    title="奖励骰"
                  >
                    {[0, 1, 2].map((value) => <option key={value} value={value}>奖励骰 {value}</option>)}
                  </select>
                  <select
                    value={checkPenaltyDice}
                    onChange={(event) => setCheckPenaltyDice(Number(event.target.value))}
                    className="rounded-lg border border-white/15 bg-ink-800 px-2 py-2 text-xs outline-none"
                    title="惩罚骰"
                  >
                    {[0, 1, 2].map((value) => <option key={value} value={value}>惩罚骰 {value}</option>)}
                  </select>
                </>
              )}
            </>
          ) : diceMode === "SANITY" ? (
            <>
              {props.skillCheckCharacters.length > 1 ? (
                <select
                  value={selectedCheckCharacter?.id ?? ""}
                  onChange={(event) => setCheckCharacterId(event.target.value)}
                  className="rounded-lg border border-white/15 bg-ink-800 px-2 py-2 text-xs outline-none"
                >
                  {props.skillCheckCharacters.map((character) => (
                    <option key={character.id} value={character.id}>{character.name}</option>
                  ))}
                </select>
              ) : null}
              <label className="flex items-center gap-1 text-[11px] text-white/55">
                成功损失
                <input
                  value={sanitySuccessLoss}
                  onChange={(event) => setSanitySuccessLoss(event.target.value)}
                  className="w-20 rounded-lg border border-white/15 bg-ink-800 px-2 py-2 font-mono text-xs outline-none"
                />
              </label>
              <label className="flex items-center gap-1 text-[11px] text-white/55">
                失败损失
                <input
                  value={sanityFailureLoss}
                  onChange={(event) => setSanityFailureLoss(event.target.value)}
                  className="w-20 rounded-lg border border-white/15 bg-ink-800 px-2 py-2 font-mono text-xs outline-none"
                />
              </label>
              <input
                value={sanityReason}
                onChange={(event) => setSanityReason(event.target.value)}
                placeholder="事由（可选）"
                className="min-w-[160px] flex-1 rounded-lg border border-white/15 bg-ink-800 px-3 py-2 text-xs outline-none placeholder:text-white/25"
              />
              <button
                type="button"
                onClick={rollMadnessBout}
                className="rounded-lg border border-fuchsia-400/40 px-3 py-2 text-xs text-fuchsia-200 transition hover:bg-fuchsia-400/10"
              >
                疯狂发作 1D10
              </button>
              <button
                type="button"
                onClick={rollRealityCheck}
                className="rounded-lg border border-cyan-400/40 px-3 py-2 text-xs text-cyan-200 transition hover:bg-cyan-400/10"
              >
                现实检定
              </button>
            </>
          ) : (
            <input
              value={diceExpr}
              onChange={(event) => {
                setDiceExpr(event.target.value);
                if (error !== null) setError(null);
              }}
              onKeyDown={(event) => { if (event.key === "Enter") roll(); }}
              placeholder="例如 1d100、2d6+3"
              className="min-w-[200px] flex-1 rounded-lg border border-white/15 bg-ink-800 px-3 py-2 font-mono text-xs outline-none focus:border-spirit-400"
            />
          )}

          <select
            value={diceVisibility}
            onChange={(event) => setDiceVisibility(event.target.value as DiceVisibility)}
            className="rounded-lg border border-white/15 bg-ink-800 px-2 py-2 text-xs outline-none"
          >
            <option value="PUBLIC">公开</option>
            <option value="DARK">暗骰（发送者 + KP）</option>
            <option value="SECRET">仅自己</option>
          </select>
          <button
            type="button"
            onClick={() => {
              if (diceMode === "SANITY") rollSanityCheck();
              else roll();
            }}
            disabled={
              conn !== "online" ||
              (diceMode === "CHECK" && (selectedCheckCharacter === null || effectiveSkillId.length === 0)) ||
              (diceMode === "SANITY" && selectedCheckCharacter === null)
            }
            className="rounded-lg border border-spirit-400/40 px-4 py-2 text-xs text-spirit-400 transition hover:bg-spirit-400/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {diceMode === "SANITY"
              ? "理智检定"
              : diceMode === "CHECK" && effectiveSkill !== null
                ? "检定 " + effectiveSkill.name
                : "掷骰"}
          </button>
        </div>
      </div>
    </>
  );
}
