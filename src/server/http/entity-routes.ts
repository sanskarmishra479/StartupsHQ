import "server-only";

import { z } from "zod";
import type { AuthedContext } from "../auth/context";
import * as batchWrites from "../services/batch-writes";
import * as founderWrites from "../services/founder-writes";
import * as investorWrites from "../services/investor-writes";
import * as lifecycle from "../services/lifecycle";
import * as roundWrites from "../services/round-writes";
import * as slugWrites from "../services/slug-writes";
import * as startupWrites from "../services/startup-writes";
import { authedRoute, uuidParam } from "./authed";
import { created, noContent, resource } from "./handler";

// docs/API.md §8.1–8.2: the same lifecycle endpoints for every entity. Writes address records by
// id. For startups, founders, investors and batches the id sits in the `[slug]` segment, because
// the public read by slug shares the path; rounds use `[id]`.

type EntityWrites = Readonly<{
  create: (ctx: AuthedContext, input: never) => Promise<unknown>;
  update: (ctx: AuthedContext, id: string, input: never) => Promise<unknown>;
}>;

const deleteQuery = z.object({ hard: z.enum(["true", "false"]).optional() });

function entityRoutes(
  entity: lifecycle.LifecycleEntity,
  writes: EntityWrites,
  idKey: "slug" | "id",
) {
  const idOf = (params: Readonly<Record<string, string>>) =>
    uuidParam(params, idKey);

  const action = (run: typeof lifecycle.publish) =>
    authedRoute({ access: "editor" }, async ({ ctx, params }) =>
      resource(await run(ctx, entity, idOf(params))),
    );

  return {
    /** `POST /{entity}` → 201, always a draft. */
    create: authedRoute(
      { access: "editor", body: "json" },
      async ({ ctx, body }) => created(await writes.create(ctx, body as never)),
    ),
    /** `PATCH /{entity}/{id}` */
    update: authedRoute(
      { access: "editor", body: "json" },
      async ({ ctx, params, body }) =>
        resource(await writes.update(ctx, idOf(params), body as never)),
    ),
    /** `DELETE /{entity}/{id}` archives; `?hard=true` deletes, admin only (checked by the service). */
    remove: authedRoute(
      { access: "editor", query: deleteQuery },
      async ({ ctx, params, query }) => {
        const id = idOf(params);
        if (query.hard === "true") {
          await lifecycle.hardDelete(ctx, entity, id);
        } else {
          await lifecycle.archive(ctx, entity, id);
        }
        return noContent();
      },
    ),
    publish: action(lifecycle.publish),
    unpublish: action(lifecycle.unpublish),
    restore: action(lifecycle.restore),
    /** `POST /{entity}/{id}/slug`, admin only (FR-409). */
    changeSlug: authedRoute(
      { access: "admin", body: "json" },
      async ({ ctx, params, body }) =>
        resource(
          await slugWrites.changeSlug(ctx, entity, idOf(params), body as never),
        ),
    ),
  };
}

export const startupRoutes = entityRoutes("startup", startupWrites, "slug");
export const founderRoutes = entityRoutes("founder", founderWrites, "slug");
export const investorRoutes = entityRoutes("investor", investorWrites, "slug");
export const batchRoutes = entityRoutes("batch", batchWrites, "slug");
export const roundRoutes = entityRoutes("round", roundWrites, "id");
