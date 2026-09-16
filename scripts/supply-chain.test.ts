import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// SEC-13. These settings are the difference between installing a dependency and running its
// author's code, so they are asserted rather than trusted to review. A change here should be a
// deliberate one, with this test updated in the same commit.

const workspace = readFileSync("pnpm-workspace.yaml", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  packageManager?: string;
  scripts?: Record<string, string>;
};

describe("the supply-chain policy", () => {
  it("refuses unreviewed dependency build scripts", () => {
    expect(workspace).toMatch(/^strictDepBuilds:\s*true$/m);
    expect(workspace).toMatch(/^dangerouslyAllowAllBuilds:\s*false$/m);
  });

  it("keeps every reviewed build script denied", () => {
    // Each of these ships prebuilt binaries, so nothing needs to run at install time.
    for (const dependency of ["esbuild", "sharp", "unrs-resolver"]) {
      expect(workspace).toMatch(
        new RegExp(`^\\s+${dependency}:\\s*false$`, "m"),
      );
    }
    expect(workspace).not.toMatch(/^\s+\S+:\s*true$/m);
  });

  it("refuses versions published in the last three days", () => {
    const age = /^minimumReleaseAge:\s*(\d+)$/m.exec(workspace);
    expect(Number(age?.[1])).toBeGreaterThanOrEqual(4320);
  });

  it("pins the package manager", () => {
    expect(packageJson.packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+$/);
  });
});

describe("the workflows", () => {
  const workflows = ["ci", "audit", "migrate", "maintenance"].map((name) => ({
    name,
    yaml: readFileSync(`.github/workflows/${name}.yml`, "utf8"),
  }));

  it.each(workflows)("$name pins every action to a commit", ({ yaml }) => {
    for (const use of yaml.match(/uses:\s*\S+/g) ?? []) {
      expect(use).toMatch(/@[0-9a-f]{40}$/);
    }
  });

  it.each(workflows)("$name declares its permissions", ({ yaml }) => {
    expect(yaml).toMatch(/^permissions:$/m);
    expect(yaml).toMatch(/^\s+contents:\s*read$/m);
  });

  it.each(workflows)("$name never runs on a fork's pull request", ({
    yaml,
  }) => {
    expect(yaml).not.toContain("pull_request_target");
  });

  it("installs with a frozen lockfile everywhere", () => {
    for (const { yaml } of workflows) {
      if (yaml.includes("pnpm install")) {
        expect(yaml).toContain("pnpm install --frozen-lockfile");
      }
    }
  });
});
