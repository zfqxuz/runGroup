import { PRESET_TIERS, RARITIES } from "@touhou/rules";
import ModuleAssetUpload from "@/components/module/ModuleAssetUpload";
import { deleteModuleEntityAction, saveModuleEntityAction } from "@/server/actions/module-entity";
import { structuredOfContent, type StructuredModuleEntry } from "@/server/modules/structure";

interface Props {
  readonly moduleId: string;
  readonly content: unknown;
  readonly assets: Readonly<Record<string, string>>;
  readonly returnTo: string;
}

const inputClass =
  "rounded border border-white/15 bg-ink-900 px-2 py-1 text-xs text-white/75 outline-none focus:border-sakura-500";
const labelClass = "flex flex-col gap-1";
const captionClass = "text-[10px] text-white/35";

function textOf(data: Record<string, unknown>, key: string, fallback = ""): string {
  const value = data[key];
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return fallback;
}

function numberOf(data: Record<string, unknown>, key: string, fallback: number): number {
  const value = Number(data[key]);
  return Number.isFinite(value) ? Math.floor(value) : fallback;
}

function boolOf(data: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = data[key];
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "true" || value === "1";
  if (typeof value === "number") return value !== 0;
  return fallback;
}

function attrOf(data: Record<string, unknown>, key: string, fallback: number): number {
  const attributes = data.attributes;
  if (attributes === null || typeof attributes !== "object" || Array.isArray(attributes)) return fallback;
  const value = Number((attributes as Record<string, unknown>)[key]);
  return Number.isFinite(value) ? Math.floor(value) : fallback;
}

function skillsTextOf(data: Record<string, unknown>): string {
  const skills = data.skills;
  if (skills === null || typeof skills !== "object" || Array.isArray(skills)) return "";
  return Object.entries(skills as Record<string, unknown>)
    .map(([id, value]) => id + ":" + String(value))
    .join(", ");
}

function tagsTextOf(data: Record<string, unknown>): string {
  const tags = data.tags;
  if (Array.isArray(tags) === false) return "";
  return tags.map((tag) => String(tag)).join(", ");
}

function assetUrl(assets: Readonly<Record<string, string>>, path: string): string | null {
  return path.length > 0 ? assets[path] ?? null : null;
}

function FormShell(props: {
  readonly moduleId: string;
  readonly kind: string;
  readonly entityId: string;
  readonly returnTo: string;
  readonly children: React.ReactNode;
}) {
  return (
    <form action={saveModuleEntityAction} className="mt-2 flex flex-col gap-2 rounded border border-white/10 bg-ink-900/40 p-3">
      <input type="hidden" name="moduleId" value={props.moduleId} />
      <input type="hidden" name="kind" value={props.kind} />
      <input type="hidden" name="entityId" value={props.entityId} />
      <input type="hidden" name="returnTo" value={props.returnTo} />
      {props.children}
      <button type="submit" className="self-start rounded bg-sakura-500 px-3 py-1.5 text-[11px] font-medium text-ink-900">
        {props.entityId.length === 0 ? "新增" : "保存"}
      </button>
    </form>
  );
}

