import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";

import { ensureTrackerTabs } from "../lib/googleWorkspace/sheets.js";

const Input = z.object({
  createMissingTabs: z
    .boolean()
    .default(true)
    .describe("Create missing tabs in the Vichita Trackers spreadsheet."),
  writeMissingHeaders: z
    .boolean()
    .default(true)
    .describe("Write header rows only for tabs that have no header row."),
  repairHeaderRows: z
    .boolean()
    .default(false)
    .describe(
      "Replace differing existing header rows with the canonical schema. Use cautiously.",
    ),
});

export default defineTool({
  description:
    "Approval-gated Google Sheets write. Create/verify required Vichita Trackers tabs and write missing canonical header rows.",
  inputSchema: Input,
  needsApproval: always(),
  async execute(input) {
    return ensureTrackerTabs(input);
  },
  toModelOutput(output) {
    return {
      type: "json",
      value: {
        ok: output.ok,
        createdTabs: output.createdTabs,
        wroteHeaders: output.wroteHeaders,
        repairedHeaders: output.repairedHeaders,
        skippedHeaderRepairs: output.skippedHeaderRepairs,
        remainingMissingTabs: output.missingTabs,
        remainingMissingHeaders: output.tabsWithMissingHeaders,
        remainingHeaderDifferences: output.tabsWithHeaderDifferences,
        spreadsheetUrl: output.spreadsheetUrl,
      },
    };
  },
});
