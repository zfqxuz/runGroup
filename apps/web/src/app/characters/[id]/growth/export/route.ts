import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";
import { ADVANCEMENT_SOURCE_LABELS } from "@/server/game/advancement";
import { isAdvancementSource } from "@/server/game/view";

const KIND_LABELS: Record<string, string> = {
  ATTRIBUTE: "属性",
  SKILL: "技能",
  SAN: "SAN",
  ITEM: "物品",
  RELATIONSHIP: "关系",
  OTHER: "其他"
};

const ATTRIBUTE_LABELS: Record<string, string> = {
  str: "力量",
  con: "体质",
  siz: "体型",
  dex: "敏捷",
  app: "外貌",
  int: "智力",
  pow: "意志",
  edu: "教育",
  luck: "幸运"
};

function csvCell(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  if (text.includes(",") || text.includes('"') || text.includes("\n") || text.includes("\r")) {
    return '"' + text.replace(/"/g, '""') + '"';
  }
  return text;
}

function targetLabel(kind: string, target: string | null): string {
  if (target === null) return "";
  if (kind === "ATTRIBUTE") return ATTRIBUTE_LABELS[target] ?? target;
  return target;
}

export async function GET(
  request: Request,
  context: { params: { id: string } }
): Promise<Response> {
  const session = await auth();
  if (session === null) return new Response("Unauthorized", { status: 401 });

  const character = await prisma.character.findUnique({
    where: { id: context.params.id },
    select: {
      id: true,
      name: true,
      userId: true,
      advancements: {
        include: { game: { select: { title: true } } },
        orderBy: { createdAt: "asc" }
      }
    }
  });
  if (character === null || character.userId !== session.user.id) {
    return new Response("Not Found", { status: 404 });
  }

  const url = new URL(request.url);
  const kindFilter = url.searchParams.get("gkind") ?? "ALL";
  const sourceFilter = url.searchParams.get("gsource") ?? "ALL";
  const gameFilter = url.searchParams.get("ggame") ?? "ALL";

  const rows = character.advancements.filter((item) => {
    if (kindFilter !== "ALL" && item.kind !== kindFilter) return false;
    if (sourceFilter !== "ALL" && item.source !== sourceFilter) return false;
    if (gameFilter === "manual" && item.gameId !== null) return false;
    if (gameFilter !== "ALL" && gameFilter !== "manual" && item.gameId !== gameFilter) return false;
    return true;
  });

  const header = ["日期", "角色", "成长类型", "目标", "变化", "来源", "来源局", "备注", "状态"];
  const lines: string[] = [header.map((cell) => csvCell(cell)).join(",")];
  for (const item of rows) {
    const source = isAdvancementSource(item.source) ? ADVANCEMENT_SOURCE_LABELS[item.source] : item.source;
    lines.push(
      [
        item.createdAt.toISOString(),
        character.name,
        KIND_LABELS[item.kind] ?? item.kind,
        targetLabel(item.kind, item.target),
        item.delta === null ? "" : item.delta > 0 ? "+" + item.delta : String(item.delta),
        source,
        item.game?.title ?? "",
        item.note ?? "",
        item.revertedAt === null ? "有效" : "已撤销"
      ]
        .map((cell) => csvCell(cell))
        .join(",")
    );
  }

  const csv = "\uFEFF" + lines.join("\r\n") + "\r\n";
  const filename = encodeURIComponent(character.name + "-成长记录.csv");
  return new Response(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": "attachment; filename*=UTF-8''" + filename
    }
  });
}
