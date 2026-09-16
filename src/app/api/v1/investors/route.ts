import { adminReadRoutes } from "../../../../server/http/admin-read-routes";
import { byOrigin } from "../../../../server/http/authed";
import { investorRoutes } from "../../../../server/http/entity-routes";

// docs/API.md §8.1 — the admin list and creation; there is no public investor directory.

export const GET = byOrigin({ admin: adminReadRoutes.investor.list });
export const POST = investorRoutes.create;
