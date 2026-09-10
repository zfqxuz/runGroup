import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { uploadRoot } from "@/server/assets/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Q = String.fromCharCode(39);

/** 用 string 拼接避免在源码里出现单引号，CSP 要求 none 必须带引号。 */
const IMAGE_CSP = "default-src " + Q + "none" + Q + "; sandbox";

const SAFE_SEGMENT = /^[a-z0-9_-]+$/i;
const SAFE_FILENAME = /^[a-z0-9_-]+[.]png$/i;

export async function GET(
  _request: Request,
  context: { params: { path: string[] } }
): Promise<NextResponse> {
  const segments = context.params.path;
  if (segments.length !== 2) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const category = segments[0] as string;
  const filename = segments[1] as string;
  if (SAFE_SEGMENT.test(category) === false || SAFE_FILENAME.test(filename) === false) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const root = path.resolve(uploadRoot());
  const target = path.resolve(root, category, filename);
  // 目录穿越防护：解析后必须仍在上传根目录内
  if (target.startsWith(root + path.sep) === false) {
    return new NextResponse("Not Found", { status: 404 });
  }

  try {
    const info = await stat(target);
    if (info.isFile() === false) {
      return new NextResponse("Not Found", { status: 404 });
    }
    const data = await readFile(target);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": IMAGE_CSP
      }
    });
  } catch {
    return new NextResponse("Not Found", { status: 404 });
  }
}
