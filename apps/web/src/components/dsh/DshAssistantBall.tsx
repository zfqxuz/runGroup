"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import Image from "next/image";
import { dshContextKey, parseDshRoute } from "@/shared/dsh-context";

interface SkillMeta {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly effect: "READ" | "WRITE";
  readonly audience: string;
}

interface DshContextPayload {
  readonly kind: string;
  readonly label: string;
  readonly pathname: string;
  readonly canEditModule: boolean;
  readonly isKp: boolean;
}

interface ContextResponse {
  readonly ok: boolean;
  readonly configured?: boolean;
  readonly available?: boolean;
  readonly reason?: string | null;
  readonly context?: DshContextPayload;
  readonly skills?: readonly SkillMeta[];
  readonly error?: string;
}

type MessageRole = "user" | "assistant" | "thinking";

interface Message {
  readonly role: MessageRole;
  readonly content: string;
}

interface StreamEvent {
  readonly type?: string;
  readonly text?: string;
  readonly reply?: string;
  readonly version?: string | null;
  readonly skillId?: string | null;
  readonly error?: string;
}

const PLACEHOLDERS: Record<string, string> = {
  "nav.guide": "例如：我想审核玩家的角色卡 / 我想发起一场战斗…",
  "kp.rule": "例如：困难成功是多少？DP 回避消耗怎么算？",
  "module.explain": "例如：帮我梳理这三章的节奏和线索",
  "combat.explain": "例如：现在轮到我了吗？我有哪些行动可选？",
  "module.edit": "描述你想怎么改这个团本，例如：把最终 Boss 改强一点…",
  "assistant.chat": "问关于当前页面的任何问题…"
};

const BALL_SIZE = 64;
const BALL_MARGIN = 12;
const PANEL_WIDTH = 400;
const PANEL_HEIGHT = 560;
const PANEL_GAP = 12;
const POSITION_STORAGE_KEY = "dsh-ball-position";

interface BallPosition {
  readonly x: number;
  readonly y: number;
}

/** 把悬浮球限制在视口内。 */
function clampPosition(x: number, y: number, viewportWidth: number, viewportHeight: number): BallPosition {
  const maxX = Math.max(BALL_MARGIN, viewportWidth - BALL_SIZE - BALL_MARGIN);
  const maxY = Math.max(BALL_MARGIN, viewportHeight - BALL_SIZE - BALL_MARGIN);
  return {
    x: Math.min(Math.max(x, BALL_MARGIN), maxX),
    y: Math.min(Math.max(y, BALL_MARGIN), maxY)
  };
}

