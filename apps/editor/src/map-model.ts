export const DEFAULT_MAP_WIDTH = 20;
export const DEFAULT_MAP_HEIGHT = 15;
export const DEFAULT_TILE_SIZE = 32;
export const MAX_MAP_DIMENSION = 200;
export const MIN_TILE_SIZE = 8;
export const MAX_TILE_SIZE = 128;
export const MAX_CANVAS_DIMENSION = 6400;
export const TILE_COUNT = 4;
export const EDITOR_STORAGE_KEY = "codequest-rpgjs-map-v1";

export type EditableLayer = "tiles" | "collision" | "events";
export type MapTool = "brush" | "eraser" | "rectangle" | "event";

export interface MapEvent {
  /** Stable author-facing event id, stored separately from Tiled's numeric object id. */
  id: string;
  name: string;
  /** Tile coordinates. Tiled object x/y are converted to pixels on export. */
  x: number;
  y: number;
}

export interface EditorMap {
  schemaVersion: 1;
  mapId: string;
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  /** Tiled GIDs: 0 is empty, 1..TILE_COUNT select procedural placeholder tiles. */
  tiles: number[];
  /** Tiled collision tilelayer values: 0 is passable, 1 is blocked. */
  collision: number[];
  events: MapEvent[];
}

export interface TileCoordinate {
  x: number;
  y: number;
}

export type EditorErrorCode =
  | "invalidJson"
  | "invalidDocument"
  | "invalidSchema"
  | "invalidMapId"
  | "invalidWidth"
  | "invalidHeight"
  | "invalidTileSize"
  | "invalidCanvasSize"
  | "invalidTiles"
  | "invalidTileGid"
  | "invalidCollision"
  | "invalidCollisionValue"
  | "invalidEvents"
  | "invalidEventId"
  | "duplicateEventId"
  | "invalidEventName"
  | "invalidEventCoordinates"
  | "eventOutOfBounds"
  | "eventNotFound"
  | "eventsOutsideResize"
  | "invalidLayers"
  | "invalidLayer"
  | "invalidLayerData"
  | "invalidLayerName"
  | "invalidOrientation"
  | "invalidTilesets"
  | "invalidTileset"
  | "invalidTilesetRange"
  | "invalidObjectId"
  | "duplicateObjectId"
  | "invalidObjectProperties"
  | "invalidObjectLayer";

const ERROR_MESSAGES: Record<EditorErrorCode, string> = {
  invalidJson: "The file is not valid JSON.",
  invalidDocument: "The map must be a JSON object.",
  invalidSchema: "The saved map uses an unsupported schema version.",
  invalidMapId: "Map id must be 1–64 characters using letters, numbers, dots, underscores, or hyphens.",
  invalidWidth: "Map width must be an integer from 1 to 200.",
  invalidHeight: "Map height must be an integer from 1 to 200.",
  invalidTileSize: "Tile width and height must be integers from 8 to 128 pixels.",
  invalidCanvasSize: "Rendered map width and height must not exceed 6400 pixels each.",
  invalidTiles: "The tile layer must contain exactly {expected} cells (width × height).",
  invalidTileGid: "Tile GIDs must be integers from 0 to 4.",
  invalidCollision: "The collision layer must contain exactly {expected} cells (width × height).",
  invalidCollisionValue: "Collision values must be either 0 or 1.",
  invalidEvents: "Events must be an array.",
  invalidEventId: "Event id must be 1–64 characters using letters, numbers, dots, underscores, or hyphens.",
  duplicateEventId: "Event ids must be unique.",
  invalidEventName: "Event name must be a string of at most 80 characters.",
  invalidEventCoordinates: "Event coordinates must be non-negative integers aligned to the tile grid.",
  eventOutOfBounds: "Event coordinates must be inside the map.",
  eventNotFound: "The selected event no longer exists.",
  eventsOutsideResize: "The smaller map would remove events. Move or delete them before resizing.",
  invalidLayers: "The map must contain ground and collision tile layers and may contain one events object layer.",
  invalidLayer: "Only tile layers and the events object layer are supported.",
  invalidLayerData: "Layer data must be an array of numbers.",
  invalidLayerName: "Tile layers must be named ground and collision, with unique names.",
  invalidOrientation: "Only finite orthogonal Tiled maps are supported.",
  invalidTilesets: "The map must reference exactly one tileset.",
  invalidTileset: "The placeholder tileset metadata is invalid.",
  invalidTilesetRange: "The tileset must start at GID 1 and contain exactly 4 tiles in 4 columns.",
  invalidObjectId: "Tiled object ids must be unique positive integers.",
  duplicateObjectId: "Tiled object ids must be unique.",
  invalidObjectProperties: "Event objects must have a valid eventId string property.",
  invalidObjectLayer: "The events layer must contain an objects array.",
};

