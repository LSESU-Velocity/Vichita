import { createHash } from "node:crypto";

import { slugifyEventName } from "./eventIdentity.js";

export type SourceRegistryEntryInput = {
  sourceName: string;
  url: string;
  topicModule: string;
  lastVerifiedDate: string;
  verifiedBy: string;
  sourceStability: "stable" | "academic_year_specific" | "needs_recheck";
  academicYearSpecific: boolean;
  encodedRuleNotes: string;
  sourceSetId?: string;
  nextReviewDue?: string;
  status?: "active" | "superseded" | "needs_recheck";
};

function hashUrl(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

function requireIsoCalendarDate(name: string, value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new Error(`${name} must use YYYY-MM-DD format.`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`${name} must be a real calendar date.`);
  }
}

export function buildSourceRegistryEntry(input: SourceRegistryEntryInput) {
  requireIsoCalendarDate("lastVerifiedDate", input.lastVerifiedDate);
  if (input.nextReviewDue) {
    requireIsoCalendarDate("nextReviewDue", input.nextReviewDue);
  }

  const sourceSetId =
    input.sourceSetId?.trim() ||
    process.env.RULES_SOURCE_SET_ID?.trim() ||
    "unversioned";
  const registryEntryId = `SRC-${sourceSetId}-${slugifyEventName(
    input.sourceName,
  )}-${hashUrl(input.url)}`;

  return {
    registryEntryId,
    row: {
      "Registry Entry ID": registryEntryId,
      "Source Name": input.sourceName,
      URL: input.url,
      "Topic/Module": input.topicModule,
      "Last Verified Date": input.lastVerifiedDate,
      "Verified By": input.verifiedBy,
      "Source Stability": input.sourceStability,
      "Academic-Year Specific?": input.academicYearSpecific ? "yes" : "no",
      "Encoded Rule Notes": input.encodedRuleNotes,
      "Source Set ID": sourceSetId,
      "Next Review Due": input.nextReviewDue ?? "",
      Status: input.status ?? "active",
      "Last Updated": new Date().toISOString(),
    },
  };
}
