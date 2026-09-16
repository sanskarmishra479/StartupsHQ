import { Landing } from "@/components/landing/Landing";
import { PUBLIC_READ } from "@/server/auth/context";
import { getLandingStartups } from "@/server/cache/startups";
import { getDirectoryCounts } from "@/server/cache/stats";

// The landing (FR-113, ADR-023): the most recently added startups, first as real links in the
// HTML, then on the curved grid where motion and WebGL allow.

export default async function HomePage() {
  const [cards, counts] = await Promise.all([
    getLandingStartups(PUBLIC_READ),
    getDirectoryCounts(PUBLIC_READ),
  ]);
  return (
    <Landing
      cards={cards}
      counts={{
        startups: counts.startups,
        founders: counts.founders,
        investors: counts.investors,
      }}
    />
  );
}
