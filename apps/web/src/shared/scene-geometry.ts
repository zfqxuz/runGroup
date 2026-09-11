export interface GeometryPoint {
  readonly x: number;
  readonly y: number;
}

export interface GeometrySegment {
  readonly a: GeometryPoint;
  readonly b: GeometryPoint;
}

export interface GridLike {
  readonly width: number;
  readonly height: number;
  readonly gridSize: number;
  readonly gridType: string;
}

export interface AxialCell {
  readonly q: number;
  readonly r: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function cubeRound(qf: number, rf: number): AxialCell {
  const sf = -qf - rf;
  let q = Math.round(qf);
  let r = Math.round(rf);
  let s = Math.round(sf);
  const qDiff = Math.abs(q - qf);
  const rDiff = Math.abs(r - rf);
  const sDiff = Math.abs(s - sf);
  if (qDiff > rDiff && qDiff > sDiff) {
    q = -r - s;
  } else if (rDiff > sDiff) {
    r = -q - s;
  } else {
    s = -q - r;
  }
  return { q, r };
}

export function hexSizeOf(gridSize: number): number {
  return Math.max(1, gridSize / 2);
}

export function hexCenter(cell: AxialCell, gridSize: number): GeometryPoint {
  const size = hexSizeOf(gridSize);
  return {
    x: size * Math.sqrt(3) * (cell.q + cell.r / 2),
    y: size * 1.5 * cell.r
  };
}

export function hexCellAt(point: GeometryPoint, gridSize: number): AxialCell {
  const size = hexSizeOf(gridSize);
  const qf = (Math.sqrt(3) / 3 * point.x - point.y / 3) / size;
  const rf = (2 / 3 * point.y) / size;
  return cubeRound(qf, rf);
}

export function hexCellKey(cell: AxialCell): string {
  return "hex:" + String(cell.q) + "," + String(cell.r);
}

export function parseCellKey(key: string): AxialCell | { readonly col: number; readonly row: number } | null {
  if (key.startsWith("hex:")) {
    const [qRaw, rRaw] = key.slice(4).split(",");
    const q = Number(qRaw);
    const r = Number(rRaw);
    if (Number.isFinite(q) && Number.isFinite(r)) return { q: Math.round(q), r: Math.round(r) };
    return null;
  }
  const [colRaw, rowRaw] = key.split(",");
  const col = Number(colRaw);
  const row = Number(rowRaw);
  if (Number.isFinite(col) && Number.isFinite(row)) return { col: Math.floor(col), row: Math.floor(row) };
  return null;
}

export function squareCellAt(point: GeometryPoint, grid: GridLike): { col: number; row: number } {
  const cols = Math.max(1, Math.ceil(grid.width / grid.gridSize));
  const rows = Math.max(1, Math.ceil(grid.height / grid.gridSize));
  return {
    col: clamp(Math.floor(point.x / grid.gridSize), 0, cols - 1),
    row: clamp(Math.floor(point.y / grid.gridSize), 0, rows - 1)
  };
}

export function cellKeyAt(grid: GridLike, x: number, y: number): string {
  const point = { x: clamp(x, 0, grid.width), y: clamp(y, 0, grid.height) };
  if (grid.gridType === "HEX") return hexCellKey(hexCellAt(point, grid.gridSize));
  if (grid.gridType === "NONE") return "";
  const cell = squareCellAt(point, grid);
  return String(cell.col) + "," + String(cell.row);
}

export function cellCenterFromKey(grid: GridLike, key: string): GeometryPoint | null {
  const parsed = parseCellKey(key);
  if (parsed === null) return null;
  if ("q" in parsed) return hexCenter(parsed, grid.gridSize);
  return {
    x: (parsed.col + 0.5) * grid.gridSize,
    y: (parsed.row + 0.5) * grid.gridSize
  };
}

export function snapPointToGrid(grid: GridLike, x: number, y: number): GeometryPoint {
  const point = { x: clamp(x, 0, grid.width), y: clamp(y, 0, grid.height) };
  const key = cellKeyAt(grid, point.x, point.y);
  const center = cellCenterFromKey(grid, key);
  if (center === null) return point;
  return {
    x: clamp(center.x, 0, grid.width),
    y: clamp(center.y, 0, grid.height)
  };
}

export function hexCellsCovering(grid: GridLike, padding = 1): AxialCell[] {
  if (grid.gridType !== "HEX") return [];
  const corners: GeometryPoint[] = [
    { x: 0, y: 0 },
    { x: grid.width, y: 0 },
    { x: 0, y: grid.height },
    { x: grid.width, y: grid.height }
  ];
  const cells: AxialCell[] = [];
  let qMin = Number.POSITIVE_INFINITY;
  let qMax = Number.NEGATIVE_INFINITY;
  let rMin = Number.POSITIVE_INFINITY;
  let rMax = Number.NEGATIVE_INFINITY;
  for (const corner of corners) {
    const cell = hexCellAt(corner, grid.gridSize);
    qMin = Math.min(qMin, cell.q);
    qMax = Math.max(qMax, cell.q);
    rMin = Math.min(rMin, cell.r);
    rMax = Math.max(rMax, cell.r);
  }
  for (let r = rMin - padding; r <= rMax + padding; r += 1) {
    for (let q = qMin - padding; q <= qMax + padding; q += 1) {
      cells.push({ q, r });
    }
  }
  return cells;
}

export function hexPolygonPoints(cell: AxialCell, gridSize: number): string {
  const center = hexCenter(cell, gridSize);
  const size = hexSizeOf(gridSize);
  const points: string[] = [];
  for (let index = 0; index < 6; index += 1) {
    const angle = (Math.PI / 180) * (60 * index - 90);
    points.push(
      (center.x + size * Math.cos(angle)).toFixed(2) + "," + (center.y + size * Math.sin(angle)).toFixed(2)
    );
  }
  return points.join(" ");
}

function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

export function raySegmentDistance(
  origin: GeometryPoint,
  direction: GeometryPoint,
  segment: GeometrySegment
): number | null {
  const abx = segment.b.x - segment.a.x;
  const aby = segment.b.y - segment.a.y;
  const denom = cross(direction.x, direction.y, abx, aby);
  if (Math.abs(denom) < 1e-9) return null;
  const acx = segment.a.x - origin.x;
  const acy = segment.a.y - origin.y;
  const t = cross(acx, acy, abx, aby) / denom;
  const u = cross(acx, acy, direction.x, direction.y) / denom;
  if (t < 0 || u < -1e-6 || u > 1 + 1e-6) return null;
  return t;
}

export function rayBoundsDistance(
  origin: GeometryPoint,
  direction: GeometryPoint,
  width: number,
  height: number
): number {
  let best = Number.POSITIVE_INFINITY;
  if (Math.abs(direction.x) > 1e-9) {
    const target = direction.x > 0 ? width : 0;
    const t = (target - origin.x) / direction.x;
    const y = origin.y + direction.y * t;
    if (t >= 0 && y >= -1e-6 && y <= height + 1e-6) best = Math.min(best, t);
  }
  if (Math.abs(direction.y) > 1e-9) {
    const target = direction.y > 0 ? height : 0;
    const t = (target - origin.y) / direction.y;
    const x = origin.x + direction.x * t;
    if (t >= 0 && x >= -1e-6 && x <= width + 1e-6) best = Math.min(best, t);
  }
  return Number.isFinite(best) ? best : 0;
}

/**
 * 经典 2D 可见性多边形：从视点向所有墙端点（含微小偏移）与边界投射射线，
 * 取最近交点后按角度排序。输出点即用于 SVG evenodd 遮罩的可视区域多边形。
 */
export function computeVisibilityPolygon(
  origin: GeometryPoint,
  segments: readonly GeometrySegment[],
  width: number,
  height: number
): GeometryPoint[] {
  if (segments.length === 0) return [];
  const angleSet = new Set<number>();
  const addAngle = (angle: number): void => {
    const normalized = Math.atan2(Math.sin(angle), Math.cos(angle));
    angleSet.add(normalized - 0.0001);
    angleSet.add(normalized);
    angleSet.add(normalized + 0.0001);
  };
  for (const segment of segments) {
    addAngle(Math.atan2(segment.a.y - origin.y, segment.a.x - origin.x));
    addAngle(Math.atan2(segment.b.y - origin.y, segment.b.x - origin.x));
  }
  for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) addAngle(angle);