function NpcForm(props: { moduleId: string; entry: StructuredModuleEntry | null; returnTo: string; assets: Readonly<Record<string, string>> }) {
  const data = props.entry?.data ?? {};
  const portrait = textOf(data, "portrait");
  const attrKeys = [
    ["str", "力量"], ["con", "体质"], ["siz", "体型"], ["dex", "敏捷"], ["app", "外貌"],
    ["int", "智力"], ["pow", "意志"], ["edu", "教育"], ["luck", "幸运"]
  ] as const;
  return (
    <FormShell moduleId={props.moduleId} kind="npc" entityId={props.entry?.id ?? ""} returnTo={props.returnTo}>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <label className={labelClass}><span className={captionClass}>名称</span><input name="name" defaultValue={textOf(data, "name", props.entry?.title ?? "")} className={inputClass} /></label>
        <label className={labelClass}><span className={captionClass}>副标题</span><input name="subtitle" defaultValue={textOf(data, "subtitle")} className={inputClass} /></label>
        <label className={labelClass}><span className={captionClass}>种族</span><input name="race" defaultValue={textOf(data, "race")} className={inputClass} /></label>
        <label className={labelClass}><span className={captionClass}>Tier</span><select name="tier" defaultValue={textOf(data, "tier", "STANDARD")} className={inputClass}>{PRESET_TIERS.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label className={labelClass}><span className={captionClass}>稀有度</span><select name="rarity" defaultValue={textOf(data, "rarity", "COMMON")} className={inputClass}>{RARITIES.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label className={labelClass}><span className={captionClass}>标签（逗号分隔）</span><input name="tags" defaultValue={tagsTextOf(data)} className={inputClass} /></label>
      </div>
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-9">
        {attrKeys.map(([key, label]) => (
          <label key={key} className={labelClass}><span className={captionClass}>{label}</span><input name={"attr_" + key} type="number" defaultValue={attrOf(data, key, 50)} className={inputClass} /></label>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-4">
        {(["maxHp", "maxMp", "maxSan", "maxDp"] as const).map((key) => (
          <label key={key} className={labelClass}><span className={captionClass}>{key}</span><input name={key} type="number" defaultValue={numberOf(data, key, key === "maxHp" ? 10 : 0)} className={inputClass} /></label>
        ))}
      </div>
      <label className={labelClass}><span className={captionClass}>描述</span><textarea name="description" rows={2} defaultValue={textOf(data, "description")} className={inputClass} /></label>
      <label className={labelClass}><span className={captionClass}>技能（SKILL:值，逗号分隔）</span><input name="skills" defaultValue={skillsTextOf(data)} className={inputClass + " font-mono"} /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <ModuleAssetUpload moduleId={props.moduleId} name="portrait" kind="IMAGE" label="角色立绘 / Token 图（可上传）" currentPath={portrait.length > 0 ? portrait : null} currentUrl={assetUrl(props.assets, portrait)} />
        <label className={labelClass}><span className={captionClass}>Token 图路径（留空则用默认占位）</span><input name="tokenPath" defaultValue={textOf(data, "token")} className={inputClass + " font-mono"} /></label>
      </div>
      <label className="flex items-center gap-2 text-[11px] text-white/55">
        <input type="checkbox" name="isPublic" value="1" defaultChecked={boolOf(data, "isPublic", false)} />
        默认对玩家公开属性
      </label>
    </FormShell>
  );
}

function ItemForm(props: { moduleId: string; entry: StructuredModuleEntry | null; returnTo: string; assets: Readonly<Record<string, string>> }) {
  const data = props.entry?.data ?? {};
  const image = textOf(data, "image");
  return (
    <FormShell moduleId={props.moduleId} kind="item" entityId={props.entry?.id ?? ""} returnTo={props.returnTo}>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className={labelClass}><span className={captionClass}>名称</span><input name="name" defaultValue={textOf(data, "name", props.entry?.title ?? "")} className={inputClass} /></label>
        <label className={labelClass}><span className={captionClass}>类型</span><select name="itemType" defaultValue={textOf(data, "itemType", "ITEM")} className={inputClass}>{["WEAPON", "ITEM", "TOME", "ARTIFACT", "EVIDENCE"].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label className={labelClass}><span className={captionClass}>稀有度</span><select name="rarity" defaultValue={textOf(data, "rarity", "COMMON")} className={inputClass}>{RARITIES.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label className={labelClass}><span className={captionClass}>数量</span><input name="quantity" type="number" min={1} defaultValue={numberOf(data, "quantity", 1)} className={inputClass} /></label>
      </div>
      <label className={labelClass}><span className={captionClass}>描述</span><textarea name="description" rows={2} defaultValue={textOf(data, "description")} className={inputClass} /></label>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <label className={labelClass}><span className={captionClass}>伤害</span><input name="damage" defaultValue={textOf(data, "damage")} className={inputClass} /></label>
        <label className={labelClass}><span className={captionClass}>射程</span><input name="range" defaultValue={textOf(data, "range")} className={inputClass} /></label>
        <label className={labelClass}><span className={captionClass}>技能 ID</span><input name="skillId" defaultValue={textOf(data, "skillId")} className={inputClass} /></label>
        <label className={labelClass}><span className={captionClass}>命中修正</span><input name="accuracyMod" type="number" defaultValue={numberOf(data, "accuracyMod", 0)} className={inputClass} /></label>
        <label className={labelClass}><span className={captionClass}>MP 消耗</span><input name="mpCost" defaultValue={textOf(data, "mpCost")} className={inputClass} /></label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <ModuleAssetUpload moduleId={props.moduleId} name="image" kind="IMAGE" label="物品图片（可上传）" currentPath={image.length > 0 ? image : null} currentUrl={assetUrl(props.assets, image)} />
        <label className={labelClass}><span className={captionClass}>效果说明</span><textarea name="effect" rows={2} defaultValue={textOf(data, "effect")} className={inputClass} /></label>
      </div>
    </FormShell>
  );
}

function ClueForm(props: { moduleId: string; entry: StructuredModuleEntry | null; returnTo: string; assets: Readonly<Record<string, string>> }) {
  const data = props.entry?.data ?? {};
  const image = textOf(data, "image");
  return (
    <FormShell moduleId={props.moduleId} kind="clue" entityId={props.entry?.id ?? ""} returnTo={props.returnTo}>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className={labelClass}><span className={captionClass}>标题</span><input name="title" defaultValue={textOf(data, "title", props.entry?.title ?? "")} className={inputClass} /></label>
        <label className={labelClass}><span className={captionClass}>关联证物 id（可选）</span><input name="linkedItemId" defaultValue={textOf(data, "linkedItemId")} className={inputClass} /></label>
      </div>
      <label className={labelClass}><span className={captionClass}>线索正文</span><textarea name="content" rows={4} defaultValue={textOf(data, "content")} className={inputClass} /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <ModuleAssetUpload moduleId={props.moduleId} name="image" kind="IMAGE" label="线索图片 / 手书（可上传）" currentPath={image.length > 0 ? image : null} currentUrl={assetUrl(props.assets, image)} />
        <label className="flex items-center gap-2 text-[11px] text-white/55">
          <input type="checkbox" name="isPublic" value="1" defaultChecked={boolOf(data, "isPublic", false)} />
          默认对所有玩家可见
        </label>
      </div>
    </FormShell>
  );
}

function SceneForm(props: { moduleId: string; entry: StructuredModuleEntry | null; returnTo: string; assets: Readonly<Record<string, string>> }) {
  const data = props.entry?.data ?? {};
  const background = textOf(data, "background");
  return (
    <FormShell moduleId={props.moduleId} kind="scene" entityId={props.entry?.id ?? ""} returnTo={props.returnTo}>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className={labelClass}><span className={captionClass}>场景名</span><input name="name" defaultValue={textOf(data, "name", props.entry?.title ?? "")} className={inputClass} /></label>
        <label className={labelClass}><span className={captionClass}>宽度</span><input name="width" type="number" defaultValue={numberOf(data, "width", 1600)} className={inputClass} /></label>
        <label className={labelClass}><span className={captionClass}>高度</span><input name="height" type="number" defaultValue={numberOf(data, "height", 1000)} className={inputClass} /></label>
        <label className={labelClass}><span className={captionClass}>网格大小</span><input name="gridSize" type="number" defaultValue={numberOf(data, "gridSize", 70)} className={inputClass} /></label>
        <label className={labelClass}><span className={captionClass}>网格类型</span><select name="gridType" defaultValue={textOf(data, "gridType", "SQUARE")} className={inputClass}>{["SQUARE", "HEX", "NONE"].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label className={labelClass}><span className={captionClass}>背景色</span><input name="bgColor" defaultValue={textOf(data, "bgColor", "#1a1a2e")} className={inputClass} /></label>
        <label className="flex items-center gap-2 text-[11px] text-white/55"><input type="checkbox" name="showGrid" value="1" defaultChecked={boolOf(data, "showGrid", true)} />显示网格</label>
        <label className="flex items-center gap-2 text-[11px] text-white/55"><input type="checkbox" name="showFog" value="1" defaultChecked={boolOf(data, "showFog", false)} />启用迷雾</label>
      </div>
      <label className={labelClass}><span className={captionClass}>场景描述</span><textarea name="description" rows={2} defaultValue={textOf(data, "description")} className={inputClass} /></label>
      <label className={labelClass}><span className={captionClass}>旁白</span><textarea name="narration" rows={2} defaultValue={textOf(data, "narration")} className={inputClass} /></label>
      <ModuleAssetUpload moduleId={props.moduleId} name="background" kind="MAP" label="场景地图 / 背景（可上传）" currentPath={background.length > 0 ? background : null} currentUrl={assetUrl(props.assets, background)} />
    </FormShell>
  );
}

function DeleteForm(props: { moduleId: string; kind: string; entityId: string; label: string; returnTo: string }) {
  return (
    <form action={deleteModuleEntityAction} className="ml-auto">
      <input type="hidden" name="moduleId" value={props.moduleId} />
      <input type="hidden" name="kind" value={props.kind} />
      <input type="hidden" name="entityId" value={props.entityId} />
      <input type="hidden" name="returnTo" value={props.returnTo} />
      <button type="submit" className="rounded border border-red-400/30 px-2 py-1 text-[11px] text-red-300 transition hover:bg-red-400/10">
        删除{props.label}
      </button>
    </form>
  );
}

function Section(props: {
  readonly title: string;
  readonly count: number;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
      <h2 className="text-sm font-medium text-white/80">{props.title}（{props.count}）</h2>
      <div className="mt-3 flex flex-col gap-3">{props.children}</div>
    </section>
  );
}

export default function ModuleEntityEditors({ moduleId, content, assets, returnTo }: Props) {
  const structured = structuredOfContent(content);
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-spirit-400/30 bg-spirit-400/5 p-4">
        <h2 className="text-sm font-medium text-spirit-300">结构化内容编辑</h2>
        <p className="mt-1 text-[11px] text-white/40">
          直接编辑角色 / 物品 / 线索 / 场景。保存后会同步写入标准 Markdown 的结构化块与只读模板，应用团本预设时生效。
        </p>
      </div>

      <Section title="NPC / 角色" count={structured.npcs.length}>
        {structured.npcs.map((entry) => (
          <details key={entry.id} className="rounded-lg border border-white/10 bg-ink-900/50 p-3" open={structured.npcs.length <= 3}>
            <summary className="flex cursor-pointer items-center gap-2 text-sm text-white/75">
              <span className="flex-1">{entry.title}</span>
              <DeleteForm moduleId={moduleId} kind="npc" entityId={entry.id} label="角色" returnTo={returnTo} />
            </summary>
            <NpcForm moduleId={moduleId} entry={entry} returnTo={returnTo} assets={assets} />
          </details>
        ))}
        <details className="rounded-lg border border-dashed border-white/15 bg-ink-900/40 p-3">
          <summary className="cursor-pointer text-xs text-spirit-300">+ 新增 NPC / 角色</summary>
          <NpcForm moduleId={moduleId} entry={null} returnTo={returnTo} assets={assets} />
        </details>
      </Section>

      <Section title="物品 / 武器 / 证物" count={structured.items.length}>
        {structured.items.map((entry) => (
          <details key={entry.id} className="rounded-lg border border-white/10 bg-ink-900/50 p-3">
            <summary className="flex cursor-pointer items-center gap-2 text-sm text-white/75">
              <span className="flex-1">{entry.title}</span>
              <DeleteForm moduleId={moduleId} kind="item" entityId={entry.id} label="物品" returnTo={returnTo} />
            </summary>
            <ItemForm moduleId={moduleId} entry={entry} returnTo={returnTo} assets={assets} />
          </details>
        ))}
        <details className="rounded-lg border border-dashed border-white/15 bg-ink-900/40 p-3">
          <summary className="cursor-pointer text-xs text-spirit-300">+ 新增物品 / 证物</summary>
          <ItemForm moduleId={moduleId} entry={null} returnTo={returnTo} assets={assets} />
        </details>
      </Section>

      <Section title="线索 / 手书" count={structured.clues.length}>
        {structured.clues.map((entry) => (
          <details key={entry.id} className="rounded-lg border border-white/10 bg-ink-900/50 p-3">
            <summary className="flex cursor-pointer items-center gap-2 text-sm text-white/75">
              <span className="flex-1">{entry.title}</span>
              <DeleteForm moduleId={moduleId} kind="clue" entityId={entry.id} label="线索" returnTo={returnTo} />
            </summary>
            <ClueForm moduleId={moduleId} entry={entry} returnTo={returnTo} assets={assets} />
          </details>
        ))}
        <details className="rounded-lg border border-dashed border-white/15 bg-ink-900/40 p-3">
          <summary className="cursor-pointer text-xs text-spirit-300">+ 新增线索</summary>
          <ClueForm moduleId={moduleId} entry={null} returnTo={returnTo} assets={assets} />
        </details>
      </Section>

      <Section title="场景 / 地图" count={structured.scenes.length}>
        {structured.scenes.map((entry) => (
          <details key={entry.id} className="rounded-lg border border-white/10 bg-ink-900/50 p-3">
            <summary className="flex cursor-pointer items-center gap-2 text-sm text-white/75">
              <span className="flex-1">{entry.title}</span>
              <DeleteForm moduleId={moduleId} kind="scene" entityId={entry.id} label="场景" returnTo={returnTo} />
            </summary>
            <SceneForm moduleId={moduleId} entry={entry} returnTo={returnTo} assets={assets} />
          </details>
        ))}
        <details className="rounded-lg border border-dashed border-white/15 bg-ink-900/40 p-3">
          <summary className="cursor-pointer text-xs text-spirit-300">+ 新增场景</summary>
          <SceneForm moduleId={moduleId} entry={null} returnTo={returnTo} assets={assets} />
        </details>
      </Section>
    </div>
  );
}
