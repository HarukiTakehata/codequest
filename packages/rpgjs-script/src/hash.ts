/** Deterministic, runtime-neutral serialization for attempt hashes. */
export function stableStringify(value: unknown): string {
  const seen = new Set<object>();

  const visit = (item: unknown): string => {
    if (item === null) return "null";
    switch (typeof item) {
      case "undefined": return "undefined";
      case "string": return `string:${JSON.stringify(item)}`;
      case "boolean": return `boolean:${item ? "true" : "false"}`;
      case "number":
        if (Number.isNaN(item)) return "number:NaN";
        if (item === Infinity) return "number:Infinity";
        if (item === -Infinity) return "number:-Infinity";
        if (Object.is(item, -0)) return "number:-0";
        return `number:${String(item)}`;
      case "bigint": return `bigint:${String(item)}`;
      case "symbol": return `symbol:${String(item.description ?? "")}`;
      case "function": return `function:${item.name || "<anonymous>"}`;
      case "object": break;
    }

    const object = item as object;
    if (seen.has(object)) throw new TypeError("cannot hash a cyclic value");
    seen.add(object);
    try {
      if (Array.isArray(item)) return `[${item.map(visit).join(",")}]`;
      const record = item as Record<string, unknown>;
      const keys = Object.keys(record).sort();
      return `{${keys.map((key) => `${JSON.stringify(key)}:${visit(record[key])}`).join(",")}}`;
    } finally {
      seen.delete(object);
    }
  };

  return visit(value);
}

/**
 * FNV-1a over UTF-16 code units. This is an audit/replay identifier, not a
 * cryptographic signature; it deliberately uses no Node or browser API.
 */
export function deterministicHash(value: unknown): string {
  const text = stableStringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, "0")}`;
}

export function hashScript(source: string): string {
  return deterministicHash(source);
}
