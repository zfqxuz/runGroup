export type SceneWeather = "NONE" | "RAIN" | "SNOW" | "FOG" | "STORM" | "SAKURA" | "PETALS";
export type SceneTimeOfDay = "DAWN" | "DAY" | "DUSK" | "NIGHT" | "MIDNIGHT";
export type SceneGridType = "SQUARE" | "HEX" | "NONE";

export interface SceneTokenView {
  readonly id: string;
  readonly name: string;
  readonly characterId: string | null;
  readonly ownerUserId: string | null;
  readonly imageUrl: string | null;
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
  readonly currentHp: number | null;
  readonly maxHp: number | null;
}

export interface SceneMapView {
  readonly id: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly gridSize: number;
  readonly gridType: SceneGridType;
  readonly bgColor: string;
  readonly showGrid: boolean;
  readonly showFog: boolean;
  readonly initialX: number;
  readonly initialY: number;
  readonly initialZoom: number;
  readonly backgroundUrl: string | null;
  readonly tokens: readonly SceneTokenView[];
}

export interface SceneView {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly narration: string | null;
  readonly weather: SceneWeather;
  readonly timeOfDay: SceneTimeOfDay;
  readonly isActive: boolean;
  readonly map: SceneMapView | null;
}

export interface SceneTokenUpdate {
  readonly roomId: string;
  readonly token: SceneTokenView;
}

export interface SceneUpdated {
  readonly roomId: string;
  readonly sceneId: string | null;
}
