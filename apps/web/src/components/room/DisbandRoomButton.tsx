"use client";

import { disbandRoomAction } from "@/server/actions/room";

interface Props {
  readonly roomId: string;
  readonly roomName: string;
}

export default function DisbandRoomButton({ roomId, roomName }: Props) {
  return (
    <form
      action={disbandRoomAction}
      onSubmit={(event) => {
        const confirmed = window.confirm(
          "确定要解散「" +
            roomName +
            "」吗？房间成员、聊天、战斗、团本关联数据都会被删除，且不可恢复。"
        );
        if (confirmed === false) event.preventDefault();
      }}
    >
      <input type="hidden" name="roomId" value={roomId} />
      <button
        type="submit"
        className="rounded-lg border border-red-400/30 px-3 py-1.5 text-xs text-red-300 transition hover:border-red-400/60 hover:bg-red-400/10"
      >
        解散房间
      </button>
    </form>
  );
}
