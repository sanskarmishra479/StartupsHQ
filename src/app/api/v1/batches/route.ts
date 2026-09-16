import { adminReadRoutes } from "../../../../server/http/admin-read-routes";
import { byOrigin } from "../../../../server/http/authed";
import { batchRoutes } from "../../../../server/http/entity-routes";

// docs/API.md §8.1 — the admin list and creation; batches are browsed through /categories.

export const GET = byOrigin({ admin: adminReadRoutes.batch.list });
export const POST = batchRoutes.create;
