"use client";

import { setActiveCharacterAction } from "@/server/actions/room";

interface Props {
  readonly roomId: string;
  readonly defaultValue: string;
  readonly characters: readonly { readonly id: string; readonly name: string }[];
}

/** 选定角色后立即保存，不需要再点一次「保存当前角色」。 */
export default function AutoSubmitCharacterSelect(props: Props) {
  return (
    <form action={setActiveCharacterAction} className="mt-4 flex flex-wrap items-end gap-3">
      <input type="hidden" name="roomId" value={props.roomId} />
      <label className="flex min-w-[240px] flex-1 flex-col gap-1.5">
        <span className="text-xs text-white/50">选择角色（选择后自动保存）</span>
        <select
          name="characterId"
          defaultValue={props.defaultValue}
          onChange={(event) => event.currentTarget.form?.requestSubmit()}
          className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-sakura-500"
        >
          <option value="">（不选择）</option>
          {props.characters.map((character) => (
            <option key={character.id} value={character.id}>
              {character.name}
            </option>
          ))}
        </select>
      </label>
      <noscript>
        <button type="submit" className="rounded-lg border border-spirit-400/40 px-4 py-2 text-sm text-spirit-400">
          保存当前角色
        </button>
      </noscript>
    </form>
  );
}