export class MapValidationError extends Error {
  readonly code: EditorErrorCode;
  readonly params: Record<string, string | number>;

  constructor(code: EditorErrorCode, params: Record<string, string | number> = {}) {
    let message = ERROR_MESSAGES[code];
    for (const [name, value] of Object.entries(params)) message = message.replaceAll(`{${name}}`, String(value));
    super(message);
    this.name = "MapValidationError";
    this.code = code;
    this.params = params;
  }
}

export const PLACEHOLDER_TILES = [
  { gid: 1, color: "#67a86b", accent: "#3f7f49", labelKey: "editor.tiles.grass" },
  { gid: 2, color: "#5b91cf", accent: "#356aa8", labelKey: "editor.tiles.water" },
  { gid: 3, color: "#a2a8ad", accent: "#737b82", labelKey: "editor.tiles.stone" },
  { gid: 4, color: "#b98252", accent: "#825637", labelKey: "editor.tiles.wood" },
] as const;

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(code: EditorErrorCode, params: Record<string, string | number> = {}): never {
  throw new MapValidationError(code, params);
}

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);
}

function validDimension(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MAX_MAP_DIMENSION;
}

function validTileSize(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= MIN_TILE_SIZE && (value as number) <= MAX_TILE_SIZE;
}

function validEventName(value: unknown): value is string {
  return typeof value === "string" && value.length <= 80 && !/[\u0000-\u001f\u007f]/.test(value);
}

function validateEvents(value: unknown, width: number, height: number): MapEvent[] {
  if (!Array.isArray(value)) fail("invalidEvents");
  const ids = new Set<string>();
  return value.map((entry) => {
    if (!isObject(entry)) fail("invalidDocument");
    if (!validId(entry.id)) fail("invalidEventId");
    if (ids.has(entry.id)) fail("duplicateEventId", { id: entry.id });
    ids.add(entry.id);
    if (!validEventName(entry.name)) fail("invalidEventName", { id: entry.id });
    if (!Number.isInteger(entry.x) || !Number.isInteger(entry.y) || (entry.x as number) < 0 || (entry.y as number) < 0) {
      fail("invalidEventCoordinates", { id: entry.id });
    }
    if ((entry.x as number) >= width || (entry.y as number) >= height) fail("eventOutOfBounds", { id: entry.id });
    return { id: entry.id, name: entry.name, x: entry.x as number, y: entry.y as number };
  });
}

function validateData(value: unknown, length: number, collision: boolean): number[] {
  if (!Array.isArray(value) || value.length !== length) fail(collision ? "invalidCollision" : "invalidTiles", { expected: length });
  if (!value.every((cell) => Number.isInteger(cell))) fail(collision ? "invalidCollisionValue" : "invalidTileGid");
  if (value.some((cell) => collision ? cell !== 0 && cell !== 1 : (cell as number) < 0 || (cell as number) > TILE_COUNT)) {
    fail(collision ? "invalidCollisionValue" : "invalidTileGid");
  }
  return [...value] as number[];
}

function validateEditorMap(value: unknown): EditorMap {
  if (!isObject(value)) fail("invalidDocument");
  if (value.schemaVersion !== 1) fail("invalidSchema");
  if (!validId(value.mapId)) fail("invalidMapId");
  if (!validDimension(value.width)) fail("invalidWidth");
  if (!validDimension(value.height)) fail("invalidHeight");
  if (!validTileSize(value.tilewidth) || !validTileSize(value.tileheight)) fail("invalidTileSize");
  if (value.width * value.tilewidth > MAX_CANVAS_DIMENSION || value.height * value.tileheight > MAX_CANVAS_DIMENSION) fail("invalidCanvasSize");
  const length = value.width * value.height;
  return {
    schemaVersion: 1,
    mapId: value.mapId,
    width: value.width,
    height: value.height,
    tilewidth: value.tilewidth,
    tileheight: value.tileheight,
    tiles: validateData(value.tiles, length, false),
    collision: validateData(value.collision, length, true),
    events: validateEvents(value.events, value.width, value.height),
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return fail("invalidJson");
  }
}

