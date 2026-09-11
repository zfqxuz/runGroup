import type {
  SceneGridType,
  SceneLayerType,
  SceneLayerView,
  SceneLightView,
  SceneMapView,
  SceneTimeOfDay,
  SceneTokenView,
  SceneView,
  SceneWallType,
  SceneWallView,
  SceneWeather
} from "@/shared/scene";

interface TokenLike {
  readonly id: string;
  readonly name: string;
  readonly characterId: string | null;
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly rotation: number;
  readonly zIndex: number;
  readonly borderColor: string;
  readonly showName: boolean;
  readonly showHpBar: boolean;
  readonly isVisible: boolean;
  readonly isLocked: boolean;
  readonly asset?: { readonly url: string } | null;
  readonly character?: {
    readonly userId: string;
    readonly hp: number;
    readonly maxHp: number;
    readonly avatar?: { readonly url: string } | null;
  } | null;
}

interface LayerLike {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly zIndex: number;
  readonly opacity: number;
  readonly visible: boolean;
  readonly locked: boolean;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly scale: number;
  readonly asset?: { readonly url: string } | null;
}

interface WallLike {
  readonly id: string;
  readonly points: unknown;
  readonly type: string;
}

interface LightLike {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly color: string;
  readonly intensity: number;
}

interface MapLike {
  readonly id: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly gridSize: number;
  readonly gridType: string;
  readonly bgColor: string;
  readonly showGrid: boolean;
  readonly showFog: boolean;
  readonly fogRevealed: unknown;
  readonly initialX: number;
  readonly initialY: number;
  readonly initialZoom: number;
  readonly background?: { readonly url: string } | null;
  readonly layers: readonly LayerLike[];
  readonly walls: readonly WallLike[];
  readonly lights: readonly LightLike[];
  readonly tokens: readonly TokenLike[];
}

interface SceneLike {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly narration: string | null;
  readonly weather: string;
  readonly timeOfDay: string;
  readonly isActive: boolean;
  readonly map?: MapLike | null;
}

export type SceneHpMap = ReadonlyMap<string, { readonly currentHp: number; readonly maxHp: number }>;

function stringArray(value: unknown): string[] {
  if (Array.isArray(value) === false) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function numberArray(value: unknown): number[] {
  if (Array.isArray(value) === false) return [];
  return value.filter((item): item is number => typeof item === "number" && Number.isFinite(item));
}

function mapViewLayers(layers: readonly LayerLike[]): SceneLayerView[] {
  return layers.map((layer) => ({
    id: layer.id,
    name: layer.name,
    type: layer.type as SceneLayerType,
    zIndex: layer.zIndex,
    opacity: layer.opacity,
    visible: layer.visible,
    locked: layer.locked,
    offsetX: layer.offsetX,
    offsetY: layer.offsetY,
    scale: layer.scale,
    imageUrl: layer.asset?.url ?? null
  }));
}

function mapViewWalls(walls: readonly WallLike[]): SceneWallView[] {
  return walls.map((wall) => ({
    id: wall.id,
    points: numberArray(wall.points),
    type: wall.type as SceneWallType
  }));
}

function mapViewLights(lights: readonly LightLike[]): SceneLightView[] {
  return lights.map((light) => ({
    id: light.id,
    x: light.x,
    y: light.y,
    radius: light.radius,
    color: light.color,
    intensity: light.intensity
  }));
}

export const sceneInclude = {
  map: {
    include: {
      background: { select: { url: true } },
      layers: {
        include: { asset: { select: { url: true } } },
        orderBy: { zIndex: "asc" as const }
      },
      walls: true,
      lights: true,
      tokens: {
        include: {
          asset: { select: { url: true } },
          character: {
            select: {
              userId: true,
              hp: true,
              maxHp: true,
              avatar: { select: { url: true } }
            }
          }
        },
        orderBy: { zIndex: "asc" as const }
      }
    }
  }
} as const;

export const tokenInclude = {
  asset: { select: { url: true } },
  character: {
    select: {
      userId: true,
      hp: true,
      maxHp: true,
      avatar: { select: { url: true } }
    }
  }
} as const;

export function tokenView(token: TokenLike, hpByCharacter: SceneHpMap): SceneTokenView {
  const hp = token.characterId === null ? null : hpByCharacter.get(token.characterId) ?? null;
  return {
    id: token.id,
    name: token.name,
    characterId: token.characterId,
    ownerUserId: token.character?.userId ?? null,
    imageUrl: token.asset?.url ?? token.character?.avatar?.url ?? null,
    x: token.x,
    y: token.y,
    size: token.size,
    rotation: token.rotation,
    zIndex: token.zIndex,
    borderColor: token.borderColor,
    showName: token.showName,
    showHpBar: token.showHpBar,
    isVisible: token.isVisible,
    isLocked: token.isLocked,
    currentHp: hp?.currentHp ?? null,
    maxHp: hp?.maxHp ?? token.character?.maxHp ?? null
  };
}

export function mapView(map: MapLike, hpByCharacter: SceneHpMap): SceneMapView {
  return {
    id: map.id,
    name: map.name,
    width: map.width,
    height: map.height,
    gridSize: map.gridSize,
    gridType: map.gridType as SceneGridType,
    bgColor: map.bgColor,
    showGrid: map.showGrid,
    showFog: map.showFog,
    initialX: map.initialX,
    initialY: map.initialY,
    initialZoom: map.initialZoom,
    backgroundUrl: map.background?.url ?? null,
    fogRevealed: stringArray(map.fogRevealed),
    layers: mapViewLayers(map.layers),
    walls: mapViewWalls(map.walls),
    lights: mapViewLights(map.lights),
    tokens: map.tokens.map((token) => tokenView(token, hpByCharacter))
  };
}

export function sceneView(scene: SceneLike, hpByCharacter: SceneHpMap): SceneView {
  return {
    id: scene.id,
    name: scene.name,
    description: scene.description,
    narration: scene.narration,
    weather: scene.weather as SceneWeather,
    timeOfDay: scene.timeOfDay as SceneTimeOfDay,
    isActive: scene.isActive,
    map: scene.map === null || scene.map === undefined ? null : mapView(scene.map, hpByCharacter)
  };
}
