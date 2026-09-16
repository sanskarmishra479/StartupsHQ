import { authedRoute } from "../../../../../server/http/authed";
import { resource } from "../../../../../server/http/handler";
import * as importService from "../../../../../server/services/import";

// docs/API.md §8.7 — applies the rows the dry run stored, in one transaction.

export const POST = authedRoute(
  { access: "editor", body: "json" },
  async ({ ctx, body }) =>
    resource(await importService.commit(ctx, body as never)),
);