export default function DshAssistantBall() {
  const pathname = usePathname();
  const router = useRouter();
  const route = useMemo(() => parseDshRoute(pathname), [pathname]);
  const contextKey = dshContextKey(route);
  const lastKeyRef = useRef<string | null>(null);

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<ContextResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [skillId, setSkillId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<BallPosition | null>(null);
  const [viewport, setViewport] = useState<{ readonly width: number; readonly height: number }>({ width: 0, height: 0 });
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const positionRef = useRef<BallPosition | null>(null);

  useEffect(() => {
    if (scrollRef.current !== null) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, sending, open]);

  // 读取持久化位置，并在视口变化时把球拉回可见区域。
  useEffect(() => {
    let stored: BallPosition | null = null;
    try {
      const raw = window.localStorage.getItem(POSITION_STORAGE_KEY);
      if (raw !== null) {
        const parsed = JSON.parse(raw) as { readonly x?: unknown; readonly y?: unknown };
        if (typeof parsed.x === "number" && typeof parsed.y === "number") {
          stored = { x: parsed.x, y: parsed.y };
        }
      }
    } catch {
      stored = null;
    }
    const apply = (): void => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      setViewport({ width, height });
      setPosition((current) => {
        const base = current ?? stored ?? { x: width - BALL_SIZE - 24, y: height - BALL_SIZE - 24 };
        return clampPosition(base.x, base.y, width, height);
      });
    };
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, []);

  useEffect(() => {
    positionRef.current = position;
  }, [position]);

  // 面板跟随球的位置：默认在球上方，空间不够就放到下方，并始终留在视口内。
  const panelLayout = useMemo(() => {
    if (position === null || viewport.width === 0 || viewport.height === 0) return null;
    const panelWidth = Math.min(PANEL_WIDTH, viewport.width - BALL_MARGIN * 2);
    const panelHeight = Math.min(PANEL_HEIGHT, viewport.height - 80);
    let left = position.x + BALL_SIZE - panelWidth;
    left = Math.min(Math.max(left, BALL_MARGIN), Math.max(BALL_MARGIN, viewport.width - panelWidth - BALL_MARGIN));
    let top = position.y - panelHeight - PANEL_GAP;
    if (top < BALL_MARGIN + 48) top = position.y + BALL_SIZE + PANEL_GAP;
    top = Math.min(Math.max(top, BALL_MARGIN + 8), Math.max(BALL_MARGIN, viewport.height - panelHeight - BALL_MARGIN));
    return { left, top, width: panelWidth, height: panelHeight };
  }, [position, viewport]);

  function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>): void {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const origin = positionRef.current ?? { x: 0, y: 0 };
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: origin.x,
      originY: origin.y,
      moved: false
    };
    suppressClickRef.current = false;
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLButtonElement>): void {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (drag.moved === false && Math.hypot(dx, dy) < 5) return;
    drag.moved = true;
    suppressClickRef.current = true;
    const width = viewport.width > 0 ? viewport.width : window.innerWidth;
    const height = viewport.height > 0 ? viewport.height : window.innerHeight;
    setPosition(clampPosition(drag.originX + dx, drag.originY + dy, width, height));
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLButtonElement>): void {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (drag.moved === false) return;
    const latest = positionRef.current;
    if (latest !== null) {
      try {
        window.localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(latest));
      } catch {
        // 隐私模式等场景忽略持久化失败。
      }
    }
  }

  function handleClick(): void {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    setOpen((current) => !current);
  }

  useEffect(() => {
    let cancelled = false;
    const changed = lastKeyRef.current !== contextKey;
    lastKeyRef.current = contextKey;
    setLoadError(null);
    fetch("/api/dsh/context?pathname=" + encodeURIComponent(pathname), { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as ContextResponse | null;
        if (cancelled) return;
        if (response.ok === false || payload === null) {
          setLoadError(payload?.error ?? "无法读取 ai 助手上下文");
          return;
        }
        setInfo(payload);
        if (changed) {
          setMessages([]);
          setSkillId(null);
          setError(null);
        }
      })
      .catch(() => {
        if (cancelled === false) setLoadError("无法连接 ai 助手，请稍后重试");
      });
    return () => {
      cancelled = true;
    };
  }, [contextKey, pathname]);

  const skills = info?.skills ?? [];
  const available = info?.available === true;
  const selectedSkill = skillId === null ? null : skills.find((skill) => skill.id === skillId) ?? null;
  const placeholder =
    (selectedSkill === null ? PLACEHOLDERS["assistant.chat"] : PLACEHOLDERS[selectedSkill.id]) ??
    "描述你的问题…（Ctrl + Enter 发送）";

  async function send(): Promise<void> {
    const message = input.trim();
    if (message.length === 0 || sending || available === false) return;
    setSending(true);
    setError(null);
    setStatus("ai 正在准备…");
    setInput("");

    const history = messages.flatMap((item) =>
      item.role === "user" || item.role === "assistant" ? [{ role: item.role, content: item.content }] : []
    );
    setMessages((current) => [...current, { role: "user", content: message }]);

    try {
      const response = await fetch("/api/dsh/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skillId, pathname, message, history })
      });
      if (response.ok === false) {
        const payload = (await response.json().catch(() => null)) as { readonly error?: string } | null;
        setError(payload?.error ?? "ai 助手请求失败");
        return;
      }
      if (response.body === null) throw new Error("服务器没有返回流");

      setMessages((current) => [...current, { role: "thinking", content: "" }]);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let reply = "";
      let nextVersion: string | null = null;
      let streamError: string | null = null;

      const handleEvent = (event: StreamEvent): void => {
        if ((event.type === "thinking" || event.type === "progress") && typeof event.text === "string") {
          if (event.type === "progress") {
            setStatus(event.text);
            return;
          }
          const text = event.text;
          setMessages((current) => {
            const next = [...current];
            for (let index = next.length - 1; index >= 0; index -= 1) {
              const item = next[index];
              if (item !== undefined && item.role === "thinking") {
                next[index] = { role: "thinking", content: item.content.length > 0 ? item.content + "\n" + text : text };
                break;
              }
            }
            return next;
          });
          return;
        }
        if (event.type === "final") {
          reply = typeof event.reply === "string" ? event.reply : "";
          if (typeof event.version === "string") nextVersion = event.version;
          return;
        }
        if (event.type === "error") {
          streamError = typeof event.error === "string" ? event.error : "ai 助手执行失败";
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let index: number;
        while ((index = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);
          if (line.length === 0) continue;
          try {
            handleEvent(JSON.parse(line) as StreamEvent);
          } catch {
            // 忽略非法行。
          }
        }
      }
      buffer += decoder.decode();
      if (buffer.trim().length > 0) {
        try {
          handleEvent(JSON.parse(buffer.trim()) as StreamEvent);
        } catch {
          // 忽略。
        }
      }

      if (streamError !== null) {
        setError(streamError);
        setMessages((current) => current.filter((item) => item.role !== "thinking"));
        return;
      }
      setMessages((current) => {
        const withoutThinking = current.filter((item) => item.role !== "thinking");
        return [...withoutThinking, { role: "assistant", content: reply.length > 0 ? reply : "已完成。" }];
      });
      if (nextVersion !== null) router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "网络异常，请稍后重试");
      setMessages((current) => current.filter((item) => item.role !== "thinking"));
    } finally {
      setSending(false);
      setStatus(null);
    }
  }

  if (pathname.startsWith("/login") || pathname.startsWith("/register")) return null;

  const contextLabel = info?.context?.label ?? (info === null ? "ai 助手" : "通用助手");

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        aria-label="打开 ai 助手"
        title="点击打开，拖动可移动位置"
        data-dsh-ball
        style={position === null ? undefined : { left: position.x, top: position.y }}
        className={
          "fixed z-[120] flex h-16 w-16 touch-none cursor-grab items-center justify-center overflow-hidden rounded-full border border-white/15 bg-ink-900/90 shadow-2xl ring-2 ring-sakura-500/35 transition hover:scale-105 active:cursor-grabbing" +
          (position === null ? " bottom-6 right-6" : "")
        }
      >
        <Image src="/ai-module-assistant.png" alt="" width={64} height={64} className="h-full w-full object-contain" priority />
      </button>

      {open ? (
        <section
          data-dsh-panel
          data-context-kind={info?.context?.kind ?? "GLOBAL"}
          style={panelLayout === null ? undefined : { left: panelLayout.left, top: panelLayout.top, width: panelLayout.width, height: panelLayout.height }}
          className={
            "fixed z-[130] flex max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-2xl border border-white/15 bg-ink-900 shadow-2xl" +
            (panelLayout === null ? " bottom-24 right-6 h-[560px] w-[400px]" : "")
          }
        >
          <header className="border-b border-white/10 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <Image src="/ai-module-assistant.png" alt="" width={32} height={32} className="h-8 w-8 shrink-0 rounded-full object-contain" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-white/85">ai 助手</p>
                  <p data-dsh-context-label className="mt-0.5 truncate text-[11px] text-white/40">
                    {contextLabel}
                    {selectedSkill === null ? "" : " · " + selectedSkill.title}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="shrink-0 rounded-lg border border-white/15 px-2.5 py-1 text-xs text-white/60 transition hover:border-white/35 hover:text-white"
              >
                关闭
              </button>
            </div>

            {skills.length > 0 ? (
              <div className="mt-2.5 flex gap-1.5 overflow-x-auto pb-0.5">
                <button
                  type="button"
                  data-skill-id="__auto__"
                  onClick={() => setSkillId(null)}
                  className={
                    "shrink-0 rounded-full border px-2.5 py-1 text-[11px] transition " +
                    (skillId === null
                      ? "border-sakura-500/60 bg-sakura-500/15 text-sakura-200"
                      : "border-white/15 text-white/50 hover:border-white/35 hover:text-white/80")
                  }
                >
                  自动
                </button>
                {skills.map((skill) => (
                  <button
                    key={skill.id}
                    type="button"
                    data-skill-id={skill.id}
                    title={skill.description}
                    onClick={() => setSkillId(skill.id)}
                    className={
                      "shrink-0 rounded-full border px-2.5 py-1 text-[11px] transition " +
                      (skillId === skill.id
                        ? "border-sakura-500/60 bg-sakura-500/15 text-sakura-200"
                        : "border-white/15 text-white/50 hover:border-white/35 hover:text-white/80")
                    }
                  >
                    {skill.title}
                    {skill.effect === "WRITE" ? " ✎" : ""}
                  </button>
                ))}
              </div>
            ) : null}
            {selectedSkill === null ? null : (
              <p className="mt-2 text-[10px] leading-relaxed text-white/35">{selectedSkill.description}</p>
            )}
          </header>

          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
            {available === false ? (
              <div className="rounded-xl border border-amber-400/25 bg-amber-400/5 px-3 py-3 text-[11px] leading-relaxed text-amber-100/80">
                {info?.reason ?? loadError ?? "ai 助手当前不可用"}
              </div>
            ) : messages.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-ink-800/50 px-3 py-3 text-[11px] leading-relaxed text-white/45">
                我是常驻的 ai 助手，会自动带上你当前页面的上下文。
                <br />
                上方可以切换技能：不选就是通用助手。
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {messages.map((item, index) => {
                  if (item.role === "thinking") {
                    const isLast = index === messages.length - 1;
                    return (
                      <div
                        key={index}
                        data-role="thinking"
                        className="max-w-[92%] self-start rounded-2xl border border-spirit-500/20 bg-spirit-500/5 px-3 py-2 text-[11px] leading-relaxed text-white/55"
                      >
                        <p className="mb-1 flex items-center gap-1.5 text-[10px] font-medium text-spirit-300/80">
                          {sending && isLast ? (
                            <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border border-spirit-300/40 border-t-spirit-300" />
                          ) : null}
                          思考过程
                        </p>
                        <p className="whitespace-pre-wrap">
                          {item.content.length > 0 ? item.content : "ai 正在思考…"}
                        </p>
                        {sending && isLast && status !== null ? (
                          <p className="mt-1 text-[10px] text-spirit-300/70">{status}</p>
                        ) : null}
                      </div>
                    );
                  }
                  return (
                    <div
                      key={index}
                      data-role={item.role}
                      className={
                        "max-w-[92%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-xs leading-relaxed " +
                        (item.role === "user"
                          ? "self-end bg-sakura-500/20 text-white/85"
                          : "self-start border border-white/10 bg-ink-800/70 text-white/75")
                      }
                    >
                      {item.content}
                    </div>
                  );
                })}
              </div>
            )}
            {error === null ? null : (
              <p className="mt-3 rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-[11px] text-red-200">{error}</p>
            )}
          </div>

          <div className="border-t border-white/10 p-3">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && event.ctrlKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              rows={3}
              disabled={available === false}
              placeholder={available === false ? "ai 助手当前不可用" : placeholder}
              className="w-full resize-none rounded-lg border border-white/15 bg-ink-800 px-3 py-2 text-xs leading-relaxed text-white/85 outline-none focus:border-sakura-500 disabled:opacity-50"
            />
            <div className="mt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => void send()}
                disabled={sending || available === false || input.trim().length === 0}
                className="rounded-lg bg-sakura-500 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-sakura-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                发送
              </button>
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}
