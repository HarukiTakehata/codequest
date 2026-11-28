import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties, type FormEvent } from "react";
import {
  Brush,
  Download,
  Eraser,
  Grid3X3,
  Layers,
  MapPin,
  Plus,
  RotateCcw,
  Shield,
  Square,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useI18n, type MessageKey } from "@codequest/i18n";
import { EventInspector } from "./components/EventInspector";
import { LanguageSwitcher } from "./components/LanguageSwitcher";
import { MapCanvas } from "./components/MapCanvas";
import {
  DEFAULT_MAP_HEIGHT,
  DEFAULT_MAP_WIDTH,
  EDITOR_STORAGE_KEY,
  MAX_MAP_DIMENSION,
  PLACEHOLDER_TILES,
  MapValidationError,
  addEvent,
  clearMap,
  createEmptyMap,
  createStarterMap,
  deserializeEditorMap,
  exportTiledMap,
  nextEventId,
  paintCells,
  parseTiledMap,
  rectangleCells,
  removeEvent,
  resizeMap,
  serializeEditorMap,
  updateEvent,
  type EditableLayer,
  type EditorErrorCode,
  type EditorMap,
  type MapEvent,
  type MapTool,
  type TileCoordinate,
} from "./map-model";

interface Notice {
  kind: "error" | "success" | "info";
  key: MessageKey;
  params?: Record<string, string | number>;
}

interface InitialMap {
  map: EditorMap;
  restored: boolean;
  errorCode?: EditorErrorCode | "unknown";
  errorParams?: Record<string, string | number>;
}

function loadInitialMap(): InitialMap {
  if (typeof window === "undefined") return { map: createStarterMap(), restored: false };
  try {
    const saved = window.localStorage.getItem(EDITOR_STORAGE_KEY);
    if (!saved) return { map: createStarterMap(), restored: false };
    return { map: deserializeEditorMap(saved), restored: true };
  } catch (error) {
    return {
      map: createStarterMap(),
      restored: false,
      errorCode: error instanceof MapValidationError ? error.code : "unknown",
      errorParams: error instanceof MapValidationError ? error.params : undefined,
    };
  }
}

