import Link from "next/link";
import ClueAdminControls, { type ClueMemberOption } from "@/components/room/ClueAdminControls";
import KpCombatRequestPanel from "@/components/room/KpCombatRequestPanel";
import ImageUpload from "@/components/upload/ImageUpload";
import { setGameSceneAction } from "@/server/actions/game";
import { applyMapBackgroundAction, createSceneTokenAction, setSceneFogAction } from "@/server/actions/scene";
import { createClueAction, setAllCluesPrivateAction } from "@/server/actions/room-info";
import type { GameStateView } from "@/shared/game";

export interface KpPrepOption {
  readonly id: string;
  readonly title: string;
  readonly detail: string | null;
}

export interface KpPrepClueOption {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly isPublic: boolean;
  readonly discoveredCount: number;
  readonly sharedWithIds: readonly string[];
}

interface Props {
  readonly roomId: string;
  readonly gameId: string;
  readonly gameTitle: string;
  readonly state: GameStateView;
  readonly sceneOptions: readonly KpPrepOption[];
  readonly sections: readonly string[];
  readonly chapterOptions: readonly KpPrepOption[];
  readonly encounterOptions: readonly KpPrepOption[];
  readonly chapterTitle: string | null;
  readonly encounterTitle: string | null;
  readonly clues: readonly KpPrepClueOption[];
  readonly members: readonly ClueMemberOption[];
  readonly sceneId: string | null;
  readonly mapId: string | null;
  readonly mapBackgroundUrl: string | null;
  readonly fogEnabled: boolean;
  readonly backgroundAssets: readonly { readonly id: string; readonly label: string; readonly url: string }[];
  readonly units: readonly { readonly ref: string; readonly name: string; readonly kind: "PLAYER" | "NPC" }[];
}

const inputClass =
  "rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-sakura-500";