  const angles = Array.from(angleSet).sort((left, right) => left - right);
  const hits: GeometryPoint[] = [];
  for (const angle of angles) {
    const direction = { x: Math.cos(angle), y: Math.sin(angle) };
    let best = rayBoundsDistance(origin, direction, width, height);
    for (const segment of segments) {
      const distance = raySegmentDistance(origin, direction, segment);
      if (distance !== null && distance < best) best = distance;
    }
    const point = { x: origin.x + direction.x * best, y: origin.y + direction.y * best };
    const previous = hits[hits.length - 1];
    if (previous === undefined || Math.hypot(previous.x - point.x, previous.y - point.y) > 0.5) {
      hits.push(point);
    }
  }
  return hits;
}

export function pointInPolygon(point: GeometryPoint, polygon: readonly GeometryPoint[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const current = polygon[index];
    const last = polygon[previous];
    if (current === undefined || last === undefined) continue;
    const crosses = (current.y > point.y) === (last.y > point.y) ? false : true;
    const intersects = crosses && point.x < ((last.x - current.x) * (point.y - current.y)) / (last.y - current.y + 1e-12) + current.x;
    if (intersects) inside = inside ? false : true;
  }
  return inside;
}
export function segmentFromPoints(points: readonly number[]): GeometrySegment | null {
  if (points.length < 4) return null;
  const x1 = points[0];
  const y1 = points[1];
  const x2 = points[2];
  const y2 = points[3];
  if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) return null;
  if (Number.isFinite(x1) === false || Number.isFinite(y1) === false) return null;
  if (Number.isFinite(x2) === false || Number.isFinite(y2) === false) return null;
  return { a: { x: x1, y: y1 }, b: { x: x2, y: y2 } };
}
