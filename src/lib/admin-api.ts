// The admin panel's calls to its own origin (docs/API.md §2, §8): JSON in, JSON out, and one error
// shape whatever went wrong. Same-origin fetches send the session cookie and an `Origin` header the
// CSRF check accepts, so nothing here handles credentials. Client-safe.

export type FieldIssue = Readonly<{ path: string; message: string }>;

export type ApiFailure = Readonly<{
  ok: false;
  status: number;
  code: string;
  message: string;
  details: readonly FieldIssue[];
  /** Seconds, from `Retry-After` on a 429. */
  retryAfter: number | null;
}>;

export type ApiSuccess<T> = Readonly<{ ok: true; status: number; data: T }>;

export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/** What a person should read for each code, when the server's own message is too terse. */
const FALLBACK_MESSAGES: Record<string, string> = {
  UNAUTHORIZED: "Your session has ended. Sign in again.",
  FORBIDDEN: "Your role cannot do this.",
  NOT_FOUND: "This record no longer exists.",
  RATE_LIMITED: "Too many requests. Wait a moment and try again.",
  NETWORK: "The server could not be reached. Check your connection.",
  INTERNAL: "Something went wrong on the server. Try again.",
};

export const messageFor = (code: string, message?: string) =>
  message || FALLBACK_MESSAGES[code] || "The request failed.";

function failure(status: number, body: unknown, headers?: Headers): ApiFailure {
  const error =
    typeof body === "object" && body !== null && "error" in body
      ? (body as { error?: Record<string, unknown> }).error
      : undefined;
  // Better Auth answers `{ code, message }` without the envelope.
  const flat =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};
  const code = String(error?.code ?? flat.code ?? `HTTP_${status}`);
  const details = Array.isArray(error?.details)
    ? (error.details as FieldIssue[])
    : [];
  const retry = Number(headers?.get("retry-after"));
  return {
    ok: false,
    status,
    code,
    message: messageFor(
      code,
      typeof (error?.message ?? flat.message) === "string"
        ? String(error?.message ?? flat.message)
        : undefined,
    ),
    details,
    retryAfter: Number.isFinite(retry) && retry > 0 ? retry : null,
  };
}

/**
 * One call to the admin origin. A body that is FormData goes as multipart; anything else as JSON.
 * Successful envelopes are unwrapped to `data` (204 gives `null`).
 */
export async function adminApi<T = unknown>(
  method: Method,
  path: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  const init: RequestInit = {
    method,
    headers: { accept: "application/json" },
    cache: "no-store",
  };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["content-type"] =
      "application/json";
  }

  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    return failure(0, { error: { code: "NETWORK" } });
  }
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!response.ok) return failure(response.status, parsed, response.headers);
  const data =
    typeof parsed === "object" && parsed !== null && "data" in parsed
      ? (parsed as { data: T }).data
      : (parsed as T);
  return { ok: true, status: response.status, data };
}

/** Better Auth's endpoints live under /api/auth and answer without the `data` envelope. */
export const authApi = <T = unknown>(path: string, body: unknown) =>
  adminApi<T>("POST", `/api/auth${path}`, body);

/** Field errors keyed by their top-level field, first message wins. */
export function fieldErrors(
  details: readonly FieldIssue[],
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const { path, message } of details) {
    const key = path.split(".")[0] ?? path;
    errors[key] ??= message;
  }
  return errors;
}