export function createEmptyMap(mapId = "map-001", width = DEFAULT_MAP_WIDTH, height = DEFAULT_MAP_HEIGHT): EditorMap {
  if (!validId(mapId)) fail("invalidMapId");
  if (!validDimension(width)) fail("invalidWidth");
  if (!validDimension(height)) fail("invalidHeight");
  return {
    schemaVersion: 1,
    mapId,
    width,
    height,
    tilewidth: DEFAULT_TILE_SIZE,
    tileheight: DEFAULT_TILE_SIZE,
    tiles: Array<number>(width * height).fill(0),
    collision: Array<number>(width * height).fill(0),
    events: [],
  };
}

export function createStarterMap(): EditorMap {
  const map = createEmptyMap("starter-map");
  const index = (x: number, y: number) => y * map.width + x;
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      map.tiles[index(x, y)] = 1;
      if (x === 0 || y === 0 || x === map.width - 1 || y === map.height - 1) {
        map.tiles[index(x, y)] = 3;
        map.collision[index(x, y)] = 1;
      }
      if (y === 7 && x >= 2 && x <= 17) map.tiles[index(x, y)] = 4;
      if (x >= 13 && x <= 16 && y >= 9 && y <= 12) {
        map.tiles[index(x, y)] = 2;
        map.collision[index(x, y)] = 1;
      }
    }
  }
  map.events = [
    { id: "guide", name: "Guide", x: 3, y: 7 },
    { id: "gate", name: "Gate", x: 17, y: 7 },
  ];
  return map;
}

export function serializeEditorMap(map: EditorMap): string {
  return JSON.stringify(validateEditorMap(map));
}

export function deserializeEditorMap(text: string): EditorMap {
  return validateEditorMap(parseJson(text));
}

function propertyValue(properties: unknown, name: string): unknown {
  if (properties === undefined) return undefined;
  if (!Array.isArray(properties)) fail("invalidObjectProperties");
  for (const property of properties) {
    if (!isObject(property) || typeof property.name !== "string") fail("invalidObjectProperties");
    if (property.name === name) return property.value;
  }
  return undefined;
}

function parseLayerData(layer: JsonObject, width: number, height: number, collision: boolean): number[] {
  if (!Array.isArray(layer.data)) fail("invalidLayerData");
  return validateData(layer.data, width * height, collision);
}

function parseEventObjects(layer: JsonObject, mapWidth: number, mapHeight: number, tilewidth: number, tileheight: number): MapEvent[] {
  if (!Array.isArray(layer.objects)) fail("invalidObjectLayer");
  if ((layer.x !== undefined && layer.x !== 0) || (layer.y !== undefined && layer.y !== 0)) fail("invalidEventCoordinates");
  const objectIds = new Set<number>();
  const eventIds = new Set<string>();
  return layer.objects.map((entry) => {
    if (!isObject(entry)) fail("invalidDocument");
    if (!Number.isInteger(entry.id) || (entry.id as number) <= 0) fail("invalidObjectId");
    if (objectIds.has(entry.id as number)) fail("duplicateObjectId", { id: entry.id as number });
    objectIds.add(entry.id as number);
    if (!validEventName(entry.name)) fail("invalidEventName");
    if (!Number.isInteger(entry.x) || !Number.isInteger(entry.y) || (entry.x as number) < 0 || (entry.y as number) < 0) {
      fail("invalidEventCoordinates");
    }
    if ((entry.x as number) % tilewidth !== 0 || (entry.y as number) % tileheight !== 0) fail("invalidEventCoordinates");
    const x = (entry.x as number) / tilewidth;
    const y = (entry.y as number) / tileheight;
    if (x >= mapWidth || y >= mapHeight) fail("eventOutOfBounds");
    const id = propertyValue(entry.properties, "eventId");
    if (!validId(id)) fail("invalidObjectProperties");
    if (eventIds.has(id)) fail("duplicateEventId", { id });
    eventIds.add(id);
    return { id, name: entry.name, x, y };
  });
}

