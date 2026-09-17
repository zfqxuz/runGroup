import ClueAdminControls, { type ClueMemberOption } from "@/components/room/ClueAdminControls";
import { createClueAction, createNoteAction, discoverClueAction } from "@/server/actions/room-info";

export interface RoomClueView {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly imageUrl: string | null;
  readonly isPublic: boolean;
  readonly discoveredByMe: boolean;
  readonly discoveredCount: number;
  readonly sharedWithIds: readonly string[];
  readonly sharedWithMe: boolean;
}

export interface RoomNoteView {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly isKPOnly: boolean;
  readonly isMine: boolean;
}

export interface RoomHandoutView {
  readonly id: string;
  readonly title: string;
  readonly url: string;
}

interface Props {
  readonly roomId: string;
  readonly isKP: boolean;
  readonly readOnly: boolean;
  readonly clues: readonly RoomClueView[];
  readonly members: readonly ClueMemberOption[];
  readonly notes: readonly RoomNoteView[];
  readonly handouts: readonly RoomHandoutView[];
  readonly clueStatus: string | null;
  readonly noteStatus: string | null;
}

const inputClass =
  "rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-sakura-500";

export default function RoomInfoPanel(props: Props) {
  return (
    <section id="room-info" className="flex flex-col gap-4 rounded-xl border border-white/10 bg-ink-800/50 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium text-white/80">线索与笔记</h2>
          <p className="mt-1 text-[11px] text-white/35">
            线索由 KP 发布；已发现线索会记录到你的账号。笔记只对本人可见，KP 可追加 KP 专属笔记。
          </p>
        </div>
        {props.clueStatus === "created" ? (
          <span className="text-[11px] text-emerald-300">线索已发布</span>
        ) : null}
        {props.clueStatus === "discovered" ? (
          <span className="text-[11px] text-emerald-300">已标记发现</span>
        ) : null}
        {props.clueStatus === "image" ? (
          <span className="text-[11px] text-red-300">图片上传失败（仅支持 PNG / JPEG / WebP，且不超过 8MB）。</span>
        ) : null}
        {props.clueStatus === "invalid" ? (
          <span className="text-[11px] text-red-300">发布失败：标题不能为空，且内容与图片至少要有一项。</span>
        ) : null}
        {props.noteStatus === "created" ? (
          <span className="text-[11px] text-emerald-300">笔记已保存</span>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-white/10 bg-ink-900/50 p-4">
          <h3 className="text-xs font-medium text-white/70">线索（{props.clues.length}）</h3>
          {props.clues.length === 0 ? (
            <p className="mt-3 text-xs text-white/35">暂无可见线索。</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-3">
              {props.clues.map((clue) => (
                <li key={clue.id} className="rounded-lg border border-white/10 bg-ink-800/60 px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-white/80">{clue.title}</span>
                    <span className="rounded border border-white/15 px-1.5 py-0.5 text-[10px] text-white/40">
                      {clue.isPublic ? "公开" : "KP 可见"}
                    </span>
                    <span className="rounded border border-spirit-400/30 px-1.5 py-0.5 text-[10px] text-spirit-200">
                      已发现 {clue.discoveredCount}
                    </span>
                    {clue.sharedWithMe ? (
                      <span className="rounded border border-sakura-500/30 px-1.5 py-0.5 text-[10px] text-sakura-300">
                        发给我
                      </span>
                    ) : null}
                    {clue.discoveredByMe ? (
                      <span className="rounded border border-emerald-400/30 px-1.5 py-0.5 text-[10px] text-emerald-300">
                        我已发现
                      </span>
                    ) : null}
                  </div>
                  {clue.content.length === 0 ? null : (
                    <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-white/55">{clue.content}</p>
                  )}
                  {clue.imageUrl === null ? null : (
                    <a
                      href={clue.imageUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 block overflow-hidden rounded-lg border border-white/10 bg-ink-900/60"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={clue.imageUrl} alt={clue.title} className="max-h-80 w-full object-contain" />
                    </a>
                  )}
                  {props.isKP && props.readOnly === false ? (
                    <ClueAdminControls
                      roomId={props.roomId}
                      clue={{ id: clue.id, title: clue.title, content: clue.content, imageUrl: clue.imageUrl, isPublic: clue.isPublic }}
                      members={props.members}
                      sharedUserIds={clue.sharedWithIds}
                      returnTo={"/rooms/" + props.roomId + "?clue=updated#room-info"}
                    />
                  ) : null}
                  {props.readOnly || clue.discoveredByMe ? null : (
                    <form action={discoverClueAction} className="mt-2">
                      <input type="hidden" name="roomId" value={props.roomId} />
                      <input type="hidden" name="clueId" value={clue.id} />
                      <button
                        type="submit"
                        className="rounded border border-spirit-400/40 px-2 py-1 text-[11px] text-spirit-300 transition hover:bg-spirit-400/10"
                      >
                        标记为已发现
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}

          {props.isKP && props.readOnly === false ? (
            <form action={createClueAction} encType="multipart/form-data" className="mt-4 flex flex-col gap-2 border-t border-white/10 pt-4">
              <input type="hidden" name="roomId" value={props.roomId} />
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
              <button
                type="submit"
                className="self-start rounded-lg bg-sakura-500 px-4 py-2 text-xs font-medium text-white transition hover:bg-sakura-400"
              >
                发布线索
              </button>
            </form>
          ) : null}
        </div>

        <div className="rounded-lg border border-white/10 bg-ink-900/50 p-4">
          <h3 className="text-xs font-medium text-white/70">我的笔记（{props.notes.length}）</h3>
          {props.notes.length === 0 ? (
            <p className="mt-3 text-xs text-white/35">还没有笔记。</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-3">
              {props.notes.map((note) => (
                <li key={note.id} className="rounded-lg border border-white/10 bg-ink-800/60 px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-white/80">{note.title}</span>
                    {note.isKPOnly ? (
                      <span className="rounded border border-sakura-500/40 px-1.5 py-0.5 text-[10px] text-sakura-300">
                        KP 专属
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-white/55">{note.content}</p>
                </li>
              ))}
            </ul>
          )}

          {props.readOnly === false ? (
            <form action={createNoteAction} className="mt-4 flex flex-col gap-2 border-t border-white/10 pt-4">
              <input type="hidden" name="roomId" value={props.roomId} />
              <input name="title" placeholder="笔记标题" className={inputClass} />
              <textarea name="content" rows={3} placeholder="笔记内容" className={inputClass} />
              {props.isKP ? (
                <label className="flex items-center gap-2 text-[11px] text-white/50">
                  <input type="checkbox" name="isKPOnly" value="1" />
                  仅 KP 可见
                </label>
              ) : null}
              <button
                type="submit"
                className="self-start rounded-lg border border-white/15 px-4 py-2 text-xs text-white/65 transition hover:border-white/35 hover:text-white"
              >
                保存笔记
              </button>
            </form>
          ) : null}
        </div>
      </div>

      <div className="rounded-lg border border-white/10 bg-ink-900/50 p-4">
        <h3 className="text-xs font-medium text-white/70">手书 / 玩家资源（{props.handouts.length}）</h3>
        {props.handouts.length === 0 ? (
          <p className="mt-3 text-xs text-white/35">本局团本没有 handout 资源。</p>
        ) : (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {props.handouts.map((handout) => (
              <li key={handout.id}>
                <a
                  href={handout.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate rounded-lg border border-spirit-400/25 bg-spirit-400/5 px-3 py-2 text-xs text-spirit-200 transition hover:bg-spirit-400/10"
                >
                  {handout.title}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
