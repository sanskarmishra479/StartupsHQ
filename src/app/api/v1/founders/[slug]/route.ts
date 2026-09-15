import { PUBLIC_READ } from "../../../../../server/auth/context";
import { getFounderPage } from "../../../../../server/cache/founders";
import {
  API_V1,
  fromLookup,
  publicRead,
} from "../../../../../server/http/handler";
import { noQuery } from "../../../../../server/validation/queries";

// docs/API.md §6.4

export const GET = publicRead(noQuery, async ({ params }) =>
  fromLookup(
    await getFounderPage(PUBLIC_READ, params.slug ?? ""),
    (slug) => `${API_V1}/founders/${slug}`,
  ),
);
