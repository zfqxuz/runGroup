import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import ImageUpload from "@/components/upload/ImageUpload";
import {
  activateSceneAction,
  createSceneAction,
  createSceneTokenAction,
  deleteSceneAction,
  deleteSceneTokenAction,
  updateSceneAction,
  updateSceneTokenAction
} from "@/server/actions/scene";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";

export const dynamic = "force-dynamic";

const WEATHER_OPTIONS = [
  ["NONE", "无"],
  ["RAIN", "雨"],
  ["SNOW", "雪"],
  ["FOG", "雾"],
  ["STORM", "暴风雨"],
  ["SAKURA", "樱吹雪"],
  ["PETALS", "花瓣"]
] as const;

const TIME_OPTIONS = [
  ["DAWN", "黎明"],
  ["DAY", "白天"],
  ["DUSK", "黄昏"],
  ["NIGHT", "夜晚"],
  ["MIDNIGHT", "午夜"]
] as const;

export default async function SceneManagementPage({
  params,
  searchParams
}: {
  params: { id: string };
  searchParams: { saved?: string; error?: string };
}) {
  const session = await auth();
  if (session === null) redirect("/login");

  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId: params.id, userId: session.user.id } },
    include: { room: { select: { id: true, name: true, status: true } } }
  });
  if (membership === null) notFound();
  const isKP = membership.role === "KP";
  const room = membership.room;

  const scenes = await prisma.scene.findMany({
    where: { roomId: room.id },
    include: {
      background: { select: { url: true } },
      map: {
        include: {
          background: { select: { url: true } },
          tokens: {
            include: {
              asset: { select: { url: true } },
              character: { select: { userId: true } }
            },
            orderBy: { zIndex: "asc" }
          },
          _count: { select: { tokens: true } }
        }
      }
    },
    orderBy: { orderIndex: "asc" }
  });

  const activeGame = await prisma.game.findFirst({
    where: { roomId: room.id, status: { in: ["PLAYING", "COMBAT"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true }
  });
  const gameCharacters = activeGame === null
    ? []
    : await prisma.gameCharacter.findMany({
        where: { gameId: activeGame.id },
        include: { character: { select: { name: true } } },
        orderBy: { createdAt: "asc" }
      });
  const npcCards = await prisma.card.findMany({
    where: { roomId: room.id, scope: "ROOM", type: "NPC" },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" }
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-6 py-12">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href={"/rooms/" + room.id} className="text-xs text-white/40 transition hover:text-white/70">← 返回跑团页</Link>
          <h1 className="mt-2 text-2xl font-semibold">场景 / 地图</h1>
          <p className="mt-1 text-sm text-white/50">KP 可创建场景、上传地图、放置角色与 NPC Token；玩家在跑团页拖动自己的 Token。</p>
        </div>
        <span className="rounded-full border border-sakura-500/40 px-3 py-1 text-xs text-sakura-400">我的身份：{membership.role}</span>
      </header>

      {searchParams.saved === undefined ? null : (
        <p className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">场景配置已保存：{searchParams.saved}</p>
      )}
      {searchParams.error === undefined ? null : (
        <p className="rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">操作失败：{searchParams.error}</p>
      )}

      {isKP ? (
        <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
          <h2 className="text-sm font-medium text-white/80">新建场景</h2>
          <form action={createSceneAction} className="mt-4 flex flex-wrap items-end gap-3">
            <input type="hidden" name="roomId" value={room.id} />
            <label className="flex min-w-[220px] flex-1 flex-col gap-1.5">
              <span className="text-xs text-white/50">场景名</span>
              <input name="name" placeholder="例：红魔馆大厅" className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-sakura-500" />
            </label>
            <label className="flex min-w-[260px] flex-1 flex-col gap-1.5">
              <span className="text-xs text-white/50">描述</span>
              <input name="description" placeholder="给玩家看的简短描述" className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-sakura-500" />
            </label>
            <button type="submit" className="rounded-lg bg-sakura-500 px-4 py-2 text-sm font-medium text-ink-900 transition hover:bg-sakura-400">创建场景</button>
          </form>
        </section>
      ) : null}

      {scenes.length === 0 ? (
        <p className="rounded-xl border border-dashed border-white/15 px-5 py-12 text-center text-sm text-white/40">
          还没有场景。KP 创建场景后，跑团页会显示战术棋盘。
        </p>
      ) : null}

      {scenes.map((scene) => (
        <section key={scene.id} className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-medium text-white/85">
                {scene.name}
                {scene.isActive ? (
                  <span className="rounded-full border border-emerald-400/40 px-2 py-0.5 text-[10px] text-emerald-300">当前场景</span>
                ) : null}
              </h2>
              <p className="mt-1 text-[11px] text-white/35">
                {scene.map === null ? "未配置地图" : scene.map.width + "×" + scene.map.height + " · " + (scene.map._count.tokens) + " 个 Token"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {scene.isActive || isKP === false ? null : (
                <form action={activateSceneAction}>
                  <input type="hidden" name="roomId" value={room.id} />
                  <input type="hidden" name="sceneId" value={scene.id} />
                  <button type="submit" className="rounded-md border border-emerald-400/40 px-3 py-1.5 text-xs text-emerald-300 transition hover:bg-emerald-400/10">切换到本场景</button>
                </form>
              )}
              {isKP ? (
                <form action={deleteSceneAction}>
                  <input type="hidden" name="roomId" value={room.id} />
                  <input type="hidden" name="sceneId" value={scene.id} />
                  <button type="submit" className="rounded-md border border-red-400/40 px-3 py-1.5 text-xs text-red-300 transition hover:bg-red-400/10">删除场景</button>
                </form>
              ) : null}
            </div>
          </div>

          {isKP ? (
            <form action={updateSceneAction} className="mt-4 grid gap-3 border-t border-white/10 pt-4 lg:grid-cols-3">
              <input type="hidden" name="roomId" value={room.id} />
              <input type="hidden" name="sceneId" value={scene.id} />
              <label className="flex flex-col gap-1.5 lg:col-span-2">
                <span className="text-xs text-white/50">场景名</span>
                <input name="name" defaultValue={scene.name} className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-sakura-500" />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs text-white/50">天气</span>
                <select name="weather" defaultValue={scene.weather} className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-sakura-500">
                  {WEATHER_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs text-white/50">时段</span>
                <select name="timeOfDay" defaultValue={scene.timeOfDay} className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-sakura-500">
                  {TIME_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1.5 lg:col-span-2">
                <span className="text-xs text-white/50">描述</span>
                <input name="description" defaultValue={scene.description ?? ""} className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-sakura-500" />
              </label>
              <label className="flex flex-col gap-1.5 lg:col-span-3">
                <span className="text-xs text-white/50">KP 旁白 / 场景说明</span>
                <textarea name="narration" rows={3} defaultValue={scene.narration ?? ""} className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-sakura-500" />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs text-white/50">地图宽</span>
                <input name="width" type="number" defaultValue={scene.map?.width ?? 1600} className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-sakura-500" />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs text-white/50">地图高</span>
                <input name="height" type="number" defaultValue={scene.map?.height ?? 1000} className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-sakura-500" />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs text-white/50">格子大小</span>
                <input name="gridSize" type="number" defaultValue={scene.map?.gridSize ?? 70} className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-sakura-500" />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs text-white/50">格子类型</span>
                <select name="gridType" defaultValue={scene.map?.gridType ?? "SQUARE"} className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-sakura-500">
                  <option value="SQUARE">方格</option>
                  <option value="HEX">六边形</option>
                  <option value="NONE">无格子</option>
                </select>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs text-white/50">背景色</span>
                <input name="bgColor" defaultValue={scene.map?.bgColor ?? "#1a1a2e"} className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-sakura-500" />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs text-white/50">初始 X</span>
                <input name="initialX" type="number" step="1" defaultValue={scene.map?.initialX ?? 0} className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-sakura-500" />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs text-white/50">初始 Y</span>
                <input name="initialY" type="number" step="1" defaultValue={scene.map?.initialY ?? 0} className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-sakura-500" />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs text-white/50">缩放</span>
                <input name="initialZoom" type="number" step="0.1" defaultValue={scene.map?.initialZoom ?? 1} className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-sakura-500" />
              </label>
              <label className="flex items-center gap-2 pt-5 text-xs text-white/60">
                <input type="checkbox" name="showGrid" value="1" defaultChecked={scene.map?.showGrid ?? true} className="accent-sakura-500" />
                显示网格
              </label>
              <label className="flex items-center gap-2 pt-5 text-xs text-white/60">
                <input type="checkbox" name="showFog" value="1" defaultChecked={scene.map?.showFog ?? false} className="accent-sakura-500" />
                启用战争迷雾
              </label>
              <div className="flex items-end">
                <button type="submit" className="rounded-lg bg-sakura-500 px-4 py-2 text-sm font-medium text-ink-900 transition hover:bg-sakura-400">保存场景 / 地图</button>
              </div>
            </form>
          ) : null}

          {scene.map === null ? null : (
            <div className="mt-4 grid gap-4 border-t border-white/10 pt-4 sm:grid-cols-2">
              <div className="rounded-lg border border-white/10 bg-ink-900/60 p-3">
                <p className="text-xs text-white/60">场景背景</p>
                <div className="mt-2">
                  <ImageUpload kind="SCENE_BG" targetId={scene.id} currentUrl={scene.background?.url ?? null} label="上传场景背景" shape="wide" />
                </div>
              </div>
              <div className="rounded-lg border border-white/10 bg-ink-900/60 p-3">
                <p className="text-xs text-white/60">地图背景</p>
                <div className="mt-2">
                  <ImageUpload kind="MAP" targetId={scene.map.id} currentUrl={scene.map.background?.url ?? null} label="上传地图背景" shape="wide" />
                </div>
              </div>
            </div>
          )}

          {isKP ? (
            <form action={createSceneTokenAction} className="mt-4 flex flex-wrap items-end gap-3 border-t border-white/10 pt-4">
              <input type="hidden" name="roomId" value={room.id} />
              <input type="hidden" name="sceneId" value={scene.id} />
              <label className="flex min-w-[260px] flex-1 flex-col gap-1.5">
                <span className="text-xs text-white/50">添加 Token</span>
                <select name="unitRef" className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-sakura-500">
                  {gameCharacters.map((gc) => (
                    <option key={gc.characterId} value={"character:" + gc.characterId}>{gc.character.name}（PC）</option>
                  ))}
                  {npcCards.map((card) => (
                    <option key={card.id} value={"npc:" + card.id}>{card.name}（NPC）</option>
                  ))}
                </select>
              </label>
              <button type="submit" className="rounded-lg border border-spirit-400/40 px-4 py-2 text-sm text-spirit-300 transition hover:bg-spirit-400/10">添加 Token</button>
            </form>
          ) : null}

          {scene.map === null || scene.map.tokens.length === 0 ? null : (
            <div className="mt-4 border-t border-white/10 pt-4">
              <p className="text-xs text-white/50">Token 管理（{scene.map.tokens.length}）</p>
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                {scene.map.tokens.map((token) => {
                  const canEdit = isKP || token.character?.userId === session.user.id;
                  const canDelete = canEdit;
                  return (
                    <div key={token.id} className="rounded-lg border border-white/10 bg-ink-900/60 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm text-white/80">{token.name}</p>
                          <p className="mt-0.5 text-[10px] text-white/30">
                            {Math.round(token.x)},{Math.round(token.y)} · {token.character === null ? "NPC" : "PC"}
                          </p>
                        </div>
                        {canDelete ? (
                          <form action={deleteSceneTokenAction}>
                            <input type="hidden" name="roomId" value={room.id} />
                            <input type="hidden" name="tokenId" value={token.id} />
                            <button type="submit" className="rounded border border-red-400/30 px-2 py-1 text-[10px] text-red-300 transition hover:bg-red-400/10">删除</button>
                          </form>
                        ) : null}
                      </div>

                      <div className="mt-3 flex flex-wrap items-start gap-3">
                        {canEdit ? (
                          <ImageUpload kind="TOKEN" targetId={token.id} currentUrl={token.asset?.url ?? null} label="上传 Token 图" shape="square" />
                        ) : token.asset === null ? (
                          <span className="flex h-20 w-20 items-center justify-center rounded-lg border border-white/10 text-[10px] text-white/25">无图</span>
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={token.asset.url} alt="" className="h-20 w-20 rounded-lg border border-white/10 object-cover" />
                        )}

                        {canEdit ? (
                          <form action={updateSceneTokenAction} className="grid min-w-[220px] flex-1 gap-2 sm:grid-cols-2">
                            <input type="hidden" name="roomId" value={room.id} />
                            <input type="hidden" name="tokenId" value={token.id} />
                            <label className="flex flex-col gap-1">
                              <span className="text-[10px] text-white/40">名称</span>
                              <input name="name" defaultValue={token.name} className="rounded border border-white/15 bg-ink-900 px-2 py-1 text-xs outline-none focus:border-sakura-500" />
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className="text-[10px] text-white/40">边框色</span>
                              <input name="borderColor" type="color" defaultValue={token.borderColor} className="h-7 w-full rounded border border-white/15 bg-ink-900 px-1" />
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className="text-[10px] text-white/40">尺寸</span>
                              <input name="size" type="number" step="0.1" min="0.5" max="4" defaultValue={token.size} className="rounded border border-white/15 bg-ink-900 px-2 py-1 text-xs outline-none focus:border-sakura-500" />
                            </label>
                            <label className="flex flex-col gap-1">
                              <span className="text-[10px] text-white/40">旋转</span>
                              <input name="rotation" type="number" step="1" defaultValue={token.rotation} className="rounded border border-white/15 bg-ink-900 px-2 py-1 text-xs outline-none focus:border-sakura-500" />
                            </label>
                            <label className="flex items-center gap-2 text-[10px] text-white/55">
                              <input type="checkbox" name="showName" value="1" defaultChecked={token.showName} className="accent-sakura-500" />
                              显示名称
                            </label>
                            <label className="flex items-center gap-2 text-[10px] text-white/55">
                              <input type="checkbox" name="showHpBar" value="1" defaultChecked={token.showHpBar} className="accent-sakura-500" />
                              显示 HP 条
                            </label>
                            {isKP ? (
                              <>
                                <label className="flex items-center gap-2 text-[10px] text-white/55">
                                  <input type="checkbox" name="isVisible" value="1" defaultChecked={token.isVisible} className="accent-sakura-500" />
                                  可见
                                </label>
                                <label className="flex items-center gap-2 text-[10px] text-white/55">
                                  <input type="checkbox" name="isLocked" value="1" defaultChecked={token.isLocked} className="accent-sakura-500" />
                                  锁定
                                </label>
                              </>
                            ) : null}
                            <div className="sm:col-span-2">
                              <button type="submit" className="rounded bg-sakura-500 px-3 py-1.5 text-xs font-medium text-ink-900 transition hover:bg-sakura-400">保存 Token</button>
                            </div>
                          </form>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      ))}
    </main>
  );
}