/** Strictly import the finite orthogonal subset emitted by this editor. */
export function parseTiledMap(text: string): EditorMap {
  const value = parseJson(text);
  if (!isObject(value)) fail("invalidDocument");
  if (value.type !== "map" || value.orientation !== "orthogonal" || value.infinite !== false) fail("invalidOrientation");
  if (!validDimension(value.width)) fail("invalidWidth");
  if (!validDimension(value.height)) fail("invalidHeight");
  if (!validTileSize(value.tilewidth) || !validTileSize(value.tileheight)) fail("invalidTileSize");
  if (value.width * value.tilewidth > MAX_CANVAS_DIMENSION || value.height * value.tileheight > MAX_CANVAS_DIMENSION) fail("invalidCanvasSize");
  if (!Array.isArray(value.layers)) fail("invalidLayers");

  let tiles: number[] | undefined;
  let collision: number[] | undefined;
  let events: MapEvent[] | undefined;
  for (const entry of value.layers) {
    if (!isObject(entry) || typeof entry.type !== "string" || typeof entry.name !== "string") fail("invalidLayer");
    if (entry.type === "tilelayer") {
      const data = parseLayerData(entry, value.width, value.height, entry.name === "collision");
      if (entry.name === "ground") {
        if (tiles) fail("invalidLayerName");
        tiles = data;
      } else if (entry.name === "collision") {
        if (collision) fail("invalidLayerName");
        collision = data;
      } else {
        fail("invalidLayerName");
      }
    } else if (entry.type === "objectgroup" && entry.name === "events") {
      if (events) fail("invalidLayerName");
      events = parseEventObjects(entry, value.width, value.height, value.tilewidth, value.tileheight);
    } else {
      fail("invalidLayer");
    }
  }
  if (!tiles || !collision) fail("invalidLayers");

  if (!Array.isArray(value.tilesets) || value.tilesets.length !== 1 || !isObject(value.tilesets[0])) fail("invalidTilesets");
  const tileset = value.tilesets[0];
  if (tileset.name !== "codequest-placeholder") fail("invalidTileset");
  if (tileset.firstgid !== 1 || tileset.tilecount !== TILE_COUNT || tileset.columns !== TILE_COUNT
    || tileset.tilewidth !== value.tilewidth || tileset.tileheight !== value.tileheight) {
    fail("invalidTilesetRange");
  }

  const mapId = propertyValue(value.properties, "mapId") ?? "untitled";
  return validateEditorMap({
    schemaVersion: 1,
    mapId,
    width: value.width,
    height: value.height,
    tilewidth: value.tilewidth,
    tileheight: value.tileheight,
    tiles,
    collision,
    events: events ?? [],
  });
}

function tileLayer(id: number, name: "ground" | "collision", data: number[], width: number, height: number) {
  return { id, name, type: "tilelayer", width, height, x: 0, y: 0, opacity: 1, visible: true, data };
}

/** Export a Tiled-compatible JSON map with a procedural-placeholder tileset descriptor. */
export function exportTiledMap(map: EditorMap) {
  const valid = validateEditorMap(map);
  const nextObjectId = valid.events.reduce((max) => max + 1, 1);
  return {
    type: "map",
    version: "1.10",
    tiledversion: "1.11.0",
    orientation: "orthogonal",
    renderorder: "right-down",
    width: valid.width,
    height: valid.height,
    tilewidth: valid.tilewidth,
    tileheight: valid.tileheight,
    infinite: false,
    nextlayerid: 4,
    nextobjectid: nextObjectId,
    properties: [{ name: "mapId", type: "string", value: valid.mapId }],
    tilesets: [{
      firstgid: 1,
      name: "codequest-placeholder",
      image: "media/codequest-placeholder.png",
      imagewidth: valid.tilewidth * TILE_COUNT,
      imageheight: valid.tileheight,
      tilewidth: valid.tilewidth,
      tileheight: valid.tileheight,
      tilecount: TILE_COUNT,
      columns: TILE_COUNT,
      margin: 0,
      spacing: 0,
      properties: [{ name: "generator", type: "string", value: "CodeQuest procedural placeholder" }],
      tiles: PLACEHOLDER_TILES.map((tile) => ({
        id: tile.gid - 1,
        properties: [{ name: "color", type: "color", value: tile.color }],
      })),
    }],
    layers: [
      tileLayer(1, "ground", valid.tiles, valid.width, valid.height),
      tileLayer(2, "collision", valid.collision, valid.width, valid.height),
      {
        id: 3,
        name: "events",
        type: "objectgroup",
        draworder: "topdown",
        x: 0,
        y: 0,
        opacity: 1,
        visible: true,
        objects: valid.events.map((event, index) => ({
          id: index + 1,
          name: event.name,
          type: "event",
          x: event.x * valid.tilewidth,
          y: event.y * valid.tileheight,
          width: valid.tilewidth,
          height: valid.tileheight,
          rotation: 0,
          visible: true,
          properties: [{ name: "eventId", type: "string", value: event.id }],
        })),
      },
    ],
  };
}

