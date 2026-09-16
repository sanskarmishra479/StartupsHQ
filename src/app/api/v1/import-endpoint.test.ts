import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { closeDb, getDb } from "../../../server/db/client";
import { seed } from "../../../server/db/seed";
import {
  type CookieJar,
  createTestUser,
  deleteTestUsers,
  signInWithTwoFactor,
} from "../../../server/testing/auth";
import * as contract from "../../../server/testing/contract";
import { GET as exportReport } from "./import/[importJobId]/export.csv/route";
import { POST as commitImport } from "./import/commit/route";
import { POST as dryRun } from "./import/dry-run/route";

// docs/API.md §8.7 at the endpoint: the three steps, and who may take them.

const ADMIN_ORIGIN = "https://admin.startupshq.test";

let editor: CookieJar;

beforeAll(async () => {
  await seed(getDb());
  editor = await signInWithTwoFactor((await createTestUser("editor")).email);
});

afterAll(async () => {
  await deleteTestUsers();
  await closeDb();
});

function headersFor(jar?: CookieJar, origin: string | null = ADMIN_ORIGIN) {
  const headers = new Headers({ host: "admin.startupshq.test" });
  if (origin !== null) headers.set("origin", origin);
  if (jar) headers.set("cookie", jar.header());
  return headers;
}

function csvForm(csv: string, filename = "companies.csv"): FormData {
  const bytes = new TextEncoder().encode(csv);
  const body = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(body).set(bytes);
  const form = new FormData();
  form.set("file", new File([body], filename, { type: "text/csv" }));
  return form;
}

const post = (
  route: typeof dryRun,
  path: string,
  body: FormData | string | undefined,
  options: {
    jar?: CookieJar;
    origin?: string | null;
    contentType?: string;
  } = {},
) => {
  const headers = headersFor(options.jar, options.origin ?? ADMIN_ORIGIN);
  if (typeof body === "string") {
    headers.set("content-type", options.contentType ?? "application/json");
  }
  return route(
    new Request(`${ADMIN_ORIGIN}/api/v1${path}`, {
      method: "POST",
      headers,
      body,
    }),
    { params: Promise.resolve({}) },
  );
};

async function read<S extends z.ZodType>(
  response: Promise<Response>,
  schema: S,
  status = 200,
): Promise<z.output<S>> {
  const resolved = await response;
  const text = await resolved.text();
  expect(resolved.status, text).toBe(status);
  const parsed = schema.safeParse(JSON.parse(text));
  if (!parsed.success) throw new Error(z.prettifyError(parsed.error));
  return parsed.data;
}

async function expectError(
  response: Promise<Response>,
  status: number,
  code: string,
) {
  const resolved = await response;
  const text = await resolved.text();
  expect(resolved.status, text).toBe(status);
  expect(contract.errorBody.parse(JSON.parse(text)).error.code).toBe(code);
}

const dryRunResult = contract.single(
  z.object({
    importJobId: z.uuid(),
    expiresAt: z.iso.datetime(),
    rowCount: z.int(),
    summary: z.object({
      create: z.int(),
      update: z.int(),
      skip: z.int(),
      error: z.int(),
    }),
    rows: z.array(
      z.object({ row: z.int(), action: z.string(), name: z.string() }),
    ),
    newFounders: z.array(z.string()),
    newInvestors: z.array(z.string()),
  }),
);

describe("the import endpoints (§8.7)", () => {
  it("runs a dry run, commits it, and offers the report as a CSV", async () => {
    const plan = await read(
      post(
        dryRun,
        "/import/dry-run",
        csvForm(
          'name,tagline\nSaltmarsh Sensors,"=HYPERLINK(""https://evil.example"")"\n',
        ),
        { jar: editor },
      ),
      dryRunResult,
      201,
    );
    expect(plan.data.summary.create).toBe(1);

    const committed = await read(
      post(
        commitImport,
        "/import/commit",
        JSON.stringify({ importJobId: plan.data.importJobId }),
        { jar: editor },
      ),
      contract.single(z.object({ created: z.int(), updated: z.int() })),
    );
    expect(committed.data).toMatchObject({ created: 1, updated: 0 });

    const report = await exportReport(
      new Request(
        `${ADMIN_ORIGIN}/api/v1/import/${plan.data.importJobId}/export.csv`,
        { headers: headersFor(editor) },
      ),
      { params: Promise.resolve({ importJobId: plan.data.importJobId }) },
    );
    expect(report.status).toBe(200);
    expect(report.headers.get("content-type")).toContain("text/csv");
    expect(report.headers.get("content-disposition")).toContain(
      'attachment; filename="companies-report.csv"',
    );
    const csv = await report.text();
    expect(csv).toContain("Saltmarsh Sensors");
    expect(csv).toContain(
      "row,action,name,slug,reason,errors".replace(/,/g, '","'),
    );
  });

  it("needs a CSV, a session and the admin origin", async () => {
    await expectError(
      post(dryRun, "/import/dry-run", JSON.stringify({ rows: [] }), {
        jar: editor,
      }),
      415,
      "UNSUPPORTED_MEDIA_TYPE",
    );
    await expectError(
      post(dryRun, "/import/dry-run", new FormData(), { jar: editor }),
      400,
      "VALIDATION_ERROR",
    );
    await expectError(
      post(dryRun, "/import/dry-run", csvForm("name\nAnon Co\n")),
      401,
      "UNAUTHORIZED",
    );
    await expectError(
      post(dryRun, "/import/dry-run", csvForm("name\nCross Origin Co\n"), {
        jar: editor,
        origin: "https://startupshq.space",
      }),
      403,
      "FORBIDDEN",
    );
  });

  it("refuses to commit an import nobody ran", async () => {
    await expectError(
      post(
        commitImport,
        "/import/commit",
        JSON.stringify({ importJobId: "00000000-0000-4000-8000-000000000000" }),
        { jar: editor },
      ),
      404,
      "NOT_FOUND",
    );
    await expectError(
      post(commitImport, "/import/commit", JSON.stringify({ file: "x" }), {
        jar: editor,
      }),
      400,
      "VALIDATION_ERROR",
    );
  });
});
