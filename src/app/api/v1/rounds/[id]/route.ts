import { adminReadRoutes } from "../../../../../server/http/admin-read-routes";
import { byOrigin } from "../../../../../server/http/authed";
import { roundRoutes } from "../../../../../server/http/entity-routes";

// docs/API.md §8.1. Rounds have no public page of their own; they appear in /rounds and on a
// company page. Participants change through `/startups/{id}/investors` (§8.3).

export const GET = byOrigin({ admin: adminReadRoutes.round.record });
export const PATCH = roundRoutes.update;
export const DELETE = roundRoutes.remove;
