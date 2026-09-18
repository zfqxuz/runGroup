import Link from "next/link";
import ClueAdminControls, { type ClueMemberOption } from "@/components/room/ClueAdminControls";
import KpBgmPanel from "@/components/room/KpBgmPanel";
import KpDrawer, { KpDrawerSection } from "@/components/room/KpDrawer";
import KpValueEditor from "@/components/room/KpValueEditor";
import ImageUpload from "@/components/upload/ImageUpload";
import { setGameProgressAction } from "@/server/actions/game";
import { prisma } from "@/server/db/prisma";
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
  "w-full rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm text-white/85 outline-none focus:border-sakura-500";
const labelClass = "text-[11px] text-white/45";
const fieldClass = "flex flex-col gap-1";
const secondaryButtonClass =
  "self-start rounded-lg border border-spirit-400/40 px-3 py-1.5 text-[11px] text-spirit-300 transition hover:bg-spirit-400/10";

/** 把「当前值不在候选里」的情况补进下拉，避免保存时被悄悄改成未设置。 */
function withCurrent(options: readonly KpPrepOption[], currentId: string | null): readonly KpPrepOption[] {
  if (currentId === null || currentId.length === 0) return options;
  if (options.some((option) => option.id === currentId)) return options;
  return [{ id: currentId, title: currentId, detail: null }, ...options];
}

