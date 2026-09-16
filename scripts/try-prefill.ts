import { loadEnvConfig } from "@next/env";
import { inArray } from "drizzle-orm";
import { authedContext } from "../src/server/auth/context";
import { closeDb, getDb } from "../src/server/db/client";
import { users } from "../src/server/db/schema";
import { AppError } from "../src/server/lib/errors";
import { getRedis } from "../src/server/lib/redis";
import { type PrefillDraft, prefill } from "../src/server/services/prefill";

// Runs prefill against real company URLs and prints what it extracted, for the pre-launch check
// in docs/TEST_PLAN.md §13 ("prefill on five real company URLs — record what it gets wrong").
//
//   pnpm try:prefill https://www.example.com https://another.example
//
// Calls the service directly with an existing editor's identity, so no sign-in or authenticator
// app is needed. It does reach the real internet — that is the point — and it writes draft image
// rows into whatever database DATABASE_URL names; `pnpm media:gc` clears them.

const LABEL_WIDTH = 14;

function line(label: string, value: unknown): void {
  const text =
    value === null || value === undefined || value === ""
      ? "—"
      : String(value).replace(/\s+/g, " ");
  console.log(`  ${label.padEnd(LABEL_WIDTH)}${text.slice(0, 140)}`);
}

function report(url: string, draft: PrefillDraft): void {
  console.log(`\n${url}`);
  line("name", `${draft.name ?? "—"}   (${draft.confidence.name})`);
  line("tagline", `${draft.tagline ?? "—"}   (${draft.confidence.tagline})`);
  line(
    "description",
    `${draft.description ?? "—"}   (${draft.confidence.description})`,
  );
  line("source", draft.source);
  line("website", draft.websiteUrl);
  line("careers", draft.careersUrl);
  line(
    "links",
    [
      draft.links.linkedin && "linkedin",
      draft.links.x && "x",
      draft.links.github && "github",
    ]
      .filter(Boolean)
      .join(", ") || null,
  );
  line(
    "location",
    draft.locationGuess === null
      ? null
      : `${draft.locationGuess.raw} ${
          draft.locationGuess.matchedLocationId
            ? "(matched an existing city)"
            : "(no matching city — add one, or pick by hand)"
        }`,
  );
  for (const [label, asset] of [
    ["logo", draft.logo],
    ["cover", draft.cover],
  ] as const) {
    line(
      label,
      asset === null
        ? null
        : `${asset.image.width}x${asset.image.height} stored, widths ${asset.image.variants
            .map((variant) => variant.width)
            .join("/")}`,
    );
  }
  if (draft.warnings.length > 0) {
    console.log(`  ${"warnings".padEnd(LABEL_WIDTH)}`);
    for (const warning of draft.warnings) console.log(`    · ${warning}`);
  }
}

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());

  const urls = process.argv
    .slice(2)
    .filter((argument) => !argument.startsWith("-"));
  if (urls.length === 0) {
    console.log(
      "Usage: pnpm try:prefill <url> [url …]\n\nRun it from the repository root, with the\ndatabase and Redis up (pnpm db:up, plus the redis services in docker-compose.yml).",
    );
    return;
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set (see .env.example).");
  }

  try {
    // Any existing staff account: prefill records who fetched each image.
    const [actor] = await getDb()
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(inArray(users.role, ["admin", "editor"]))
      .limit(1);
    if (!actor) {
      throw new Error(
        'No staff account exists yet. Create one first:\n  SEED_ADMIN_PASSWORD="…" pnpm seed:admin --email you@example.com --name "Your Name"',
      );
    }
    const ctx = authedContext({ id: actor.id, role: actor.role }, "127.0.0.1");

    // Prefill fails closed without a limiter, which otherwise looks like "too many requests".
    try {
      await getRedis().ping();
    } catch {
      throw new Error(
        "The rate-limit store is unreachable, and prefill refuses to run without one.\n" +
          "  Start it:  docker compose up -d --wait redis redis-http\n" +
          "  And set:   UPSTASH_REDIS_REST_URL=http://127.0.0.1:8079\n" +
          "             UPSTASH_REDIS_REST_TOKEN=startupshq_local_redis",
      );
    }

    for (const url of urls) {
      try {
        report(url, await prefill(ctx, { url }));
      } catch (error) {
        const reason =
          error instanceof AppError ? error.message : String(error);
        console.log(`\n${url}\n  refused: ${reason}`);
        if (error instanceof AppError && error.code === "RATE_LIMITED") {
          console.log(
            "  (20 per hour per account, and it refuses outright when Redis is unreachable —\n   check that the redis and redis-http services are up.)",
          );
        }
      }
    }
    console.log(
      "\nDraft images were stored; run `pnpm media:gc` after 24 h, or ignore them.",
    );
  } finally {
    await closeDb();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
