"use client";

import { archiveRoomAction } from "@/server/actions/room";

interface Props {
  readonly roomId: string;
  readonly roomName: string;
}

export default function ArchiveRoomButton({ roomId, roomName }: Props) {
  return (
    <form
      action={archiveRoomAction}
      onSubmit={(event) => {
        const confirmed = window.confirm(
          "确定要归档「" + roomName + "」吗？归档后房间不再出现在进行中列表，但历史数据会保留。"
        );
        if (confirmed === false) event.preventDefault();
      }}
    >
      <input type="hidden" name="roomId" value={roomId} />
      <button
        type="submit"
        className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/55 transition hover:border-white/35 hover:text-white"
      >
        归档房间
      </button>
    </form>
  );
}
