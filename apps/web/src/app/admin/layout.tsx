import Link from "next/link";
import type { ReactNode } from "react";
import { requireAdmin } from "@/server/auth";

const NAV = [
  { href: "/admin", label: "总览" },
  { href: "/admin/users", label: "用户" },
  { href: "/admin/rooms", label: "房间" },
  { href: "/admin/modules", label: "团本" },
  { href: "/admin/games", label: "游戏局" },
  { href: "/admin/rulepacks", label: "规则包" },
  { href: "/admin/magic", label: "魔法" },
  { href: "/admin/system", label: "系统设置" },
  { href: "/admin/audit", label: "审计日志" }
] as const;

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { readonly children: ReactNode }) {
  await requireAdmin();
  return (
    <div className="mx-auto flex min-h-screen max-w-7xl gap-6 px-6 py-8">
      <aside className="hidden w-44 shrink-0 lg:block">
        <div className="sticky top-24 rounded-xl border border-white/10 bg-ink-800/60 p-3">
          <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-widest text-white/30">管理后台</p>
          <nav className="flex flex-col gap-1">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-2 text-xs text-white/60 transition hover:bg-white/5 hover:text-white"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <Link
            href="/"
            className="mt-3 block border-t border-white/10 px-3 pt-3 text-[11px] text-white/35 transition hover:text-white/70"
          >
            ← 返回前台
          </Link>
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        <nav className="mb-4 flex gap-2 overflow-x-auto lg:hidden">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="shrink-0 rounded-full border border-white/15 px-3 py-1.5 text-[11px] text-white/55 transition hover:text-white"
            >
              {item.label}
            </Link>
          ))}
          <Link href="/" className="shrink-0 rounded-full border border-white/15 px-3 py-1.5 text-[11px] text-white/35">返回前台</Link>
        </nav>
        {children}
      </main>
    </div>
  );
}
