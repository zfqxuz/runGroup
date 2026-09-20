"use client";

import { useMemo, useState } from "react";
import type { SpellReference } from "@touhou/rules";

interface Props {
  readonly references: readonly SpellReference[];
}

const inputClass =
  "rounded-lg border border-white/15 bg-ink-900 px-2 py-1.5 text-xs text-white/80 outline-none focus:border-sakura-500";

/** 千幻抄 wiki 法术 / 能力速查表：只做展示，具体结算由 KP / 规则包 effects 处理。 */
export default function SpellReferencePanel({ references }: Props) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<string>("全部");
  const [school, setSchool] = useState<string>("全部");
  const [query, setQuery] = useState("");

  const categories = useMemo(
    () => ["全部", ...Array.from(new Set(references.map((entry) => entry.category)))],
    [references]
  );
  const schools = useMemo(() => {
    const source = category === "全部" ? references : references.filter((entry) => entry.category === category);
    return ["全部", ...Array.from(new Set(source.map((entry) => entry.school).filter((value): value is string => typeof value === "string")))];
  }, [references, category]);

  const automationCounts = useMemo(() => {
    let builtin = 0;
    let partial = 0;
    let kp = 0;
    for (const entry of references) {
      if (entry.automation === "BUILTIN") builtin += 1;
      else if (entry.automation === "PARTIAL") partial += 1;
      else kp += 1;
    }
    return { builtin, partial, kp };
  }, [references]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return references.filter((entry) => {
      if (category !== "全部" && entry.category !== category) return false;
      if (school !== "全部" && entry.school !== school) return false;
      if (keyword.length > 0 && entry.name.toLowerCase().includes(keyword) === false) return false;
      return true;
    });
  }, [references, category, school, query]);

  if (references.length === 0) return null;

  return (
    <section className="rounded-xl border border-sky-400/25 bg-sky-400/5 p-4">
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-center justify-between gap-2 text-left">
        <span>
          <span className="text-sm font-medium text-white/85">法术·能力速查表</span>
          <span className="ml-2 text-[11px] text-white/45">
            wiki 共 {references.length} 条 · 已自动化 {automationCounts.builtin} / 部分 {automationCounts.partial} / KP {automationCounts.kp} · {open ? "收起" : "展开"}
          </span>
        </span>
        <span className="text-xs text-sky-200">{open ? "▲" : "▼"}</span>
      </button>

      {open ? (
        <div className="mt-3">
          <div className="flex flex-wrap gap-2">
            <select value={category} onChange={(event) => { setCategory(event.target.value); setSchool("全部"); }} className={inputClass}>
              {categories.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
            <select value={school} onChange={(event) => setSchool(event.target.value)} className={inputClass}>
              {schools.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索法术名"
              className={inputClass + " min-w-[160px] flex-1"}
            />
            <span className="self-center text-[11px] text-white/45">{filtered.length} 条</span>
          </div>

          <div className="mt-3 grid max-h-[420px] gap-2 overflow-y-auto pr-1 lg:grid-cols-2">
            {filtered.map((entry) => (
              <article key={entry.id} className="rounded-lg border border-white/10 bg-ink-900/50 p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-xs font-medium text-white/85">{entry.name}</h3>
                  <span className="shrink-0 text-right text-[10px] text-white/40">
                    <span
                      className={
                        "mr-1 rounded px-1 py-0.5 " +
                        (entry.automation === "BUILTIN"
                          ? "bg-emerald-400/15 text-emerald-200"
                          : entry.automation === "PARTIAL"
                            ? "bg-amber-400/15 text-amber-200"
                            : "bg-white/10 text-white/45")
                      }
                    >
                      {entry.automation === "BUILTIN" ? "已自动化" : entry.automation === "PARTIAL" ? "部分" : "KP"}
                    </span>
                    {entry.category}
                    {entry.school === undefined ? "" : " · " + entry.school}
                  </span>
                </div>
                <p className="mt-1 font-mono text-[10px] text-sky-200/80">
                  目标 {entry.targetValue ?? "—"} · 灵力 {entry.mpCostText ?? "—"} · 范围 {entry.rangeText ?? "—"} · 时间 {entry.durationText ?? "—"}
                </p>
                <p className="mt-1 max-h-24 overflow-hidden whitespace-pre-wrap text-[10px] leading-relaxed text-white/50">
                  {entry.description}
                </p>
              </article>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
