import { PUBLIC_READ } from "../../../../server/auth/context";
import { getStartupsFirstPage } from "../../../../server/cache/startups";
import {
  collection,
  noneGiven,
  publicRead,
} from "../../../../server/http/handler";
import * as startups from "../../../../server/services/startups";
import { startupListQuery } from "../../../../server/validation/queries";

// docs/API.md §6.1 — the explore grid.

export const GET = publicRead(startupListQuery, async ({ ctx, query }) => {
  const { sort, cursor, limit, ...facets } = query;
  if (noneGiven({ cursor, limit, ...facets })) {
    return collection(await getStartupsFirstPage(PUBLIC_READ, sort));
  }
  return collection(
    await startups.list(ctx, {
      sort,
      cursor,
      limit,
      filters: {
        stage: facets.stage,
        industry: facets.industry,
        workType: facets.work_type,
        city: facets.city,
        country: facets.country,
        batch: facets.batch,
        investor: facets.investor,
        founder: facets.founder,
        q: facets.q,
        includeAcquired: facets.include_acquired,
      },
    }),
  );
});
