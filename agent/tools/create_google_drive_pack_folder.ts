import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";

import { parseEventId } from "../lib/eventIdentity.js";
import { createOrFindEventPackFolder } from "../lib/googleWorkspace/drive.js";

const Input = z.object({
  eventId: z.string().min(1),
  eventName: z.string().min(1),
  proposedDate: z.string().optional(),
  sourceSlackChannelId: z
    .string()
    .optional()
    .describe(
      "Slack channel ID for the originating event thread. Used with sourceSlackThreadTs for Drive idempotency.",
    ),
  sourceSlackThreadTs: z
    .string()
    .optional()
    .describe(
      "Root Slack thread timestamp for the originating event thread, not a later reply timestamp. Used with sourceSlackChannelId for Drive idempotency.",
    ),
  createEventPacksParentIfMissing: z
    .boolean()
    .default(false)
    .describe(
      "If true, create the Event Packs folder under the Vichita root when it is missing.",
    ),
});

export default defineTool({
  description:
    "Approval-gated Google Drive write. Create or find the idempotent event pack folder for an Event ID, using a human-readable visible folder name and deduping by vichitaEventId plus Slack thread app property when Slack thread inputs are supplied. Does not copy templates or generate documents.",
  inputSchema: Input,
  needsApproval: always(),
  async execute(input) {
    if (!parseEventId(input.eventId)) {
      throw new Error("eventId must use EVT-YYYYMMDD-event-slug-shortid format.");
    }

    return createOrFindEventPackFolder(input);
  },
});
