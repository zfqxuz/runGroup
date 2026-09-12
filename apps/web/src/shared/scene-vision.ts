import {
  hexCellAt,
  hexCellKey,
  hexCellsCovering,
  type GeometryPoint,
  type GridLike
} from "./scene-geometry";

/** 玩家 Token 默认视野半径（格）。 */
export const DEFAULT_VISION_RADIUS_CELLS = 2;

function squareCellKeys(grid: GridLike): string[] {
  const cols = Math.max(1, Math.ceil(grid.width / grid.gridSize));
  const rows = Math.max(1, Math.ceil(grid.height / grid.gridSize));
  const keys: string[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      keys.push(String(col) + "," + String(row));
    }
  }
  return keys;
}

function hexDistance(a: { readonly q: number; readonly r: number }, b: { readonly q: number; readonly r: number }): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

export function allVisionCellKeys(grid: GridLike): string[] {
  if (grid.gridType === "HEX") {
    return hexCellsCovering(grid, 1).map((cell) => hexCellKey(cell));
  }
  if (grid.gridType === "NONE") return [];
  return squareCellKeys(grid);
}

export function visionCellKeysForPoints(
  grid: GridLike,
  points: readonly GeometryPoint[],
  radiusCells = DEFAULT_VISION_RADIUS_CELLS
): Set<string> {
  const revealed = new Set<string>();
  if (points.length === 0 || grid.gridType === "NONE") return revealed;
  const radius = Math.max(1, Math.floor(radiusCells));
  if (grid.gridType === "HEX") {
    for (const point of points) {
      const origin = hexCellAt(point, grid.gridSize);
      for (const cell of hexCellsCovering(grid, radius + 1)) {
        if (hexDistance(origin, cell) <= radius) revealed.add(hexCellKey(cell));
      }
    }
    return revealed;
  }

  const cols = Math.max(1, Math.ceil(grid.width / grid.gridSize));
  const rows = Math.max(1, Math.ceil(grid.height / grid.gridSize));
  for (const point of points) {
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const cx = (col + 0.5) * grid.gridSize;
        const cy = (row + 0.5) * grid.gridSize;
        const dx = Math.abs((cx - point.x) / grid.gridSize);
        const dy = Math.abs((cy - point.y) / grid.gridSize);
        if (Math.max(dx, dy) <= radius) {
          revealed.add(String(col) + "," + String(row));
        }
      }
    }
  }
  return revealed;
}
