import { loadEffectivePack } from "@/server/rules/loader";
import { setCharacterVisibilityAction, setRoomMagicEnabledAction } from "@/server/actions/room";

interface Props {
  readonly roomId: string;
  readonly system: string;
  readonly era: string | null;
  readonly chargenMethod: string | null;
  readonly rulePackVersionId: string | null;
  readonly ruleOverride: unknown;
  readonly status: string;
  readonly inviteCode: string;
  readonly allowPlayerCombatRequest: boolean;
  readonly isKP: boolean;
  readonly characterVisibility: string;
  readonly magicEnabled: boolean;
  readonly magicSpellCount: number;
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
          <p className="text-[11px] text-white/40">背景年代</p>
          <p className="mt-1 text-sm text-white/80">
            {props.system === "TOUHOU"
              ? "幻想乡年代"
              : props.era === "CLASSIC"
                ? "1920 年代"
                : "现代"}
          </p>
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
        <span>·</span>
        <span>玩家互见角色属性：{props.characterVisibility === "PRIVATE" ? "仅自己" : "公开（默认）"}</span>
        <span>·</span>
        <span>模组魔法：{props.magicSpellCount > 0 ? (props.magicEnabled ? "已启用 " + String(props.magicSpellCount) + " 条" : "检测到 " + String(props.magicSpellCount) + " 条，未启用") : "无"}</span>
      </div>

      {props.isKP ? (
        <div className="mt-4 grid gap-3 border-t border-white/10 pt-4 sm:grid-cols-2">
          <form action={setCharacterVisibilityAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="roomId" value={props.roomId} />
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] text-white/45">玩家之间是否可见对方角色属性</span>
              <select
                name="characterVisibility"
                defaultValue={props.characterVisibility === "PRIVATE" ? "PRIVATE" : "PUBLIC"}
                className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-xs outline-none focus:border-sakura-500"
              >
                <option value="PUBLIC">公开（默认）</option>
                <option value="PRIVATE">仅自己可见</option>
              </select>
            </label>
            <button type="submit" className="rounded-lg border border-spirit-400/40 px-3 py-2 text-xs text-spirit-300 transition hover:bg-spirit-400/10">
              保存可见性
            </button>
          </form>
          {props.magicSpellCount === 0 ? null : (
            <form action={setRoomMagicEnabledAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="roomId" value={props.roomId} />
              <input type="hidden" name="enabled" value={props.magicEnabled ? "0" : "1"} />
              <span className="text-[11px] leading-5 text-white/45">
                模组包含 {props.magicSpellCount} 条魔法规则；关闭时战斗中将无法施法。
              </span>
              <button type="submit" className="rounded-lg border border-purple-400/40 px-3 py-2 text-xs text-purple-200 transition hover:bg-purple-400/10">
                {props.magicEnabled ? "停用魔法" : "启用魔法"}
              </button>
            </form>
          )}
        </div>
      ) : null}
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
