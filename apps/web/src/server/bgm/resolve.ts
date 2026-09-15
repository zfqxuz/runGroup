import {
  createRoomBgmView,
  parseBgmLink,
  QQ_SHORT_PREFIX,
  type BgmKind,
  type RoomBgmView
} from "@/shared/bgm";

export type BgmResolveResult =
  | { readonly ok: true; readonly value: RoomBgmView }
  | { readonly ok: false; readonly error: string };

const FETCH_TIMEOUT_MS = 4500;
const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";

function recordOf(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function arrayOf(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function positiveNumericId(value: string): string | null {
  if (/^\d{1,20}$/.test(value) === false) return null;
  const numeric = Number(value);
  if (Number.isSafeInteger(numeric) === false || numeric <= 0) return null;
  return String(numeric);
}

function textOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length === 0 ? null : text;
}

function joinNames(value: unknown): string | null {
  const names = arrayOf(value)
    .map((item) => textOf(recordOf(item).name))
    .filter((item): item is string => item !== null);
  return names.length === 0 ? null : names.join(" / ");
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "User-Agent": DESKTOP_UA,
        ...(init?.headers ?? {})
      }
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown | null> {
  const response = await fetchWithTimeout(url, init);
  if (response === null || response.ok === false) return null;
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

interface TrackMeta {
  readonly title: string | null;
  readonly artist: string | null;
}

async function neteaseMeta(kind: BgmKind, id: string): Promise<TrackMeta | null> {
  if (kind === "SONG") {
    const json = await fetchJson(
      "https://music.163.com/api/song/detail/?ids=" + encodeURIComponent(JSON.stringify([id])),
      { headers: { Referer: "https://music.163.com/" } }
    );
    const song = recordOf(arrayOf(recordOf(json).songs)[0]);
    const title = textOf(song.name);
    const artist = joinNames(song.artists);
    return title === null && artist === null ? null : { title, artist };
  }

  if (kind === "ALBUM") {
    const json = await fetchJson("https://music.163.com/api/album/" + encodeURIComponent(id), {
      headers: { Referer: "https://music.163.com/" }
    });
    const album = recordOf(recordOf(json).album);
    const title = textOf(album.name);
    const artist = joinNames(album.artists);
    return title === null && artist === null ? null : { title, artist };
  }

  const json = await fetchJson("https://music.163.com/api/playlist/detail?id=" + encodeURIComponent(id), {
    headers: { Referer: "https://music.163.com/" }
  });
  const playlist = recordOf(recordOf(json).playlist);
  const title = textOf(playlist.name);
  const creator = recordOf(playlist.creator);
  const artist = textOf(creator.nickname);
  return title === null && artist === null ? null : { title, artist };
}

interface QqMusicuResult {
  readonly code?: unknown;
  readonly data?: unknown;
}

async function qqMusicu(name: string, module: string, method: string, param: unknown): Promise<unknown | null> {
  const payload = {
    comm: { ct: 24, cv: 0 },
    [name]: { module, method, param }
  };
  const json = recordOf(
    await fetchJson(
      "https://u.y.qq.com/cgi-bin/musicu.fcg?format=json&data=" + encodeURIComponent(JSON.stringify(payload)),
      { headers: { Referer: "https://y.qq.com/" } }
    )
  );
  const result = recordOf(json[name]) as QqMusicuResult;
  if (result.code !== 0) return null;
  return result.data ?? null;
}

interface QqSongMeta {
  readonly id: string;
  readonly mid: string | null;
  readonly title: string | null;
  readonly artist: string | null;
}

function qqSongFromTrack(value: unknown): QqSongMeta | null {
  const track = recordOf(value);
  const id =
    typeof track.id === "number" && Number.isFinite(track.id) && track.id > 0
      ? String(Math.trunc(track.id))
      : textOf(track.id);
  if (id === null || id === "0") return null;
  return {
    id,
    mid: textOf(track.mid),
    title: textOf(track.name) ?? textOf(track.title),
    artist: joinNames(track.singer)
  };
}

async function qqSongByMid(mid: string): Promise<QqSongMeta | null> {
  const data = recordOf(
    await qqMusicu("songinfo", "music.pf_song_detail_svr", "get_song_detail_yqq", {
      song_type: 0,
      song_mid: mid
    })
  );
  return qqSongFromTrack(data.track_info);
}

async function qqSongById(id: string): Promise<QqSongMeta | null> {
  const canonical = positiveNumericId(id);
  if (canonical === null) return null;
  const numeric = Number(canonical);
  const data = recordOf(
    await qqMusicu("trackinfo", "track_info.UniformRuleCtrlServer", "GetTrackInfo", {
      ids: [numeric],
      types: [0],
      singer_pmid: 1
    })
  );
  return qqSongFromTrack(arrayOf(data.tracks)[0]);
}

async function qqShortToLong(shortTag: string): Promise<string | null> {
  const shortUrl = "https://c.y.qq.com/base/fcgi-bin/u?__=" + encodeURIComponent(shortTag);
  const data = recordOf(
    await qqMusicu("shorturl", "music.shortUrl.sUrl", "ShortToLong", { shortUrl })
  );
  return textOf(data.longUrl);
}

async function resolveNeteaseShort(input: string): Promise<string | null> {
  const response = await fetchWithTimeout(input, { redirect: "follow" });
  if (response === null) return null;
  if (parseBgmLink(response.url).ok) return response.url;

  const html = await response.text().catch(() => "");
  const patterns = [
    /https?:\/\/music[.]163[.]com\/#?\/(song|album|playlist)[^"'<>\\s]*[?&]id=(\d{1,20})/i,
    /(song|album|playlist)[^"'<>\s]{0,80}?[?&]id=(\d{1,20})/i
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    const kind = match?.[1]?.toLowerCase();
    const id = match?.[2];
    if (kind !== undefined && id !== undefined) {
      return "https://music.163.com/" + kind + "?id=" + id;
    }
  }
  return null;
}

async function resolveNetease(kind: BgmKind, id: string): Promise<BgmResolveResult> {
  const meta = await neteaseMeta(kind, id).catch(() => null);
  const view = createRoomBgmView({
    provider: "NETEASE",
    kind,
    id,
    title: meta?.title ?? null,
    artist: meta?.artist ?? null
  });
  if (view === null) return { ok: false, error: "无法构造网易云音乐播放器地址" };
  return { ok: true, value: view };
}

async function resolveQqSongValue(id: string): Promise<BgmResolveResult> {
  const canonicalId = positiveNumericId(id);
  if (canonicalId !== null) {
    const meta = await qqSongById(canonicalId).catch(() => null);
    const view = createRoomBgmView({
      provider: "QQ",
      kind: "SONG",
      id: meta?.id ?? canonicalId,
      qqMid: meta?.mid ?? null,
      title: meta?.title ?? null,
      artist: meta?.artist ?? null
    });
    return view === null ? { ok: false, error: "无法构造 QQ 音乐播放器地址" } : { ok: true, value: view };
  }

  const meta = await qqSongByMid(id).catch(() => null);
  if (meta === null) {
    return { ok: false, error: "无法解析 QQ 音乐单曲，请确认链接是否有效" };
  }
  const view = createRoomBgmView({
    provider: "QQ",
    kind: "SONG",
    id: meta.id,
    qqMid: meta.mid,
    title: meta.title,
    artist: meta.artist
  });
  return view === null ? { ok: false, error: "无法构造 QQ 音乐播放器地址" } : { ok: true, value: view };
}

async function resolveQqShort(shortTag: string): Promise<BgmResolveResult> {
  const longUrl = await qqShortToLong(shortTag).catch(() => null);
  if (longUrl !== null) {
    const parsed = parseBgmLink(longUrl);
    if (parsed.ok && parsed.value.provider === "QQ" && parsed.value.kind === "SONG") {
      const resolved = await resolveQqSongValue(parsed.value.id);
      if (resolved.ok) return resolved;
    }
  }

  // 短链解析接口失败时仍交给 QQ 官方外链播放器自己解析 shorttag。
  const fallback = createRoomBgmView({
    provider: "QQ",
    kind: "SONG",
    id: QQ_SHORT_PREFIX + shortTag,
    title: null,
    artist: null
  });
  return fallback === null
    ? { ok: false, error: "QQ 音乐短链格式不正确" }
    : { ok: true, value: fallback };
}

/**
 * 把用户粘贴的网易云 / QQ 音乐链接解析成房间 BGM。
 * 支持常见完整链接和 App 分享短链；不支持的链接会返回可直接展示的错误文案。
 */
export async function resolveBgmLink(raw: string): Promise<BgmResolveResult> {
  const input = raw.trim().slice(0, 1200);
  if (input.length === 0) return { ok: false, error: "请输入音乐链接" };

  const parsed = parseBgmLink(input);
  if (parsed.ok) {
    if (parsed.value.provider === "NETEASE") {
      return resolveNetease(parsed.value.kind, parsed.value.id);
    }
    if (parsed.value.kind !== "SONG") {
      return { ok: false, error: "QQ 音乐外链播放器目前只支持单曲链接" };
    }
    if (parsed.value.shortTag !== null) return resolveQqShort(parsed.value.shortTag);
    return resolveQqSongValue(parsed.value.id);
  }

  let host: string | null = null;
  try {
    host = new URL(input).hostname.toLowerCase();
  } catch {
    host = null;
  }
  if (host === "163cn.tv" || host?.endsWith(".163cn.tv") === true) {
    const longUrl = await resolveNeteaseShort(input);
    if (longUrl === null) return { ok: false, error: "网易云短链解析失败，请改用完整链接" };
    const resolved = parseBgmLink(longUrl);
    if (resolved.ok && resolved.value.provider === "NETEASE") {
      return resolveNetease(resolved.value.kind, resolved.value.id);
    }
    return { ok: false, error: "网易云短链解析失败，请改用完整链接" };
  }

  return { ok: false, error: parsed.error };
}
