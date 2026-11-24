export interface C2wBrowserAssetOptions {
  network?: boolean;
  totalBytes?: number;
  root?: string;
}

export interface C2wBrowserWorkerAssets {
  vmWorker: string;
  ringWorker: string;
  vendorFiles: Map<string, Uint8Array>;
}

export const C2W_PROGRESS_CHANNEL: string;
export const C2W_RUNTIME_CACHE_MARKER: string;

export function instrumentC2wWorkerProgress(source: string, options?: { totalBytes?: number }): string;
export function patchC2wWorkerSource(source: string, options?: { network?: boolean }): string;
export function instrumentC2wWorkerCache(source: string, options?: { root?: string }): Promise<string>;
export function loadC2wBrowserWorkerAssets(root?: string, options?: C2wBrowserAssetOptions): Promise<C2wBrowserWorkerAssets>;
