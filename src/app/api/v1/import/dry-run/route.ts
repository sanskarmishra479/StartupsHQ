import { authedRoute } from "../../../../../server/http/authed";
import { created } from "../../../../../server/http/handler";
import {
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
  ValidationError,
} from "../../../../../server/lib/errors";
import * as importService from "../../../../../server/services/import";

// docs/API.md §8.7 — the mandatory dry run. Multipart, so this handler reads its own body.

/** 1,000 rows of startup data fit in far less; anything larger is not a startup sheet. */
const MAX_CSV_BYTES = 4 * 1024 * 1024;

export const POST = authedRoute(
  { access: "editor" },
  async ({ ctx, request }) => {
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
      throw new UnsupportedMediaTypeError(
        "Send the CSV as multipart/form-data.",
      );
    }

    const file = (await request.formData()).get("file");
    if (!(file instanceof File)) {
      throw new ValidationError([
        { path: "file", message: "Attach a CSV file." },
      ]);
    }
    if (file.size > MAX_CSV_BYTES) {
      throw new PayloadTooLargeError("CSV files must be 4 MB or smaller.");
    }

    return created(
      await importService.dryRun(ctx, {
        filename: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
      }),
    );
  },
);