/** KP 专属准备区：场景 / 时间 / 战斗 / 数值 / 线索。 */
export default async function KpPrepPanel(props: Props) {
  const pendingCombatRequests = await prisma.combatRequest.findMany({
    where: { roomId: props.roomId, status: "PENDING_REVIEW" },
    include: { initiator: { select: { username: true, displayName: true } } },
    orderBy: { createdAt: "asc" }
  });
  const pendingCombatRequestCount = pendingCombatRequests.length;

  const sceneOptions = withCurrent(props.sceneOptions, props.state.currentSceneId);
  const chapterOptions = withCurrent(props.chapterOptions, props.state.currentChapterId);
  const encounterOptions = withCurrent(props.encounterOptions, props.state.currentEncounterId);
  const returnTo = "/rooms/" + props.roomId + "?state=saved";

  return (
    <KpDrawer title="KP 准备区">
      <KpDrawerSection id="scene" label="场景与地图" description="团内时间、当前章节 / 场景 / 遭遇、地图与 Token">
        <div className="flex flex-col gap-5">
          <form action={setGameProgressAction} className="flex flex-col gap-3">
            <input type="hidden" name="roomId" value={props.roomId} />
            <input type="hidden" name="gameId" value={props.gameId} />
            <input type="hidden" name="returnTo" value={returnTo} />

            <label className={fieldClass}>
              <span className={labelClass}>团内时间</span>
              <input
                name="gameTime"
                defaultValue={props.state.gameTime ?? ""}
                placeholder="例如：第 2 天 上午 10:20"
                className={inputClass}
              />
            </label>

            <label className={fieldClass}>
              <span className={labelClass}>当前章节</span>
              <select name="currentChapterId" defaultValue={props.state.currentChapterId ?? ""} className={inputClass}>
                <option value="">未设置</option>
                {chapterOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.title}
                    {option.detail === null ? "" : "（" + option.detail + "）"}
                  </option>
                ))}
              </select>
            </label>

            <label className={fieldClass}>
              <span className={labelClass}>当前场景</span>
              <select name="currentSceneId" defaultValue={props.state.currentSceneId ?? ""} className={inputClass}>
                <option value="">未设置</option>
                {sceneOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.title}
                    {option.detail === null ? "" : "（" + option.detail + "）"}
                  </option>
                ))}
              </select>
            </label>

            <label className={fieldClass}>
              <span className={labelClass}>当前遭遇</span>
              <select name="currentEncounterId" defaultValue={props.state.currentEncounterId ?? ""} className={inputClass}>
                <option value="">未设置</option>
                {encounterOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.title}
                    {option.detail === null ? "" : "（" + option.detail + "）"}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="submit"
              className="self-start rounded-lg bg-sakura-500 px-4 py-2 text-xs font-medium text-white transition hover:bg-sakura-400"
            >
              保存
            </button>
          </form>

          {props.mapId === null ? null : (
            <div className="flex flex-col gap-2 border-t border-white/10 pt-4">
              <p className={labelClass}>地图背景</p>
              <div className="flex flex-col gap-2">
                <div className="h-24 w-full overflow-hidden rounded-lg border border-white/10 bg-ink-800">
                  {props.mapBackgroundUrl === null ? (
                    <span className="flex h-full items-center justify-center text-[11px] text-white/25">无背景</span>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={props.mapBackgroundUrl} alt="" className="h-full w-full object-cover" />
                  )}
                </div>
                <ImageUpload kind="MAP" targetId={props.mapId} currentUrl={props.mapBackgroundUrl} label="上传新背景" shape="wide" />
                <form action={applyMapBackgroundAction} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="roomId" value={props.roomId} />
                  <input type="hidden" name="sceneId" value={props.sceneId ?? ""} />
                  <input type="hidden" name="returnTo" value={"/rooms/" + props.roomId} />
                  {props.backgroundAssets.length === 0 ? (
                    <span className={labelClass}>暂无可选素材，可直接上传。</span>
                  ) : (
                    <select name="assetId" className={inputClass + " min-w-[160px] flex-1"}>
                      {props.backgroundAssets.map((asset) => (
                        <option key={asset.id} value={asset.id}>{asset.label}</option>
                      ))}
                    </select>
                  )}
                  <button type="submit" disabled={props.backgroundAssets.length === 0} className={secondaryButtonClass}>
                    应用背景
                  </button>
                </form>
              </div>
            </div>
          )}

          {props.sceneId === null ? null : (
            <form action={setSceneFogAction} className="flex items-center justify-between gap-2 border-t border-white/10 pt-4">
              <input type="hidden" name="roomId" value={props.roomId} />
              <input type="hidden" name="sceneId" value={props.sceneId} />
              <input type="hidden" name="returnTo" value={"/rooms/" + props.roomId} />
              <span className={labelClass}>战争迷雾：{props.fogEnabled ? "已开启" : "已关闭"}</span>
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

          {props.sceneId === null ? null : (
            <form id="kp-token-place" action={createSceneTokenAction} className="flex scroll-mt-6 flex-col gap-2 border-t border-white/10 pt-4">
              <input type="hidden" name="roomId" value={props.roomId} />
              <input type="hidden" name="sceneId" value={props.sceneId} />
              <input type="hidden" name="returnTo" value={"/rooms/" + props.roomId} />
              <p className={labelClass}>放置角色 Token 到当前场景</p>
              {props.units.length === 0 ? (
                <p className="text-[10px] text-white/35">当前没有可放置的单位。</p>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <select name="unitRef" className={inputClass + " min-w-[160px] flex-1"}>
                    {props.units.map((unit) => (
                      <option key={unit.ref} value={unit.ref}>
                        {unit.name}（{unit.kind === "NPC" ? "NPC" : "PC"}）
                      </option>
                    ))}
                  </select>
                  <button type="submit" className={secondaryButtonClass}>放置到本场景</button>
                </div>
              )}
            </form>
          )}

          <div className="flex flex-wrap gap-2 border-t border-white/10 pt-4">
            <Link href={"/rooms/" + props.roomId + "/modules"} className={secondaryButtonClass}>
              团本编辑与素材
            </Link>
            <Link href={"/rooms/" + props.roomId + "/npcs/new"} className={secondaryButtonClass}>
              新建 NPC
            </Link>
          </div>
        </div>
      </KpDrawerSection>

      <KpDrawerSection id="combat" label="战斗与申请" description="主动开战与玩家战斗申请" badge={pendingCombatRequestCount > 0 ? pendingCombatRequestCount : undefined} autoOpen={pendingCombatRequestCount > 0}>
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium text-white/70">主动开战</p>
            <p className={labelClass}>KP 选择双方单位后可直接发起战斗。</p>
            <Link
              href={"/rooms/" + props.roomId + "/combat/new"}
              className="self-start rounded-lg bg-red-400 px-4 py-2 text-xs font-medium text-white transition hover:bg-red-300"
            >
              发起战斗
            </Link>
          </div>

          <div className="flex flex-col gap-2 border-t border-white/10 pt-4">
            <p className="text-xs font-medium text-white/70">玩家战斗申请</p>
            {pendingCombatRequests.length === 0 ? (
              <p className={labelClass}>当前没有待审批申请。</p>
            ) : (
              <ul className="flex flex-col">
                {pendingCombatRequests.map((request) => (
                  <li key={request.id} className="flex items-center justify-between gap-2 border-b border-white/5 py-2 last:border-b-0">
                    <span className="min-w-0 truncate text-xs text-white/70">
                      {request.initiator.displayName ?? request.initiator.username}
                    </span>
                    <Link
                      href={"/rooms/" + props.roomId + "/combat/requests/" + request.id}
                      className="shrink-0 rounded border border-amber-400/40 px-2 py-1 text-[11px] text-amber-300 transition hover:bg-amber-400/10"
                    >
                      处理
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </KpDrawerSection>

      <KpDrawerSection id="bgm" label="背景音乐" description="房间 BGM 与播放状态">
        <KpBgmPanel roomId={props.roomId} gameId={props.gameId} bgm={props.bgm} status={props.bgmStatus} embedded />
      </KpDrawerSection>

      <KpDrawerSection id="values" label="数值调整" description="HP / MP / SAN / DP、属性与技能">
        <KpValueEditor roomId={props.roomId} units={props.units} embedded />
      </KpDrawerSection>

      <KpDrawerSection id="clues" label="线索公布" description="发布线索、公开状态与定向分享">
        <div id="kp-clues" className="flex scroll-mt-6 flex-col gap-4">
          <div className="flex items-center justify-between gap-2">
            <p className={labelClass}>共 {props.clues.length} 条线索</p>
            <form action={setAllCluesPrivateAction}>
              <input type="hidden" name="roomId" value={props.roomId} />
              <input type="hidden" name="returnTo" value={"/rooms/" + props.roomId + "?clue=updated#kp-clues"} />
              <button type="submit" className="rounded border border-amber-400/40 px-2 py-1 text-[10px] text-amber-200 transition hover:bg-amber-400/10">
                全部设为私密
              </button>
            </form>
          </div>

          <form action={createClueAction} encType="multipart/form-data" className="flex flex-col gap-2 border-b border-white/10 pb-4">
            <input type="hidden" name="roomId" value={props.roomId} />
            <input type="hidden" name="returnTo" value={"/rooms/" + props.roomId + "?clue=created#kp-clues"} />
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
              对所有成员公开
            </label>
            <button type="submit" className="self-start rounded-lg bg-sakura-500 px-4 py-2 text-xs font-medium text-white transition hover:bg-sakura-400">
              发布线索
            </button>
          </form>

          {props.clues.length === 0 ? (
            <p className="text-xs text-white/35">还没有线索。</p>
          ) : (
            <div className="flex max-h-96 flex-col divide-y divide-white/5 overflow-y-auto overscroll-contain pr-1">
              {props.clues.map((clue) => (
                <details key={clue.id} className="group py-2">
                  <summary className="flex cursor-pointer list-none items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs text-white/80">{clue.title}</span>
                    <span className="shrink-0 rounded border border-white/15 px-1.5 py-0.5 text-[10px] text-white/40">
                      {clue.isPublic ? "公开" : "KP"}
                    </span>
                    <span className="shrink-0 rounded border border-spirit-400/30 px-1.5 py-0.5 text-[10px] text-spirit-200">
                      {clue.discoveredCount}
                    </span>
                    <span className="shrink-0 text-[10px] text-white/30 transition group-open:rotate-90">▶</span>
                  </summary>
                  <div className="pt-2">
                    {clue.content.length === 0 ? null : (
                      <p className="whitespace-pre-wrap text-xs leading-relaxed text-white/55">{clue.content}</p>
                    )}
                    {clue.imageUrl === null ? null : (
                      <a href={clue.imageUrl} target="_blank" rel="noreferrer" className="mt-2 block overflow-hidden rounded-lg border border-white/10 bg-ink-900/60">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={clue.imageUrl} alt={clue.title} className="max-h-72 w-full object-contain" />
                      </a>
                    )}
                    <ClueAdminControls
                      roomId={props.roomId}
                      clue={{ id: clue.id, title: clue.title, content: clue.content, imageUrl: clue.imageUrl, isPublic: clue.isPublic }}
                      members={props.members}
                      sharedUserIds={clue.sharedWithIds}
                      returnTo={"/rooms/" + props.roomId + "?clue=updated#kp-clues"}
                    />
                  </div>
                </details>
              ))}
            </div>
          )}
        </div>
      </KpDrawerSection>
    </KpDrawer>
  );
}
