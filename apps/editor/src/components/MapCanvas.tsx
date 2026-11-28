import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useI18n } from "@codequest/i18n";
import {
  PLACEHOLDER_TILES,
  eventAt,
  lineCells,
  type EditableLayer,
  type EditorMap,
  type MapTool,
  type TileCoordinate,
} from "../map-model";

interface MapCanvasProps {
  map: EditorMap;
  layer: EditableLayer;
  tool: MapTool;
  selectedTile: number;
  selectedEventId: string | null;
  onPaint: (cells: TileCoordinate[], erase: boolean) => void;
  onFillRectangle: (start: TileCoordinate, end: TileCoordinate, erase: boolean) => void;
  onPlaceEvent: (cell: TileCoordinate) => void;
  onSelectEvent: (id: string | null) => void;
  onDeleteEvent: (id: string) => void;
}

interface PaintingState {
  start: TileCoordinate;
  last: TileCoordinate;
}

export function MapCanvas({
  map,
  layer,
  tool,
  selectedTile,
  selectedEventId,
  onPaint,
  onFillRectangle,
  onPlaceEvent,
  onSelectEvent,
  onDeleteEvent,
}: MapCanvasProps) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const paintingRef = useRef<PaintingState | null>(null);
  const rectangleRef = useRef<{ start: TileCoordinate; end: TileCoordinate } | null>(null);
  const [hover, setHover] = useState<TileCoordinate | null>(null);
  const [rectangle, setRectangle] = useState<{ start: TileCoordinate; end: TileCoordinate } | null>(null);
  const pixelWidth = map.width * map.tilewidth;
  const pixelHeight = map.height * map.tileheight;

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, pixelWidth, pixelHeight);
    context.imageSmoothingEnabled = false;

    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1) {
        const index = y * map.width + x;
        const left = x * map.tilewidth;
        const top = y * map.tileheight;
        const gid = map.tiles[index];
        const tile = PLACEHOLDER_TILES.find((candidate) => candidate.gid === gid);
        context.fillStyle = tile?.color ?? "#edf1e8";
        context.fillRect(left, top, map.tilewidth, map.tileheight);

        if (tile) {
          context.fillStyle = tile.accent;
          if (tile.gid === 1) {
            for (let offset = 6; offset < map.tilewidth; offset += 9) {
              context.fillRect(left + offset, top + 8 + (offset % 3), 2, 5);
              context.fillRect(left + offset + 3, top + 20, 2, 4);
            }
          } else if (tile.gid === 2) {
            context.fillRect(left + 4, top + 10, map.tilewidth - 8, 2);
            context.fillRect(left + 8, top + 21, map.tilewidth - 12, 2);
          } else if (tile.gid === 3) {
            context.fillRect(left + 4, top + 5, 10, 2);
            context.fillRect(left + 18, top + 14, 9, 2);
            context.fillRect(left + 6, top + 24, 12, 2);
          } else {
            context.fillRect(left + 5, top + 3, 2, map.tileheight - 6);
            context.fillRect(left + 16, top + 3, 2, map.tileheight - 6);
            context.fillRect(left + 27, top + 3, 2, map.tileheight - 6);
          }
        }

        if (map.collision[index]) {
          context.fillStyle = "rgba(197, 62, 79, 0.28)";
          context.fillRect(left, top, map.tilewidth, map.tileheight);
          context.strokeStyle = "rgba(151, 35, 51, 0.48)";
          context.lineWidth = 1;
          context.beginPath();
          context.moveTo(left + 3, top + map.tileheight - 3);
          context.lineTo(left + map.tilewidth - 3, top + 3);
          context.stroke();
        }
      }
    }

    context.strokeStyle = "rgba(61, 72, 61, 0.16)";
    context.lineWidth = 1;
    context.beginPath();
    for (let x = 0; x <= map.width; x += 1) {
      context.moveTo(x * map.tilewidth + 0.5, 0);
      context.lineTo(x * map.tilewidth + 0.5, pixelHeight);
    }
    for (let y = 0; y <= map.height; y += 1) {
      context.moveTo(0, y * map.tileheight + 0.5);
      context.lineTo(pixelWidth, y * map.tileheight + 0.5);
    }
    context.stroke();

    map.events.forEach((event, index) => {
      const centerX = (event.x + 0.5) * map.tilewidth;
      const centerY = (event.y + 0.5) * map.tileheight;
      const radius = Math.max(8, Math.min(12, map.tilewidth * 0.3));
      context.beginPath();
      context.arc(centerX, centerY, radius, 0, Math.PI * 2);
      context.fillStyle = event.id === selectedEventId ? "#f0b429" : "#6554c0";
      context.fill();
      context.strokeStyle = "#ffffff";
      context.lineWidth = 2;
      context.stroke();
      context.fillStyle = "#ffffff";
      context.font = "700 11px ui-sans-serif, system-ui, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(String(index + 1), centerX, centerY + 0.5);
      if (event.id === selectedEventId) {
        context.strokeStyle = "#8a5a00";
        context.lineWidth = 2;
        context.strokeRect(event.x * map.tilewidth + 2, event.y * map.tileheight + 2, map.tilewidth - 4, map.tileheight - 4);
      }
    });

    if (rectangle) {
      const left = Math.min(rectangle.start.x, rectangle.end.x) * map.tilewidth;
      const top = Math.min(rectangle.start.y, rectangle.end.y) * map.tileheight;
      const width = (Math.abs(rectangle.start.x - rectangle.end.x) + 1) * map.tilewidth;
      const height = (Math.abs(rectangle.start.y - rectangle.end.y) + 1) * map.tileheight;
      context.fillStyle = "rgba(91, 91, 214, 0.22)";
      context.fillRect(left, top, width, height);
      context.strokeStyle = "#4646bd";
      context.lineWidth = 2;
      context.strokeRect(left + 1, top + 1, width - 2, height - 2);
    } else if (hover && layer !== "events") {
      if (layer === "tiles" && selectedTile > 0 && tool !== "eraser") {
        const preview = PLACEHOLDER_TILES.find((candidate) => candidate.gid === selectedTile);
        if (preview) {
          context.globalAlpha = 0.3;
          context.fillStyle = preview.color;
          context.fillRect(hover.x * map.tilewidth, hover.y * map.tileheight, map.tilewidth, map.tileheight);
          context.globalAlpha = 1;
        }
      }
      context.strokeStyle = tool === "eraser" ? "#c8465b" : "#4646bd";
      context.lineWidth = 2;
      context.strokeRect(hover.x * map.tilewidth + 1, hover.y * map.tileheight + 1, map.tilewidth - 2, map.tileheight - 2);
    }
  }, [map, selectedEventId, hover, rectangle, layer, tool, pixelWidth, pixelHeight]);

  function cellFromPointer(event: ReactPointerEvent<HTMLCanvasElement>): TileCoordinate | null {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return null;
    const x = Math.floor((event.clientX - bounds.left) / bounds.width * map.width);
    const y = Math.floor((event.clientY - bounds.top) / bounds.height * map.height);
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) return null;
    return { x, y };
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0) return;
    const cell = cellFromPointer(event);
    if (!cell) return;
    event.preventDefault();
    event.currentTarget.focus();
    setHover(cell);

    if (layer === "events") {
      const existing = eventAt(map, cell.x, cell.y);
      if (tool === "eraser") {
        if (existing) onDeleteEvent(existing.id);
      } else if (existing) {
        onSelectEvent(existing.id);
      } else {
        onPlaceEvent(cell);
      }
      return;
    }

    if (tool === "rectangle") {
      rectangleRef.current = { start: cell, end: cell };
      setRectangle(rectangleRef.current);
    } else {
      paintingRef.current = { start: cell, last: cell };
      onPaint([cell], tool === "eraser");
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const cell = cellFromPointer(event);
    setHover(cell);
    if (!cell) return;
    if (rectangleRef.current) {
      rectangleRef.current = { ...rectangleRef.current, end: cell };
      setRectangle(rectangleRef.current);
    } else if (paintingRef.current) {
      onPaint(lineCells(paintingRef.current.last, cell), tool === "eraser");
      paintingRef.current.last = cell;
    }
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    const cell = cellFromPointer(event);
    if (rectangleRef.current && cell) {
      onFillRectangle(rectangleRef.current.start, cell, tool === "eraser");
    }
    rectangleRef.current = null;
    paintingRef.current = null;
    setRectangle(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function cancelPointer() {
    rectangleRef.current = null;
    paintingRef.current = null;
    setRectangle(null);
  }

  return (
    <div className="canvas-scroll">
      <canvas
        ref={canvasRef}
        className="map-canvas"
        width={pixelWidth}
        height={pixelHeight}
        style={{ width: pixelWidth, height: pixelHeight }}
        role="application"
        tabIndex={0}
        aria-label={t("editor.canvas.label", { width: map.width, height: map.height })}
        aria-describedby="canvas-help"
        data-testid="map-canvas"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={cancelPointer}
        onPointerLeave={() => { if (!paintingRef.current && !rectangleRef.current) setHover(null); }}
        onKeyDown={(event) => { if (event.key === "Escape") cancelPointer(); }}
        onContextMenu={(event) => event.preventDefault()}
      >
        {t("editor.canvas.hint")}
      </canvas>
    </div>
  );
}
