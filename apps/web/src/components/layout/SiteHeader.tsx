import Link from "next/link";
import UserMenu from "./UserMenu";

const TABS = [
  { href: "/", label: "房间" },
  { href: "/modules", label: "团本广场" },
  { href: "/modules/mine", label: "我的团本" },
  { href: "/characters", label: "我的角色" },
  { href: "/cards", label: "我的卡牌" },
  { href: "/history", label: "游戏历史" }
] as const;

export interface SiteHeaderUser {
  readonly username: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
}

export default function SiteHeader({ user }: { readonly user: SiteHeaderUser }) {
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-ink-900/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-3">
        <nav className="flex flex-wrap items-center gap-1.5">
          {TABS.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/55 transition hover:border-sakura-500/50 hover:text-sakura-300"
            >
              {tab.label}
            </Link>
          ))}
        </nav>
        <UserMenu user={user} />
      </div>
    </header>
  );
}
