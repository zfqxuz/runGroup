"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { attachAssetAction, type AttachKind } from "@/server/actions/asset";

interface Props {
  readonly kind: AttachKind;
  readonly targetId: string;
  readonly currentUrl: string | null;
  readonly label: string;
  readonly shape?: "square" | "wide";
}

interface UploadResponse {
  readonly ok: boolean;
  readonly error?: string;
  readonly asset?: {
    readonly id: string;
    readonly url: string;
    readonly thumbnailUrl: string;
  };
}

export default function ImageUpload(props: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  async function handleFile(file: File): Promise<void> {
    setBusy(true);
    setError(null);

    const form = new FormData();
    form.set("type", props.kind);
    form.set("file", file);

    let payload: UploadResponse;
    try {
      const response = await fetch("/api/upload", { method: "POST", body: form });
      payload = (await response.json()) as UploadResponse;
    } catch {
      setBusy(false);
      setError("网络错误，上传失败");
      return;
    }

    if (payload.ok === false || payload.asset === undefined) {
      setBusy(false);
      setError(payload.error ?? "上传失败");
      return;
    }

    setPreview(payload.asset.url);

    const result = await attachAssetAction({
      kind: props.kind,
      targetId: props.targetId,
      assetId: payload.asset.id
    });

    setBusy(false);
    if (result.ok === false) {
      setError(result.error ?? "保存失败");
      return;
    }
    router.refresh();
  }

  const shown = preview ?? props.currentUrl;
  const boxClass =
    props.shape === "wide"
      ? "relative h-28 w-full overflow-hidden rounded-lg border border-white/10 bg-ink-900"
      : "relative h-20 w-20 overflow-hidden rounded-lg border border-white/10 bg-ink-900";

  return (
    <div className="flex flex-col gap-2">
      <div className={boxClass}>
        {shown === null ? (
          <span className="absolute inset-0 flex items-center justify-center text-[11px] text-white/25">
            无图
          </span>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shown} alt="" className="h-full w-full object-cover" />
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file !== undefined) void handleFile(file);
          event.target.value = "";
        }}
      />

      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="rounded-md border border-white/15 px-2 py-1 text-[11px] text-white/50 transition hover:border-white/35 hover:text-white disabled:opacity-40"
      >
        {busy ? "上传中…" : props.label}
      </button>

      {error === null ? null : <p className="text-[11px] text-red-300">{error}</p>}
    </div>
  );
}
