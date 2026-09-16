import "server-only";

import { unstable_rethrow } from "next/navigation";
import type { z } from "zod";
import type { AuthedContext } from "../auth/context";
import { requireAdmin, requireEditor } from "../auth/session";
import {
  NotFoundError,
  PayloadTooLargeError,
  RateLimitedError,
  ValidationError,
} from "../lib/errors";
import { assertMutationRequest } from "../lib/origin";
import { getRedis, hitWindow, limitKey } from "../lib/redis";
import { noQuery, parseQuery } from "../validation/queries";
import { isUuid } from "../validation/shared";
import {
  errorResponse,
  type RouteHandler,
  type RouteResult,
  routeParams,
  toResponse,
} from "./handler";

// The wrapper for endpoints that need a signed-in editor or admin (docs/API.md §2, §8;
// SEC-03.5 layer 2, SEC-04). Checks run in a fixed order before any work is done:
//   1. anything but GET/HEAD: Origin is the admin origin, else 403; a JSON body needs
//      Content-Type: application/json, else 415 (CSRF);
//   2. a session whose user completed two-factor, else 401; an admin where required, else 403;
//   3. the per-account write budget (SEC-08);
//   4. query and route params, then the JSON body (size-capped).
// Services re-check every permission (layer 3) and validate the body with strict schemas
// (SEC-02), so handlers pass the parsed JSON through untouched.

/** Larger than any entity form; media and CSV uploads have their own endpoints. */
export const MAX_JSON_BODY_BYTES = 256 * 1024;

/**
 * Writes per minute per account (docs/API.md §5). Only staff have accounts, so this is not
 * protection from visitors — it caps the damage a stolen editor session can do in a minute.
 * Unlike sign-in, it fails **open**: a limiter outage must not stop editorial work, and every
 * write is audited regardless.
 */
export const WRITE_LIMIT_PER_MINUTE = 120;
const WRITE_WINDOW_SECONDS = 60;

export type Access = "editor" | "admin";

export type AuthedRequest<Query> = Readonly<{
  ctx: AuthedContext;
  /** The raw request, for the few endpoints that read their own body (uploads, CSV). */
  request: Request;
  params: Readonly<Record<string, string>>;
  query: Query;
  /** Parsed JSON, not yet validated: the service validates it. */
  body: unknown;
}>;

export type AuthedOptions<S extends z.ZodObject> = Readonly<{
  access: Access;
  /** `"json"` for endpoints that take a body; others ignore any body sent. */
  body?: "json";
  query?: S;
}>;

const invalidJson = () =>
  new ValidationError(
    [{ path: "(root)", message: "The body must be valid JSON." }],
    "Invalid request body.",
  );

/** Reads at most MAX_JSON_BODY_BYTES, whatever Content-Length claims, then parses JSON. */
async function readJsonBody(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > MAX_JSON_BODY_BYTES) {
    throw new PayloadTooLargeError();
  }
  const reader = request.body?.getReader();
  if (!reader) throw invalidJson();

  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_JSON_BODY_BYTES) {
      await reader.cancel();
      throw new PayloadTooLargeError();
    }
    chunks.push(value);
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks),
    );
    return JSON.parse(text);
  } catch {
    throw invalidJson();
  }
}

async function assertWriteAllowed(actorId: string): Promise<void> {
  let hit: { count: number; secondsLeft: number };
  try {
    hit = await hitWindow(
      getRedis(),
      limitKey("writes", actorId),
      WRITE_WINDOW_SECONDS,
    );
  } catch (error) {
    // Fails open by design; the outage itself is the thing to fix.
    console.error("[api] the write limiter is unavailable; allowing", error);
    return;
  }
  if (hit.count > WRITE_LIMIT_PER_MINUTE) {
    throw new RateLimitedError(hit.secondsLeft);
  }
}

/** A uuid route param; anything else cannot name a record, so it is a 404. */
export function uuidParam(
  params: Readonly<Record<string, string>>,
  key: string,
): string {
  const value = params[key];
  if (value === undefined || !isUuid(value)) throw new NotFoundError();
  return value;
}

/** Admin responses carry drafts and personal data: never stored by a shared cache. */
function noStore(response: Response): Response {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

/**
 * True when the request arrived on the admin origin. Fails closed: an unset or unparsable
 * ADMIN_ORIGIN, or any other host, counts as the public origin (as `proxy.ts` treats it).
 */
export function isAdminRequest(
  request: Request,
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const configured = env.ADMIN_ORIGIN;
  if (!configured) return false;
  let adminHost: string;
  try {
    adminHost = new URL(configured).host.toLowerCase();
  } catch {
    return false;
  }
  const host =
    request.headers.get("host")?.toLowerCase() ??
    new URL(request.url).host.toLowerCase();
  return host === adminHost;
}

/**
 * Serves one handler on the admin origin and another on the public origin, so an admin read can
 * share a path with the public read of the same records (docs/API.md §8.1). A path with no public
 * handler answers 404 off the admin origin, as `proxy.ts` does for write paths.
 */
export function byOrigin(handlers: {
  admin: RouteHandler;
  public?: RouteHandler;
}): RouteHandler {
  return async (request, context) => {
    if (isAdminRequest(request)) return handlers.admin(request, context);
    if (handlers.public) return handlers.public(request, context);
    return noStore(errorResponse(new NotFoundError(), request.method));
  };
}

export function authedRoute<S extends z.ZodObject = typeof noQuery>(
  options: AuthedOptions<S>,
  handle: (request: AuthedRequest<z.output<S>>) => Promise<RouteResult>,
): RouteHandler {
  const schema = (options.query ?? noQuery) as S;
  return async (request, context) => {
    try {
      const isWrite = request.method !== "GET" && request.method !== "HEAD";
      if (isWrite) {
        assertMutationRequest(request.headers, {
          requireJson: options.body === "json",
        });
      }
      const ctx =
        options.access === "admin"
          ? await requireAdmin(request.headers)
          : await requireEditor(request.headers);
      if (isWrite) await assertWriteAllowed(ctx.actor.id);

      const url = new URL(request.url);
      const query = parseQuery(schema, url.searchParams);
      const params = routeParams((await context?.params) ?? {});
      const body =
        options.body === "json" ? await readJsonBody(request) : undefined;

      return noStore(
        toResponse(await handle({ ctx, params, query, body, request }), url),
      );
    } catch (error) {
      unstable_rethrow(error);
      return noStore(errorResponse(error, request.method));
    }
  };
}
