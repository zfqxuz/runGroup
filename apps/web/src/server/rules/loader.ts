import { createHash } from "node:crypto";
import {
  builtinRegistry,
  compileParsedRulePack,
  deepMerge,
  resolveRulePack,
  RulePackSchema,
  type CompiledRulePack,
  type RulePack
} from "@touhou/rules";
import { prisma } from "@/server/db/prisma";

const BUILTIN_BY_SYSTEM: Record<string, string> = {
  COC7: "coc7-baseline",
  TOUHOU: "touhou-ext"
};

/**
 * 编译结果缓存。
 *
 * 公式的 tokenize → parse → 白名单校验是毫秒级的，
 * 但战斗里每人每帧都要求值，绝不能现读现编译 —— 必须按内容哈希缓存编译产物。
 */
const compiledCache = new Map<string, CompiledRulePack>();

export interface RoomPackSource {
  readonly id: string;
  readonly system: string;
  readonly rulePackVersionId: string | null;
  readonly ruleOverride: unknown;
}

export interface EffectivePack {
  readonly compiled: CompiledRulePack;
  readonly source: "builtin" | "database";
  readonly checksum: string;
  readonly hasRoomOverride: boolean;
}

function checksumOf(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

async function loadBasePack(
  room: RoomPackSource
): Promise<{ pack: RulePack; source: "builtin" | "database" }> {
  if (room.rulePackVersionId !== null) {
    const version = await prisma.rulePackVersion.findUnique({
      where: { id: room.rulePackVersionId },
      include: { pack: { select: { slug: true } } }
    });

    if (version !== null) {
      const registry = builtinRegistry();
      const parsed = RulePackSchema.safeParse(version.config);
      if (parsed.success) {
        // 从库里读出来的包同样要沿 extends 链解析，才能拿到完整配置
        const merged = resolveRulePack(version.pack.slug, {
          ...registry,
          [version.pack.slug]: version.config as never
        });
        return { pack: merged, source: "database" };
      }
      // 库里配置非法就拒绝加载，不静默兜底 —— 否则线上会带着坏配置跑
      throw new Error(
        "RulePackVersion " + version.id + " 配置非法：" +
          (parsed.error.issues[0]?.message ?? "未知错误")
      );
    }
  }

  const builtinId = BUILTIN_BY_SYSTEM[room.system] ?? "coc7-baseline";
  return { pack: resolveRulePack(builtinId, builtinRegistry()), source: "builtin" };
}

/**
 * 解析出房间实际生效的规则包：
 *   DB 版本（若已绑定） > 内置包 > 深合并 Room.ruleOverride > 编译并缓存
 */
export async function loadEffectivePack(room: RoomPackSource): Promise<EffectivePack> {
  const base = await loadBasePack(room);

  const override = isPlainObject(room.ruleOverride) ? room.ruleOverride : {};
  const hasRoomOverride = Object.keys(override).length > 0;

  const effectiveRaw = hasRoomOverride ? deepMerge(base.pack, override) : base.pack;
  const parsed = RulePackSchema.safeParse(effectiveRaw);
  if (parsed.success === false) {
    throw new Error(
      "房间 " + room.id + " 的规则覆盖非法：" + (parsed.error.issues[0]?.message ?? "未知错误")
    );
  }

  const checksum = checksumOf(parsed.data);
  const cached = compiledCache.get(checksum);
  if (cached !== undefined) {
    return { compiled: cached, source: base.source, checksum, hasRoomOverride };
  }

  const compiled = compileParsedRulePack(parsed.data);
  compiledCache.set(checksum, compiled);
  return { compiled, source: base.source, checksum, hasRoomOverride };
}

export function clearPackCache(): void {
  compiledCache.clear();
}
