"use client";

import { useMemo, useState } from "react";
import { markGrowthCheckAction } from "@/server/actions/advancement";

export interface CharacterSkillGroup {
  readonly characterId: string;
  readonly characterName: string;
  readonly skills: readonly { readonly id: string; readonly name: string; readonly value: number }[];
}

interface Props {
  readonly roomId: string;
  readonly gameId: string;
  readonly characters: readonly { readonly id: string; readonly name: string }[];
  readonly characterSkills: readonly CharacterSkillGroup[];
  readonly skillOptions: readonly { readonly id: string; readonly name: string }[];
  readonly returnTo: string;
}

const inputClass =
  "rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-sakura-500";

export default function GrowthCheckForm({
  roomId,
  gameId,
  characters,
  characterSkills,
  skillOptions,
  returnTo
}: Props) {
  const firstCharacterId = characters[0]?.id ?? "";
  const [characterId, setCharacterId] = useState(firstCharacterId);
  const selected = characterSkills.find((group) => group.characterId === characterId);
  const skills = useMemo(() => {
    if (selected !== undefined && selected.skills.length > 0) return selected.skills;
    return skillOptions.map((skill) => ({ id: skill.id, name: skill.name, value: 0 }));
  }, [selected, skillOptions]);
  const [skillId, setSkillId] = useState(skills[0]?.id ?? "");

  const effectiveSkillId = skills.some((skill) => skill.id === skillId) ? skillId : skills[0]?.id ?? "";
  const selectedSkill = skills.find((skill) => skill.id === effectiveSkillId);

  return (
    <form action={markGrowthCheckAction} className="mt-3 rounded-lg border border-dashed border-white/15 p-3">
      <input type="hidden" name="roomId" value={roomId} />
      <input type="hidden" name="gameId" value={gameId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <p className="text-[11px] text-white/45">
        标记本局使用成功、需要幕间成长检定的技能。结束本局时可一键掷骰结算。
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-4">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-white/35">角色</span>
          <select
            name="characterId"
            value={characterId}
            onChange={(event) => setCharacterId(event.target.value)}
            className={inputClass}
          >
            {characters.map((character) => (
              <option key={character.id} value={character.id}>
                {character.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-white/35">技能</span>
          <select
            name="skillId"
            value={effectiveSkillId}
            onChange={(event) => setSkillId(event.target.value)}
            className={inputClass}
          >
            {skills.map((skill) => (
              <option key={skill.id} value={skill.id}>
                {skill.name}（{skill.value}）
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-white/35">备注</span>
          <input name="note" maxLength={500} placeholder="使用场景 / 说明" className={inputClass} />
        </label>
        <div className="flex items-end">
          <button
            type="submit"
            disabled={characters.length === 0 || effectiveSkillId.length === 0}
            className="w-full rounded-lg border border-amber-400/40 px-3 py-2 text-xs text-amber-300 transition hover:bg-amber-400/10 disabled:opacity-40"
          >
            标记成长点{selectedSkill === undefined ? "" : "：当前 " + selectedSkill.value}
          </button>
        </div>
      </div>
    </form>
  );
}
