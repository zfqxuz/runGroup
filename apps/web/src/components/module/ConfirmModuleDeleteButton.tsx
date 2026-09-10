"use client";

import { deleteOwnedModuleAction } from "@/server/actions/module";

interface Props {
  readonly moduleId: string;
  readonly label?: string;
}

export default function ConfirmModuleDeleteButton(props: Props) {
  return (
    <form
      action={deleteOwnedModuleAction}
      onSubmit={(event) => {
        if (window.confirm("确定删除这个团本吗？正在进行的局不能删除。") === false) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="moduleId" value={props.moduleId} />
      <button
        type="submit"
        className="rounded-md border border-red-400/40 px-2 py-1 text-[11px] text-red-300 transition hover:bg-red-400/10"
      >
        {props.label ?? "删除"}
      </button>
    </form>
  );
}
