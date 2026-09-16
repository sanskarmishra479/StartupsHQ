import { adminReadRoutes } from "../../../../server/http/admin-read-routes";
import { byOrigin } from "../../../../server/http/authed";
import { founderRoutes } from "../../../../server/http/entity-routes";

// docs/API.md §8.1 — the admin list and creation; there is no public founder directory.

export const GET = byOrigin({ admin: adminReadRoutes.founder.list });
export const POST = founderRoutes.create;
