"use client";

import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type {
  Ack,
  ChatChannel,
  ChatMessage,
  JoinAck,
  RoomMemberView
} from "@/shared/socket";

interface Props {
  roomId: string;
  isKP: boolean;
  initialMembers: readonly RoomMemberView[];
  initialMessages: readonly ChatMessage[];
}

type ConnState = "connecting" | "online" | "offline";

export default function RoomPlay(props: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([...props.initialMessages]);
  const [members, setMembers] = useState<RoomMemberView[]>([...props.initialMembers]);
  const [channel, setChannel] = useState<ChatChannel>("OOC");
  const [text, setText] = useState("");
  const [diceExpr, setDiceExpr] = useState("1d100");
  const [conn, setConn] = useState<ConnState>("connecting");
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

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

    socket.on("connect", () => {
      if (cancelled) return;
      setConn("online");
      socket.emit("room:join", props.roomId, (result: JoinAck) => {
        if (cancelled) return;
        if (result.ok === false) {
          setError(result.error ?? "加入房间失败");
          return;
        }
        if (result.messages !== undefined) setMessages([...result.messages]);
        if (result.members !== undefined) setMembers([...result.members]);
      });
    });

    socket.on("chat:message", (message: ChatMessage) => {
      setMessages((prev) => [...prev, message]);
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
  }, [props.roomId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  function send(): void {
    const socket = socketRef.current;
    const value = text.trim();
    if (socket === null || value.length === 0) return;
    socket.emit("chat:send", { roomId: props.roomId, channel, text: value }, (result: Ack) => {
      if (result.ok === false) setError(result.error ?? "发送失败");
    });
    setText("");
  }

  function roll(): void {
    const socket = socketRef.current;
    if (socket === null) return;
    socket.emit("dice:roll", { roomId: props.roomId, expression: diceExpr }, (result: Ack) => {
      if (result.ok === false) setError(result.error ?? "掷骰失败");
    });
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
    <div className="grid gap-5 lg:grid-cols-[1fr_240px]">
      <section className="flex h-[560px] flex-col rounded-xl border border-white/10 bg-ink-800/50">
        <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <h2 className="text-sm font-medium text-white/80">跑团日志</h2>
          <span className={"rounded-full border px-2 py-0.5 text-[11px] " + connClass}>
            {connLabel}
          </span>
        </header>

        <ul className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {messages.length === 0 ? (
            <li className="py-10 text-center text-sm text-white/30">还没有消息，说点什么吧</li>
          ) : (
            messages.map((message) => (
              <li key={message.id} className="text-sm">
                <div className="flex items-baseline gap-2">
                  <span className="font-medium text-white/80">{message.displayName}</span>
                  {message.channel === "KP_ONLY" ? (
                    <span className="rounded border border-sakura-500/40 px-1 text-[10px] text-sakura-400">
                      KP
                    </span>
                  ) : null}
                  <span className="font-mono text-[10px] text-white/25">
                    {message.createdAt.slice(11, 19)}
                  </span>
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
          <div ref={bottomRef} />
        </ul>

        {error === null ? null : (
          <p className="border-t border-red-400/20 bg-red-400/5 px-4 py-2 text-xs text-red-300">{error}</p>
        )}

        <div className="border-t border-white/10 p-3">
          <div className="flex gap-2">
            <select
              value={channel}
              onChange={(event) => setChannel(event.target.value as ChatChannel)}
              className="rounded-lg border border-white/15 bg-ink-800 px-2 py-2 text-xs outline-none"
            >
              <option value="OOC">OOC</option>
              <option value="IC">IC</option>
              {props.isKP ? <option value="KP_ONLY">KP</option> : null}
            </select>
            <input
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") send(); }}
              placeholder="说点什么（回车发送）"
              className={inputClass + " flex-1"}
            />
            <button
              type="button"
              onClick={send}
              className="rounded-lg bg-sakura-500 px-4 py-2 text-sm font-medium text-ink-900 transition hover:bg-sakura-400"
            >
              发送
            </button>
          </div>

          <div className="mt-2 flex gap-2">
            <input
              value={diceExpr}
              onChange={(event) => setDiceExpr(event.target.value)}
              placeholder="1d100  2d6+3"
              className="flex-1 rounded-lg border border-white/15 bg-ink-800 px-3 py-2 font-mono text-xs outline-none focus:border-spirit-400"
            />
            <button
              type="button"
              onClick={roll}
              className="rounded-lg border border-spirit-400/40 px-4 py-2 text-xs text-spirit-400 transition hover:bg-spirit-400/10"
            >
              掷骰
            </button>
          </div>
        </div>
      </section>

      <aside className="rounded-xl border border-white/10 bg-ink-800/50 p-4">
        <h2 className="text-sm font-medium text-white/80">成员（{members.length}）</h2>
        <ul className="mt-3 space-y-2">
          {members.map((member) => (
            <li key={member.userId} className="flex items-center justify-between text-sm">
              <span className="text-white/70">{member.displayName}</span>
              <span className="text-[10px] text-white/35">{member.role}</span>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
