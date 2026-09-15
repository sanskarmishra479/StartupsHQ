import { PUBLIC_READ } from "../../../../server/auth/context";
import { getCategoryDirectory } from "../../../../server/cache/categories";
import { publicRead, resource } from "../../../../server/http/handler";
import { noQuery } from "../../../../server/validation/queries";

// docs/API.md §6.10a

export const GET = publicRead(noQuery, async () =>
  resource(await getCategoryDirectory(PUBLIC_READ)),
);
