"use client";

import { deleteModuleAction, duplicateModuleAction } from "@/server/actions/module";

interface Props {
  readonly roomId: string;
  readonly moduleId: string;
}

export default function ModuleActions(props: Props) {
  return (
    <div className="flex flex-wrap gap-2">
      <form action={duplicateModuleAction}>
        <input type="hidden" name="roomId" value={props.roomId} />
        <input type="hidden" name="moduleId" value={props.moduleId} />
        <button
          type="submit"
          className="rounded-lg border border-spirit-400/40 px-3 py-1.5 text-xs text-spirit-400 transition hover:bg-spirit-400/10"
        >
          复制团本
        </button>
      </form>
      <form
        action={deleteModuleAction}
        onSubmit={(event) => {
          if (window.confirm("确定删除这个团本吗？正在进行的局不能删除。") === false) {
            event.preventDefault();
          }
        }}
      >
        <input type="hidden" name="roomId" value={props.roomId} />
        <input type="hidden" name="moduleId" value={props.moduleId} />
        <button
          type="submit"
          className="rounded-lg border border-red-400/40 px-3 py-1.5 text-xs text-red-300 transition hover:bg-red-400/10"
        >
          删除团本
        </button>
      </form>
    </div>
  );
}
