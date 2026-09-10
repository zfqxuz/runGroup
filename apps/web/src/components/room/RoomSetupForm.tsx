"use client";

import { useState } from "react";
import { createRoomAction } from "@/server/actions/room";

type SystemKey = "COC7" | "TOUHOU";

interface PackOptions {
  readonly methods: ReadonlyArray<{ readonly id: string; readonly label: string }>;
  readonly events: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly description: string | null;
  }>;
  readonly defaultMode: "INITIATIVE" | "ATB";
}

interface Props {
  readonly options: Record<SystemKey, PackOptions>;
}

const MODE_LABELS: Record<"INITIATIVE" | "ATB", { title: string; hint: string }> = {
  INITIATIVE: { title: "顺序制", hint: "KP 每轮排定出手顺序，全员依次行动" },
  ATB: { title: "ATB 进度条", hint: "全局计数器推进，谁进度先满谁行动" }
};

export default function RoomSetupForm(props: Props) {
  const [system, setSystem] = useState<SystemKey>("COC7");
  const active = props.options[system];
  const [methodId, setMethodId] = useState(active.methods[0]?.id ?? "");
  const [combatMode, setCombatMode] = useState<"INITIATIVE" | "ATB">(active.defaultMode);
  const [disabled, setDisabled] = useState<readonly string[]>([]);
  const [allowPlayerCombatRequest, setAllowPlayerCombatRequest] = useState(true);

  function switchSystem(next: SystemKey): void {
    const nextOptions = props.options[next];
    setSystem(next);
    setMethodId(nextOptions.methods[0]?.id ?? "");
    setCombatMode(nextOptions.defaultMode);
    setDisabled([]);
  }

  function toggleEvent(id: string): void {
    setDisabled((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  }

  const inputClass =
    "w-full rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-sakura-500";

  return (
    <form action={createRoomAction} className="flex flex-col gap-5">
      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <h2 className="text-sm font-medium text-white/80">房间</h2>
        <label className="mt-4 flex flex-col gap-1.5">
          <span className="text-xs text-white/50">房间名</span>
          <input name="name" placeholder="例：红魔馆异变调查" className={inputClass} />
        </label>
        <input type="hidden" name="system" value={system} />
      </section>

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <h2 className="text-sm font-medium text-white/80">模组</h2>
        <p className="mt-1 text-[11px] text-white/35">
          决定技能表、种族与可用卡池。角色卡和卡牌不能跨模组使用。
        </p>
        <div className="mt-3 flex gap-2">
          {(["COC7", "TOUHOU"] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => switchSystem(key)}
              className={
                key === system
                  ? "rounded-lg border border-sakura-500/50 bg-sakura-500/10 px-4 py-2 text-sm text-sakura-400"
                  : "rounded-lg border border-white/15 px-4 py-2 text-sm text-white/50 transition hover:border-white/30"
              }
            >
              {key === "COC7" ? "COC7 原版" : "东方模组"}
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <h2 className="text-sm font-medium text-white/80">车卡方式</h2>
        <p className="mt-1 text-[11px] text-white/35">全房统一，进房后不能改</p>
        <div className="mt-3 flex flex-col gap-2">
          {active.methods.map((method) => (
            <label key={method.id} className="flex items-center gap-3 rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2.5">
              <input
                type="radio"
                name="chargenMethod"
                value={method.id}
                checked={method.id === methodId}
                onChange={() => setMethodId(method.id)}
                className="accent-sakura-500"
              />
              <span className="text-sm text-white/75">{method.label}</span>
            </label>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <h2 className="text-sm font-medium text-white/80">战斗模式</h2>
        <p className="mt-1 text-[11px] text-white/35">默认跟随模组，可以覆盖</p>
        <div className="mt-3 flex flex-col gap-2">
          {(["INITIATIVE", "ATB"] as const).map((mode) => (
            <label key={mode} className="flex items-start gap-3 rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2.5">
              <input
                type="radio"
                name="combatMode"
                value={mode}
                checked={mode === combatMode}
                onChange={() => setCombatMode(mode)}
                className="mt-1 accent-sakura-500"
              />
              <span>
                <span className="block text-sm text-white/75">{MODE_LABELS[mode].title}</span>
                <span className="mt-0.5 block text-[11px] text-white/35">{MODE_LABELS[mode].hint}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-white/80">战斗中允许发生的事件</h2>
            <p className="mt-1 text-[11px] text-white/35">默认全部开启，勾选「禁用」则本房不生效</p>
          </div>
          <span className="shrink-0 rounded-full border border-white/15 px-2 py-0.5 text-[10px] text-white/50">
            启用 {active.events.length - disabled.length} / {active.events.length}
          </span>
        </div>
        <div className="mt-3 flex flex-col gap-2">
          {active.events.map((event) => (
            <label
              key={event.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2.5"
            >
              <span className="min-w-0">
                <span className="block text-sm text-white/75">{event.label}</span>
                {event.description === null ? null : (
                  <span className="mt-0.5 block text-[11px] text-white/35">{event.description}</span>
                )}
              </span>
              <span className="flex shrink-0 items-center gap-2 pt-0.5">
                <span className="text-[10px] text-white/30">禁用</span>
                <input
                  type="checkbox"
                  name="disabledEvents"
                  value={event.id}
                  checked={disabled.includes(event.id)}
                  onChange={() => toggleEvent(event.id)}
                  className="accent-red-400"
                />
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-white/80">战斗申请</h2>
            <p className="mt-1 text-[11px] text-white/35">开启后 PL 可发起战斗申请，由 KP 审批；KP 始终可直接发起</p>
          </div>
          <label className="flex shrink-0 items-center gap-2 pt-0.5">
            <input
              type="checkbox"
              checked={allowPlayerCombatRequest}
              onChange={(event) => setAllowPlayerCombatRequest(event.target.checked)}
              className="accent-sakura-500"
            />
            <span className="text-xs text-white/60">{allowPlayerCombatRequest ? "允许" : "禁止"}</span>
          </label>
        </div>
        <input type="hidden" name="allowPlayerCombatRequest" value={allowPlayerCombatRequest ? "1" : "0"} />
      </section>

      <button
        type="submit"
        className="rounded-lg bg-sakura-500 px-6 py-3 text-sm font-medium text-ink-900 transition hover:bg-sakura-400"
      >
        创建房间
      </button>
    </form>
  );
}
