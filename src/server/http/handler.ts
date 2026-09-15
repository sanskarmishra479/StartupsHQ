import "server-only";

import { unstable_rethrow } from "next/navigation";
import type { z } from "zod";
import { type PublicContext, publicContext } from "../auth/context";
import type { CachedLookup, NotFound } from "../lib/cached-lookup";
import {
  AppError,
  NotFoundError,
  RateLimitedError,
  toErrorResponse,
} from "../lib/errors";
import { clientIp } from "../lib/ip";
import type { Page } from "../lib/pagination";
import { parseQuery } from "../validation/queries";

// The shared wrapper for public read endpoints (docs/API.md §3, §4, §6; SEC-12, SEC-14).
// Every handler runs the same steps in the same order: trusted client IP → query validation →
// public context → service → DTO envelope, with one error mapping. Reads never look at cookies,
// so a read is anonymous on either origin and cannot branch on identity. Endpoints that need a
// session use `authedRoute` (./authed.ts), which shares the results and error mapping below.

export const API_V1 = "/api/v1";

type RawParams = Record<string, string | string[] | undefined>;

export type RouteContext = Readonly<{ params: Promise<RawParams> }>;

export type RouteHandler = (
  request: Request,
  context?: RouteContext,
) => Promise<Response>;

export type ReadRequest<Query> = Readonly<{
  ctx: PublicContext;
  params: Readonly<Record<string, string>>;
  query: Query;
}>;

export type RouteResult =
  | Readonly<{ kind: "resource"; data: unknown }>
  | Readonly<{ kind: "created"; data: unknown }>
  | Readonly<{ kind: "page"; page: Page<unknown> }>
  | Readonly<{ kind: "body"; body: unknown }>
  | Readonly<{ kind: "redirect"; path: string }>
  | Readonly<{ kind: "no-content" }>;

/** `200 { data }` */
export const resource = (data: unknown): RouteResult => ({
  kind: "resource",
  data,
});

/** `201 { data }` */
export const created = (data: unknown): RouteResult => ({
  kind: "created",
  data,
});

/** `204` */
export const noContent = (): RouteResult => ({ kind: "no-content" });

/** `200 { data, pagination }` */
export const collection = (page: Page<unknown>): RouteResult => ({
  kind: "page",
  page,
});

/** A DTO that already is the whole body, such as SearchResults (`{ data, meta }`). */
export const body = (value: unknown): RouteResult => ({
  kind: "body",
  body: value,
});

/** A slug read: the record, a 301 to its current slug (API.md §1), or a 404. */
export function fromLookup<T>(
  result: CachedLookup<T>,
  pathFor: (slug: string) => string,
): RouteResult {
  if (result.kind === "found") return resource(result.value);
  if (result.kind === "redirect") {
    return { kind: "redirect", path: pathFor(result.slug) };
  }
  throw new NotFoundError();
}

function isNotFound(value: unknown): value is NotFound {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as { kind?: unknown }).kind === "not-found"
  );
}

/** Unwraps a cached read that returns absence as a value. */
export function orNotFound<T>(value: T | NotFound): T {
  if (isNotFound(value)) throw new NotFoundError();
  return value as T;
}

/** True when no value was supplied, so a handler may serve the shared cached first page. */
export const noneGiven = (values: Readonly<Record<string, unknown>>) =>
  Object.values(values).every((value) => value === undefined);

/** Route params as strings; a catch-all array or a missing value is simply absent. */
export function routeParams(raw: RawParams): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") params[key] = value;
  }
  return params;
}

export function toResponse(result: RouteResult, url: URL): Response {
  switch (result.kind) {
    case "resource":
      return Response.json({ data: result.data });
    case "created":
      return Response.json({ data: result.data }, { status: 201 });
    case "page":
      return Response.json({
        data: result.page.data,
        pagination: result.page.pagination,
      });
    case "body":
      return Response.json(result.body);
    case "no-content":
      return new Response(null, { status: 204 });
    case "redirect":
      // Always a same-origin path: the slug comes from our own database.
      if (!result.path.startsWith("/") || result.path.startsWith("//")) {
        throw new Error("Redirects must be same-origin paths.");
      }
      return Response.redirect(new URL(result.path, url.origin), 301);
  }
}

/** The one error mapping for every API response: typed errors as-is, anything else a bare 500. */
export function errorResponse(error: unknown, method: string): Response {
  if (!(error instanceof AppError)) {
    // Detail goes to the server log only (Sentry from Phase 22); the body stays generic (SEC-12).
    console.error(`[api] unhandled error in a ${method} handler`, error);
  }
  const { status, body: errorBody } = toErrorResponse(error);
  const headers: Record<string, string> = {};
  if (error instanceof RateLimitedError) {
    headers["Retry-After"] = String(error.retryAfterSeconds);
  }
  return Response.json(errorBody, { status, headers });
}

export function publicRead<S extends z.ZodObject>(
  schema: S,
  handle: (request: ReadRequest<z.output<S>>) => Promise<RouteResult>,
): RouteHandler {
  return async (request, context) => {
    try {
      const ip = clientIp(request.headers);
      const url = new URL(request.url);
      const query = parseQuery(schema, url.searchParams);
      const ctx = publicContext(ip);
      const params = routeParams((await context?.params) ?? {});
      return toResponse(await handle({ ctx, params, query }), url);
    } catch (error) {
      // Next.js signals some control flow by throwing; those must never become a 500.
      unstable_rethrow(error);
      return errorResponse(error, request.method);
    }
  };
}
