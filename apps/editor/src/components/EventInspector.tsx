import { useEffect, useState, type FormEvent } from "react";
import { Trash2 } from "lucide-react";
import { useI18n } from "@codequest/i18n";
import type { MapEvent } from "../map-model";

interface EventInspectorProps {
  event: MapEvent;
  maxX: number;
  maxY: number;
  onSave: (currentId: string, patch: Partial<MapEvent>) => void;
  onDelete: (id: string) => void;
}

export function EventInspector({ event, maxX, maxY, onSave, onDelete }: EventInspectorProps) {
  const { t } = useI18n();
  const [id, setId] = useState(event.id);
  const [name, setName] = useState(event.name);
  const [x, setX] = useState(String(event.x));
  const [y, setY] = useState(String(event.y));

  useEffect(() => {
    setId(event.id);
    setName(event.name);
    setX(String(event.x));
    setY(String(event.y));
  }, [event]);

  function submit(eventForm: FormEvent<HTMLFormElement>) {
    eventForm.preventDefault();
    onSave(event.id, { id: id.trim(), name, x: Number(x), y: Number(y) });
  }

  return (
    <form className="event-inspector" onSubmit={submit}>
      <div className="section-heading">
        <h3>{t("editor.events.inspector")}</h3>
        <span className="event-id">{event.id}</span>
      </div>
      <label htmlFor="event-id">{t("editor.events.id")}</label>
      <input id="event-id" className="field" value={id} onChange={(eventInput) => setId(eventInput.target.value)} maxLength={64} required />
      <label htmlFor="event-name">{t("editor.events.name")}</label>
      <input
        id="event-name"
        className="field"
        value={name}
        onChange={(eventInput) => setName(eventInput.target.value)}
        placeholder={t("editor.events.namePlaceholder")}
        maxLength={80}
      />
      <div className="field-pair">
        <label htmlFor="event-x">{t("editor.events.x")}
          <input
            id="event-x"
            className="field"
            type="number"
            min={0}
            max={maxX}
            step={1}
            value={x}
            onChange={(eventInput) => setX(eventInput.target.value)}
            required
          />
        </label>
        <label htmlFor="event-y">{t("editor.events.y")}
          <input
            id="event-y"
            className="field"
            type="number"
            min={0}
            max={maxY}
            step={1}
            value={y}
            onChange={(eventInput) => setY(eventInput.target.value)}
            required
          />
        </label>
      </div>
      <div className="inspector-actions">
        <button type="submit" className="button button-primary button-small" data-testid="save-event">
          {t("editor.actions.saveEvent")}
        </button>
        <button type="button" className="button button-danger button-small" onClick={() => onDelete(event.id)}>
          <Trash2 size={15} aria-hidden="true" />
          {t("editor.actions.deleteEvent")}
        </button>
      </div>
    </form>
  );
}
