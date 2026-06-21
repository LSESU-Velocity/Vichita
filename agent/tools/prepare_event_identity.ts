import { defineTool } from "eve/tools";
import { z } from "zod";

import { buildEventIdentity, buildPackId } from "../lib/eventIdentity.js";

const Input = z.object({
  eventName: z.string().min(1),
  proposedDate: z
    .string()
    .optional()
    .describe("Preferred event date as YYYY-MM-DD. Must be a real calendar date if supplied."),
  existingEventId: z
    .string()
    .optional()
    .describe("Use when an event already has a persisted Event ID."),
  shortId: z
    .string()
    .optional()
    .describe(
      "Optional persisted 4-12 character hex suffix. Usually omit; Slack thread context creates a stable suffix automatically.",
    ),
  sourceSlackChannelId: z
    .string()
    .optional()
    .describe("Slack channel ID for the originating event thread."),
  sourceSlackThreadTs: z
    .string()
    .optional()
    .describe(
      "Root Slack thread timestamp for the originating event thread, not the timestamp of a later reply.",
    ),
});

export default defineTool({
  description:
    "Prepare a canonical Vichita Event ID, event slug, pack ID, and idempotency key. With Slack channel/thread inputs, the generated Event ID is stable across sessions for that thread. This does not write to Google Workspace; persist the returned Event ID in trackers before reuse.",
  inputSchema: Input,
  async execute(input) {
    const identity = buildEventIdentity(input);

    return {
      ...identity,
      packId: buildPackId(identity.eventId),
      eventIdFormat: "EVT-YYYYMMDD-event-slug-shortid",
      idempotencyRule:
        "For Slack-originated event records, pass sourceSlackChannelId and sourceSlackThreadTs into write tools so Drive folders can also dedupe by the stored vichitaThreadKey app property.",
    };
  },
});
