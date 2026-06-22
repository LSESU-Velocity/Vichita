import { defineTool } from "eve/tools";
import { z } from "zod";

export const EventInput = z.object({
  eventName: z.string().min(1),
  eventDescription: z
    .string()
    .optional()
    .describe(
      "Raw user event description, including date, venue, travel, accommodation, and attendee wording when available.",
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
      "True only when the prompt explicitly says travel beyond/outside the M25, outside London, or a destination away from the normal venue context.",
    ),
  overnightTrip: z
    .boolean()
    .default(false)
    .describe(
      "True only when the prompt explicitly describes an overnight trip, overnight accommodation, hotel/hostel stay, residential, tour, or travel away. Do not infer this from a multi-day event at one venue.",
    ),
  externalVenue: z.boolean().default(false),
  multiDayAtSingleVenue: z
    .boolean()
    .default(false)
    .describe(
      "True when an event spans multiple days but is held at one ordinary venue. This is not a trip signal by itself.",
    ),
  tripSignals: z
    .array(z.string())
    .default([])
    .describe(
      "Short source phrases that support a trip classification, such as coach travel, hotel accommodation, beyond M25, Oxford trip, or tour.",
    ),
});

type EventClassificationInput = z.input<typeof EventInput>;

const BEYOND_M25_RE =
  /\b(?:beyond|outside)\s+(?:the\s+)?m25\b|\boutside london\b|\bleav(?:e|ing) london\b/iu;
const OVERNIGHT_AWAY_RE =
  /\b(?:overnight\s+(?:trip|stay|stays|accommodation)|stay(?:ing)? overnight|hotel|hostel|accommodation|residential)\b/iu;
const EXPLICIT_TRIP_RE = /\b(?:trip|tour)\b/iu;
const TRAVEL_PLANNING_RE =
  /\b(?:coach|train|flight|ferry|transport|travel(?:ling|ing)?|journey|departure|departing|return journey)\b/iu;
const SINGLE_VENUE_RE =
  /\b(?:single|same|one)\s+venue\b|\blse generate\b|\bgenerate hub\b|\blse\b|\bcampus\b|\bstudent centre\b/iu;
const DATE_RANGE_RE =
  /\bmulti[-\s]?day\b|\bover\s+\d+\s+days\b|\b\d{1,2}(?:st|nd|rd|th)?\s+(?:to|-)\s*\d{1,2}(?:st|nd|rd|th)?\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?\s*(?:to|-)\s*(?:\d{1,2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*)\b/iu;
const EXTERNAL_ATTENDEE_RE =
  /\b(?:students? from other universities|other universities|kcl|ucl|imperial|king'?s college|external students?|non-lse attendees?)\b/iu;

function tripEvidenceText(input: z.infer<typeof EventInput>) {
  return [
    input.eventDescription,
    input.preferredLocation,
    ...input.tripSignals,
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join("\n");
}

function hasSourceEvidence(text: string) {
  return text.trim().length > 0;
}

function stripNegatedTripPhrases(text: string) {
  return text
    .replace(/\bno\s+travel\s+or\s+accommodation(?:\s+is\s+planned)?\b/giu, "")
    .replace(/\b(?:no|not|without)\s+(?:travel|transport|accommodation|overnight stays?|trip|tour)\b/giu, "");
}

function inferTripProcess(input: z.infer<typeof EventInput>) {
  const evidenceText = stripNegatedTripPhrases(tripEvidenceText(input));
  const hasEvidence = hasSourceEvidence(evidenceText);
  const explicitBeyondM25 = BEYOND_M25_RE.test(evidenceText);
  const explicitOvernightAway = OVERNIGHT_AWAY_RE.test(evidenceText);
  const explicitTrip = EXPLICIT_TRIP_RE.test(evidenceText);
  const explicitTravelPlanning = TRAVEL_PLANNING_RE.test(evidenceText);

  if (!hasEvidence) {
    return {
      isTrip: input.tripBeyondM25 || input.overnightTrip,
      reason: input.tripBeyondM25 || input.overnightTrip
        ? "Trip beyond M25 or overnight trip"
        : undefined,
      ignoredTripFlags: false,
    };
  }

  const isTrip =
    explicitBeyondM25 ||
    explicitOvernightAway ||
    explicitTrip ||
    (input.tripBeyondM25 && (explicitBeyondM25 || explicitTravelPlanning)) ||
    (input.overnightTrip && (explicitOvernightAway || explicitTravelPlanning));

  return {
    isTrip,
    reason: explicitBeyondM25
      ? "Explicit beyond-M25 or outside-London travel signal"
      : explicitOvernightAway
        ? "Explicit overnight accommodation or residential trip signal"
        : explicitTrip
          ? "Explicit trip or tour wording"
          : isTrip
            ? "Explicit travel planning signal"
            : undefined,
    ignoredTripFlags:
      (input.tripBeyondM25 || input.overnightTrip) && !isTrip,
  };
}

export function classifyEventInput(rawInput: EventClassificationInput) {
  const input = EventInput.parse(rawInput);
  const triggers: string[] = [];
  const nonTriggers: string[] = [];
  const humanReview: string[] = [];
  const missingCriticalFields: string[] = [];
  const blocksFinalSubmissionReadiness: string[] = [];
  const evidenceText = tripEvidenceText(input);

  if (typeof input.expectedAttendance !== "number") {
    missingCriticalFields.push("Expected attendance");
    blocksFinalSubmissionReadiness.push("Expected attendance");
    humanReview.push(
      "Expected attendance missing; cannot rule out the over-75 large-event trigger.",
    );
  }

  if (
    input.multiDayAtSingleVenue ||
    (SINGLE_VENUE_RE.test(evidenceText) && DATE_RANGE_RE.test(evidenceText))
  ) {
    nonTriggers.push(
      "Multi-day duration at one named venue does not trigger the trips process.",
    );
  }

  if (EXTERNAL_ATTENDEE_RE.test(evidenceText)) {
    nonTriggers.push(
      "External university attendees do not imply travel or the trips process.",
    );
  }

  const tripDecision = inferTripProcess(input);
  if (tripDecision.ignoredTripFlags) {
    nonTriggers.push(
      "Trip flags were ignored because the source text did not include actual travel, beyond-M25, trip, tour, or accommodation evidence.",
    );
    humanReview.push(
      "Check trip status only if travel or accommodation planning is later added.",
    );
  }

  if (tripDecision.isTrip) {
    triggers.push(tripDecision.reason ?? "Trip beyond M25 or overnight trip");
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
    "Classify a proposed society event into a draft LSESU route and list triggers/blockers. Multi-day duration at one venue is not a trip; classify trips only from explicit trip, travel, beyond-M25, or accommodation signals.",
  inputSchema: EventInput,
  async execute(input) {
    return classifyEventInput(input);
  },
});
