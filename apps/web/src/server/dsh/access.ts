import { prisma } from "@/server/db/prisma";

export const MODULE_DSH_SETTING_KEY = "ai.moduleDsh.whitelist";

export interface ModuleDshSetting {
  readonly enabled: boolean;
  readonly entries: readonly string[];
}

export function parseModuleDshSetting(value: unknown): ModuleDshSetting {
  if (Array.isArray(value)) {
    return { enabled: true, entries: value.filter((item): item is string => typeof item === "string") };
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Array.isArray(record.entries)
      ? record.entries.filter((item): item is string => typeof item === "string")
      : [];
    return { enabled: record.enabled === true, entries };
  }
  return { enabled: false, entries: [] };
}

export async function getModuleDshSetting(): Promise<ModuleDshSetting> {
  const row = await prisma.systemSetting.findUnique({
    where: { key: MODULE_DSH_SETTING_KEY },
    select: { value: true }
  });
  return parseModuleDshSetting(row?.value ?? null);
}

export interface DshUserLike {
  readonly id: string;
  readonly username: string;
}

/** 白名单同时支持用户 id 和用户名，大小写不敏感。 */
export function isUserInModuleDshWhitelist(user: DshUserLike, setting: ModuleDshSetting): boolean {
  if (setting.enabled === false) return false;
  const id = user.id.trim().toLowerCase();
  const username = user.username.trim().toLowerCase();
  return setting.entries.some((entry) => {
    const value = entry.trim().toLowerCase();
    return value.length > 0 && (value === id || value === username);
  });
}
