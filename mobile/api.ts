export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL?.trim() ||
  "https://virtual-rudra.vercel.app";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = new URL(path, `${API_BASE_URL.replace(/\/+$/, "")}/`);
  const method = (options.method ?? "GET").toUpperCase();
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    headers.set("Origin", url.origin);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      method,
      headers,
      cache: "no-store",
      credentials: "include",
    });
  } catch (cause) {
    throw new Error(
      cause instanceof Error
        ? cause.message
        : "Could not reach the restaurant service. Check your connection.",
    );
  }

  let payload: unknown = null;
  if (response.status !== 204) {
    try {
      payload = await response.json();
    } catch {
      throw new ApiError("The restaurant service returned unreadable data.", response.status);
    }
  }
  if (!response.ok) {
    const message =
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : `The restaurant service returned HTTP ${response.status}.`;
    throw new ApiError(message, response.status);
  }
  return payload as T;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
