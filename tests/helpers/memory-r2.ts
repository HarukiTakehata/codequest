interface StoredObject {
  body: string;
  httpMetadata?: R2HTTPMetadata;
  customMetadata?: Record<string, string>;
}

function bodyText(value: unknown): Promise<string> {
  if (typeof value === "string") return Promise.resolve(value);
  if (value instanceof Blob) return value.text();
  if (value instanceof ArrayBuffer) return Promise.resolve(new TextDecoder().decode(value));
  if (ArrayBuffer.isView(value)) {
    return Promise.resolve(new TextDecoder().decode(value));
  }
  return new Response(value as BodyInit).text();
}

/** 最小内存 R2：记录真实读写/删除路径，并允许注入存储故障。 */
export class MemoryR2 {
  readonly objects = new Map<string, StoredObject>();
  readonly gets: string[] = [];
  readonly puts: string[] = [];
  readonly deletes: string[] = [];
  putError: Error | null = null;
  getError: Error | null = null;
  deleteError: Error | null = null;

  async put(key: string, value: unknown, options?: { httpMetadata?: R2HTTPMetadata; customMetadata?: Record<string, string> }) {
    if (this.putError) throw this.putError;
    this.puts.push(key);
    const object: StoredObject = { body: await bodyText(value), ...options };
    this.objects.set(key, object);
    return { key, size: new TextEncoder().encode(object.body).length, etag: `"${key}"`, version: "1", uploaded: new Date(), ...object };
  }

  async get(key: string) {
    this.gets.push(key);
    if (this.getError) throw this.getError;
    const object = this.objects.get(key);
    if (!object) return null;
    return {
      key, size: new TextEncoder().encode(object.body).length, etag: `"${key}"`, version: "1", uploaded: new Date(),
      ...object,
      text: async () => object.body,
      arrayBuffer: async () => new TextEncoder().encode(object.body).buffer,
    };
  }

  async delete(key: string) {
    this.deletes.push(key);
    if (this.deleteError) throw this.deleteError;
    this.objects.delete(key);
  }

  asR2(): R2Bucket {
    return this as unknown as R2Bucket;
  }
}
