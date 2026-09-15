import { roundRoutes } from "../../../../../server/http/entity-routes";

// docs/API.md §8.1. Participants change through `/startups/{id}/investors` (§8.3).

export const PATCH = roundRoutes.update;
export const DELETE = roundRoutes.remove;
