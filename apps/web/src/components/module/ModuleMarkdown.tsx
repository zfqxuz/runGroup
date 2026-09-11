"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Props {
  readonly text: string;
  readonly emptyText?: string;
}

export default function ModuleMarkdown({ text, emptyText }: Props) {
  if (text.trim().length === 0) {
    return <p className="text-xs text-white/35">{emptyText ?? "暂无正文"}</p>;
  }

  return (
    <div className="max-h-[640px] overflow-auto rounded-lg border border-white/10 bg-ink-900/60 px-4 py-3 text-sm leading-relaxed text-white/70 [&_a]:text-spirit-400 [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-white/20 [&_blockquote]:pl-3 [&_blockquote]:text-white/50 [&_code]:rounded [&_code]:bg-ink-900 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[11px] [&_h1]:mb-3 [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:text-white [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-white [&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:font-medium [&_h3]:text-white/90 [&_hr]:my-4 [&_hr]:border-white/10 [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_pre]:my-3 [&_pre]:overflow-auto [&_pre]:rounded-lg [&_pre]:bg-ink-900 [&_pre]:p-3 [&_table]:my-3 [&_table]:w-full [&_td]:border [&_td]:border-white/10 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-white/10 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:text-white/80 [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}
