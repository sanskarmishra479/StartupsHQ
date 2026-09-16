import { authedRoute, uuidParam } from "../../../../../../server/http/authed";
import { file } from "../../../../../../server/http/handler";
import * as importService from "../../../../../../server/services/import";

// docs/API.md §8.7 — the dry-run report as a CSV. Formula prefixes are neutralised here, on the
// way out, because that is the only place a stored value becomes a spreadsheet formula (SEC-07).

export const GET = authedRoute(
  { access: "editor" },
  async ({ ctx, params }) => {
    const report = await importService.exportReport(
      ctx,
      uuidParam(params, "importJobId"),
    );
    return file(report.csv, "text/csv; charset=utf-8", report.filename);
  },
);
