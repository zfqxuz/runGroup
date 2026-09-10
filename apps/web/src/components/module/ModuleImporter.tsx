"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Props {
  readonly roomId?: string;
}

interface ImportResult {
  readonly ok: boolean;
  readonly moduleId?: string;
  readonly error?: string;
  readonly details?: readonly string[];
  readonly warnings?: readonly string[];
}

export default function ModuleImporter(props: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<readonly string[]>([]);

  async function submit(form: HTMLFormElement): Promise<void> {
    setBusy(true);
    setMessage(null);
    setWarnings([]);
    try {
      const response = await fetch("/api/modules/import", {
        method: "POST",
        body: new FormData(form)
      });
      const payload = (await response.json()) as ImportResult;
      if (payload.ok === false || payload.moduleId === undefined) {
        const details = payload.details === undefined ? "" : "：" + payload.details.join("；");
        setMessage((payload.error ?? "导入失败") + details);
        return;
      }
      setWarnings(payload.warnings ?? []);
      router.push(
        props.roomId === undefined
          ? "/modules/" + payload.moduleId
          : "/rooms/" + props.roomId + "/modules/" + payload.moduleId
      );
      router.refresh();
    } catch {
      setMessage("导入请求失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit(event.currentTarget);
      }}
      className="rounded-xl border border-white/10 bg-ink-900/60 p-4"
    >
      {props.roomId === undefined ? null : <input type="hidden" name="roomId" value={props.roomId} />}
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-[260px] flex-1">
          <span className="mb-1.5 block text-xs text-white/50">选择 .md 或 .zip 标准团本包</span>
          <input
            type="file"
            name="file"
            accept=".md,.zip"
            required
            className="block w-full cursor-pointer rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm text-white/60 file:mr-3 file:rounded-md file:border-0 file:bg-sakura-500 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-ink-900"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-sakura-500 px-5 py-2.5 text-sm font-medium text-ink-900 transition hover:bg-sakura-400 disabled:opacity-40"
        >
          {busy ? "导入中…" : "导入团本"}
        </button>
      </div>
      {message === null ? null : (
        <p className="mt-3 rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-[11px] leading-relaxed text-red-200">
          {message}
        </p>
      )}
      {warnings.length === 0 ? null : (
        <ul className="mt-3 space-y-1 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-200">
          {warnings.slice(0, 6).map((warning) => (
            <li key={warning}>· {warning}</li>
          ))}
        </ul>
      )}
    </form>
  );
}
