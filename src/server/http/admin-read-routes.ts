import "server-only";

import * as adminReads from "../services/admin-reads";
import { adminListQuery } from "../validation/queries";
import { authedRoute, uuidParam } from "./authed";
import { collection, resource } from "./handler";

// docs/API.md §8.1 admin reads: the same paths as the public reads, served on the admin origin
// (see `byOrigin`). Uncached, drafts and archived records included, editors and admins only.

function routesFor(entity: adminReads.AdminEntity, idKey: "slug" | "id") {
  return {
    list: authedRoute(
      { access: "editor", query: adminListQuery },
      async ({ ctx, query }) =>
        collection(await adminReads.listRecords(ctx, entity, query)),
    ),
    record: authedRoute({ access: "editor" }, async ({ ctx, params }) =>
      resource(
        await adminReads.getRecord(ctx, entity, uuidParam(params, idKey)),
      ),
    ),
  };
}

export const adminReadRoutes = {
  startup: routesFor("startup", "slug"),
  founder: routesFor("founder", "slug"),
  investor: routesFor("investor", "slug"),
  batch: routesFor("batch", "slug"),
  round: routesFor("round", "id"),
};
