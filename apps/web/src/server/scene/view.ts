import type {
  SceneGridType,
  SceneMapView,
  SceneTimeOfDay,
  SceneTokenView,
  SceneView,
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
  readonly initialX: number;
  readonly initialY: number;
  readonly initialZoom: number;
  readonly background?: { readonly url: string } | null;
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

export const sceneInclude = {
  map: {
    include: {
      background: { select: { url: true } },
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
