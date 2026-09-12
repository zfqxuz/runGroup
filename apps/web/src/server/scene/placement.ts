import {
  cellKeyAt,
  hexCellAt,
  hexCellKey,
  hexCenter,
  squareCellAt,
  type GeometryPoint,
  type GridLike
} from "@/shared/scene-geometry";
import { prisma } from "@/server/db/prisma";

export interface TokenMapGrid extends GridLike {
  readonly id: string;
}

function squareCandidates(start: { readonly col: number; readonly row: number }, radius: number): { readonly col: number; readonly row: number }[] {
  const cells: { readonly col: number; readonly row: number }[] = [];
  for (let drow = -radius; drow <= radius; drow += 1) {
    for (let dcol = -radius; dcol <= radius; dcol += 1) {
      if (Math.max(Math.abs(dcol), Math.abs(drow)) !== radius) continue;
      cells.push({ col: start.col + dcol, row: start.row + drow });
    }
  }
  return cells;
}

function hexDistance(a: { readonly q: number; readonly r: number }, b: { readonly q: number; readonly r: number }): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

function withinSquare(grid: GridLike, col: number, row: number): boolean {
  const cols = Math.max(1, Math.ceil(grid.width / grid.gridSize));
  const rows = Math.max(1, Math.ceil(grid.height / grid.gridSize));
  return col >= 0 && col < cols && row >= 0 && row < rows;
}

function findSquareFreePoint(grid: GridLike, occupied: ReadonlySet<string>, preferred: GeometryPoint): GeometryPoint | null {
  const start = squareCellAt(preferred, grid);
  const cols = Math.max(1, Math.ceil(grid.width / grid.gridSize));
  const rows = Math.max(1, Math.ceil(grid.height / grid.gridSize));
  const maxRings = Math.max(cols, rows) + 2;
  for (let radius = 0; radius <= maxRings; radius += 1) {
    for (const cell of squareCandidates(start, radius)) {
      if (withinSquare(grid, cell.col, cell.row) === false) continue;
      const key = String(cell.col) + "," + String(cell.row);
      if (occupied.has(key)) continue;
      return {
        x: (cell.col + 0.5) * grid.gridSize,
        y: (cell.row + 0.5) * grid.gridSize
      };
    }
  }
  return null;
}

function findHexFreePoint(grid: GridLike, occupied: ReadonlySet<string>, preferred: GeometryPoint): GeometryPoint | null {
  const start = hexCellAt(preferred, grid.gridSize);
  const maxRings = Math.ceil(Math.max(grid.width, grid.height) / grid.gridSize) + 4;
  for (let radius = 0; radius <= maxRings; radius += 1) {
    for (let q = start.q - radius; q <= start.q + radius; q += 1) {
      for (let r = start.r - radius; r <= start.r + radius; r += 1) {
        const cell = { q, r };
        if (hexDistance(start, cell) !== radius) continue;
        const key = hexCellKey(cell);
        if (occupied.has(key)) continue;
        const center = hexCenter(cell, grid.gridSize);
        if (center.x < 0 || center.x > grid.width || center.y < 0 || center.y > grid.height) continue;
        return center;
      }
    }
  }
  return null;
}

/** 在指定格子周围螺旋寻找最近空闲格；地图无网格时返回原坐标。 */
export function findNearestFreePoint(
  grid: GridLike,
  occupied: ReadonlySet<string>,
  preferred: GeometryPoint
): GeometryPoint | null {
  if (grid.gridType === "NONE") return preferred;
  if (grid.gridType === "HEX") return findHexFreePoint(grid, occupied, preferred);
  return findSquareFreePoint(grid, occupied, preferred);
}

/** 读取整个场景地图的 Token 占用格，排除某个 Token 后返回最近空闲落点。 */
export async function findFreeTokenPosition(
  grid: TokenMapGrid,
  preferred: GeometryPoint,
  excludeTokenId?: string
): Promise<GeometryPoint | null> {
  const rows = await prisma.token.findMany({
    where: { mapId: grid.id },
    select: { id: true, x: true, y: true }
  });
  const excludedId = excludeTokenId ?? "";
  const occupied = new Set<string>();
  for (const row of rows) {
    if (row.id === excludedId) continue;
    const key = cellKeyAt(grid, row.x, row.y);
    if (key.length > 0) occupied.add(key);
  }
  return findNearestFreePoint(grid, occupied, preferred);
}
