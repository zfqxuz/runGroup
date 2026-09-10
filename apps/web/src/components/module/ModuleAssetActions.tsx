"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  readonly roomId: string;
  readonly moduleId: string;
  readonly moduleAssetId: string;
}

export default function ModuleAssetActions(props: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function upload(form: HTMLFormElement): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/modules/" + props.moduleId + "/assets", {
        method: "POST",
        body: new FormData(form)
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string };
      if (payload.ok === false) {
        setMessage(payload.error ?? "替换失败");
        return;
      }
      router.refresh();
    } catch {
      setMessage("替换请求失败");
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    if (window.confirm("确定删除这个资源吗？引用它的正文可能需要手动修正。") === false) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/modules/" + props.moduleId + "/assets", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roomId: props.roomId, moduleAssetId: props.moduleAssetId })
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string };
      if (payload.ok === false) {
        setMessage(payload.error ?? "删除失败");
        return;
      }
      router.refresh();
    } catch {
      setMessage("删除请求失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void upload(event.currentTarget);
      }}
      className="mt-2 flex flex-wrap items-center gap-2"
    >
      <input type="hidden" name="roomId" value={props.roomId} />
      <input type="hidden" name="moduleAssetId" value={props.moduleAssetId} />
      <input
        type="file"
        name="file"
        required
        className="max-w-[160px] text-[11px] text-white/50 file:mr-2 file:rounded file:border-0 file:bg-spirit-400/20 file:px-2 file:py-1 file:text-[10px] file:text-spirit-200"
      />
      <button
        type="submit"
        disabled={busy}
        className="rounded-md border border-spirit-400/40 px-2 py-1 text-[10px] text-spirit-300 transition hover:bg-spirit-400/10 disabled:opacity-40"
      >
        替换
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => void remove()}
        className="rounded-md border border-red-400/40 px-2 py-1 text-[10px] text-red-300 transition hover:bg-red-400/10 disabled:opacity-40"
      >
        删除
      </button>
      {message === null ? null : <span className="text-[10px] text-red-300">{message}</span>}
    </form>
  );
}
