import { PUBLIC_READ } from "../../../../../../server/auth/context";
import { getSimilarStartups } from "../../../../../../server/cache/startups";
import {
  orNotFound,
  publicRead,
  resource,
} from "../../../../../../server/http/handler";
import { noQuery } from "../../../../../../server/validation/queries";

// docs/API.md §6.3

export const GET = publicRead(noQuery, async ({ params }) =>
  resource(
    orNotFound(await getSimilarStartups(PUBLIC_READ, params.slug ?? "")),
  ),
);