export default function App() {
  const { t } = useI18n();
  const [initial] = useState(loadInitialMap);
  const [map, setMap] = useState(initial.map);
  const [layer, setLayer] = useState<EditableLayer>("tiles");
  const [tool, setTool] = useState<MapTool>("brush");
  const [selectedTile, setSelectedTile] = useState(1);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [mapIdDraft, setMapIdDraft] = useState(initial.map.mapId);
  const [widthDraft, setWidthDraft] = useState(String(initial.map.width));
  const [heightDraft, setHeightDraft] = useState(String(initial.map.height));
  const [saveState, setSaveState] = useState<"saved" | "error">("saved");
  const [notice, setNotice] = useState<Notice | null>(() => initial.errorCode ? {
    kind: "error",
    key: `editor.error.${initial.errorCode}` as MessageKey,
    params: initial.errorParams,
  } : initial.restored ? { kind: "info", key: "editor.notice.restored" } : null);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const updateTitle = () => { document.title = t("editor.app.title"); };
    updateTitle();
    // The shared provider also updates the document title in a parent effect;
    // run once more after that effect so the editor keeps its own localized title.
    const frame = window.requestAnimationFrame(updateTitle);
    return () => window.cancelAnimationFrame(frame);
  }, [t]);

  useEffect(() => {
    setMapIdDraft(map.mapId);
    setWidthDraft(String(map.width));
    setHeightDraft(String(map.height));
  }, [map.mapId, map.width, map.height]);

  useEffect(() => {
    try {
      window.localStorage.setItem(EDITOR_STORAGE_KEY, serializeEditorMap(map));
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }, [map]);

  function showError(error: unknown) {
    setNotice(error instanceof MapValidationError ? {
      kind: "error",
      key: `editor.error.${error.code}` as MessageKey,
      params: error.params,
    } : { kind: "error", key: "editor.error.unknown" });
  }

  function showNotice(key: MessageKey) {
    setNotice({ kind: "success", key });
  }

  function changeLayer(next: EditableLayer) {
    setLayer(next);
    setTool(next === "events" ? "event" : tool === "event" ? "brush" : tool);
  }

  function changeTool(next: MapTool) {
    setTool(next);
    if (next === "event") setLayer("events");
    else if (layer === "events") setLayer("tiles");
  }

  function paint(cells: TileCoordinate[], erase: boolean) {
    if (layer === "events") return;
    const value = layer === "collision" ? (erase ? 0 : 1) : (erase ? 0 : selectedTile);
    setMap((current) => paintCells(current, layer, cells, value));
  }

  function fillRectangle(start: TileCoordinate, end: TileCoordinate, erase: boolean) {
    if (layer === "events") return;
    const value = layer === "collision" ? (erase ? 0 : 1) : (erase ? 0 : selectedTile);
    setMap((current) => paintCells(current, layer, rectangleCells(start, end), value));
  }

  function placeEvent(cell: TileCoordinate) {
    const id = nextEventId(map);
    const event: MapEvent = {
      id,
      name: t("editor.event.defaultName", { count: map.events.length + 1 }),
      x: cell.x,
      y: cell.y,
    };
    try {
      setMap(addEvent(map, event));
      setSelectedEventId(id);
      showNotice("editor.notice.eventAdded");
    } catch (error) {
      showError(error);
    }
  }

  function deleteEvent(id: string) {
    setMap((current) => removeEvent(current, id));
    if (selectedEventId === id) setSelectedEventId(null);
    showNotice("editor.notice.eventDeleted");
  }

  function saveEvent(currentId: string, patch: Partial<MapEvent>) {
    try {
      setMap(updateEvent(map, currentId, patch));
      if (patch.id) setSelectedEventId(patch.id);
      showNotice("editor.notice.eventUpdated");
    } catch (error) {
      showError(error);
    }
  }

  function applySettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const resized = resizeMap({ ...map, mapId: mapIdDraft.trim() }, Number(widthDraft), Number(heightDraft));
      serializeEditorMap(resized);
      setMap(resized);
      showNotice("editor.notice.updated");
    } catch (error) {
      showError(error);
    }
  }

  function newMap() {
    setMap(createEmptyMap(`map-${Date.now().toString(36)}`, DEFAULT_MAP_WIDTH, DEFAULT_MAP_HEIGHT));
    setSelectedEventId(null);
    setLayer("tiles");
    setTool("brush");
    showNotice("editor.notice.created");
  }

  function resetMap() {
    setMap(createStarterMap());
    setSelectedEventId(null);
    setLayer("tiles");
    setTool("brush");
    showNotice("editor.notice.reset");
  }

  function clearCurrentMap() {
    setMap((current) => clearMap(current));
    setSelectedEventId(null);
    showNotice("editor.notice.cleared");
  }

  async function importMap(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) {
        setNotice({ kind: "error", key: "editor.error.fileTooLarge" });
        return;
      }
      const imported = parseTiledMap(await file.text());
      setMap(imported);
      setSelectedEventId(null);
      setLayer("tiles");
      setTool("brush");
      showNotice("editor.notice.imported");
    } catch (error) {
      showError(error);
    }
  }

  function downloadMap() {
    try {
      const json = JSON.stringify(exportTiledMap(map), null, 2);
      const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${map.mapId}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      showNotice("editor.notice.exported");
    } catch (error) {
      showError(error);
    }
  }

  const selectedEvent = map.events.find((event) => event.id === selectedEventId) ?? null;
  const layerHint = layer === "tiles" ? "editor.hint.tiles" : layer === "collision" ? "editor.hint.collision" : "editor.hint.events";

  return (
    <div className="editor-app">
      <a className="skip-link" href="#editor-main">{t("editor.skipToContent")}</a>
      <header className="editor-header">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true"><Grid3X3 size={23} /></div>
          <div>
            <div className="brand-title-row">
              <h1>{t("editor.app.title")}</h1>
              <span className="version-badge">{t("editor.app.badge")}</span>
            </div>
            <p>{t("editor.app.subtitle")}</p>
          </div>
        </div>
        <div className="header-actions">
          <span className={`save-state ${saveState === "error" ? "is-error" : ""}`} role="status">
            <span className="status-dot" aria-hidden="true" />
            {t(saveState === "saved" ? "editor.save.saved" : "editor.save.error")}
          </span>
          <LanguageSwitcher />
          <input ref={importRef} className="sr-only" type="file" accept="application/json,.json" onChange={importMap} tabIndex={-1} />
          <button type="button" className="button button-outline" onClick={() => importRef.current?.click()} data-testid="import-map">
            <Upload size={16} aria-hidden="true" />{t("editor.actions.import")}
          </button>
          <button type="button" className="button button-primary" onClick={downloadMap} data-testid="export-map">
            <Download size={16} aria-hidden="true" />{t("editor.actions.export")}
          </button>
        </div>
      </header>

      {notice && (
        <div className={`notice notice-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>
          <span>{t(notice.key, notice.params)}</span>
          <button type="button" className="icon-button" onClick={() => setNotice(null)} aria-label={t("editor.actions.close")}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}

      <main id="editor-main" className="editor-workspace">
        <section className="canvas-panel" aria-label={t("editor.canvas.label", { width: map.width, height: map.height })}>
          <div className="canvas-toolbar">
            <div className="toolbar-group" role="group" aria-label={t("editor.layers.title")}>
              <span className="toolbar-label"><Layers size={15} aria-hidden="true" />{t("editor.layers.title")}</span>
              <button
                type="button"
                className={`tool-button ${layer === "tiles" ? "is-active" : ""}`}
                aria-pressed={layer === "tiles"}
                onClick={() => changeLayer("tiles")}
                data-testid="layer-tiles"
              ><Grid3X3 size={15} aria-hidden="true" />{t("editor.layers.tiles")}</button>
              <button
                type="button"
                className={`tool-button ${layer === "collision" ? "is-active" : ""}`}
                aria-pressed={layer === "collision"}
                onClick={() => changeLayer("collision")}
                data-testid="layer-collision"
              ><Shield size={15} aria-hidden="true" />{t("editor.layers.collision")}</button>
              <button
                type="button"
                className={`tool-button ${layer === "events" ? "is-active" : ""}`}
                aria-pressed={layer === "events"}
                onClick={() => changeLayer("events")}
                data-testid="layer-events"
              ><MapPin size={15} aria-hidden="true" />{t("editor.layers.events")}</button>
            </div>
            <div className="toolbar-group tools-group" role="group" aria-label={t("editor.tools.title")}>
              <button type="button" className={`tool-button ${tool === "brush" ? "is-active" : ""}`} aria-pressed={tool === "brush"} onClick={() => changeTool("brush")} data-testid="tool-brush">
                <Brush size={15} aria-hidden="true" />{t("editor.tools.brush")}
              </button>
              <button type="button" className={`tool-button ${tool === "eraser" ? "is-active" : ""}`} aria-pressed={tool === "eraser"} onClick={() => changeTool("eraser")} data-testid="tool-eraser">
                <Eraser size={15} aria-hidden="true" />{t("editor.tools.eraser")}
              </button>
              <button type="button" className={`tool-button ${tool === "rectangle" ? "is-active" : ""}`} aria-pressed={tool === "rectangle"} onClick={() => changeTool("rectangle")} data-testid="tool-rectangle">
                <Square size={15} aria-hidden="true" />{t("editor.tools.rectangle")}
              </button>
              <button type="button" className={`tool-button ${tool === "event" ? "is-active" : ""}`} aria-pressed={tool === "event"} onClick={() => changeTool("event")} data-testid="tool-event">
                <MapPin size={15} aria-hidden="true" />{t("editor.tools.event")}
              </button>
            </div>
          </div>

          <div className="canvas-stage">
            <MapCanvas
              map={map}
              layer={layer}
              tool={tool}
              selectedTile={selectedTile}
              selectedEventId={selectedEventId}
              onPaint={paint}
              onFillRectangle={fillRectangle}
              onPlaceEvent={placeEvent}
              onSelectEvent={setSelectedEventId}
              onDeleteEvent={deleteEvent}
            />
          </div>
          <div className="canvas-footer">
            <p id="canvas-help">{t(layerHint)}</p>
          </div>
        </section>

        <aside className="editor-sidebar" aria-label={t("editor.settings.title")}>
          <section className="panel">
            <div className="section-heading"><h2>{t("editor.settings.title")}</h2></div>
            <form className="settings-form" onSubmit={applySettings}>
              <label htmlFor="map-id">{t("editor.settings.mapId")}</label>
              <input
                id="map-id"
                className="field"
                value={mapIdDraft}
                onChange={(event) => setMapIdDraft(event.target.value)}
                placeholder={t("editor.settings.mapIdPlaceholder")}
                maxLength={64}
                required
              />
              <div className="field-pair">
                <label htmlFor="map-width">{t("editor.settings.width")}
                  <input
                    id="map-width"
                    className="field"
                    type="number"
                    min={1}
                    max={MAX_MAP_DIMENSION}
                    step={1}
                    value={widthDraft}
                    onChange={(event) => setWidthDraft(event.target.value)}
                    required
                  />
                </label>
                <label htmlFor="map-height">{t("editor.settings.height")}
                  <input
                    id="map-height"
                    className="field"
                    type="number"
                    min={1}
                    max={MAX_MAP_DIMENSION}
                    step={1}
                    value={heightDraft}
                    onChange={(event) => setHeightDraft(event.target.value)}
                    required
                  />
                </label>
              </div>
              <p className="field-hint">{t("editor.settings.hint")}</p>
              <p className="tile-size">{t("editor.settings.tileSize", { width: map.tilewidth, height: map.tileheight })}</p>
              <button type="submit" className="button button-outline button-wide button-small">{t("editor.actions.apply")}</button>
            </form>
            <div className="settings-actions">
              <button type="button" className="button button-outline button-small" onClick={newMap} data-testid="new-map">
                <Plus size={15} aria-hidden="true" />{t("editor.actions.new")}
              </button>
              <button type="button" className="button button-outline button-small" onClick={clearCurrentMap} data-testid="clear-map">
                <Trash2 size={15} aria-hidden="true" />{t("editor.actions.clear")}
              </button>
              <button type="button" className="button button-ghost button-small" onClick={resetMap} data-testid="reset-map">
                <RotateCcw size={15} aria-hidden="true" />{t("editor.actions.reset")}
              </button>
            </div>
          </section>

          <section className="panel">
            <div className="section-heading"><h2>{t("editor.tiles.title")}</h2></div>
            <div className="tile-palette" role="group" aria-label={t("editor.tiles.title")}>
              {PLACEHOLDER_TILES.map((tile) => (
                <button
                  type="button"
                  key={tile.gid}
                  className={`tile-choice ${selectedTile === tile.gid ? "is-active" : ""}`}
                  style={{ "--tile-color": tile.color, "--tile-accent": tile.accent } as CSSProperties}
                  aria-label={t("editor.tiles.select", { name: t(tile.labelKey) })}
                  aria-pressed={selectedTile === tile.gid}
                  title={t(tile.labelKey)}
                  onClick={() => { setSelectedTile(tile.gid); if (layer === "events") changeLayer("tiles"); setTool("brush"); }}
                  data-testid={`tile-${tile.gid}`}
                >
                  <span className="tile-swatch" aria-hidden="true" />
                  <span>{t(tile.labelKey)}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="panel events-panel">
            <div className="section-heading">
              <h2>{t("editor.events.title")}</h2>
              <span className="count-badge">{t("editor.events.count", { count: map.events.length })}</span>
            </div>
            {map.events.length === 0 ? (
              <p className="empty-state">{t("editor.events.empty")}</p>
            ) : (
              <div className="event-list" role="list">
                {map.events.map((event) => (
                  <button
                    type="button"
                    role="listitem"
                    key={event.id}
                    className={`event-list-item ${selectedEventId === event.id ? "is-active" : ""}`}
                    onClick={() => { setSelectedEventId(event.id); setLayer("events"); setTool("event"); }}
                    aria-label={t("editor.events.select", { name: event.name || event.id })}
                  >
                    <MapPin size={14} aria-hidden="true" />
                    <span>{event.name || event.id}</span>
                    <small>{event.x}, {event.y}</small>
                  </button>
                ))}
              </div>
            )}
            {selectedEvent && (
              <EventInspector
                key={selectedEvent.id}
                event={selectedEvent}
                maxX={map.width - 1}
                maxY={map.height - 1}
                onSave={saveEvent}
                onDelete={deleteEvent}
              />
            )}
          </section>
        </aside>
      </main>

      <footer className="editor-footer">{t("editor.footer.localOnly")}</footer>
    </div>
  );
}
