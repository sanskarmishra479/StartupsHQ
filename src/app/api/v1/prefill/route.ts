import { authedRoute } from "../../../../server/http/authed";
import { resource } from "../../../../server/http/handler";
import * as prefill from "../../../../server/services/prefill";

// docs/API.md §8.6 (FR-401, SEC-05) — fetches a URL the caller chose, so every refusal the
// service raises is deliberate. Nothing here is persisted as an entity.

export const POST = authedRoute(
  { access: "editor", body: "json" },
  async ({ ctx, body }) => resource(await prefill.prefill(ctx, body as never)),
);
