"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import {
  setAvatarAction,
  signOutAction,
  updateDisplayNameAction,
  updatePasswordAction,
  type UserActionState
} from "@/server/actions/user";

interface Props {
  readonly user: {
    readonly username: string;
    readonly displayName: string;
    readonly avatarUrl: string | null;
  };
}

type Panel = "menu" | "nickname" | "avatar" | "password";

const INITIAL_STATE: UserActionState = { ok: false, message: "" };

function SubmitButton({ children }: { readonly children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-sakura-500 px-3 py-1.5 text-xs font-medium text-ink-900 transition hover:bg-sakura-400 disabled:opacity-50"
    >
      {pending ? "保存中…" : children}
    </button>
  );
}

function BackButton({ onClick }: { readonly onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/60 transition hover:border-white/35 hover:text-white"
    >
      返回
    </button>
  );
}

function FieldLabel({ children }: { readonly children: React.ReactNode }) {
  return <span className="text-[11px] text-white/45">{children}</span>;
}

const inputClass =
  "rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-xs text-white outline-none focus:border-sakura-500";

export default function UserMenu({ user }: Props) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>("menu");
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarMessage, setAvatarMessage] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const [nameState, nameAction] = useFormState(updateDisplayNameAction, INITIAL_STATE);
  const [passwordState, passwordAction] = useFormState(updatePasswordAction, INITIAL_STATE);

  useEffect(() => {
    if (open === false) return;
    function onPointerDown(event: MouseEvent): void {
      const target = event.target;
      if (rootRef.current === null) return;
      if (target instanceof Node === false) return;
      if (rootRef.current.contains(target)) return;
      setOpen(false);
      setPanel("menu");
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setOpen(false);
        setPanel("menu");
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (nameState.ok) router.refresh();
  }, [nameState.ok, router]);

  function close(): void {
    setOpen(false);
    setPanel("menu");
  }

  async function uploadAvatar(file: File): Promise<void> {
    setAvatarBusy(true);
    setAvatarMessage(null);
    setAvatarError(null);

    const form = new FormData();
    form.set("type", "AVATAR");
    form.set("file", file);

    try {
      const response = await fetch("/api/upload", { method: "POST", body: form });
      const payload = (await response.json()) as {
        readonly ok: boolean;
        readonly error?: string;
        readonly asset?: { readonly id: string };
      };
      if (payload.ok === false || payload.asset === undefined) {
        setAvatarBusy(false);
        setAvatarError(payload.error ?? "上传失败");
        return;
      }

      const result = await setAvatarAction(payload.asset.id);
      setAvatarBusy(false);
      if (result.ok === false) {
        setAvatarError(result.message);
        return;
      }

      setAvatarMessage(result.message);
      router.refresh();
    } catch {
      setAvatarBusy(false);
      setAvatarError("网络错误，上传失败");
    }
  }

  const initial = user.displayName.trim().slice(0, 1).toUpperCase() || "?";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => value === false);
          setPanel("menu");
          setAvatarMessage(null);
          setAvatarError(null);
        }}
        className="flex items-center gap-2 rounded-full border border-white/15 bg-ink-800/80 py-1 pl-1 pr-3 text-left transition hover:border-sakura-500/50"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-ink-900 text-xs text-sakura-300">
          {user.avatarUrl === null ? (
            initial
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" />
          )}
        </span>
        <span className="max-w-[9rem] truncate text-xs text-white/85">{user.displayName}</span>
        <span className="text-[10px] text-white/35">▾</span>
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-xl border border-white/10 bg-ink-800 p-3 shadow-2xl shadow-black/50">
          {panel === "menu" ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3 rounded-lg bg-ink-900/70 px-3 py-2">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-ink-900 text-sm text-sakura-300">
                  {user.avatarUrl === null ? (
                    initial
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm text-white/85">{user.displayName}</span>
                  <span className="block truncate text-[11px] text-white/35">@{user.username}</span>
                </span>
              </div>

              <div className="flex flex-col">
                <button
                  type="button"
                  onClick={() => setPanel("nickname")}
                  className="rounded-lg px-3 py-2 text-left text-xs text-white/70 transition hover:bg-white/5 hover:text-white"
                >
                  修改昵称
                </button>
                <button
                  type="button"
                  onClick={() => setPanel("avatar")}
                  className="rounded-lg px-3 py-2 text-left text-xs text-white/70 transition hover:bg-white/5 hover:text-white"
                >
                  修改头像
                </button>
                <button
                  type="button"
                  onClick={() => setPanel("password")}
                  className="rounded-lg px-3 py-2 text-left text-xs text-white/70 transition hover:bg-white/5 hover:text-white"
                >
                  修改密码
                </button>
              </div>

              <form action={signOutAction} className="border-t border-white/10 pt-2">
                <button
                  type="submit"
                  className="w-full rounded-lg px-3 py-2 text-left text-xs text-red-300 transition hover:bg-red-400/10"
                >
                  退出登录
                </button>
              </form>
            </div>
          ) : null}

          {panel === "nickname" ? (
            <form action={nameAction} className="flex flex-col gap-3">
              <p className="text-xs font-medium text-white/80">修改昵称</p>
              <label className="flex flex-col gap-1">
                <FieldLabel>新昵称</FieldLabel>
                <input
                  name="displayName"
                  defaultValue={user.displayName}
                  maxLength={32}
                  autoComplete="nickname"
                  className={inputClass}
                />
              </label>
              {nameState.message.length === 0 ? null : (
                <p className={nameState.ok ? "text-[11px] text-spirit-400" : "text-[11px] text-red-300"}>
                  {nameState.message}
                </p>
              )}
              <div className="flex items-center gap-2">
                <BackButton onClick={close} />
                <SubmitButton>保存昵称</SubmitButton>
              </div>
            </form>
          ) : null}

          {panel === "avatar" ? (
            <div className="flex flex-col gap-3">
              <p className="text-xs font-medium text-white/80">修改头像</p>
              <div className="flex items-center gap-3">
                <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-ink-900 text-lg text-sakura-300">
                  {user.avatarUrl === null ? (
                    initial
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" />
                  )}
                </span>
                <p className="text-[11px] leading-5 text-white/40">
                  支持 PNG / JPEG / WebP，最大 8 MB；上传后自动裁剪为正方形。
                </p>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file === undefined) return;
                  void uploadAvatar(file);
                  event.target.value = "";
                }}
              />
              <button
                type="button"
                disabled={avatarBusy}
                onClick={() => fileRef.current?.click()}
                className="rounded-lg border border-sakura-500/40 px-3 py-2 text-xs text-sakura-300 transition hover:bg-sakura-500/10 disabled:opacity-50"
              >
                {avatarBusy ? "上传中…" : "选择图片上传"}
              </button>
              {avatarError === null ? null : <p className="text-[11px] text-red-300">{avatarError}</p>}
              {avatarMessage === null ? null : <p className="text-[11px] text-spirit-400">{avatarMessage}</p>}
              <div className="flex items-center gap-2">
                <BackButton onClick={close} />
              </div>
            </div>
          ) : null}

          {panel === "password" ? (
            <form action={passwordAction} className="flex flex-col gap-3">
              <p className="text-xs font-medium text-white/80">修改密码</p>
              <label className="flex flex-col gap-1">
                <FieldLabel>当前密码</FieldLabel>
                <input name="currentPassword" type="password" autoComplete="current-password" className={inputClass} />
              </label>
              <label className="flex flex-col gap-1">
                <FieldLabel>新密码</FieldLabel>
                <input name="newPassword" type="password" autoComplete="new-password" className={inputClass} />
              </label>
              <label className="flex flex-col gap-1">
                <FieldLabel>确认新密码</FieldLabel>
                <input name="confirmPassword" type="password" autoComplete="new-password" className={inputClass} />
              </label>
              {passwordState.message.length === 0 ? null : (
                <p className={passwordState.ok ? "text-[11px] text-spirit-400" : "text-[11px] text-red-300"}>
                  {passwordState.message}
                </p>
              )}
              <div className="flex items-center gap-2">
                <BackButton onClick={close} />
                <SubmitButton>更新密码</SubmitButton>
              </div>
            </form>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
