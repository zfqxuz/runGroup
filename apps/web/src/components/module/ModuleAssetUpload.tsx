"use client";

import { useRef, useState } from "react";

interface Props {
  readonly moduleId: string;
  readonly name: string;
  readonly kind: string;
  readonly label: string;
  readonly currentPath: string | null;
  readonly currentUrl: string | null;
}

interface UploadResponse {
  readonly ok: boolean;
  readonly error?: string;
  readonly relativePath?: string;
  readonly url?: string;
}

export default function ModuleAssetUpload(props: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [path, setPath] = useState(props.currentPath ?? "");
  const [preview, setPreview] = useState<string | null>(props.currentUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File): Promise<void> {
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("file", file);
    form.set("kind", props.kind);
    try {
      const response = await fetch("/api/modules/" + props.moduleId + "/assets", { method: "POST", body: form });
      const payload = (await response.json()) as UploadResponse;
      if (payload.ok === false || payload.relativePath === undefined) {
        setError(payload.error ?? "上传失败");
        return;
      }
      setPath(payload.relativePath);
      setPreview(payload.url ?? null);
    } catch {
      setError("网络错误，上传失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <input type="hidden" name={props.name} value={path} />
      <span className="text-[10px] text-white/35">{props.label}</span>
      <div className="flex items-center gap-2">
        {preview === null ? (
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded border border-dashed border-white/15 text-[10px] text-white/25">
            无图
          </span>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" className="h-14 w-14 shrink-0 rounded border border-white/10 object-cover" />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <input
            name={props.name + "Path"}
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder="资源相对路径，可直接上传"
            className="rounded border border-white/15 bg-ink-900 px-2 py-1 text-[11px] text-white/70 outline-none focus:border-sakura-500"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
              className="rounded border border-spirit-400/40 px-2 py-1 text-[11px] text-spirit-300 transition hover:bg-spirit-400/10 disabled:opacity-40"
            >
              {busy ? "上传中…" : "上传素材"}
            </button>
            {path.length === 0 ? null : (
              <button
                type="button"
                onClick={() => { setPath(""); setPreview(null); }}
                className="rounded border border-white/15 px-2 py-1 text-[11px] text-white/45 transition hover:border-white/35"
              >
                清除
              </button>
            )}
            {error === null ? null : <span className="text-[10px] text-red-300">{error}</span>}
          </div>
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,.pdf,.mp3,.ogg,.wav,.mp4,.webm"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file !== undefined) void upload(file);
          event.target.value = "";
        }}
      />
    </div>
  );
}
