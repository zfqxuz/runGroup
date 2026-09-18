/**
 * 房间 BGM：网易云音乐 / QQ 音乐链接解析与官方外链播放器地址构造。
 *
 * 该文件必须保持纯函数、可供客户端与服务端同时引用；不要在这里发起网络请求。
 * 需要联网把 QQ songmid 解析成官方播放器要求的数字 songid 的逻辑在
 * server/bgm/resolve.ts。
 */

export type BgmProvider = "NETEASE" | "QQ";
export type BgmKind = "SONG" | "ALBUM" | "PLAYLIST";

export const QQ_SHORT_PREFIX = "short:";

export interface ParsedBgmLink {
  readonly provider: BgmProvider;
  readonly kind: BgmKind;
  /** 网易云为数字 id；QQ 为 songmid / 数字 songid / short:短链 tag。 */
  readonly id: string;
  /** QQ App 分享短链的 __ 参数；长链为 null。 */
  readonly shortTag: string | null;
}

export type ParseBgmResult =
  | { readonly ok: true; readonly value: ParsedBgmLink }
  | { readonly ok: false; readonly error: string };

export interface RoomBgmView {
  readonly provider: BgmProvider;
  readonly kind: BgmKind;
  readonly id: string;
  /** QQ 音乐 songmid，仅用于「打开原链接」，播放仍使用数字 songid。 */
  readonly qqMid: string | null;
  readonly title: string | null;
  readonly artist: string | null;
  readonly embedUrl: string;
  readonly pageUrl: string;
}

const NETEASE_ID_PATTERN = /^\d{1,20}$/;
const QQ_NUMERIC_PATTERN = /^[1-9]\d{0,19}$/;
const QQ_MID_PATTERN = /^[A-Za-z0-9]{6,40}$/;
const QQ_SHORT_TAG_PATTERN = /^[A-Za-z0-9_-]{2,80}$/;
const TEXT_LIMIT = 160;

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function cleanText(value: unknown, maxLength = TEXT_LIMIT): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/\s+/g, " ");
  if (text.length === 0) return null;
  return text.slice(0, maxLength);
}

function parseUrl(raw: string): URL | null {
  const value = raw.trim();
  if (value.length === 0 || value.length > 1200) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    try {
      const url = new URL("https://" + value);
      return url.protocol === "https:" ? url : null;
    } catch {
      return null;
    }
  }
}

function hashParams(url: URL): URLSearchParams {
  const index = url.hash.indexOf("?");
  if (index < 0) return new URLSearchParams();
  return new URLSearchParams(url.hash.slice(index + 1));
}

function kindFromText(value: string): BgmKind | null {
  const text = value.toLowerCase();
  if (text.includes("playlist")) return "PLAYLIST";
  if (text.includes("album")) return "ALBUM";
  if (text.includes("song")) return "SONG";
  return null;
}

function parseNetease(url: URL): ParseBgmResult {
  const hash = hashParams(url);
  const search = url.searchParams;
  const kind =
    kindFromText(url.pathname + " " + url.hash) ??
    (search.get("id") !== null || hash.get("id") !== null ? "SONG" : null);
  if (kind === null) return { ok: false, error: "无法识别该音乐链接" };

  const pathMatch = /(?:song|album|playlist)\/(\d{1,20})/i.exec(url.pathname);
  const id = (search.get("id") ?? hash.get("id") ?? pathMatch?.[1] ?? "").trim();
  if (NETEASE_ID_PATTERN.test(id) === false) {
    return { ok: false, error: "链接中没有找到歌曲信息" };
  }
  return { ok: true, value: { provider: "NETEASE", kind, id, shortTag: null } };
}

function parseQq(url: URL): ParseBgmResult {
  const search = url.searchParams;
  const shortTag = (search.get("__") ?? search.get("shorttag") ?? "").trim();
  if (shortTag.length > 0 && QQ_SHORT_TAG_PATTERN.test(shortTag)) {
    return {
      ok: true,
      value: { provider: "QQ", kind: "SONG", id: QQ_SHORT_PREFIX + shortTag, shortTag }
    };
  }

  const path = url.pathname;
  const songMatch = /songdetail\/([A-Za-z0-9]{6,40})/i.exec(path);
  if (songMatch?.[1] !== undefined) {
    return { ok: true, value: { provider: "QQ", kind: "SONG", id: songMatch[1], shortTag: null } };
  }

  const playlistMatch = /playlist\/([A-Za-z0-9]{1,40})/i.exec(path);
  if (playlistMatch?.[1] !== undefined) {
    return { ok: true, value: { provider: "QQ", kind: "PLAYLIST", id: playlistMatch[1], shortTag: null } };
  }

  const albumMatch = /albumdetail\/([A-Za-z0-9]{6,40})/i.exec(path);
  if (albumMatch?.[1] !== undefined) {
    return { ok: true, value: { provider: "QQ", kind: "ALBUM", id: albumMatch[1], shortTag: null } };
  }

  const queryId = (search.get("songmid") ?? search.get("songid") ?? "").trim();
  if (queryId.length > 0) {
    const valid = search.get("songmid") !== null ? QQ_MID_PATTERN.test(queryId) : QQ_MID_PATTERN.test(queryId) || QQ_NUMERIC_PATTERN.test(queryId);
    if (valid === false) return { ok: false, error: "QQ 音乐歌曲链接不正确" };
    return { ok: true, value: { provider: "QQ", kind: "SONG", id: queryId, shortTag: null } };
  }

  return { ok: false, error: "暂时无法识别该 QQ 音乐链接" };
}

