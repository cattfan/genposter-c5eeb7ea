// HTTP client tối thiểu cho backend NestJS.
//
// Tất cả request đi qua /api/v1 (Vite proxy về localhost:3001 ở dev,
// trực tiếp ở production). JSON in/out, throw RemoteError khi !ok.

const API_BASE = "/api/v1";

export class RemoteError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    message: string,
  ) {
    super(message);
    this.name = "RemoteError";
  }
}

async function parseError(res: Response): Promise<never> {
  let detail = "";
  try {
    const body = (await res.json()) as { message?: string };
    detail = body?.message ?? "";
  } catch {
    detail = await res.text().catch(() => "");
  }
  throw new RemoteError(res.status, res.statusText, detail || `${res.status} ${res.statusText}`);
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  if (!res.ok) await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const remoteClient = {
  get<T>(path: string): Promise<T> {
    return request<T>("GET", path);
  },
  put<T>(path: string, body: unknown): Promise<T> {
    return request<T>("PUT", path, body);
  },
  post<T>(path: string, body: unknown): Promise<T> {
    return request<T>("POST", path, body);
  },
  delete<T>(path: string, body?: unknown): Promise<T> {
    return request<T>("DELETE", path, body);
  },
  /** Upload binary blob qua multipart. Trả về { blobKey, mime, size }. */
  async uploadBlob(blob: Blob, blobKey?: string): Promise<{ blobKey: string; mime: string; size: number }> {
    const formData = new FormData();
    formData.append("file", blob);
    const headers: HeadersInit = {};
    if (blobKey) (headers as Record<string, string>)["x-blob-key"] = blobKey;
    const res = await fetch(`${API_BASE}/blobs`, {
      method: "POST",
      headers,
      body: formData,
      credentials: "same-origin",
    });
    if (!res.ok) await parseError(res);
    return (await res.json()) as { blobKey: string; mime: string; size: number };
  },
  /**
   * Batch upload nhiều blob trong 1 multipart request. Giảm 95% network
   * overhead so với upload từng cái khi import folder lớn (5000+ ảnh).
   * Backend giới hạn 50 file/request -> caller chia batches.
   */
  async uploadBlobsBatch(
    blobs: Blob[],
  ): Promise<Array<{ blobKey: string; mime: string; size: number }>> {
    if (blobs.length === 0) return [];
    const formData = new FormData();
    for (const blob of blobs) {
      formData.append("files", blob);
    }
    const res = await fetch(`${API_BASE}/blobs/batch`, {
      method: "POST",
      body: formData,
      credentials: "same-origin",
    });
    if (!res.ok) await parseError(res);
    const result = (await res.json()) as {
      blobs: Array<{ blobKey: string; mime: string; size: number }>;
    };
    return result.blobs;
  },
};

/** URL public để render `<img src=...>`. Trả relative path để Vite proxy. */
export function blobPublicUrl(blobKey: string): string {
  return `${API_BASE}/blobs/${encodeURIComponent(blobKey)}`;
}

export const API_BASE_URL = API_BASE;
