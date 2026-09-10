"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { useState } from "react";

export default function RegisterPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const response = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        displayName: displayName.length > 0 ? displayName : undefined,
        password
      })
    });

    const payload = (await response.json()) as { ok: boolean; error?: string };

    if (payload.ok === false) {
      setBusy(false);
      setError(payload.error ?? "注册失败");
      return;
    }

    const result = await signIn("credentials", { username, password, redirect: false });
    if (result?.error) {
      setBusy(false);
      setError("注册成功，但自动登录失败，请手动登录");
      return;
    }

    router.push("/");
    router.refresh();
  }

  const inputClass =
    "rounded-lg border border-white/15 bg-ink-800 px-3 py-2 text-sm outline-none focus:border-sakura-500";

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="text-2xl font-semibold">注册</h1>
        <p className="mt-2 text-sm text-white/50">创建一个账号，开始跑团</p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-white/50">用户名（登录用，字母数字下划线连字符）</span>
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            className={inputClass}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-white/50">显示名（可留空）</span>
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            className={inputClass}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-white/50">密码（至少 8 位）</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            className={inputClass}
          />
        </label>

        {error === null ? null : (
          <p className="rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-sakura-500 px-4 py-2 text-sm font-medium text-ink-900 transition hover:bg-sakura-400 disabled:opacity-50"
        >
          {busy ? "注册中…" : "注册并登录"}
        </button>
      </form>

      <p className="text-center text-xs text-white/40">
        已有账号？
        <Link href="/login" className="ml-1 text-spirit-400 hover:underline">
          去登录
        </Link>
      </p>
    </main>
  );
}
