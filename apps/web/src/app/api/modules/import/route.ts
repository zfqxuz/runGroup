import { NextResponse } from "next/server";
import { parse as parseYaml } from "yaml";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";
import {
  extensionOf,
  publicPath,
  storeImage,
  storeRawFile
} from "@/server/assets/storage";
import {
  parseModulePackage,
  slugifyModuleId
} from "@/server/modules/format";
import { parseStructuredBlocks, type StructuredModuleEntry } from "@/server/modules/structure";
import { syncModuleTemplatesFromModule } from "@/server/modules/templates";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_ZIP_BYTES = 50 * 1024 * 1024;
const MAX_ASSET_BYTES = 20 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);


function npcEntriesFromYaml(text: string | null | undefined): StructuredModuleEntry[] {
  if (text === null || text === undefined || text.trim().length === 0) return [];
  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch {
    return [];
  }
  const source = Array.isArray(parsed)
    ? parsed
    : parsed !== null && typeof parsed === "object" && Array.isArray((parsed as { npcs?: unknown }).npcs)
      ? ((parsed as { npcs: unknown[] }).npcs as unknown[])
      : [];
  const rows: StructuredModuleEntry[] = [];
  source.forEach((item, index) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return;
    const data = item as Record<string, unknown>;
    const title = String(data.name ?? data.title ?? data.id ?? "NPC " + String(index + 1)).trim();
    return rows.push({
      kind: "npc",
      id: String(data.id ?? title).trim() || "npc-" + String(index + 1),
      title,
      data
    });
  });
  return rows;
}

async function uniqueSlug(roomId: string | null, base: string): Promise<string> {
  let slug = base;
  let suffix = 2;
  while ((await prisma.module.findFirst({ where: { roomId, slug }, select: { id: true } })) !== null) {
    slug = base + "-" + suffix;
    suffix += 1;
  }
  return slug;
}

