import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider, en, zh } from "@codequest/i18n";
import { describe, expect, it } from "vitest";
import App from "../../apps/editor/src/App";
import {
  DEFAULT_MAP_HEIGHT,
  DEFAULT_MAP_WIDTH,
  DEFAULT_TILE_SIZE,
  MapValidationError,
  addEvent,
  clearMap,
  createEmptyMap,
  createStarterMap,
  deserializeEditorMap,
  eventAt,
  exportTiledMap,
  lineCells,
  nextEventId,
  paintCells,
  parseTiledMap,
  rectangleCells,
  removeEvent,
  resizeMap,
  serializeEditorMap,
  updateEvent,
} from "../../apps/editor/src/map-model";

function tiledDocument() {
  return exportTiledMap(createEmptyMap("test-map", 4, 3)) as any;
}

function parseDocument(document: unknown) {
  return parseTiledMap(JSON.stringify(document));
}

describe("M6d RPGJS 地图模型", () => {
  it("新建地图使用 20 × 15、32px tile，并提供空白地形/碰撞层", () => {
    const map = createEmptyMap();
    expect(map).toMatchObject({
      schemaVersion: 1,
      mapId: "map-001",
      width: DEFAULT_MAP_WIDTH,
      height: DEFAULT_MAP_HEIGHT,
      tilewidth: DEFAULT_TILE_SIZE,
      tileheight: DEFAULT_TILE_SIZE,
      events: [],
    });
    expect(map.tiles).toHaveLength(300);
    expect(map.collision).toHaveLength(300);
    expect(map.tiles.every((cell) => cell === 0)).toBe(true);
    expect(() => createEmptyMap("../escape")).toThrow(MapValidationError);
    expect(() => createEmptyMap("map", 0, 15)).toThrow(/width/);
  });

  it("画笔、拖动画笔、橡皮与矩形填充只修改有效格子", () => {
    const blank = createEmptyMap("draw", 4, 3);
    const painted = paintCells(blank, "tiles", [{ x: 1, y: 1 }, { x: 99, y: 99 }], 2);
    expect(painted.tiles[5]).toBe(2);
    expect(painted.tiles).toHaveLength(12);
    expect(blank.tiles[5]).toBe(0);

    const stroke = lineCells({ x: 0, y: 0 }, { x: 3, y: 0 });
    const line = paintCells(painted, "tiles", stroke, 4);
    expect(line.tiles.slice(0, 4)).toEqual([4, 4, 4, 4]);

    const rectangle = paintCells(line, "tiles", rectangleCells({ x: 2, y: 1 }, { x: 3, y: 2 }), 3);
    expect(rectangle.tiles.slice(6)).toEqual([3, 3, 0, 0, 3, 3]);
    const erased = paintCells(rectangle, "tiles", rectangleCells({ x: 2, y: 1 }, { x: 3, y: 2 }), 0);
    expect(erased.tiles.slice(6)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(() => paintCells(blank, "tiles", [{ x: 0, y: 0 }], 5)).toThrow(/GIDs/);
  });

  it("碰撞层可独立绘制、矩形阻塞和擦除", () => {
    const map = createEmptyMap("collision", 3, 2);
    const blocked = paintCells(map, "collision", rectangleCells({ x: 0, y: 0 }, { x: 1, y: 1 }), 1);
    expect(blocked.collision).toEqual([1, 1, 0, 1, 1, 0]);
    expect(blocked.tiles.every((cell) => cell === 0)).toBe(true);
    const opened = paintCells(blocked, "collision", [{ x: 0, y: 0 }], 0);
    expect(opened.collision[0]).toBe(0);
    expect(() => paintCells(map, "collision", [{ x: 0, y: 0 }], 2)).toThrow(/Collision values/);
  });

  it("调整宽高保留左上角内容，清空保留尺寸，重置提供可用示例", () => {
    const map = paintCells(createEmptyMap("resize", 4, 3), "tiles", [{ x: 2, y: 1 }], 4);
    const resized = resizeMap(map, 6, 4);
    expect(resized.tiles).toHaveLength(24);
    expect(resized.tiles[8]).toBe(4);
    const cropped = resizeMap(resized, 2, 2);
    expect(cropped.tiles).toHaveLength(4);
    expect(cropped.tiles.every((cell) => cell === 0)).toBe(true);

    const cleared = clearMap(createStarterMap());
    expect(cleared.width).toBe(20);
    expect(cleared.height).toBe(15);
    expect(cleared.tiles.every((cell) => cell === 0)).toBe(true);
    expect(cleared.collision.every((cell) => cell === 0)).toBe(true);
    expect(cleared.events).toEqual([]);
    expect(createStarterMap().events).toHaveLength(2);
  });

  it("事件可放置、选中、修改 id/name/x/y、删除，并拒绝重复 id 与越界", () => {
    const map = createEmptyMap("events", 4, 3);
    const placed = addEvent(map, { id: "npc", name: "Guide", x: 1, y: 1 });
    expect(eventAt(placed, 1, 1)?.id).toBe("npc");
    expect(nextEventId(placed)).toBe("event-1");
    expect(() => addEvent(placed, { id: "npc", name: "Other", x: 2, y: 1 })).toThrow(/unique/);
    expect(() => addEvent(placed, { id: "bad id", name: "Other", x: 2, y: 1 })).toThrow(/Event id/);
    expect(() => addEvent(placed, { id: "outside", name: "Other", x: 4, y: 1 })).toThrow(/inside/);

    const updated = updateEvent(placed, "npc", { id: "guard", name: "守卫", x: 3, y: 2 });
    expect(updated.events).toEqual([{ id: "guard", name: "守卫", x: 3, y: 2 }]);
    expect(removeEvent(updated, "guard").events).toEqual([]);
    expect(() => updateEvent(updated, "missing", { x: 0 })).toThrow(/no longer exists/);
    expect(() => resizeMap(updated, 2, 2)).toThrow(/remove events/);
  });
});

describe("M6d Tiled JSON 导入/导出", () => {
  it("导出包含地图维度、两块 tilelayer、event objects、tileset 与地图 ID", () => {
    const map = addEvent(createEmptyMap("cave", 4, 3), { id: "npc-1", name: "NPC", x: 2, y: 1 });
    const document = exportTiledMap(map);
    expect(document).toMatchObject({
      type: "map",
      orientation: "orthogonal",
      width: 4,
      height: 3,
      tilewidth: 32,
      tileheight: 32,
      infinite: false,
      nextlayerid: 4,
      nextobjectid: 2,
    });
    expect(document.layers.map((layer) => layer.name)).toEqual(["ground", "collision", "events"]);
    expect((document.layers[0] as any).data).toHaveLength(12);
    expect((document.layers[1] as any).data).toHaveLength(12);
    expect(document.tilesets[0]).toMatchObject({ firstgid: 1, tilecount: 4, columns: 4 });
    const objects = (document.layers[2] as any).objects;
    expect(objects[0]).toMatchObject({ id: 1, name: "NPC", x: 64, y: 32, width: 32, height: 32 });
    expect(objects[0].properties).toContainEqual({ name: "eventId", type: "string", value: "npc-1" });
  });

  it("导出后可严格导入并完整恢复地形、碰撞、事件和本地存档", () => {
    let map = createStarterMap();
    map = paintCells(map, "tiles", [{ x: 4, y: 4 }], 2);
    map = paintCells(map, "collision", [{ x: 4, y: 4 }], 1);
    const restored = parseTiledMap(JSON.stringify(exportTiledMap(map), null, 2));
    expect(restored).toEqual(map);
    expect(deserializeEditorMap(serializeEditorMap(map))).toEqual(map);
  });

  it("没有 events 对象层时按空事件集导入", () => {
    const document = tiledDocument();
    document.layers = document.layers.filter((layer: any) => layer.type !== "objectgroup");
    expect(parseDocument(document).events).toEqual([]);
  });

  it("拒绝非法 JSON、维度、tile 尺寸与 schema", () => {
    expect(() => parseTiledMap("{")) .toThrow(/valid JSON/);
    expect(() => parseTiledMap("[]")).toThrow(/JSON object/);
    expect(() => deserializeEditorMap(JSON.stringify({ ...createEmptyMap(), schemaVersion: 2 }))).toThrow(/schema version/);
    for (const width of [0, -1, 1.5, 201]) {
      const document = tiledDocument();
      document.width = width;
      expect(() => parseDocument(document)).toThrow(/width/);
    }
    for (const tilewidth of [0, 7, 129, 32.5]) {
      const document = tiledDocument();
      document.tilewidth = tilewidth;
      expect(() => parseDocument(document)).toThrow(/Tile width/);
    }
    const oversizedCanvas = tiledDocument();
    oversizedCanvas.width = 51;
    oversizedCanvas.tilewidth = 128;
    expect(() => parseDocument(oversizedCanvas)).toThrow(/6400 pixels/);
  });

  it("严格校验 ground/collision data 长度与 GID 范围", () => {
    const shortGround = tiledDocument();
    shortGround.layers[0].data.pop();
    expect(() => parseDocument(shortGround)).toThrow(/tile layer.*12/);

    const shortCollision = tiledDocument();
    shortCollision.layers[1].data.pop();
    expect(() => parseDocument(shortCollision)).toThrow(/collision layer.*12/);

    const invalidGid = tiledDocument();
    invalidGid.layers[0].data[0] = 5;
    expect(() => parseDocument(invalidGid)).toThrow(/Tile GIDs/);

    const fractionalGid = tiledDocument();
    fractionalGid.layers[0].data[0] = 1.5;
    expect(() => parseDocument(fractionalGid)).toThrow(/Tile GIDs/);

    const invalidCollision = tiledDocument();
    invalidCollision.layers[1].data[0] = 2;
    expect(() => parseDocument(invalidCollision)).toThrow(/Collision values/);
  });

  it("拒绝缺失/重复/未知图层、非正交地图和错误 tileset 范围", () => {
    const missingCollision = tiledDocument();
    missingCollision.layers.splice(1, 1);
    expect(() => parseDocument(missingCollision)).toThrow(/ground and collision/);

    const duplicateGround = tiledDocument();
    duplicateGround.layers[1].name = "ground";
    expect(() => parseDocument(duplicateGround)).toThrow(/named ground and collision/);

    const unknownLayer = tiledDocument();
    unknownLayer.layers[0].name = "decor";
    expect(() => parseDocument(unknownLayer)).toThrow(/named ground and collision/);

    const unsupportedLayer = tiledDocument();
    unsupportedLayer.layers.push({ id: 9, name: "images", type: "imagelayer", image: "x.png" });
    expect(() => parseDocument(unsupportedLayer)).toThrow(/Only tile layers/);

    const isometric = tiledDocument();
    isometric.orientation = "isometric";
    expect(() => parseDocument(isometric)).toThrow(/orthogonal/);

    const badTileset = tiledDocument();
    badTileset.tilesets[0].tilecount = 5;
    expect(() => parseDocument(badTileset)).toThrow(/exactly 4 tiles/);

    const foreignTileset = tiledDocument();
    foreignTileset.tilesets[0].name = "another-artist";
    expect(() => parseDocument(foreignTileset)).toThrow(/metadata is invalid/);

    const noTileset = tiledDocument();
    noTileset.tilesets = [];
    expect(() => parseDocument(noTileset)).toThrow(/exactly one tileset/);
  });

  it("严格校验对象坐标、eventId 和对象/事件 ID 唯一性", () => {
    const coordinateCases = [
      { x: -1, y: 0, message: /non-negative integers/ },
      { x: 0.5, y: 0, message: /non-negative integers/ },
      { x: 1, y: 0, message: /aligned/ },
      { x: 128, y: 0, message: /inside the map/ },
      { x: 0, y: 96, message: /inside the map/ },
    ];
    for (const value of coordinateCases) {
      const document = tiledDocument();
      document.layers[2].objects = [{
        id: 1, name: "NPC", x: value.x, y: value.y,
        properties: [{ name: "eventId", type: "string", value: "npc" }],
      }];
      expect(() => parseDocument(document)).toThrow(value.message);
    }

    const missingEventId = tiledDocument();
    missingEventId.layers[2].objects = [{ id: 1, name: "NPC", x: 0, y: 0, properties: [] }];
    expect(() => parseDocument(missingEventId)).toThrow(/eventId/);

    const offsetEventLayer = tiledDocument();
    offsetEventLayer.layers[2].x = 32;
    expect(() => parseDocument(offsetEventLayer)).toThrow(/aligned/);

    const duplicateObjectId = tiledDocument();
    duplicateObjectId.layers[2].objects = [
      { id: 1, name: "A", x: 0, y: 0, properties: [{ name: "eventId", value: "a" }] },
      { id: 1, name: "B", x: 32, y: 0, properties: [{ name: "eventId", value: "b" }] },
    ];
    expect(() => parseDocument(duplicateObjectId)).toThrow(/object ids must be unique/);

    const duplicateEventId = tiledDocument();
    duplicateEventId.layers[2].objects = [
      { id: 1, name: "A", x: 0, y: 0, properties: [{ name: "eventId", value: "same" }] },
      { id: 2, name: "B", x: 32, y: 0, properties: [{ name: "eventId", value: "same" }] },
    ];
    expect(() => parseDocument(duplicateEventId)).toThrow(/Event ids must be unique/);

    const invalidObjectId = tiledDocument();
    invalidObjectId.layers[2].objects = [{ id: 0, name: "A", x: 0, y: 0, properties: [{ name: "eventId", value: "a" }] }];
    expect(() => parseDocument(invalidObjectId)).toThrow(/positive integers/);
  });
});

describe("M6d 编辑器界面与 i18n", () => {
  it("服务端渲染包含默认地图、四种 tile、三层切换和导入导出入口", () => {
    const html = renderToStaticMarkup(createElement(I18nProvider, { initialLocale: "zh" }, createElement(App)));
    expect(html).toContain('data-testid="map-canvas"');
    expect(html).toContain('width="640"');
    expect(html).toContain('height="480"');
    for (const gid of [1, 2, 3, 4]) expect(html).toContain(`data-testid="tile-${gid}"`);
    expect(html).toContain('data-testid="layer-collision"');
    expect(html).toContain('data-testid="layer-events"');
    expect(html).toContain('data-testid="import-map"');
    expect(html).toContain('data-testid="export-map"');
    expect(html).toContain("程序化占位图块");
  });

  it("英文文案齐全，语言切换按钮只包含单个图标且保留菜单 ARIA", () => {
    const html = renderToStaticMarkup(createElement(I18nProvider, { initialLocale: "en" }, createElement(App)));
    expect(html).toContain("Placeholder tileset");
    expect(html).toContain("Import JSON");
    const toggle = /<button[^>]*data-testid="language-switcher"[^>]*>([\s\S]*?)<\/button>/.exec(html)?.[1] ?? "";
    expect(toggle).toContain("<svg");
    expect(toggle).not.toContain("English");
    expect(toggle).not.toContain("中文");
    expect(toggle).not.toContain("chevron");
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');

    const editorKeys = Object.keys(en).filter((key) => key.startsWith("editor."));
    expect(editorKeys.length).toBeGreaterThan(60);
    for (const key of editorKeys) expect(zh).toHaveProperty(key);
  });
});
