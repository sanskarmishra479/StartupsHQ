import { PUBLIC_READ } from "../../../../server/auth/context";
import { getNewsFirstPage } from "../../../../server/cache/rounds";
import {
  collection,
  noneGiven,
  publicRead,
} from "../../../../server/http/handler";
import * as rounds from "../../../../server/services/rounds";
import { roundFeedQuery } from "../../../../server/validation/queries";

// docs/API.md §6.9 — the news feed.

export const GET = publicRead(roundFeedQuery, async ({ ctx, query }) => {
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
