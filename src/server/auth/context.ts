import "server-only";

// Request identity for every service call (docs/SRS.md §5, ADR-003, ADR-013).

export type Role = "admin" | "editor";

export type Actor = Readonly<{ id: string; role: Role }>;

/**
 * Proves a context came from `authedContext()`. The symbol is module-private, so an object
 * literal elsewhere — a bug, deserialized JSON, a copied value — can neither satisfy the type
 * nor pass the runtime check. Anything unproven is treated as public (fail closed, SEC-03.4).
 */
const GENUINE: unique symbol = Symbol("startupshq.authed-context");

export type PublicContext = Readonly<{ kind: "public"; ip: string }>;

export type AuthedContext = Readonly<{
  kind: "authed";
  actor: Actor;
  ip: string;
  [GENUINE]: true;
}>;

/** Per-request identity. */
export type RequestContext = PublicContext | AuthedContext;

/**
 * Carries no identity and never varies, so it is safe inside a shared cache key.
 * The only context `src/server/cache/**` functions accept (SEC-03.6).
 */
export type PublicReadContext = Readonly<{ kind: "public-read" }>;

/** Any context a read may receive. */
export type ReadContext = RequestContext | PublicReadContext;

export const PUBLIC_READ: PublicReadContext = Object.freeze({
  kind: "public-read",
});

export function publicContext(ip: string): PublicContext {
  return Object.freeze({ kind: "public", ip });
}

export function authedContext(actor: Actor, ip: string): AuthedContext {
  if (!actor.id || (actor.role !== "admin" && actor.role !== "editor")) {
    throw new Error(
      "authedContext requires an actor with an id and a valid role.",
    );
  }
  return Object.freeze({
    kind: "authed",
    actor: Object.freeze({ id: actor.id, role: actor.role }),
    ip,
    [GENUINE]: true as const,
  });
}

/** True only for contexts built by `authedContext()`. */
export function isAuthedContext(ctx: unknown): ctx is AuthedContext {
  if (typeof ctx !== "object" || ctx === null) return false;
  const candidate = ctx as Partial<AuthedContext>;
  return (
    candidate[GENUINE] === true &&
    candidate.kind === "authed" &&
    (candidate.actor?.role === "admin" || candidate.actor?.role === "editor")
  );
}

/** Runtime guard for cached public reads: rejects anything but PUBLIC_READ's shape. */
export function assertPublicRead(
  ctx: unknown,
): asserts ctx is PublicReadContext {
  if (
    typeof ctx !== "object" ||
    ctx === null ||
    (ctx as { kind?: unknown }).kind !== "public-read" ||
    Object.keys(ctx).length !== 1
  ) {
    throw new Error("Cached public reads accept only PUBLIC_READ.");
  }
}
