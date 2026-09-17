import Link from "next/link";
import ClueAdminControls, { type ClueMemberOption } from "@/components/room/ClueAdminControls";
import KpBgmPanel from "@/components/room/KpBgmPanel";
import KpCombatRequestPanel from "@/components/room/KpCombatRequestPanel";
import KpValueEditor from "@/components/room/KpValueEditor";
import ImageUpload from "@/components/upload/ImageUpload";
import { setGameSceneAction } from "@/server/actions/game";
import { applyMapBackgroundAction, createSceneTokenAction, setSceneFogAction } from "@/server/actions/scene";
import { createClueAction, setAllCluesPrivateAction } from "@/server/actions/room-info";
import type { RoomBgmView } from "@/shared/bgm";
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
  readonly imageUrl: string | null;
  readonly isPublic: boolean;
  readonly discoveredCount: number;
  readonly sharedWithIds: readonly string[];
}

interface Props {
  readonly roomId: string;
  readonly gameId: string;
  readonly gameTitle: string;
  readonly state: GameStateView;
  readonly bgm: RoomBgmView | null;
  readonly bgmStatus: string | null;
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
                className="rounded-lg bg-sakura-500 px-4 py-2 text-xs font-medium text-white transition hover:bg-sakura-400"
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

      <KpBgmPanel roomId={props.roomId} gameId={props.gameId} bgm={props.bgm} status={props.bgmStatus} />

      <section className="rounded-xl border border-red-400/30 bg-red-400/5 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-red-200">主动开战</h2>
            <p className="mt-0.5 text-[10px] text-white/45">
              KP 直接选择双方单位进入战斗，不需要玩家申请，也不需要审批。
            </p>
          </div>
          <Link
            href={"/rooms/" + props.roomId + "/combat/new"}
            className="rounded-lg bg-red-400 px-4 py-2 text-xs font-medium text-white transition hover:bg-red-300"
          >
            直接发起战斗
          </Link>
        </div>
      </section>

      <KpValueEditor roomId={props.roomId} units={props.units} />

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

        <form action={createClueAction} encType="multipart/form-data" className="mt-4 flex flex-col gap-2 border-b border-white/10 pb-4">
          <input type="hidden" name="roomId" value={props.roomId} />
          <input type="hidden" name="returnTo" value={"/rooms/" + props.roomId + "?clue=created#room-info"} />
          <input name="title" placeholder="线索标题" className={inputClass} />
          <textarea name="content" rows={3} placeholder="线索内容（可只上传图片）" className={inputClass} />
          <input
            type="file"
            name="image"
            accept="image/png,image/jpeg,image/webp"
            className="text-[11px] text-white/45 file:mr-2 file:rounded file:border file:border-white/15 file:bg-ink-800 file:px-2 file:py-1 file:text-[11px] file:text-white/60"
          />
          <label className="flex items-center gap-2 text-[11px] text-white/50">
            <input type="checkbox" name="isPublic" value="1" />
            对所有成员公开（默认仅 KP 可见）
          </label>
          <button type="submit" className="self-start rounded-lg bg-sakura-500 px-4 py-2 text-xs font-medium text-white transition hover:bg-sakura-400">
            发布线索
          </button>
        </form>

        <div className="mt-4 flex flex-col gap-2">
          <h3 className="text-xs font-medium text-white/70">全部线索（{props.clues.length}）</h3>
          {props.clues.length === 0 ? (
            <p className="text-xs text-white/35">还没有线索。</p>
          ) : (
            // 线索多时用可滚动 + 折叠行，避免整块面板被撑得很长。
            <div className="flex max-h-80 flex-col gap-1 overflow-y-auto overscroll-contain pr-1">
              {props.clues.map((clue) => (
                <details key={clue.id} className="group rounded-lg border border-white/10 bg-ink-900/50">
                  <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-xs text-white/80">{clue.title}</span>
                    <span className="shrink-0 rounded border border-white/15 px-1.5 py-0.5 text-[10px] text-white/40">
                      {clue.isPublic ? "公开" : "KP"}
                    </span>
                    <span className="shrink-0 rounded border border-spirit-400/30 px-1.5 py-0.5 text-[10px] text-spirit-200">
                      {clue.discoveredCount}
                    </span>
                    <span className="shrink-0 text-[10px] text-white/30 transition group-open:rotate-90">▶</span>
                  </summary>
                  <div className="border-t border-white/5 px-2.5 py-2">
                    {clue.content.length === 0 ? null : (
                      <p className="whitespace-pre-wrap text-xs leading-relaxed text-white/55">{clue.content}</p>
                    )}
                    {clue.imageUrl === null ? null : (
                      <a
                        href={clue.imageUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 block overflow-hidden rounded-lg border border-white/10 bg-ink-900/60"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={clue.imageUrl} alt={clue.title} className="max-h-72 w-full object-contain" />
                      </a>
                    )}
                    <ClueAdminControls
                      roomId={props.roomId}
                      clue={{ id: clue.id, title: clue.title, content: clue.content, imageUrl: clue.imageUrl, isPublic: clue.isPublic }}
                      members={props.members}
                      sharedUserIds={clue.sharedWithIds}
                      returnTo={"/rooms/" + props.roomId + "?clue=updated#room-info"}
                    />
                  </div>
                </details>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
