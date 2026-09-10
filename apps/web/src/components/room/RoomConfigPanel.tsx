import { loadEffectivePack } from "@/server/rules/loader";

interface Props {
  readonly roomId: string;
  readonly system: string;
  readonly chargenMethod: string | null;
  readonly rulePackVersionId: string | null;
  readonly ruleOverride: unknown;
  readonly status: string;
  readonly inviteCode: string;
  readonly allowPlayerCombatRequest: boolean;
}

const MODE_LABELS: Record<string, string> = {
  INITIATIVE: "顺序制",
  ATB: "ATB 进度条"
};

export default async function RoomConfigPanel(props: Props) {
  const effective = await loadEffectivePack({
    id: props.roomId,
    system: props.system,
    rulePackVersionId: props.rulePackVersionId,
    ruleOverride: props.ruleOverride
  });
  const pack = effective.compiled.pack;
  const method = pack.attributes.methods.find((item) => item.id === props.chargenMethod) ?? pack.attributes.methods[0];
  const events = Object.entries(effective.compiled.combat.events);
  const enabledEvents = events.filter(([, rule]) => rule.defaultEnabled).length;

  return (
    <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-white/80">房间配置</h2>
        <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] text-white/45">
          {props.status}
        </span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2.5">
          <p className="text-[11px] text-white/40">规则包</p>
          <p className="mt-1 font-mono text-sm text-white/80">{pack.id}@{pack.version}</p>
        </div>
        <div className="rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2.5">
          <p className="text-[11px] text-white/40">模组</p>
          <p className="mt-1 text-sm text-white/80">{props.system}</p>
        </div>
        <div className="rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2.5">
          <p className="text-[11px] text-white/40">车卡方式</p>
          <p className="mt-1 text-sm text-white/80">{method?.label ?? "未指定"}</p>
        </div>
        <div className="rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2.5">
          <p className="text-[11px] text-white/40">战斗模式</p>
          <p className="mt-1 text-sm text-white/80">
            {MODE_LABELS[effective.compiled.combat.mode] ?? effective.compiled.combat.mode}
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-white/45">
        <span>邀请码 <span className="font-mono text-white/70">{props.inviteCode}</span></span>
        <span>·</span>
        <span>战斗事件 {enabledEvents}/{events.length} 启用</span>
        <span>·</span>
        <span>玩家战斗申请：{props.allowPlayerCombatRequest ? "允许" : "禁止"}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {events.map(([id, rule]) => (
          <span
            key={id}
            className={rule.defaultEnabled ? "rounded-full border border-emerald-400/30 px-2 py-0.5 text-[10px] text-emerald-300" : "rounded-full border border-white/15 px-2 py-0.5 text-[10px] text-white/35 line-through"}
          >
            {rule.label}
          </span>
        ))}
      </div>
    </section>
  );
}
