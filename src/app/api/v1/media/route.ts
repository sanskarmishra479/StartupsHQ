import { authedRoute } from "../../../../server/http/authed";
import { created } from "../../../../server/http/handler";
import {
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
  ValidationError,
} from "../../../../server/lib/errors";
import * as media from "../../../../server/services/media";

// docs/API.md §8.5 — a multipart upload, so this handler reads its own body. The session, origin
// and per-account write budget are already checked by the wrapper.

export const POST = authedRoute(
  { access: "editor" },
  async ({ ctx, request }) => {
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
      throw new UnsupportedMediaTypeError(
        "Send the image as multipart/form-data.",
      );
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new ValidationError([{ path: "file", message: "Attach a file." }]);
    }
    // Checked before the bytes are read into memory.
    if (file.size > media.MAX_UPLOAD_BYTES) {
      throw new PayloadTooLargeError("Images must be 5 MB or smaller.");
    }

    return created(
      await media.upload(ctx, {
        purpose: String(form.get("purpose") ?? ""),
        bytes: new Uint8Array(await file.arrayBuffer()),
      }),
    );
  },
);
