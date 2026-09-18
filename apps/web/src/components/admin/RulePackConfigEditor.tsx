"use client";

import { useMemo, useState } from "react";

interface Props {
  readonly initialJson: string;
}

type Mode = "form" | "json";

function recordOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && Array.isArray(value) === false
    ? { ...(value as Record<string, unknown>) }
    : {};
}

/**
 * 规则集配置编辑器：JSON 编辑 + 常用字段表单编辑。
 * 两种模式共用同一份 JSON，表单改动会实时合并回 JSON。
 */
export default function RulePackConfigEditor(props: Props) {
  const [mode, setMode] = useState<Mode>("json");
  const [jsonText, setJsonText] = useState(props.initialJson);
  const parsed = useMemo<Record<string, unknown> | null>(() => {
    try {
      const value: unknown = JSON.parse(jsonText);
      return value !== null && typeof value === "object" && Array.isArray(value) === false
        ? (value as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }, [jsonText]);
  const [error, setError] = useState<string | null>(null);

  function patch(updater: (draft: Record<string, unknown>) => void): void {
    if (parsed === null) {
      setError("当前内容格式有误，请先在高级编辑中修正。");
      return;
    }
    const draft = structuredClone(parsed);
    updater(draft);
    setJsonText(JSON.stringify(draft, null, 2));
    setError(null);
  }

  const system = typeof parsed?.system === "string" ? parsed.system : "";
  const attributes = recordOf(parsed?.attributes);
  const magic = recordOf(parsed?.magic);
  const skills = Array.isArray(parsed?.skills) ? parsed.skills : [];
  const spells = Array.isArray(magic.spells) ? magic.spells : [];

  const SKILL_CATEGORIES = ["COMBAT", "PHYSICAL", "KNOWLEDGE", "SOCIAL", "TECH", "MAGIC", "OTHER"] as const;

  function updateSkill(index: number, key: "id" | "name" | "category" | "base", value: string): void {
    patch((draft) => {
      const list = Array.isArray(draft.skills) ? [...draft.skills] : [];
      const current = recordOf(list[index]);
      list[index] = { ...current, [key]: value };
      draft.skills = list;
    });
  }

  function addSkill(): void {
    patch((draft) => {
      const list = Array.isArray(draft.skills) ? [...draft.skills] : [];
      list.push({ id: "NEW_SKILL_" + String(list.length + 1), name: "新技能", category: "OTHER", base: "0" });
      draft.skills = list;
    });
  }

  function removeSkill(index: number): void {
    patch((draft) => {
      const list = Array.isArray(draft.skills) ? [...draft.skills] : [];
      list.splice(index, 1);
      draft.skills = list;
    });
  }

  const inputClass =
    "w-full rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-xs outline-none focus:border-sakura-500";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="flex overflow-hidden rounded border border-white/15">
          {(["form", "json"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setMode(item)}
              className={
                "px-3 py-1 text-[11px] transition " +
                (mode === item ? "bg-sakura-500/15 text-sakura-300" : "text-white/45 hover:bg-white/5")
              }
            >
              {item === "form" ? "表单编辑" : "JSON 编辑"}
            </button>
          ))}
        </div>
        {parsed === null ? (
          <span className="text-[11px] text-red-300">格式不正确</span>
        ) : (
          <span className="text-[11px] text-emerald-300/70">
            已识别：{system || "未知系统"} · {skills.length} 技能 · {spells.length} 法术
          </span>
        )}
      </div>

      {error === null ? null : <p className="text-[11px] text-red-300">{error}</p>}

      {mode === "json" ? (
        <textarea
          name="config"
          rows={16}
          value={jsonText}
          onChange={(event) => setJsonText(event.target.value)}
          spellCheck={false}
          className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 font-mono text-[11px] leading-5 outline-none focus:border-sakura-500"
        />
      ) : (
        <>
          <input type="hidden" name="config" value={jsonText} />
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] text-white/45">系统</span>
              <select
                value={system}
                onChange={(event) => patch((draft) => { draft.system = event.target.value; })}
                className={inputClass}
              >
                <option value="COC7">COC7</option>
                <option value="TOUHOU">TOUHOU</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] text-white/45">属性下限</span>
              <input
                type="number"
                value={typeof attributes.min === "number" ? attributes.min : 0}
                onChange={(event) =>
                  patch((draft) => {
                    draft.attributes = { ...recordOf(draft.attributes), min: Number(event.target.value) };
                  })
                }
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] text-white/45">属性上限</span>
              <input
                type="number"
                value={typeof attributes.max === "number" ? attributes.max : 0}
                onChange={(event) =>
                  patch((draft) => {
                    draft.attributes = { ...recordOf(draft.attributes), max: Number(event.target.value) };
                  })
                }
                className={inputClass}
              />
            </label>
          </div>
          <label className="flex items-center gap-2 text-xs text-white/60">
            <input
              type="checkbox"
              checked={magic.enabled === true}
              onChange={(event) =>
                patch((draft) => {
                  draft.magic = { ...recordOf(draft.magic), enabled: event.target.checked };
                })
              }
            />
            启用魔法规则
          </label>
          <div className="overflow-hidden rounded-lg border border-white/10">
            <div className="flex items-center justify-between border-b border-white/10 bg-ink-900/60 px-3 py-2">
              <span className="text-[11px] text-white/55">技能表（{skills.length}）</span>
              <button
                type="button"
                onClick={addSkill}
                className="rounded border border-spirit-400/40 px-2 py-1 text-[10px] text-spirit-200 transition hover:bg-spirit-400/10"
              >
                添加技能
              </button>
            </div>
            <div className="max-h-80 overflow-auto">
              <table className="w-full min-w-[640px] text-left text-[11px]">
                <thead className="bg-white/5 text-white/40">
                  <tr>
                    <th className="px-2 py-1.5">id</th>
                    <th className="px-2 py-1.5">名称</th>
                    <th className="px-2 py-1.5">类别</th>
                    <th className="px-2 py-1.5">基础值表达式</th>
                    <th className="px-2 py-1.5 text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {skills.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-3 py-4 text-center text-white/35">当前规则包没有技能；点击“添加技能”。</td>
                    </tr>
                  ) : (
                    skills.map((skill, index) => {
                      const record = recordOf(skill);
                      return (
                        <tr key={index} className="border-t border-white/5" data-testid={"skill-row-" + index}>
                          <td className="px-2 py-1">
                            <input
                              data-testid={"skill-id-" + index}
                              value={typeof record.id === "string" ? record.id : ""}
                              onChange={(event) => updateSkill(index, "id", event.target.value)}
                              className="w-36 rounded border border-white/15 bg-ink-900 px-2 py-1 font-mono text-[11px] outline-none focus:border-sakura-500"
                            />
                          </td>
                          <td className="px-2 py-1">
                            <input
                              data-testid={"skill-name-" + index}
                              value={typeof record.name === "string" ? record.name : ""}
                              onChange={(event) => updateSkill(index, "name", event.target.value)}
                              className="w-40 rounded border border-white/15 bg-ink-900 px-2 py-1 text-[11px] outline-none focus:border-sakura-500"
                            />
                          </td>
                          <td className="px-2 py-1">
                            <select
                              data-testid={"skill-category-" + index}
                              value={typeof record.category === "string" ? record.category : "OTHER"}
                              onChange={(event) => updateSkill(index, "category", event.target.value)}
                              className="rounded border border-white/15 bg-ink-900 px-2 py-1 text-[11px] outline-none focus:border-sakura-500"
                            >
                              {SKILL_CATEGORIES.map((category) => (
                                <option key={category} value={category}>{category}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-2 py-1">
                            <input
                              data-testid={"skill-base-" + index}
                              value={typeof record.base === "string" ? record.base : String(record.base ?? "")}
                              onChange={(event) => updateSkill(index, "base", event.target.value)}
                              className="w-28 rounded border border-white/15 bg-ink-900 px-2 py-1 font-mono text-[11px] outline-none focus:border-sakura-500"
                            />
                          </td>
                          <td className="px-2 py-1 text-right">
                            <button
                              type="button"
                              onClick={() => removeSkill(index)}
                              className="rounded border border-red-400/30 px-2 py-1 text-[10px] text-red-300 transition hover:bg-red-400/10"
                            >
                              删除
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-[11px] text-white/35">
            种族、战斗、法术等复杂配置可继续使用「JSON 编辑」。
          </p>
        </>
      )}
    </div>
  );
}
