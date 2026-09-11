import {
  deleteClueAction,
  setClueVisibilityAction,
  shareClueAction,
  updateClueAction
} from "@/server/actions/room-info";

export interface ClueMemberOption {
  readonly userId: string;
  readonly displayName: string;
  readonly role: string;
}

interface Props {
  readonly roomId: string;
  readonly clue: {
    readonly id: string;
    readonly title: string;
    readonly content: string;
    readonly isPublic: boolean;
  };
  readonly members: readonly ClueMemberOption[];
  readonly sharedUserIds: readonly string[];
  readonly returnTo: string;
}

const inputClass =
  "rounded border border-white/15 bg-ink-900 px-2 py-1 text-xs text-white/75 outline-none focus:border-sakura-500";

export default function ClueAdminControls({ roomId, clue, members, sharedUserIds, returnTo }: Props) {
  const sharedSet = new Set(sharedUserIds);
  return (
    <div className="mt-2 flex flex-col gap-2 border-t border-white/5 pt-2">
      <div className="flex flex-wrap items-center gap-2">
        <form action={setClueVisibilityAction}>
          <input type="hidden" name="roomId" value={roomId} />
          <input type="hidden" name="clueId" value={clue.id} />
          <input type="hidden" name="isPublic" value={clue.isPublic ? "0" : "1"} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <button
            type="submit"
            className={
              clue.isPublic
                ? "rounded border border-amber-400/40 px-2 py-1 text-[11px] text-amber-300 transition hover:bg-amber-400/10"
                : "rounded border border-emerald-400/40 px-2 py-1 text-[11px] text-emerald-300 transition hover:bg-emerald-400/10"
            }
          >
            {clue.isPublic ? "取消公开" : "公布给所有人"}
          </button>
        </form>
        <form action={deleteClueAction}>
          <input type="hidden" name="roomId" value={roomId} />
          <input type="hidden" name="clueId" value={clue.id} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <button
            type="submit"
            className="rounded border border-red-400/30 px-2 py-1 text-[11px] text-red-300 transition hover:bg-red-400/10"
          >
            删除线索
          </button>
        </form>
        <span className="text-[10px] text-white/35">
          定向分享：{sharedUserIds.length === 0 ? "无" : sharedUserIds.length + " 人"}
        </span>
      </div>

      <details className="rounded border border-white/10 bg-ink-900/40 p-2">
        <summary className="cursor-pointer text-[11px] text-white/45">编辑线索</summary>
        <form action={updateClueAction} className="mt-2 flex flex-col gap-2">
          <input type="hidden" name="roomId" value={roomId} />
          <input type="hidden" name="clueId" value={clue.id} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <input name="title" defaultValue={clue.title} className={inputClass} />
          <textarea name="content" rows={3} defaultValue={clue.content} className={inputClass} />
          <label className="flex items-center gap-2 text-[11px] text-white/50">
            <input type="checkbox" name="isPublic" value="1" defaultChecked={clue.isPublic} />
            对所有成员公开
          </label>
          <button type="submit" className="self-start rounded bg-sakura-500 px-3 py-1.5 text-[11px] font-medium text-ink-900">
            保存线索
          </button>
        </form>
      </details>

      <details className="rounded border border-white/10 bg-ink-900/40 p-2">
        <summary className="cursor-pointer text-[11px] text-white/45">发给特定玩家</summary>
        {members.length === 0 ? (
          <p className="mt-2 text-[11px] text-white/35">房间里还没有其他成员。</p>
        ) : (
          <form action={shareClueAction} className="mt-2 flex flex-col gap-2">
            <input type="hidden" name="roomId" value={roomId} />
            <input type="hidden" name="clueId" value={clue.id} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <div className="flex flex-wrap gap-2">
              {members.map((member) => (
                <label key={member.userId} className="flex items-center gap-1.5 rounded border border-white/10 px-2 py-1 text-[11px] text-white/60">
                  <input type="checkbox" name="targetUserIds" value={member.userId} defaultChecked={sharedSet.has(member.userId)} />
                  {member.displayName}
                  <span className="text-[10px] text-white/30">{member.role}</span>
                </label>
              ))}
            </div>
            <p className="text-[10px] text-white/30">勾选后会替换当前分享名单；全部取消表示撤回转发。</p>
            <button type="submit" className="self-start rounded border border-spirit-400/40 px-3 py-1.5 text-[11px] text-spirit-300">
              保存分享名单
            </button>
          </form>
        )}
      </details>
    </div>
  );
}
