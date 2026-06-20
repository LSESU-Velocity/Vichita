import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";

import { buildSourceRegistryEntry } from "../lib/sourceRegistry.js";
import { upsertTrackerRow } from "../lib/googleWorkspace/sheets.js";

const Input = z.object({
  sourceName: z.string().min(1),
  url: z.string().url(),
  topicModule: z.string().min(1),
  lastVerifiedDate: z
    .string()
    .describe("Manual verification date in YYYY-MM-DD format."),
  verifiedBy: z.string().min(1),
  sourceStability: z.enum([
    "stable",
    "academic_year_specific",
    "needs_recheck",
  ]),
  academicYearSpecific: z.boolean(),
  encodedRuleNotes: z.string().min(1),
  sourceSetId: z.string().optional(),
  nextReviewDue: z.string().optional(),
  status: z.enum(["active", "superseded", "needs_recheck"]).default("active"),
});

export default defineTool({
  description:
    "Approval-gated Google Sheets write. Upsert one Source Registry row in the Vichita Trackers spreadsheet using a stable registry entry ID. Writes values as RAW so free-text source notes are not interpreted as formulas.",
  inputSchema: Input,
  needsApproval: always(),
  async execute(input) {
    const entry = buildSourceRegistryEntry(input);
    const result = await upsertTrackerRow({
      tabName: "Source Registry",
      keyColumn: "Registry Entry ID",
      keyValue: entry.registryEntryId,
      row: entry.row,
      valueInputOption: "RAW",
    });

    return {
      registryEntryId: entry.registryEntryId,
      result,
    };
  },
});
