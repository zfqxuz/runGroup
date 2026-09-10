type Phase = {
  id: string;
  title: string;
  subtitle: string;
  items: string[];
};

const phases: Phase[] = [
  {
    id: "P0",
    title: "MVP",
    subtitle: "能完整打完一场",
    items: ["车卡与审核", "房间 / 聊天 / 掷骰", "ATB 战斗引擎", "符卡 / 弹幕结算", "KP 与 PL 权限分离"]
  },
  {
    id: "P1",
    title: "VTT",
    subtitle: "可视化跑团",
    items: ["地图导入与图层", "棋子实时同步", "场景切换 / 天气", "立绘与卡面", "背景音乐"]
  },
  {
    id: "P2",
    title: "生态",
    subtitle: "可复用内容",
    items: ["模组导入导出", "符卡 / 武器内容库", "战斗回放", "模组编辑器"]
  }
];

const stack: ReadonlyArray<readonly [string, string]> = [
  ["运行时", "Next.js 14 App Router + 自定义 server.ts"],
  ["实时", "Socket.IO（服务端权威）"],
  ["数据", "PostgreSQL 16 + Prisma 5"],
  ["规则", "RulePack 配置驱动 + 表达式引擎"],
  ["校验", "Zod（配置与 API 双向）"],
  ["前端", "TailwindCSS + Zustand + Konva"]
];

export default function Home() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-20">
      <header className="flex flex-col gap-4">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-sakura-400">
          Touhou TRPG Platform
        </p>
        <h1 className="text-4xl font-semibold leading-tight sm:text-5xl">
          东方 TRPG 线上跑团平台
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-white/60">
          COC7 兼容的规则内核，叠加东方扩展：种族、符卡、弹幕对抗、灵力与 DP。
          数值全部由 RulePack 配置驱动，战斗过程可快照、可回放。
        </p>
        <div className="flex flex-wrap gap-2 font-mono text-xs text-white/50">
          <span className="rounded-full border border-white/10 px-3 py-1">Spec v1.1</span>
          <span className="rounded-full border border-white/10 px-3 py-1">Phase 0 · 地基</span>
          <span className="rounded-full border border-white/10 px-3 py-1">PostgreSQL</span>
        </div>
      </header>

      <section className="mt-16 grid gap-4 sm:grid-cols-3">
        {phases.map((phase) => (
          <div key={phase.id} className="rounded-xl border border-white/10 bg-ink-800/60 p-5">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-xs text-spirit-400">{phase.id}</span>
              <h2 className="text-lg font-medium">{phase.title}</h2>
            </div>
            <p className="mt-1 text-xs text-white/50">{phase.subtitle}</p>
            <ul className="mt-4 space-y-2 text-sm text-white/70">
              {phase.items.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="text-sakura-500">·</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section className="mt-16">
        <h2 className="text-sm font-medium uppercase tracking-widest text-white/40">技术栈</h2>
        <dl className="mt-6 divide-y divide-white/10 border-y border-white/10">
          {stack.map(([label, value]) => (
            <div key={label} className="grid grid-cols-3 gap-4 py-3 text-sm">
              <dt className="text-white/40">{label}</dt>
              <dd className="col-span-2 text-white/80">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  );
}
