"use client";

import { deleteCharacterAction } from "@/server/actions/character";

interface Props {
  readonly characterId: string;
  readonly characterName: string;
}

/** 删除角色：先二次确认，避免误删。 */
export default function DeleteCharacterButton(props: Props) {
  return (
    <form
      action={deleteCharacterAction}
      onSubmit={(event) => {
        if (window.confirm("确定删除角色「" + props.characterName + "」？该操作不可恢复。") === false) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="characterId" value={props.characterId} />
      <button
        type="submit"
        className="rounded-lg border border-red-400/40 px-3 py-1.5 text-xs text-red-300 transition hover:bg-red-400/10"
      >
        删除角色
      </button>
    </form>
  );
}
