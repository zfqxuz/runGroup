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
      setError("JSON 不合法，无法用表单编辑，请先在 JSON 模式修正。");
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
          <span className="text-[11px] text-red-300">JSON 不合法</span>
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
            启用魔法规则（magic.enabled）
          </label>
          <p className="text-[11px] text-white/35">
            技能 / 种族 / 战斗 / 法术等复杂结构请切到「JSON 编辑」修改。表单只覆盖系统与常用开关，不会动其它字段。
          </p>
        </>
      )}
    </div>
  );
}
