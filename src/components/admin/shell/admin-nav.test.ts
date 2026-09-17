import { describe, expect, it } from "vitest";
import { ADMIN_NAV, adminSectionFor } from "./admin-nav";

describe("adminSectionFor", () => {
  it.each([
    ["/admin", "/admin"],
    ["/admin/startups", "/admin/startups"],
    ["/admin/startups/new", "/admin/startups"],
    ["/admin/startupsx", undefined],
    ["/admin/users", "/admin/users"],
  ])("%s belongs to %s", (pathname, section) => {
    expect(adminSectionFor(pathname)).toBe(section);
  });

  it("marks only the staff and privacy tools as admin-only (FR-208, FR-210)", () => {
    const adminOnly = ADMIN_NAV.flatMap((group) => group.items)
      .filter((item) => item.adminOnly)
      .map((item) => item.href);
    expect(adminOnly).toEqual(["/admin/users", "/admin/privacy"]);
  });
});
