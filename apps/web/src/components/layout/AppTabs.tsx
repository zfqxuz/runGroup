import Link from "next/link";

const TABS = [
  { href: "/", label: "房间" },
  { href: "/modules", label: "团本广场" },
  { href: "/modules/mine", label: "我的团本" },
  { href: "/characters", label: "我的角色" },
  { href: "/cards", label: "我的卡牌" },
  { href: "/history", label: "游戏历史" }
] as const;

export default function AppTabs() {
  return (
    <nav className="flex flex-wrap gap-2">
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
  );
}
