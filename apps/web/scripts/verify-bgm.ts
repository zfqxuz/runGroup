import {
  bgmToCustomRecord,
  createRoomBgmView,
  parseBgmLink,
  readRoomBgm
} from "@/shared/bgm";

let failed = 0;

function check(condition: boolean, label: string): void {
  if (condition) {
    console.log("PASS " + label);
  } else {
    failed += 1;
    console.error("FAIL " + label);
  }
}

function parsedCase(url: string, provider: string, kind: string, id: string): void {
  const result = parseBgmLink(url);
  check(
    result.ok && result.value.provider === provider && result.value.kind === kind && result.value.id === id,
    "parse " + url
  );
}

parsedCase("https://music.163.com/#/song?id=26092893", "NETEASE", "SONG", "26092893");
parsedCase("https://y.music.163.com/m/song?id=26092893", "NETEASE", "SONG", "26092893");
parsedCase("https://music.163.com/#/playlist?id=3778678", "NETEASE", "PLAYLIST", "3778678");
parsedCase("https://y.qq.com/n/ryqq/songDetail/0039MnYb0qxYhV", "QQ", "SONG", "0039MnYb0qxYhV");
parsedCase("https://i.y.qq.com/n2/m/share/details/song.html?songid=97773", "QQ", "SONG", "97773");
parsedCase("https://c6.y.qq.com/base/fcgi-bin/u?__=abcd1234", "QQ", "SONG", "short:abcd1234");

const rejected = parseBgmLink("https://example.com/song?id=1");
check(rejected.ok === false, "reject non-music host");

const view = createRoomBgmView({ provider: "NETEASE", kind: "SONG", id: "26092893", title: "Coin seller", artist: "Nell" });
check(view !== null && view.embedUrl.includes("music.163.com/outchain/player"), "build netease embed");
if (view !== null) {
  const restored = readRoomBgm({ bgm: bgmToCustomRecord(view) });
  check(restored?.embedUrl === view.embedUrl && restored.title === "Coin seller", "round trip custom");
}
check(readRoomBgm({ bgm: { provider: "QQ", kind: "SONG", id: "evil" } }) === null, "reject malformed qq id");
check(readRoomBgm({ bgm: { provider: "NETEASE", kind: "SONG", id: "../../etc/passwd" } }) === null, "reject path-like id");

async function runNetworkChecks(): Promise<void> {
  const { resolveBgmLink } = await import("@/server/bgm/resolve");
  const netease = await resolveBgmLink("https://music.163.com/#/song?id=26092893");
  check(netease.ok && netease.value.title === "Coin seller", "resolve netease metadata");
  const qq = await resolveBgmLink("https://y.qq.com/n/ryqq/songDetail/0039MnYb0qxYhV");
  check(qq.ok && qq.value.id === "97773" && qq.value.title === "晴天", "resolve qq metadata");
}

void (async () => {
  if (process.env.BGM_NETWORK_TEST === "1") await runNetworkChecks();

  if (failed > 0) {
    console.error("verify-bgm: " + failed + " failure(s)");
    process.exitCode = 1;
  } else {
    console.log("verify-bgm: all offline checks passed");
  }
})();

