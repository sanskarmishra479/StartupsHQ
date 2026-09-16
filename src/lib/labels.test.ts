import { describe, expect, it } from "vitest";
import {
  investorTypeEnum,
  roundTypeEnum,
  stageEnum,
  workTypeEnum,
} from "../server/db/schema";
import {
  enumToSlug,
  INVESTOR_TYPE_LABELS,
  investorTypeLabel,
  ROUND_TYPE_LABELS,
  roundTypeLabel,
  STAGE_LABELS,
  slugToEnum,
  stageLabel,
  WORK_TYPE_LABELS,
  workTypeLabel,
} from "./labels";

describe("labels", () => {
  it.each([
    ["stage", STAGE_LABELS, stageEnum.enumValues],
    ["work type", WORK_TYPE_LABELS, workTypeEnum.enumValues],
    ["investor type", INVESTOR_TYPE_LABELS, investorTypeEnum.enumValues],
    ["round type", ROUND_TYPE_LABELS, roundTypeEnum.enumValues],
  ] as const)("covers exactly the database %s enum", (_label, labels, values) => {
    expect(Object.keys(labels).sort()).toEqual([...values].sort());
  });

  it("labels known values and nothing else", () => {
    expect(stageLabel("series_a")).toBe("Series A");
    expect(workTypeLabel("onsite")).toBe("On-site");
    expect(investorTypeLabel("vc")).toBe("VC");
    expect(roundTypeLabel("series_a")).toBe("Series A");
    expect(stageLabel("unicorn")).toBeUndefined();
    expect(stageLabel("toString")).toBeUndefined();
  });
});

describe("enum slugs", () => {
  it("round-trips every stage", () => {
    for (const stage of stageEnum.enumValues) {
      expect(slugToEnum(enumToSlug(stage), stageEnum.enumValues)).toBe(stage);
    }
  });

  it.each([
    "series_a",
    "unicorn",
    "series-z",
    "",
    "SERIES-A",
  ])("rejects %j", (slug) => {
    expect(slugToEnum(slug, stageEnum.enumValues)).toBeUndefined();
  });
});