export async function POST(request: Request): Promise<NextResponse> {
  const session = await auth();
  if (session === null) {
    return NextResponse.json({ ok: false, error: "未登录" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "请求格式不合法" }, { status: 400 });
  }

  const roomId = String(form.get("roomId") ?? "").trim();
  if (roomId.length > 0) {
    const membership = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId: session.user.id } },
      select: { role: true }
    });
    if (membership === null || membership.role !== "KP") {
      return NextResponse.json({ ok: false, error: "只有本房 KP 可以导入房间团本" }, { status: 403 });
    }
  }

  const file = form.get("file");
  if (file === null || typeof file !== "object" || !("arrayBuffer" in file)) {
    return NextResponse.json({ ok: false, error: "请选择 .md 或 .zip 文件" }, { status: 400 });
  }
  const upload = file as File;
  const lower = upload.name.toLowerCase();
  if (lower.endsWith(".md") === false && lower.endsWith(".zip") === false) {
    return NextResponse.json({ ok: false, error: "只支持 .md 或 .zip" }, { status: 400 });
  }
  if (lower.endsWith(".zip") && upload.size > MAX_ZIP_BYTES) {
    return NextResponse.json({ ok: false, error: "zip 超过 50MB 上限" }, { status: 413 });
  }

  const buffer = Buffer.from(await upload.arrayBuffer());
  const parsed = parseModulePackage(buffer, upload.name);
  if (parsed.errors.length > 0) {
    return NextResponse.json({ ok: false, error: "团本格式校验失败", details: parsed.errors }, { status: 400 });
  }

  const slug = await uniqueSlug(roomId.length === 0 ? null : roomId, slugifyModuleId(parsed.frontMatter.id || parsed.frontMatter.title));
  const baseStructured = parseStructuredBlocks(parsed.markdown);
  const yamlNpcs = npcEntriesFromYaml(parsed.npcYaml);
  const structured = yamlNpcs.length === 0
    ? baseStructured
    : { ...baseStructured, npcs: [...baseStructured.npcs, ...yamlNpcs] };
  const moduleRecord = await prisma.module.create({
    data: {
      ownerId: session.user.id,
      roomId: roomId.length === 0 ? null : roomId,
      slug,
      title: parsed.frontMatter.title,
      synopsis: parsed.frontMatter.summary,
      author: parsed.frontMatter.author,
      system: parsed.frontMatter.system,
      era: parsed.frontMatter.era,
      background: typeof parsed.frontMatter.background === "string" ? parsed.frontMatter.background : null,
      occupationRecommendation: typeof parsed.frontMatter.occupationRecommendation === "string" ? parsed.frontMatter.occupationRecommendation : null,
      version: parsed.frontMatter.version,
      sourceType: lower.endsWith(".zip") ? "ZIP" : "MARKDOWN",
      originalFilename: upload.name.slice(0, 200),
      content: {
        format: "markdown",
        text: parsed.markdown,
        sections: parsed.sections,
        structured: structured as never
      } as never,
      metadata: parsed.frontMatter as never,
      importReport: {
        warnings: parsed.warnings,
        errors: parsed.errors,
        assetCount: parsed.assets.length,
        originalFilename: upload.name
      } as never
    },
    select: { id: true }
  });

  const createdAssets: string[] = [];
  try {
    for (const asset of parsed.assets) {
      const ext = extensionOf(asset.originalName) ?? extensionOf(asset.relativePath);
      if (ext === null || ext.length === 0) continue;
      if (asset.buffer.byteLength > MAX_ASSET_BYTES) {
        throw new Error("资源超过 20MB：" + asset.originalName);
      }

      let assetData;
      if (IMAGE_EXTENSIONS.has(ext)) {
        const stored = await storeImage(asset.buffer, { category: "modules", maxBytes: MAX_ASSET_BYTES });
        assetData = await prisma.asset.create({
          data: {
            ownerId: session.user.id,
            type: "OTHER",
            filename: stored.filename,
            originalName: asset.originalName.slice(0, 200),
            mimeType: stored.mime,
            size: stored.size,
            width: stored.width,
            height: stored.height,
            url: publicPath("modules", stored.filename),
            thumbnailUrl: publicPath("modules", stored.thumbnailName),
            checksum: stored.checksum,
            metadata: { moduleId: moduleRecord.id, relativePath: asset.relativePath, kind: asset.kind }
          },
          select: { id: true }
        });
      } else {
        const stored = await storeRawFile(asset.buffer, {
          category: "modules",
          extension: ext,
          maxBytes: MAX_ASSET_BYTES
        });
        assetData = await prisma.asset.create({
          data: {
            ownerId: session.user.id,
            type: "OTHER",
            filename: stored.filename,
            originalName: asset.originalName.slice(0, 200),
            mimeType: stored.mime,
            size: stored.size,
            url: publicPath("modules", stored.filename),
            checksum: stored.checksum,
            metadata: { moduleId: moduleRecord.id, relativePath: asset.relativePath, kind: asset.kind }
          },
          select: { id: true }
        });
      }

      await prisma.moduleAsset.create({
        data: {
          moduleId: moduleRecord.id,
          assetId: assetData.id,
          relativePath: asset.relativePath,
          originalName: asset.originalName,
          kind: asset.kind
        }
      });
      createdAssets.push(asset.relativePath);
    }
  } catch (error) {
    await prisma.module.delete({ where: { id: moduleRecord.id } }).catch(() => undefined);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "资源处理失败" },
      { status: 400 }
    );
  }

  let templateCounts: Awaited<ReturnType<typeof syncModuleTemplatesFromModule>> = { chapters: 0, npcs: 0, items: 0, clues: 0, scenes: 0, encounters: 0, magic: 0, warnings: [] };
  let templateParseWarning: string | null = null;
  try {
    templateCounts = await syncModuleTemplatesFromModule(moduleRecord.id);
  } catch (error) {
    templateParseWarning = error instanceof Error ? error.message : "模板解析失败";
  }
  const warnings = [
    ...parsed.warnings,
    ...templateCounts.warnings.map((warning) => "模板解析：" + warning),
    ...(templateParseWarning === null ? [] : ["模板解析：" + templateParseWarning])
  ];

  return NextResponse.json({
    ok: true,
    moduleId: moduleRecord.id,
    slug,
    warnings,
    assets: createdAssets,
    templates: {
      chapters: templateCounts.chapters,
      npcs: templateCounts.npcs,
      items: templateCounts.items,
      clues: templateCounts.clues,
      scenes: templateCounts.scenes,
      encounters: templateCounts.encounters,
      magic: templateCounts.magic
    }
  });
}
