import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

/**
 * 上传根目录。
 *
 * 刻意不放在 public/ 下：同源托管用户上传的文件，
 * 等于给自己开了一个 XSS 与存储滥用的口子。
 * 真实文件只能经由 /api/assets/[...path] 读取，那里会带安全响应头。
 */
export function uploadRoot(): string {
  return process.env.UPLOAD_DIR ?? path.join(process.cwd(), "uploads");
}

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

interface Signature {
  readonly mime: string;
  readonly ext: string;
  readonly check: (buffer: Buffer) => boolean;
}

const SIGNATURES: readonly Signature[] = [
  {
    mime: "image/png",
    ext: "png",
    check: (buffer) =>
      buffer.length > 8 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
  },
  {
    mime: "image/jpeg",
    ext: "jpg",
    check: (buffer) =>
      buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  },
  {
    mime: "image/webp",
    ext: "webp",
    check: (buffer) =>
      buffer.length > 12 &&
      buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
      buffer.subarray(8, 12).toString("ascii") === "WEBP"
  }
];

/** 只认 magic bytes —— 不信 Content-Type，也不信文件名后缀。 */
export function detectImage(buffer: Buffer): { mime: string; ext: string } | null {
  for (const signature of SIGNATURES) {
    if (signature.check(buffer)) return { mime: signature.mime, ext: signature.ext };
  }
  return null;
}

export interface StoredImage {
  readonly filename: string;
  readonly thumbnailName: string;
  readonly mime: string;
  readonly size: number;
  readonly width: number;
  readonly height: number;
  readonly checksum: string;
}

export interface StoreOptions {
  readonly category: string;
  readonly maxDimension?: number;
  readonly thumbDimension?: number;
  readonly maxBytes?: number;
}

export async function storeImage(buffer: Buffer, options: StoreOptions): Promise<StoredImage> {
  const maxBytes = options.maxBytes ?? MAX_UPLOAD_BYTES;
  if (buffer.byteLength > maxBytes) {
    throw new Error("文件超过 " + Math.floor(maxBytes / 1024 / 1024) + " MB 上限");
  }

  if (detectImage(buffer) === null) {
    throw new Error("只接受 PNG / JPEG / WebP 图片");
  }

  const maxDimension = options.maxDimension ?? 2048;
  const thumbDimension = options.thumbDimension ?? 384;

  // 用 sharp 重新编码：统一成 PNG，同时剥掉 EXIF 与任何塞进图片里的载荷
  const normalized = await sharp(buffer, { limitInputPixels: 4096 * 4096 })
    .rotate()
    .resize({ width: maxDimension, height: maxDimension, fit: "inside", withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer({ resolveWithObject: true });

  const thumbnail = await sharp(normalized.data)
    .resize({ width: thumbDimension, height: thumbDimension, fit: "cover" })
    .png({ compressionLevel: 9 })
    .toBuffer();

  const id = randomUUID();
  const category = options.category.replace(/[^a-z0-9_-]/gi, "");
  const dir = path.join(uploadRoot(), category);
  await mkdir(dir, { recursive: true });

  const filename = id + ".png";
  const thumbnailName = id + "_thumb.png";
  await writeFile(path.join(dir, filename), normalized.data);
  await writeFile(path.join(dir, thumbnailName), thumbnail);

  return {
    filename,
    thumbnailName,
    mime: "image/png",
    size: normalized.data.byteLength,
    width: normalized.info.width,
    height: normalized.info.height,
    checksum: createHash("sha256").update(normalized.data).digest("hex")
  };
}

export function publicPath(category: string, filename: string): string {
  return "/api/assets/" + category + "/" + filename;
}

const MODULE_EXT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  md: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  json: "application/json; charset=utf-8",
  yaml: "application/yaml; charset=utf-8",
  yml: "application/yaml; charset=utf-8",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  mp4: "video/mp4",
  webm: "video/webm"
};

export function extensionOf(filename: string): string | null {
  const match = /[.]([a-z0-9]+)$/i.exec(filename);
  if (match === null) return null;
  const ext = match[1]?.toLowerCase();
  if (ext === undefined || MODULE_EXT_MIME[ext] === undefined) return null;
  return ext;
}

export function mimeForExtension(ext: string): string {
  return MODULE_EXT_MIME[ext] ?? "application/octet-stream";
}

export interface StoredRawFile {
  readonly filename: string;
  readonly ext: string;
  readonly mime: string;
  readonly size: number;
  readonly checksum: string;
}

/** 保存任意白名单文件；不重编码，只做路径与扩展名校验。 */
export async function storeRawFile(
  buffer: Buffer,
  options: { readonly category: string; readonly extension: string; readonly maxBytes?: number }
): Promise<StoredRawFile> {
  const maxBytes = options.maxBytes ?? 20 * 1024 * 1024;
  if (buffer.byteLength > maxBytes) {
    throw new Error("文件超过 " + Math.floor(maxBytes / 1024 / 1024) + " MB 上限");
  }
  const ext = options.extension.toLowerCase();
  if (MODULE_EXT_MIME[ext] === undefined) {
    throw new Error("不支持的文件扩展名：" + ext);
  }
  const category = options.category.replace(/[^a-z0-9_-]/gi, "");
  const dir = path.join(uploadRoot(), category);
  await mkdir(dir, { recursive: true });
  const filename = randomUUID() + "." + ext;
  await writeFile(path.join(dir, filename), buffer);
  return {
    filename,
    ext,
    mime: MODULE_EXT_MIME[ext],
    size: buffer.byteLength,
    checksum: createHash("sha256").update(buffer).digest("hex")
  };
}
