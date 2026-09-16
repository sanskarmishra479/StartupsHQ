import { PUBLIC_READ } from "../../../../server/auth/context";
import { getNewsFirstPage } from "../../../../server/cache/rounds";
import { adminReadRoutes } from "../../../../server/http/admin-read-routes";
import { byOrigin } from "../../../../server/http/authed";
import { roundRoutes } from "../../../../server/http/entity-routes";
import {
  collection,
  noneGiven,
  publicRead,
} from "../../../../server/http/handler";
import * as rounds from "../../../../server/services/rounds";
import { roundFeedQuery } from "../../../../server/validation/queries";

// docs/API.md §6.9 — the news feed.

const newsFeed = publicRead(roundFeedQuery, async ({ ctx, query }) => {
  if (noneGiven(query)) {
    return collection(await getNewsFirstPage(PUBLIC_READ));
  }
  const { cursor, limit, round_type, ...filters } = query;
  return collection(
    await rounds.listRecent(ctx, {
      cursor,
      limit,
      filters: { ...filters, roundType: round_type },
    }),
  );
});

// On the admin origin the same path lists every round, drafts included (§8.1).

export const GET = byOrigin({
  admin: adminReadRoutes.round.list,
  public: newsFeed,
});

// docs/API.md §8.1 — the server computes USD amounts and FX (FR-406).

export const POST = roundRoutes.create;
