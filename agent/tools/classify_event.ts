import { defineTool } from "eve/tools";
import { z } from "zod";

export const EventInput = z.object({
  eventName: z.string().min(1),
  eventDescription: z
    .string()
    .optional()
    .describe(
      "Raw user event description. Used for context and notes only; trip routing is driven by the structured flags below, which you set from the meaning of the prompt.",
    ),
  preferredLocation: z
    .string()
    .optional()
    .describe("Named venue or location if the user supplied one."),
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
  externalOrganisationInvolved: z
    .boolean()
    .default(false)
    .describe(
      "True only when an outside organisation is helping organise or deliver the event, not merely attending or sponsoring.",
    ),
  sponsorInvolved: z.boolean().default(false),
  alcoholCentred: z.boolean().default(false),
  tripBeyondM25: z
    .boolean()
    .default(false)
    .describe(
      "Set true when the event takes attendees to a destination away from the society's normal venue/area — e.g. beyond or outside the M25, outside London, or another town or city. This is the primary trip signal: judge it from the meaning of the prompt (including place names), not from specific keywords. Do not set it for an event at the usual venue.",
    ),
  overnightTrip: z
    .boolean()
    .default(false)
    .describe(
      "Set true only for an overnight stay AWAY from the normal venue (accommodation at or near a destination). Do NOT set it for an on-site overnight at the usual venue, e.g. a hackathon where participants sleep at the venue.",
    ),
  externalVenue: z.boolean().default(false),
  multiDayAtSingleVenue: z
    .boolean()
    .default(false)
    .describe(
      "Set true when the event spans multiple days but is held at one ordinary on-site venue (e.g. a multi-day hackathon at the usual hub). This is not a trip on its own.",
    ),
});

type EventClassificationInput = z.input<typeof EventInput>;

// The only deterministic prose check that remains is a purely informational note
// about external/public attendance. It never affects routing.
const EXTERNAL_ATTENDEE_RE =
  /\b(?:students? from other universities|other universities|kcl|ucl|imperial|king'?s college|external students?|non-lse attendees?)\b/iu;

function attendeeNoteText(input: z.infer<typeof EventInput>) {
  return [input.eventDescription, input.preferredLocation]
    .filter(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0,
    )
    .join("\n");
}

export function classifyEventInput(rawInput: EventClassificationInput) {
  const input = EventInput.parse(rawInput);
  const triggers: string[] = [];
  const nonTriggers: string[] = [];
  const humanReview: string[] = [];
  const missingCriticalFields: string[] = [];
  const blocksFinalSubmissionReadiness: string[] = [];

  if (typeof input.expectedAttendance !== "number") {
    missingCriticalFields.push("Expected attendance");
    blocksFinalSubmissionReadiness.push("Expected attendance");
    humanReview.push(
      "Expected attendance missing; cannot rule out the over-75 large-event trigger.",
    );
  }

  // Trip routing trusts the model's structured flags: the model owns the
  // "is this away / overnight away?" judgement (it can read place names and
  // phrasing that deterministic code cannot). The single correction applied here
  // is the common over-flag — an on-site multi-day event (e.g. a hackathon at the
  // usual venue, possibly with an on-site overnight stay) where the model set
  // overnightTrip but did NOT assert beyond-M25 travel or an external venue.
  const tripFlagged = input.tripBeyondM25 || input.overnightTrip;
  const onSiteOvernightOnly =
    !input.tripBeyondM25 &&
    input.multiDayAtSingleVenue &&
    !input.externalVenue;

  if (tripFlagged && !onSiteOvernightOnly) {
    triggers.push(
      input.tripBeyondM25
        ? "Trip beyond the M25 / away from the normal venue"
        : "Overnight trip with accommodation away from the normal venue",
    );
    return {
      route: "trip_process",
      triggers,
      nonTriggers,
      humanReview,
      missingCriticalFields,
      blocksFinalSubmissionReadiness,
      canGenerateDraftPack: missingCriticalFields.length === 0,
      confidence: missingCriticalFields.length > 0 ? "medium" : "high",
      disclaimer:
        "Draft aid only. Check current SU guidance and live forms before submission.",
      rulesLastVerifiedDate: process.env.RULES_LAST_VERIFIED_DATE ?? "2026-06-21",
    };
  }

  // Non-trip from here. Record the single-venue context, the external-attendee
  // note, and — when a trip flag was set but demoted — a human-review prompt.
  if (input.multiDayAtSingleVenue) {
    nonTriggers.push(
      "Multi-day duration at one named venue does not trigger the trips process.",
    );
  }

  if (EXTERNAL_ATTENDEE_RE.test(attendeeNoteText(input))) {
    nonTriggers.push(
      "External university attendees do not imply travel or the trips process.",
    );
  }

  if (tripFlagged && onSiteOvernightOnly) {
    humanReview.push(
      "Overnight was flagged but the event is multi-day at one on-site venue with no beyond-M25 travel; confirm there is no off-site trip before ruling out the trips process.",
    );
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
          : missingCriticalFields.length > 0
            ? "needs_human_review"
            : "regular_event_candidate";

  const confidence =
    missingCriticalFields.length > 0
      ? "low"
      : triggers.length > 0
        ? "high"
        : "medium";

  return {
    route,
    triggers,
    nonTriggers,
    humanReview,
    missingCriticalFields,
    blocksFinalSubmissionReadiness,
    canGenerateDraftPack: missingCriticalFields.length === 0,
    confidence,
    disclaimer:
      "Draft aid only. Check current SU guidance and live forms before submission.",
    rulesLastVerifiedDate: process.env.RULES_LAST_VERIFIED_DATE ?? "2026-06-21",
  };
}

export default defineTool({
  description:
    "Classify a proposed society event into a draft LSESU route and list triggers/blockers. Trip routing is driven by the structured tripBeyondM25 / overnightTrip / multiDayAtSingleVenue flags you set from the meaning of the prompt (including place names). A multi-day event at one on-site venue — even with an on-site overnight stay — is not a trip.",
  inputSchema: EventInput,
  async execute(input) {
    return classifyEventInput(input);
  },
});
