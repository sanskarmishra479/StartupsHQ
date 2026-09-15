import { authedRoute } from "../../../../../server/http/authed";
import { created, resource } from "../../../../../server/http/handler";
import * as privacy from "../../../../../server/services/privacy";
import { privacyRequestsQuery } from "../../../../../server/validation/queries";

// docs/API.md §8.9 (FR-210), admin only. Requests arrive by email; there is no public endpoint.

export const GET = authedRoute(
  { access: "admin", query: privacyRequestsQuery },
  async ({ ctx, query }) => resource(await privacy.listRequests(ctx, query)),
);

export const POST = authedRoute(
  { access: "admin", body: "json" },
  async ({ ctx, body }) =>
    created(await privacy.recordRequest(ctx, body as never)),
);
