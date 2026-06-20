import { defineTool } from "eve/tools";
import { z } from "zod";

const EventInput = z.object({
  eventName: z.string().min(1),
  expectedAttendance: z.number().int().nonnegative().optional(),
  estimatedBudgetGbp: z.number().nonnegative().optional(),
  externalSpeakers: z
    .array(
      z.object({
        name: z.string().optional(),
        organisation: z.string().optional(),
        topic: z.string().optional(),
      }),
    )
    .default([]),
  externalOrganisationInvolved: z.boolean().default(false),
  sponsorInvolved: z.boolean().default(false),
  alcoholCentred: z.boolean().default(false),
  tripBeyondM25: z.boolean().default(false),
  overnightTrip: z.boolean().default(false),
  externalVenue: z.boolean().default(false),
});

export default defineTool({
  description:
    "Classify a proposed society event into a draft LSESU route and list triggers/blockers.",
  inputSchema: EventInput,
  async execute(input) {
    const triggers: string[] = [];
    const humanReview: string[] = [];

    if (input.tripBeyondM25 || input.overnightTrip) {
      triggers.push("Trip beyond M25 or overnight trip");
      return {
        route: "trip_process",
        triggers,
        humanReview,
        confidence: "high",
        disclaimer:
          "Draft aid only. Current published guidance and the live form/template are authoritative.",
      };
    }

    const hasSpeaker = input.externalSpeakers.length > 0;
    let large = false;

    if (hasSpeaker) {
      triggers.push("External speaker involved");
    }

    if (
      typeof input.expectedAttendance === "number" &&
      input.expectedAttendance > 75
    ) {
      large = true;
      triggers.push("Expected attendance over 75");
    }

    if (
      typeof input.estimatedBudgetGbp === "number" &&
      input.estimatedBudgetGbp > 500
    ) {
      large = true;
      triggers.push("Estimated budget over GBP 500");
    }

    if (input.externalOrganisationInvolved) {
      large = true;
      triggers.push("External organisation involved");
    }

    if (input.sponsorInvolved) {
      humanReview.push("Sponsor involvement needs sponsorship/process review");
    }

    if (input.alcoholCentred) {
      large = true;
      triggers.push("Alcohol-centred activity");
    }

    if (input.externalVenue) {
      humanReview.push("External venue details should be checked");
    }

    const route =
      large && hasSpeaker
        ? "large_speaker_event"
        : large
          ? "large_event"
          : hasSpeaker
            ? "speaker_event"
            : "regular_event_candidate";

    return {
      route,
      triggers,
      humanReview,
      confidence: triggers.length > 0 ? "high" : "medium",
      disclaimer:
        "Draft aid only. Current published guidance and the live form/template are authoritative.",
    };
  },
});
