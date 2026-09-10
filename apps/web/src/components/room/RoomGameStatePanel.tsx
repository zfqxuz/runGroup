import { updateGameStateAction } from "@/server/actions/game";
import type { GameStateView } from "@/shared/game";

interface Props {
  readonly roomId: string;
  readonly gameId: string;
  readonly gameTitle: string;
  readonly status: string;
  readonly state: GameStateView;
  readonly moduleSections: readonly string[];
  readonly isKP: boolean;
  readonly saved: boolean;
  readonly error: string | null;
}

function valueOrDash(value: string | null): string {
  return value === null || value.length === 0 ? "未设置" : value;
}

const ERROR_LABELS: Record<string, string> = {
  version: "状态已被其他操作更新，请刷新后重试。",
  flags: "旗标必须是合法的 JSON 对象。",
  counters: "计数器必须是合法的 JSON 对象。",
  custom: "自定义状态必须是合法的 JSON 对象。",
  game: "当前没有可编辑的进行中局。"
};

export default function RoomGameStatePanel(props: Props) {
  const flagsCount = Object.keys(props.state.flags).length;
  const countersCount = Object.keys(props.state.counters).length;
  const customCount = Object.keys(props.state.custom).length;

  return (
    <section id="game-state" className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-white/80">局内状态</h2>
          <p className="mt-1 text-[11px] text-white/35">
            {props.gameTitle} · {props.status} · 状态版本 {props.state.version}
          </p>
        </div>
        <span className="rounded-full border border-spirit-400/30 px-2 py-0.5 text-[10px] text-spirit-200">
          {props.state.paused ? "已暂停" : "进行中"}
        </span>
      </div>

      {props.saved ? (
        <p className="mt-3 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-[11px] text-emerald-200">
          局内状态已保存，并已同步给在线成员。
        </p>
      ) : null}
      {props.error === null ? null : (
        <p className="mt-3 rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-[11px] text-red-200">
          {ERROR_LABELS[props.error] ?? "操作失败：" + props.error}
        </p>
      )}

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2">
          <p className="text-[10px] text-white/35">当前章节</p>
          <p className="mt-0.5 truncate text-sm text-white/75">{valueOrDash(props.state.currentChapterId)}</p>
        </div>
        <div className="rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2">
          <p className="text-[10px] text-white/35">当前场景</p>
          <p className="mt-0.5 truncate text-sm text-white/75">{valueOrDash(props.state.currentSceneId)}</p>
        </div>
        <div className="rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2">
          <p className="text-[10px] text-white/35">当前遭遇</p>
          <p className="mt-0.5 truncate text-sm text-white/75">{valueOrDash(props.state.currentEncounterId)}</p>
        </div>
        <div className="rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2">
          <p className="text-[10px] text-white/35">团内时间</p>
          <p className="mt-0.5 truncate text-sm text-white/75">{valueOrDash(props.state.gameTime)}</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-white/45">
        <span className="rounded-full border border-white/15 px-2 py-0.5">旗标 {flagsCount}</span>
        <span className="rounded-full border border-white/15 px-2 py-0.5">计数器 {countersCount}</span>
        <span className="rounded-full border border-white/15 px-2 py-0.5">自定义 {customCount}</span>
      </div>

      {props.isKP ? (
        <form action={updateGameStateAction} className="mt-5 border-t border-white/10 pt-5">
          <input type="hidden" name="roomId" value={props.roomId} />
          <input type="hidden" name="gameId" value={props.gameId} />
          <input type="hidden" name="expectedVersion" value={props.state.version} />
          <h3 className="text-xs font-medium text-white/70">KP 更新局内状态</h3>
          <datalist id="game-module-sections">
            {props.moduleSections.map((section) => (
              <option key={section} value={section} />
            ))}
          </datalist>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] text-white/45">当前章节</span>
              <input
                name="currentChapterId"
                list="game-module-sections"
                defaultValue={props.state.currentChapterId ?? ""}
                className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-sakura-500"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] text-white/45">当前场景</span>
              <input
                name="currentSceneId"
                defaultValue={props.state.currentSceneId ?? ""}
                className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-sakura-500"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] text-white/45">当前遭遇</span>
              <input
                name="currentEncounterId"
                defaultValue={props.state.currentEncounterId ?? ""}
                className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-sakura-500"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] text-white/45">团内时间</span>
              <input
                name="gameTime"
                defaultValue={props.state.gameTime ?? ""}
                placeholder="例：第 3 天 20:14"
                className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-sakura-500"
              />
            </label>
          </div>
          <div className="mt-3 grid gap-3 lg:grid-cols-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] text-white/45">旗标 JSON</span>
              <textarea
                name="flags"
                rows={5}
                defaultValue={JSON.stringify(props.state.flags, null, 2)}
                className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 font-mono text-[11px] outline-none focus:border-sakura-500"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] text-white/45">计数器 JSON</span>
              <textarea
                name="counters"
                rows={5}
                defaultValue={JSON.stringify(props.state.counters, null, 2)}
                className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 font-mono text-[11px] outline-none focus:border-sakura-500"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] text-white/45">自定义 JSON</span>
              <textarea
                name="custom"
                rows={5}
                defaultValue={JSON.stringify(props.state.custom, null, 2)}
                className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 font-mono text-[11px] outline-none focus:border-sakura-500"
              />
            </label>
          </div>
          <div className="mt-3">
            <button
              type="submit"
              className="rounded-lg bg-sakura-500 px-5 py-2.5 text-sm font-medium text-ink-900 transition hover:bg-sakura-400"
            >
              保存局内状态
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
