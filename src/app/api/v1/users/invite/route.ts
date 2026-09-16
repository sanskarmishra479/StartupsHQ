import { authedRoute } from "../../../../../server/http/authed";
import { created } from "../../../../../server/http/handler";
import * as users from "../../../../../server/services/users";

// docs/API.md §8.8 — invites by email; the invitee sets a password, then enrols two-factor.

export const POST = authedRoute(
  { access: "admin", body: "json" },
  async ({ ctx, body }) => created(await users.inviteUser(ctx, body as never)),
);