/** KP 专属准备区：场景切换、线索公布与定向分享。 */
export default function KpPrepPanel(props: Props) {
  const currentScene = props.sceneOptions.find((scene) => scene.id === props.state.currentSceneId) ?? null;
  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-xl border border-sakura-500/30 bg-sakura-500/5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-medium text-sakura-200">KP 准备区</h2>
            <p className="mt-1 text-[11px] text-white/40">{props.gameTitle}</p>
          </div>
          <span className="rounded-full border border-sakura-500/40 px-2 py-0.5 text-[10px] text-sakura-300">
            仅 KP 可见
          </span>
        </div>

        <div className="mt-4 grid gap-2 border-t border-white/10 pt-4 sm:grid-cols-2">
          <div className="rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2">
            <p className="text-[10px] text-white/35">当前章节</p>
            <p className="mt-0.5 truncate text-sm text-white/75">{props.chapterTitle ?? "未设置"}</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2">
            <p className="text-[10px] text-white/35">当前遭遇</p>
            <p className="mt-0.5 truncate text-sm text-white/75">{props.encounterTitle ?? "未设置"}</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2 sm:col-span-2">
            <p className="text-[10px] text-white/35">团内时间</p>
            <p className="mt-0.5 truncate text-sm text-white/75">{props.state.gameTime ?? "未设置"}</p>
          </div>
        </div>

        <details className="mt-3 rounded-lg border border-white/10 bg-ink-900/40 p-3">
          <summary className="cursor-pointer text-[11px] text-white/45">可用章节 / 遭遇（开局快照，只读）</summary>
          <div className="mt-2 flex flex-col gap-2">
            <div>
              <p className="text-[10px] text-white/35">正文章节（快照 sections）</p>
              {props.sections.length === 0 ? (
                <p className="text-[10px] text-white/30">无</p>
              ) : (
                <div className="mt-1 flex flex-wrap gap-1">
                  {props.sections.map((section) => (
                    <span key={section} className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-white/50">
                      {section}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div>
              <p className="text-[10px] text-white/35">章节</p>
              {props.chapterOptions.length === 0 ? (
                <p className="text-[10px] text-white/30">无</p>
              ) : (
                <div className="mt-1 flex flex-wrap gap-1">
                  {props.chapterOptions.map((item) => (
                    <span key={item.id} className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-white/50">
                      {item.title}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div>
              <p className="text-[10px] text-white/35">遭遇</p>
              {props.encounterOptions.length === 0 ? (
                <p className="text-[10px] text-white/30">无</p>
              ) : (
                <div className="mt-1 flex flex-wrap gap-1">
                  {props.encounterOptions.map((item) => (
                    <span key={item.id} className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-white/50">
                      {item.title}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </details>

        <form action={setGameSceneAction} className="mt-3 flex flex-col gap-2 border-t border-white/10 pt-4">
          <input type="hidden" name="roomId" value={props.roomId} />
          <input type="hidden" name="gameId" value={props.gameId} />
          <input type="hidden" name="returnTo" value={"/rooms/" + props.roomId} />
          <span className="text-[11px] text-white/45">切换场景</span>
          {props.sceneOptions.length === 0 ? (
            <p className="text-xs text-white/40">团本没有结构化场景，可先去场景 / 地图页面创建。</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <select name="sceneId" defaultValue={props.state.currentSceneId ?? ""} className={inputClass + " min-w-[200px] flex-1"}>
                <option value="">未设置</option>
                {props.sceneOptions.map((scene) => (
                  <option key={scene.id} value={scene.id}>
                    {scene.title}
                    {scene.detail === null ? "" : "（" + scene.detail + "）"}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="rounded-lg bg-sakura-500 px-4 py-2 text-xs font-medium text-ink-900 transition hover:bg-sakura-400"
              >
                切换场景
              </button>
            </div>
          )}
          {currentScene === null ? null : (
            <p className="text-[10px] text-white/35">当前：{currentScene.title}</p>
          )}
        </form>

        {props.mapId === null ? null : (
          <div className="mt-4 border-t border-white/10 pt-4">
            <p className="text-[11px] text-white/45">地图背景</p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-start">
              <div className="h-24 w-full overflow-hidden rounded-lg border border-white/10 bg-ink-800 sm:w-40">
                {props.mapBackgroundUrl === null ? (
                  <span className="flex h-full items-center justify-center text-[11px] text-white/25">无背景</span>
                ) : (
                  <img src={props.mapBackgroundUrl} alt="" className="h-full w-full object-cover" />
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <ImageUpload kind="MAP" targetId={props.mapId} currentUrl={props.mapBackgroundUrl} label="上传新背景" shape="wide" />
            {props.sceneId === null ? null : (
              <form action={setSceneFogAction} className="mt-1 flex items-center justify-between gap-2 rounded border border-white/10 bg-ink-800 px-2 py-1.5">
                <input type="hidden" name="roomId" value={props.roomId} />
                <input type="hidden" name="sceneId" value={props.sceneId} />
                <input type="hidden" name="returnTo" value={"/rooms/" + props.roomId} />
                <span className="text-[10px] text-white/45">战争迷雾：{props.fogEnabled ? "已开启" : "已关闭"}</span>
                <button
                  type="submit"
                  name="enabled"
                  value={props.fogEnabled ? "0" : "1"}
                  className="rounded border border-purple-400/40 px-2 py-1 text-[10px] text-purple-200 transition hover:bg-purple-400/10"
                >
                  {props.fogEnabled ? "关闭" : "开启"}
                </button>
              </form>
            )}
                <form action={applyMapBackgroundAction} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="roomId" value={props.roomId} />
                  <input type="hidden" name="sceneId" value={props.sceneId ?? ""} />
                  <input type="hidden" name="returnTo" value={"/rooms/" + props.roomId} />
                  {props.backgroundAssets.length === 0 ? (
                    <span className="text-[10px] text-white/35">还没有可选的团本 / 房间素材，可直接上传。</span>
                  ) : (
                    <select name="assetId" className="min-w-[180px] flex-1 rounded border border-white/15 bg-ink-900 px-2 py-1.5 text-[11px] text-white/75 outline-none">
                      {props.backgroundAssets.map((asset) => (
                        <option key={asset.id} value={asset.id}>{asset.label}</option>
                      ))}
                    </select>
                  )}
                  <button
                    type="submit"
                    disabled={props.backgroundAssets.length === 0}
                    className="rounded border border-spirit-400/40 px-3 py-1.5 text-[11px] text-spirit-300 transition hover:bg-spirit-400/10 disabled:opacity-40"
                  >
                    应用背景
                  </button>
                </form>
              </div>
            </div>
          </div>
        )}

        {props.sceneId === null ? null : (
          <form id="kp-token-place" action={createSceneTokenAction} className="mt-4 flex scroll-mt-6 flex-col gap-2 border-t border-white/10 pt-4">
            <input type="hidden" name="roomId" value={props.roomId} />
            <input type="hidden" name="sceneId" value={props.sceneId} />
            <input type="hidden" name="returnTo" value={"/rooms/" + props.roomId} />
            <p className="text-[11px] text-white/45">放置 PC / NPC Token 到当前场景</p>
            {props.units.length === 0 ? (
              <p className="text-[10px] text-white/35">当前没有可放置的单位。</p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <select name="unitRef" className="min-w-[180px] flex-1 rounded border border-white/15 bg-ink-900 px-2 py-1.5 text-xs text-white/75 outline-none">
                  {props.units.map((unit) => (
                    <option key={unit.ref} value={unit.ref}>
                      {unit.name}（{unit.kind === "NPC" ? "NPC" : "PC"}）
                    </option>
                  ))}
                </select>
                <button type="submit" className="rounded border border-spirit-400/40 px-3 py-1.5 text-[11px] text-spirit-300 transition hover:bg-spirit-400/10">
                  放置到本场景
                </button>
              </div>
            )}
            <span className="text-[10px] text-white/30">同一角色全局唯一；其他场景已有的 Token 会被移动到当前场景。</span>
          </form>
        )}

        <div className="mt-4 flex flex-wrap gap-2 border-t border-white/10 pt-4">
          <Link href={"/rooms/" + props.roomId + "/modules"} className="rounded-lg border border-spirit-400/40 px-3 py-1.5 text-[11px] text-spirit-300 transition hover:bg-spirit-400/10">
            团本编辑与素材
          </Link>
          <Link href={"/rooms/" + props.roomId + "/npcs/new"} className="rounded-lg border border-spirit-400/40 px-3 py-1.5 text-[11px] text-spirit-300 transition hover:bg-spirit-400/10">
            新建 NPC
          </Link>
        </div>
      </section>

      <KpCombatRequestPanel roomId={props.roomId} />

      <section id="kp-clues" className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-medium text-white/80">线索公布</h2>
          </div>
          <form action={setAllCluesPrivateAction}>
            <input type="hidden" name="roomId" value={props.roomId} />
            <input type="hidden" name="returnTo" value={"/rooms/" + props.roomId + "?clue=updated#room-info"} />
            <button type="submit" className="rounded border border-amber-400/40 px-2 py-1 text-[10px] text-amber-200 transition hover:bg-amber-400/10">
              全部设为私密
            </button>
          </form>
        </div>

        <form action={createClueAction} className="mt-4 flex flex-col gap-2 border-b border-white/10 pb-4">
          <input type="hidden" name="roomId" value={props.roomId} />
          <input type="hidden" name="returnTo" value={"/rooms/" + props.roomId + "?clue=created#room-info"} />
          <input name="title" placeholder="线索标题" className={inputClass} />
          <textarea name="content" rows={3} placeholder="线索内容" className={inputClass} />
          <label className="flex items-center gap-2 text-[11px] text-white/50">
            <input type="checkbox" name="isPublic" value="1" />
            对所有成员公开（默认仅 KP 可见）
          </label>
          <button type="submit" className="self-start rounded-lg bg-sakura-500 px-4 py-2 text-xs font-medium text-ink-900 transition hover:bg-sakura-400">
            发布线索
          </button>
        </form>

        <div className="mt-4 flex flex-col gap-3">
          <h3 className="text-xs font-medium text-white/70">全部线索（{props.clues.length}）</h3>
          {props.clues.length === 0 ? (
            <p className="text-xs text-white/35">还没有线索。</p>
          ) : (
            props.clues.map((clue) => (
              <div key={clue.id} className="rounded-lg border border-white/10 bg-ink-900/50 px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-white/80">{clue.title}</span>
                  <span className="rounded border border-white/15 px-1.5 py-0.5 text-[10px] text-white/40">
                    {clue.isPublic ? "公开" : "KP 可见"}
                  </span>
                  <span className="rounded border border-spirit-400/30 px-1.5 py-0.5 text-[10px] text-spirit-200">
                    已发现 {clue.discoveredCount}
                  </span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-white/55">{clue.content}</p>
                <ClueAdminControls
                  roomId={props.roomId}
                  clue={{ id: clue.id, title: clue.title, content: clue.content, isPublic: clue.isPublic }}
                  members={props.members}
                  sharedUserIds={clue.sharedWithIds}
                  returnTo={"/rooms/" + props.roomId + "?clue=updated#room-info"}
                />
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
