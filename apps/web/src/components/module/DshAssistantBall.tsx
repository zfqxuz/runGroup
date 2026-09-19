"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

interface Props {
  readonly moduleId: string;
  readonly moduleTitle: string;
  readonly initialVersion: string;
  readonly roomId?: string;
}

interface Message {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export default function DshAssistantBall(props: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(props.initialVersion);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (scrollRef.current !== null) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, sending, open]);

  async function send(): Promise<void> {
    const message = input.trim();
    if (message.length === 0 || sending) return;
    setSending(true);
    setError(null);
    try {
      const response = await fetch("/api/modules/" + props.moduleId + "/dsh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, history: messages })
      });
      const payload = (await response.json()) as {
        readonly ok?: boolean;
        readonly reply?: string;
        readonly version?: string;
        readonly error?: string;
      };
      if (payload.ok !== true) {
        setError(payload.error ?? "团本助手执行失败");
        return;
      }
      setMessages((current) => [
        ...current,
        { role: "user", content: message },
        { role: "assistant", content: payload.reply ?? "团本已修改。" }
      ]);
      if (typeof payload.version === "string") setVersion(payload.version);
      setInput("");
      router.refresh();
    } catch {
      setError("网络异常，请稍后重试");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label="打开 ai团本助手"
        className="fixed bottom-6 right-6 z-[120] flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border border-white/15 bg-ink-900/90 shadow-2xl ring-2 ring-sakura-500/35 transition hover:scale-105"
      >
        <Image src="/ai-module-assistant.png" alt="" width={64} height={64} className="h-full w-full object-contain" priority />
      </button>

      {open ? (
        <section className="fixed bottom-24 right-6 z-[130] flex h-[540px] w-[380px] max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-2xl border border-white/15 bg-ink-900 shadow-2xl">
          <header className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <Image src="/ai-module-assistant.png" alt="" width={32} height={32} className="h-8 w-8 shrink-0 rounded-full object-contain" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-white/85">ai团本助手</p>
                <p className="mt-0.5 truncate text-[11px] text-white/35">
                  {props.moduleTitle} · v{version}
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
          </header>

          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
            {messages.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-ink-800/50 px-3 py-3 text-[11px] leading-relaxed text-white/45">
                直接说出你想怎么改这个团本，例如：
                <br />「把最终 Boss 改强一点」
                <br />「给老周补一段背景」
                <br />「这一节的节奏太快了，拆成两场遭遇」
                <br />
                <span className="mt-1 block text-white/30">每次成功修改，小版本号 +1。</span>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {messages.map((item, index) => (
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
                ))}
              </div>
            )}
            {sending ? (
              <p className="mt-3 flex items-center gap-2 text-[11px] text-spirit-300">
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-spirit-300/40 border-t-spirit-300" />
                ai 正在阅读团本并修改，通常需要 10~60 秒…
              </p>
            ) : null}
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
              placeholder="描述你想修改的内容…（Ctrl + Enter 发送）"
              className="w-full resize-none rounded-lg border border-white/15 bg-ink-800 px-3 py-2 text-xs leading-relaxed text-white/85 outline-none focus:border-sakura-500"
            />
            <div className="mt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => void send()}
                disabled={sending || input.trim().length === 0}
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