/** 纯解析：只负责从链接中提取 provider / kind / id，不联网。 */
export function parseBgmLink(raw: string): ParseBgmResult {
  const url = parseUrl(raw);
  if (url === null) return { ok: false, error: "链接格式不正确" };

  const host = url.hostname.toLowerCase().replace(/^www[.]/, "");
  if (host === "music.163.com" || host.endsWith(".music.163.com")) {
    return parseNetease(url);
  }
  if (host === "y.qq.com" || host.endsWith(".y.qq.com")) {
    return parseQq(url);
  }
  return { ok: false, error: "只支持网易云音乐或 QQ 音乐链接" };
}

function neteasePlayerType(kind: BgmKind): number {
  if (kind === "SONG") return 2;
  if (kind === "ALBUM") return 1;
  return 0;
}

/** 由可信字段重建官方播放器 iframe 地址，不直接使用用户提供的 URL。 */
export function createRoomBgmView(input: {
  readonly provider: BgmProvider;
  readonly kind: BgmKind;
  readonly id: string;
  readonly qqMid?: string | null;
  readonly title?: string | null;
  readonly artist?: string | null;
}): RoomBgmView | null {
  const title = cleanText(input.title) ?? null;
  const artist = cleanText(input.artist) ?? null;
  const qqMid =
    typeof input.qqMid === "string" && QQ_MID_PATTERN.test(input.qqMid) ? input.qqMid : null;

  if (input.provider === "NETEASE") {
    if (NETEASE_ID_PATTERN.test(input.id) === false) return null;
    const type = neteasePlayerType(input.kind);
    const path = input.kind === "SONG" ? "song" : input.kind === "ALBUM" ? "album" : "playlist";
    return {
      provider: "NETEASE",
      kind: input.kind,
      id: input.id,
      qqMid: null,
      title,
      artist,
      embedUrl: "https://music.163.com/outchain/player?type=" + type + "&id=" + encodeURIComponent(input.id) + "&auto=1&height=66",
      pageUrl: "https://music.163.com/#/" + path + "?id=" + encodeURIComponent(input.id)
    };
  }

  if (input.kind !== "SONG") return null;

  if (input.id.startsWith(QQ_SHORT_PREFIX)) {
    const tag = input.id.slice(QQ_SHORT_PREFIX.length);
    if (QQ_SHORT_TAG_PATTERN.test(tag) === false) return null;
    return {
      provider: "QQ",
      kind: "SONG",
      id: input.id,
      qqMid: null,
      title,
      artist,
      embedUrl: "https://i.y.qq.com/n2/m/outchain/player/index.html?shorttag=" + encodeURIComponent(tag),
      pageUrl: "https://c.y.qq.com/base/fcgi-bin/u?__=" + encodeURIComponent(tag)
    };
  }

  if (QQ_NUMERIC_PATTERN.test(input.id) === false) return null;
  return {
    provider: "QQ",
    kind: "SONG",
    id: input.id,
    qqMid,
    title,
    artist,
    embedUrl: "https://i.y.qq.com/n2/m/outchain/player/index.html?songid=" + encodeURIComponent(input.id) + "&songtype=0",
    pageUrl: "https://y.qq.com/n/ryqq/songDetail/" + encodeURIComponent(qqMid ?? input.id)
  };
}

/** 从 GameState.custom 中读取 BGM。所有 URL 都由 provider/kind/id 重建，不信任 JSON 里的 URL 字段。 */
export function readRoomBgm(custom: unknown): RoomBgmView | null {
  const stored = asRecord(asRecord(custom).bgm);
  const provider = stored.provider === "NETEASE" || stored.provider === "QQ" ? stored.provider : null;
  const kind = stored.kind === "SONG" || stored.kind === "ALBUM" || stored.kind === "PLAYLIST" ? stored.kind : null;
  const id = typeof stored.id === "string" ? stored.id.slice(0, 100) : "";
  const qqMid = typeof stored.qqMid === "string" ? stored.qqMid : null;
  const title = typeof stored.title === "string" ? stored.title : null;
  const artist = typeof stored.artist === "string" ? stored.artist : null;
  if (provider === null || kind === null || id.length === 0) return null;
  return createRoomBgmView({ provider, kind, id, qqMid, title, artist });
}

/** 写入 GameState.custom 的精简记录：不存 URL，读取时重建。 */
export function bgmToCustomRecord(bgm: RoomBgmView): Record<string, unknown> {
  return {
    provider: bgm.provider,
    kind: bgm.kind,
    id: bgm.id,
    qqMid: bgm.qqMid,
    title: bgm.title,
    artist: bgm.artist
  };
}

export function bgmProviderLabel(provider: BgmProvider): string {
  return provider === "NETEASE" ? "网易云音乐" : "QQ 音乐";
}

export function bgmKindLabel(kind: BgmKind): string {
  if (kind === "SONG") return "单曲";
  if (kind === "ALBUM") return "专辑";
  return "歌单";
}

export function bgmDisplayTitle(bgm: RoomBgmView): string {
  if (bgm.title === null || bgm.title.length === 0) {
    return bgmProviderLabel(bgm.provider) + bgmKindLabel(bgm.kind);
  }
  if (bgm.artist === null || bgm.artist.length === 0) return bgm.title;
  return bgm.title + " - " + bgm.artist;
}