export function resizeMap(map: EditorMap, width: number, height: number): EditorMap {
  if (!validDimension(width)) fail("invalidWidth");
  if (!validDimension(height)) fail("invalidHeight");
  if (width * map.tilewidth > MAX_CANVAS_DIMENSION || height * map.tileheight > MAX_CANVAS_DIMENSION) fail("invalidCanvasSize");
  if (map.events.some((event) => event.x >= width || event.y >= height)) fail("eventsOutsideResize");
  const tiles = Array<number>(width * height).fill(0);
  const collision = Array<number>(width * height).fill(0);
  for (let y = 0; y < Math.min(height, map.height); y += 1) {
    for (let x = 0; x < Math.min(width, map.width); x += 1) {
      tiles[y * width + x] = map.tiles[y * map.width + x];
      collision[y * width + x] = map.collision[y * map.width + x];
    }
  }
  return { ...map, width, height, tiles, collision };
}

export function clearMap(map: EditorMap): EditorMap {
  return {
    ...map,
    tiles: Array<number>(map.width * map.height).fill(0),
    collision: Array<number>(map.width * map.height).fill(0),
    events: [],
  };
}

export function paintCells(
  map: EditorMap,
  layer: "tiles" | "collision",
  cells: readonly TileCoordinate[],
  value: number,
): EditorMap {
  if (layer === "tiles" && (!Number.isInteger(value) || value < 0 || value > TILE_COUNT)) fail("invalidTileGid");
  if (layer === "collision" && value !== 0 && value !== 1) fail("invalidCollisionValue");
  const key = layer === "tiles" ? "tiles" : "collision";
  const next = [...map[key]];
  let changed = false;
  for (const cell of cells) {
    if (!Number.isInteger(cell.x) || !Number.isInteger(cell.y) || cell.x < 0 || cell.y < 0
      || cell.x >= map.width || cell.y >= map.height) continue;
    const index = cell.y * map.width + cell.x;
    if (next[index] !== value) {
      next[index] = value;
      changed = true;
    }
  }
  return changed ? { ...map, [key]: next } : map;
}

export function rectangleCells(start: TileCoordinate, end: TileCoordinate): TileCoordinate[] {
  const minX = Math.min(start.x, end.x);
  const maxX = Math.max(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const maxY = Math.max(start.y, end.y);
  const cells: TileCoordinate[] = [];
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) cells.push({ x, y });
  }
  return cells;
}

export function lineCells(start: TileCoordinate, end: TileCoordinate): TileCoordinate[] {
  const cells: TileCoordinate[] = [];
  let x = start.x;
  let y = start.y;
  const dx = Math.abs(end.x - start.x);
  const dy = Math.abs(end.y - start.y);
  const sx = start.x < end.x ? 1 : -1;
  const sy = start.y < end.y ? 1 : -1;
  let error = dx - dy;
  while (true) {
    cells.push({ x, y });
    if (x === end.x && y === end.y) break;
    const doubled = error * 2;
    if (doubled > -dy) { error -= dy; x += sx; }
    if (doubled < dx) { error += dx; y += sy; }
  }
  return cells;
}

export function nextEventId(map: EditorMap): string {
  const ids = new Set(map.events.map((event) => event.id));
  let index = 1;
  while (ids.has(`event-${index}`)) index += 1;
  return `event-${index}`;
}

export function addEvent(map: EditorMap, event: MapEvent): EditorMap {
  const events = validateEvents([...map.events, event], map.width, map.height);
  return { ...map, events };
}

export function updateEvent(map: EditorMap, currentId: string, patch: Partial<Omit<MapEvent, "id">> & { id?: string }): EditorMap {
  const current = map.events.find((event) => event.id === currentId);
  if (!current) fail("eventNotFound");
  const updated = { ...current, ...patch };
  const others = map.events.filter((event) => event.id !== currentId);
  const events = validateEvents([...others, updated], map.width, map.height);
  return { ...map, events };
}

export function removeEvent(map: EditorMap, id: string): EditorMap {
  return { ...map, events: map.events.filter((event) => event.id !== id) };
}

export function eventAt(map: EditorMap, x: number, y: number): MapEvent | undefined {
  return [...map.events].reverse().find((event) => event.x === x && event.y === y);
}
