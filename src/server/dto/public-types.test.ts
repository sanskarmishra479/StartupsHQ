import { describe, expectTypeOf, it } from "vitest";
import type * as Client from "../../types/public";
import type { Page, Pagination } from "../lib/pagination";
import type { Batch, BatchStats } from "./batch";
import type {
  CategoryDirectory,
  CategoryEntry,
  CategoryKind,
  CategoryPage,
} from "./category";
import type { Founder } from "./founder";
import type { Image } from "./image";
import type { Investor, InvestorBreakdown } from "./investor";
import type { NewsItem } from "./news";
import type {
  BatchHit,
  FounderHit,
  InvestorHit,
  SearchResults,
  Suggestion,
  SuggestionType,
} from "./search";
import type {
  FounderRole,
  HeadcountBand,
  InvestorType,
  LocationSummary,
  Round,
  RoundClass,
  RoundType,
  Stage,
  Startup,
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
    expectTypeOf<Client.Pagination>().toEqualTypeOf<Pagination>();
    expectTypeOf<Client.InvestorType>().toEqualTypeOf<InvestorType>();
    expectTypeOf<Client.FounderRole>().toEqualTypeOf<FounderRole>();
    expectTypeOf<Client.RoundClass>().toEqualTypeOf<RoundClass>();
    expectTypeOf<Client.HeadcountBand>().toEqualTypeOf<HeadcountBand>();
    expectTypeOf<Client.Round>().toEqualTypeOf<Round>();
    expectTypeOf<Client.Startup>().toEqualTypeOf<Startup>();
    expectTypeOf<Client.Founder>().toEqualTypeOf<Founder>();
    expectTypeOf<Client.InvestorBreakdown>().toEqualTypeOf<InvestorBreakdown>();
    expectTypeOf<Client.Investor>().toEqualTypeOf<Investor>();
    expectTypeOf<Client.BatchStats>().toEqualTypeOf<BatchStats>();
    expectTypeOf<Client.Batch>().toEqualTypeOf<Batch>();
    expectTypeOf<Client.NewsItem>().toEqualTypeOf<NewsItem>();
    expectTypeOf<Client.CategoryPage>().toEqualTypeOf<CategoryPage>();
    expectTypeOf<Client.Page<Client.StartupCard>>().toEqualTypeOf<
      Page<StartupCard>
    >();
    expectTypeOf<Client.CategoryKind>().toEqualTypeOf<CategoryKind>();
    expectTypeOf<Client.CategoryEntry>().toEqualTypeOf<CategoryEntry>();
    expectTypeOf<Client.CategoryDirectory>().toEqualTypeOf<CategoryDirectory>();
    expectTypeOf<Client.FounderHit>().toEqualTypeOf<FounderHit>();
    expectTypeOf<Client.InvestorHit>().toEqualTypeOf<InvestorHit>();
    expectTypeOf<Client.BatchHit>().toEqualTypeOf<BatchHit>();
    expectTypeOf<Client.SearchResults>().toEqualTypeOf<SearchResults>();
    expectTypeOf<Client.SuggestionType>().toEqualTypeOf<SuggestionType>();
    expectTypeOf<Client.Suggestion>().toEqualTypeOf<Suggestion>();
  });
});
