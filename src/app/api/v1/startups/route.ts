import { PUBLIC_READ } from "../../../../server/auth/context";
import { getStartupsFirstPage } from "../../../../server/cache/startups";
import { adminReadRoutes } from "../../../../server/http/admin-read-routes";
import { byOrigin } from "../../../../server/http/authed";
import { startupRoutes } from "../../../../server/http/entity-routes";
import {
  collection,
  noneGiven,
  publicRead,
} from "../../../../server/http/handler";
import * as startups from "../../../../server/services/startups";
import { startupListQuery } from "../../../../server/validation/queries";

// docs/API.md §6.1 — the explore grid.

const exploreGrid = publicRead(startupListQuery, async ({ ctx, query }) => {
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

// On the admin origin the same path lists drafts and archived records instead (§8.1).

export const GET = byOrigin({
  admin: adminReadRoutes.startup.list,
  public: exploreGrid,
});

// docs/API.md §8.1 — creates a draft, with nested relations in one transaction.

export const POST = startupRoutes.create;
