import { describe, expectTypeOf, it } from "vitest";
import type * as Client from "../../types/public";
import type { Image } from "./image";
import type {
  LocationSummary,
  RoundType,
  Stage,
  StartupCard,
  WorkType,
} from "./startup";

// The client-safe copies in src/types/public.ts must stay identical to what the mappers emit. The
// assertions are checked by `pnpm typecheck`; the test body itself does nothing at run time.

describe("src/types/public.ts", () => {
  it("matches the server DTOs exactly", () => {
    expectTypeOf<Client.Stage>().toEqualTypeOf<Stage>();
    expectTypeOf<Client.WorkType>().toEqualTypeOf<WorkType>();
    expectTypeOf<Client.RoundType>().toEqualTypeOf<RoundType>();
    expectTypeOf<Client.Image>().toEqualTypeOf<Image>();
    expectTypeOf<Client.LocationSummary>().toEqualTypeOf<LocationSummary>();
    expectTypeOf<Client.StartupCard>().toEqualTypeOf<StartupCard>();
  });
});
