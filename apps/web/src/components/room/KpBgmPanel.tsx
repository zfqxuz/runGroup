import { setRoomBgmAction } from "@/server/actions/bgm";
import { bgmDisplayTitle, bgmProviderLabel, type RoomBgmView } from "@/shared/bgm";

interface Props {
  readonly roomId: string;
  readonly gameId: string;
  readonly bgm: RoomBgmView | null;
  readonly status: string | null;
  /** 表单提交后返回的页面；战斗页可用它让 KP 留在战斗页。 */
  readonly returnTo?: string;
}

const inputClass =
  "rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-spirit-400";

function statusText(status: string | null): string | null {
  if (status === "saved") return "BGM 已开始播放，并已同步给全房间。";
  if (status === "cleared") return "BGM 已停止，玩家端也会同步停止。";
  if (status === "invalid") {
    return "无法解析该链接。支持网易云音乐完整链接 / 短链，以及 QQ 音乐单曲完整链接 / App 分享短链；QQ 歌单暂不支持。";
  }
  if (status === "game") return "当前没有可操作的对局，无法设置 BGM。";
  return null;
}

export default function KpBgmPanel(props: Props) {
  const notice = statusText(props.status);
  const baseReturnTo = props.returnTo ?? "/rooms/" + props.roomId;
  const playReturnTo = baseReturnTo + "?bgm=saved#kp-bgm";
  const stopReturnTo = baseReturnTo + "?bgm=cleared#kp-bgm";
  return (
    <section id="kp-bgm" className="scroll-mt-6 rounded-xl border border-spirit-400/30 bg-spirit-400/5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium text-spirit-200">BGM 播放</h2>
          <p className="mt-1 text-[11px] text-white/40">
            粘贴网易云音乐或 QQ 音乐链接，房间内所有成员会加载同一个播放器。
          </p>
        </div>
        <span className="rounded-full border border-spirit-400/30 px-2 py-0.5 text-[10px] text-spirit-200">
          全房间同步
        </span>
      </div>

      <form action={setRoomBgmAction} className="mt-4 flex flex-col gap-2 border-t border-white/10 pt-4">
        <input type="hidden" name="roomId" value={props.roomId} />
        <input type="hidden" name="gameId" value={props.gameId} />
        <input type="hidden" name="returnTo" value={playReturnTo} />
        <input
          name="link"
          placeholder="https://music.163.com/#/song?id=... 或 QQ 音乐单曲分享链接"
          className={inputClass}
        />
        <button
          type="submit"
          className="self-start rounded-lg bg-spirit-400 px-4 py-2 text-xs font-medium text-white transition hover:bg-spirit-300"
        >
          解析并播放
        </button>
        <p className="text-[10px] text-white/30">
          受浏览器自动播放策略限制，玩家端可能需要在播放器上点一次播放；KP 也会在右侧房间视角里看到同一个播放器。
        </p>
      </form>

      {notice === null ? null : (
        <p className="mt-3 rounded-lg border border-white/10 bg-ink-900/50 px-3 py-2 text-[11px] text-white/55">
          {notice}
        </p>
      )}

      <div className="mt-3 rounded-lg border border-white/10 bg-ink-900/40 p-3">
        <p className="text-[10px] text-white/35">当前 BGM</p>
        {props.bgm === null ? (
          <p className="mt-0.5 text-xs text-white/45">未播放</p>
        ) : (
          <>
            <p className="mt-0.5 truncate text-sm text-white/80">{bgmDisplayTitle(props.bgm)}</p>
            <p className="mt-0.5 text-[11px] text-white/40">
              {bgmProviderLabel(props.bgm.provider)}
              {props.bgm.kind === "SONG" ? "" : " · " + (props.bgm.kind === "ALBUM" ? "专辑" : "歌单")}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <a
                href={props.bgm.pageUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded border border-white/15 px-2 py-1 text-[11px] text-white/55 transition hover:border-white/35"
              >
                打开原链接
              </a>
              <form action={setRoomBgmAction}>
                <input type="hidden" name="roomId" value={props.roomId} />
                <input type="hidden" name="gameId" value={props.gameId} />
                <input type="hidden" name="link" value="" />
                <input type="hidden" name="returnTo" value={stopReturnTo} />
                <button
                  type="submit"
                  className="rounded border border-red-400/40 px-2 py-1 text-[11px] text-red-300 transition hover:bg-red-400/10"
                >
                  停止播放
                </button>
              </form>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
