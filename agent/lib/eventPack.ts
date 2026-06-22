import type { sheets_v4 } from "googleapis";

import { buildPackId } from "./eventIdentity.js";
import { displayDateFromIsoDate, eventDateRangeLabel } from "./dateLabels.js";

export type EventRoute =
  | "regular_event_candidate"
  | "large_event"
  | "speaker_event"
  | "large_speaker_event"
  | "trip_process"
  | "needs_human_review";

export type EventSpeaker = {
  name?: string;
  role?: string;
  organisation?: string;
  topic?: string;
};

export type DeadlinePlanItem = {
  task: string;
  dueDate?: string;
  deadlineType?: string;
  sourceRule?: string;
  blocksFinalSubmissionReadiness?: boolean;
  notes?: string[];
};

export type BudgetLineItem = {
  description: string;
  pricePerItem: number;
  quantity: number;
  notes?: string;
};

export type BudgetIncomeLine = {
  pricePerItem: number;
  quantity: number;
  notes?: string;
};

export type BudgetInput = {
  expenses?: BudgetLineItem[];
  income?: {
    memberTicket?: BudgetIncomeLine;
    nonMemberTicket?: BudgetIncomeLine;
    nonLseTicket?: BudgetIncomeLine;
    sponsorship?: BudgetIncomeLine;
    societyAccountContribution?: BudgetIncomeLine;
    sufRequested?: BudgetIncomeLine;
    otherIncome?: BudgetIncomeLine;
  };
};

export type EventPackInput = {
  eventId: string;
  eventName: string;
  eventDescription?: string;
  proposedDate?: string;
  proposedEndDate?: string;
  setupStartTime?: string;
  eventStartTime?: string;
  eventEndTime?: string;
  expectedAttendance?: number;
  preferredLocation?: string;
  externalVenueDetails?: string;
  organiserName?: string;
  organiserRole?: string;
  organiserLseEmail?: string;
  organiserContactNumber?: string;
  firstAidPlan?: string;
  isRepeatedEvent?: boolean;
  repeatedEventDates?: string;
  accessibilityPlan?: string;
  accessibilityContactOrRequestRoute?: string;
  externalSpeakers?: EventSpeaker[];
  academicChairStatus?: string;
  academicChairNameEmail?: string;
  externalOrganisationInvolved?: boolean;
  externalOrganisationName?: string;
  sponsorInvolved?: boolean;
  sponsorName?: string;
  estimatedCost?: number;
  societyBalanceEstimate?: number;
  foodOrRefreshments?: boolean;
  alcohol?: boolean;
  publicOrNonLseAttendees?: boolean;
  under18sOrVulnerableAdults?: boolean;
  filmScreening?: boolean;
  tripBeyondM25?: boolean;
  overnightTrip?: boolean;
  multiDayAtSingleVenue?: boolean;
  onSiteOvernightStay?: boolean;
  externalVenue?: boolean;
  classificationRoute?: EventRoute;
  classificationReason?: string;
  triggers?: string[];
  missingCriticalFields?: string[];
  blocksFinalSubmissionReadiness?: string[];
  ticketingPlan?: string;
  attendeeRegistrationEntryPlan?: string;
  publicEventAcademicChairNote?: string;
  sufStatus?: string;
  contractsAttachedStatus?: string;
  tripType?: string;
  transportPlan?: string;
  accommodationPlan?: string;
  societyLedExplanation?: string;
  highRiskOrHighProfileSpeaker?: boolean;
  budget?: BudgetInput;
  deadlines?: DeadlinePlanItem[];
  generatedAtUtc?: string;
  generatedBy?: string;
  packVersion?: number;
  rulesLastVerifiedDate?: string;
  rulesSourceSetId?: string;
};

export type EventPackFileLinks = {
  packFolderLink?: string;
  riskAssessmentLink?: string;
  budgetLink?: string;
  fieldPackLink?: string;
  accessibilityChecklistLink?: string;
  accessibilityTasksStatus?: string;
  deadlinePlanLink?: string;
  internalReviewSummaryLink?: string;
};

export type RiskRow = {
  hazardIdentified: string;
  whyHazard: string;
  whoAtRisk: string;
  riskScore: string;
  actionsBeforeEvent: string;
  actionsDuringEvent: string;
  owner: string;
};

export type BudgetRequirement = {
  shouldGenerateBudget: boolean;
  required: boolean;
  requiredReasons: string[];
  planningReasons: string[];
  reasons: string[];
};

export type SheetValueUpdate = {
  range: string;
  values: Array<Array<string | number>>;
  valueInputOption: "RAW" | "USER_ENTERED";
};

export type GeneratedSheetCell = string | number | boolean;

export type GeneratedSheet = {
  sheetTitle: string;
  values: GeneratedSheetCell[][];
  frozenRowCount?: number;
  checkboxColumns?: number[];
  columnWidths?: number[];
};

const SOCIETY_NAME = "LSESU Velocity";
const DEFAULT_RULES_LAST_VERIFIED = "not provided";
const DEFAULT_RULES_SOURCE_SET = "not provided";
const FIELD_PACK_DISCLAIMER =
  "Draft aid only. LSESU's current published guidance and the live form/template are authoritative. This was generated for internal Velocity review and must be checked before submission.";

function text(value: string | undefined, fallback = "TBC") {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

function yesNo(value: boolean | undefined) {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "TBC";
}

function displayDate(value: string | undefined) {
  return displayDateFromIsoDate(value) ?? text(value);
}

// Human-facing event date label that covers single-day and multi-day events.
// Renders "DD-MM-YYYY" or "DD-MM-YYYY to DD-MM-YYYY" from the structured start/end
// dates so every generated artifact shows the full range, not just the start day.
function eventDateRangeDisplay(input: EventPackInput) {
  return (
    eventDateRangeLabel({
      startIsoDate: input.proposedDate,
      endIsoDate: input.proposedEndDate,
    }) ?? text(input.proposedDate)
  );
}

function generatedDisplayDate(input: EventPackInput) {
  const generatedAt = input.generatedAtUtc
    ? new Date(input.generatedAtUtc)
    : new Date();

  if (Number.isNaN(generatedAt.getTime())) return text(input.generatedAtUtc);
  return `${String(generatedAt.getUTCDate()).padStart(2, "0")}-${String(
    generatedAt.getUTCMonth() + 1,
  ).padStart(2, "0")}-${generatedAt.getUTCFullYear()}`;
}

function eventDateTimeWithSetup(input: EventPackInput) {
  const date = eventDateRangeDisplay(input);
  const setup = text(input.setupStartTime);
  const start = text(input.eventStartTime);
  const end = text(input.eventEndTime);

  return `${date}, setup ${setup}, event ${start}-${end}`;
}

function routeLabel(route: EventRoute | undefined) {
  switch (route) {
    case "regular_event_candidate":
      return "Regular Event candidate";
    case "large_event":
      return "Large Event";
    case "speaker_event":
      return "Speaker Event";
    case "large_speaker_event":
      return "Large/Speaker Event";
    case "trip_process":
      return "Trip process";
    case "needs_human_review":
      return "Needs human review";
    default:
      return "TBC";
  }
}

function hasSpeakers(input: EventPackInput) {
  return (input.externalSpeakers ?? []).length > 0;
}

function listOrNone(values: string[] | undefined) {
  const filtered = (values ?? []).map((value) => value.trim()).filter(Boolean);
  if (filtered.length === 0) return "- None recorded";
  return filtered.map((value) => `- ${value}`).join("\n");
}

function tableCellText(value: string) {
  return value
    .replace(/\\\|/g, "|")
    .replace(/\s+/g, " ")
    .trim();
}

function isMarkdownTableSeparator(cells: string[]) {
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function isMarkdownTableHeader(cells: string[]) {
  const first = cells[0]?.toLowerCase();
  const second = cells[1]?.toLowerCase();

  return (
    (first === "official form field" && second === "draft answer") ||
    (first === "trips field" && second === "draft answer")
  );
}

export function plainGoogleDocText(markdownish: string) {
  const output: string[] = [];

  for (const rawLine of markdownish.trim().split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      if (output.length > 0 && output[output.length - 1] !== "") {
        output.push("");
      }
      continue;
    }

    const heading = trimmed.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      if (output.length > 0 && output[output.length - 1] !== "") {
        output.push("");
      }
      output.push(heading[1]);
      continue;
    }

    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const cells = trimmed
        .slice(1, -1)
        .split("|")
        .map(tableCellText);

      if (isMarkdownTableSeparator(cells) || isMarkdownTableHeader(cells)) {
        continue;
      }

      output.push(cells.length === 2 ? `${cells[0]}: ${cells[1]}` : cells.join(" | "));
      continue;
    }

    const checkbox = trimmed.match(/^- \[[ xX]\]\s+(.+)$/);
    if (checkbox) {
      output.push(`TODO: ${checkbox[1]}`);
      continue;
    }

    const bullet = trimmed.match(/^- (.+)$/);
    if (bullet) {
      output.push(bullet[1]);
      continue;
    }

    output.push(line);
  }

  return `${output.join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
}

function speakerDetails(input: EventPackInput) {
  const speakers = input.externalSpeakers ?? [];
  if (speakers.length === 0) return "No external speakers recorded.";

  return speakers
    .map((speaker, index) => {
      const parts = [
        text(speaker.name, `Speaker ${index + 1}`),
        text(speaker.role, "role TBC"),
        text(speaker.organisation, "organisation TBC"),
        text(speaker.topic, "topic TBC"),
      ];
      return `${index + 1}. ${parts.join(", ")}`;
    })
    .join("\n");
}

function speakerTopics(input: EventPackInput) {
  const topics = (input.externalSpeakers ?? [])
    .map((speaker) => speaker.topic?.trim())
    .filter((topic): topic is string => Boolean(topic));

  return topics.length > 0 ? topics.join("; ") : "TBC";
}

// Important submission fields that are still TBC in the generated pack. Derived
// deterministically from the input so the internal review / form pack do not
// report "None recorded" while the risk, header, and form fields still carry
// TBC values for things the SU form requires.
function deriveMissingCriticalFields(input: EventPackInput): string[] {
  const missing: string[] = [];
  const isTrip =
    input.classificationRoute === "trip_process" ||
    Boolean(input.tripBeyondM25 || input.overnightTrip);

  if (!input.proposedDate?.trim()) missing.push("Event date");
  if (!input.eventStartTime?.trim() || !input.eventEndTime?.trim()) {
    missing.push("Event start/end time");
  }
  if (!input.preferredLocation?.trim()) missing.push("Confirmed event location");
  if (typeof input.expectedAttendance !== "number") {
    missing.push("Expected attendance");
  }
  if (!input.firstAidPlan?.trim()) missing.push("First-aid plan");
  if (!input.organiserName?.trim()) missing.push("Event lead name");
  if (!input.organiserLseEmail?.trim()) missing.push("Event lead LSE email");
  if (!input.organiserContactNumber?.trim()) {
    missing.push("Event lead contact number");
  }
  if (hasSpeakers(input) && !input.academicChairStatus?.trim()) {
    missing.push("Academic chair status");
  }
  if (isTrip) {
    if (!input.transportPlan?.trim()) missing.push("Transport plan");
    if (
      (input.overnightTrip || input.accommodationPlan !== undefined) &&
      !input.accommodationPlan?.trim()
    ) {
      missing.push("Accommodation plan");
    }
    // A trip almost always has coach/accommodation costs. If no amount is known,
    // record cost/budget as a blocker rather than shipping a pack with none.
    if (typeof input.estimatedCost !== "number") {
      missing.push("Trip cost / budget estimate");
    }
  }

  return missing;
}

// Model-supplied missing fields merged with the deterministically derived TBCs,
// de-duplicated case-insensitively. This is the list shown to humans everywhere.
export function effectiveMissingCriticalFields(input: EventPackInput): string[] {
  const supplied = (input.missingCriticalFields ?? [])
    .map((value) => value.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of [...supplied, ...deriveMissingCriticalFields(input)]) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }

  return out;
}

function submissionReadiness(input: EventPackInput) {
  const blockers = [
    ...effectiveMissingCriticalFields(input),
    ...(input.blocksFinalSubmissionReadiness ?? []),
  ].filter((value, index, values) => value.trim() && values.indexOf(value) === index);

  if (blockers.length === 0) {
    return "Draft generated, ready for internal committee review.";
  }

  return `Draft generated, final submission readiness blocked by: ${blockers.join(
    "; ",
  )}.`;
}

function riskOwner(input: EventPackInput) {
  return text(input.organiserName, "Velocity event lead");
}

function riskScore(
  score: string,
  input: EventPackInput,
  requiresLocation = false,
  requiresFirstAid = false,
) {
  if (requiresLocation && !input.preferredLocation?.trim()) {
    return "TBC - committee to confirm";
  }
  if (requiresFirstAid && !input.firstAidPlan?.trim()) {
    return "TBC - committee to confirm";
  }
  return score;
}

export function buildRiskRows(input: EventPackInput) {
  const owner = riskOwner(input);
  const attendance = input.expectedAttendance ?? "TBC";
  const location = text(input.preferredLocation, "the confirmed venue");

  const coreRisks: RiskRow[] = [
    {
      hazardIdentified: "Capacity Control",
      whyHazard:
        "Overcrowding or unclear capacity controls can create unsafe movement, queuing, or room-capacity issues.",
      whoAtRisk: "Attendees, committee members, venue staff, and speakers.",
      riskScore:
        typeof input.expectedAttendance === "number"
          ? "4 (2 x 2)"
          : "TBC - committee to confirm",
      actionsBeforeEvent: `Confirm expected attendance (${attendance}) against venue capacity. Use registration or sign-in where needed and keep an attendee-counting plan.`,
      actionsDuringEvent:
        "Committee lead monitors entry, pauses admissions if capacity is reached, and keeps exits clear.",
      owner,
    },
    {
      hazardIdentified: "Crowd Control",
      whyHazard:
        "Arrival, departure, queues, or clustered networking can cause congestion and make evacuation harder.",
      whoAtRisk: "Attendees, committee members, venue staff, and speakers.",
      riskScore: riskScore("4 (2 x 2)", input, true),
      actionsBeforeEvent: `Confirm room layout and arrival/departure flow for ${location}. Brief committee volunteers on entry, exit, and queue management.`,
      actionsDuringEvent:
        "Keep aisles and exits clear, spread committee volunteers around the room, and escalate crowding concerns to venue/SU staff.",
      owner,
    },
    {
      hazardIdentified: "Electrical Hazards",
      whyHazard:
        "Laptops, chargers, AV equipment, cables, and extension leads can create electric shock or trip hazards.",
      whoAtRisk: "Attendees, committee members, speakers, and venue staff.",
      riskScore: "4 (2 x 2)",
      actionsBeforeEvent:
        "Use venue-approved AV equipment where possible. Keep cables taped down or away from walkways and avoid overloading sockets.",
      actionsDuringEvent:
        "Committee checks walkways remain clear and reports faulty equipment to venue staff. Do not improvise unsafe electrical setups.",
      owner,
    },
    {
      hazardIdentified: "Fire Hazards",
      whyHazard:
        "Blocked exits, overcrowding, electrical faults, or unclear evacuation routes can worsen a fire incident.",
      whoAtRisk: "Attendees, committee members, speakers, and venue staff.",
      riskScore: riskScore("4 (2 x 2)", input, true),
      actionsBeforeEvent:
        "Confirm fire exits, evacuation route, and room-capacity limits with the venue. Do not block exits with furniture, bags, or queues.",
      actionsDuringEvent:
        "Follow venue evacuation instructions immediately. Committee members help attendees leave calmly and do not re-enter until cleared.",
      owner,
    },
    {
      hazardIdentified: "First Aid Emergencies",
      whyHazard:
        "Illness, injury, panic, allergic reactions, or other medical issues may need immediate support.",
      whoAtRisk: "Attendees, committee members, speakers, and venue staff.",
      riskScore: riskScore("TBC - committee to confirm", input, false, true),
      actionsBeforeEvent: text(
        input.firstAidPlan,
        "Confirm first-aid plan, nearest first-aid support, emergency contact route, and who will call venue/security help if needed.",
      ),
      actionsDuringEvent:
        "Stop the activity if needed, call venue/security/emergency support, record the incident according to SU/venue process, and preserve privacy.",
      owner,
    },
    {
      hazardIdentified: "Trips, Slips and Falls",
      whyHazard:
        "Cables, bags, furniture movement, spilled drinks, and poor lighting can cause falls.",
      whoAtRisk: "Attendees, committee members, speakers, and venue staff.",
      riskScore: "4 (2 x 2)",
      actionsBeforeEvent:
        "Keep walkways clear, tape down unavoidable cables, check lighting, and agree where bags/coats should be kept.",
      actionsDuringEvent:
        "Committee monitors for spills or obstructions, clears issues quickly, and reports venue hazards.",
      owner,
    },
  ];

  const activityRisks: RiskRow[] = [];

  if (input.foodOrRefreshments) {
    activityRisks.push({
      hazardIdentified: "Food, Allergens, and Hygiene",
      whyHazard:
        "Food or drinks can create allergy, hygiene, spill, or dietary-exclusion risks.",
      whoAtRisk: "Attendees, committee members, speakers, and catering staff.",
      riskScore: "6 (2 x 3)",
      actionsBeforeEvent:
        "Confirm supplier/catering route, allergen information, dietary labels, and food handling responsibilities. Keep an accessibility/dietary contact route visible.",
      actionsDuringEvent:
        "Display allergen information, avoid cross-contamination where possible, clear spills quickly, and escalate allergy incidents immediately.",
      owner,
    });
  }

  if (input.alcohol) {
    activityRisks.push({
      hazardIdentified: "Alcohol",
      whyHazard:
        "Alcohol can increase risks around behaviour, consent, dehydration, and safe departure.",
      whoAtRisk: "Attendees, committee members, venue staff, and the public.",
      riskScore: "6 (2 x 3)",
      actionsBeforeEvent:
        "Confirm whether alcohol is central to the event, venue licensing arrangements, age controls, non-alcoholic options, and safe-departure plan.",
      actionsDuringEvent:
        "Committee monitors welfare, does not pressure drinking, supports anyone unwell, and escalates behavioural concerns to venue/SU/security staff.",
      owner,
    });
  }

  if (hasSpeakers(input)) {
    activityRisks.push({
      hazardIdentified: "External Speakers",
      whyHazard:
        "Speaker approval, topic sensitivity, attendee questions, or publicity can create compliance and safety risks.",
      whoAtRisk: "Speakers, attendees, committee members, and the society.",
      riskScore: input.highRiskOrHighProfileSpeaker
        ? "TBC - committee to confirm"
        : "4 (2 x 2)",
      actionsBeforeEvent:
        "Provide speaker names, roles, organisations, and topics in the event form. Confirm academic-chair applicability and do not advertise speakers until SU approval.",
      actionsDuringEvent:
        "Keep a named committee lead present, manage Q&A respectfully, and escalate disruption or safety concerns to venue/SU/security staff.",
      owner,
    });
  }

  if (input.publicOrNonLseAttendees) {
    activityRisks.push({
      hazardIdentified: "Public or Non-LSE Attendees",
      whyHazard:
        "Open attendance can increase identity, access-control, safeguarding, and capacity risks.",
      whoAtRisk: "Attendees, committee members, speakers, and venue staff.",
      riskScore: "6 (2 x 3)",
      actionsBeforeEvent:
        "Confirm entry route, ticketing/access list, guest expectations, and any academic-chair or security requirements.",
      actionsDuringEvent:
        "Check entry against the approved plan, monitor capacity, and keep committee contact visible for attendee issues.",
      owner,
    });
  }

  if (input.sponsorInvolved || input.externalOrganisationInvolved) {
    activityRisks.push({
      hazardIdentified: "Sponsor or External Organisation Involvement",
      whyHazard:
        "External involvement can create ownership, approval, branding, data, contract, or Careers-process risks.",
      whoAtRisk: "Attendees, committee members, the society, and external partners.",
      riskScore: "TBC - committee to confirm",
      actionsBeforeEvent:
        "Confirm the event is society-led, sponsorship/branding approvals are clear, Careers contact is considered where relevant, and no attendee data is shared without approval.",
      actionsDuringEvent:
        "Keep committee control of the event, avoid unapproved sponsor deliverables, and record issues for post-event review.",
      owner,
    });
  }

  if (input.under18sOrVulnerableAdults) {
    activityRisks.push({
      hazardIdentified: "Under-18s or Vulnerable Adults",
      whyHazard:
        "Safeguarding, supervision, DBS, consent, and welfare requirements may apply.",
      whoAtRisk: "Under-18s, vulnerable adults, attendees, committee members, and the society.",
      riskScore: "TBC - committee to confirm",
      actionsBeforeEvent:
        "Confirm safeguarding route, supervision, DBS considerations, consent requirements, and SU guidance before final readiness.",
      actionsDuringEvent:
        "Follow the confirmed safeguarding plan and escalate concerns immediately through the agreed route.",
      owner,
    });
  }

  if (input.externalVenue) {
    activityRisks.push({
      hazardIdentified: "External Venue",
      whyHazard:
        "External venues may have different evacuation, accessibility, insurance, licensing, and staff-support arrangements.",
      whoAtRisk: "Attendees, committee members, speakers, venue staff, and the public.",
      riskScore: "TBC - committee to confirm",
      actionsBeforeEvent:
        "Confirm venue risk information, accessibility, insurance/licensing expectations, emergency contacts, and arrival/departure route.",
      actionsDuringEvent:
        "Follow venue staff instructions, keep committee contact visible, and record/report any incidents through the agreed process.",
      owner,
    });
  }

  // Trip-shaped risks. Driven by the structured trip flags / plans the model
  // supplies, not by prose parsing (see AGENTS.md route-classification note).
  const isAwayTrip = Boolean(input.tripBeyondM25 || input.overnightTrip);
  const hasTransport = Boolean(input.transportPlan?.trim()) || isAwayTrip;
  const hasOvernightAway =
    Boolean(input.overnightTrip) || Boolean(input.accommodationPlan?.trim());

  if (hasTransport) {
    activityRisks.push({
      hazardIdentified: "Coach Transport and Travel Delays",
      whyHazard:
        "Group travel by coach or other transport adds road-traffic, boarding, head-count, and travel-delay risks, and attendees can be stranded or split from the group if timings slip.",
      whoAtRisk: "Attendees, committee members, drivers, and the public.",
      riskScore: "TBC - committee to confirm",
      actionsBeforeEvent: `Confirm transport provider, pick-up/drop-off points, departure and return times, and a named trip lead. Build in a travel-delay buffer, share an emergency contact number, and agree a register/head-count routine. Transport plan: ${text(
        input.transportPlan,
      )}.`,
      actionsDuringEvent:
        "Take a register at each departure, keep the group together, monitor timings and traffic, keep the emergency contact reachable, and escalate delays or incidents to the trip lead and emergency services as needed.",
      owner,
    });
  }

  if (hasOvernightAway) {
    activityRisks.push({
      hazardIdentified: "Overnight Accommodation, Rooming and Welfare",
      whyHazard:
        "Overnight stays away from the normal venue add accommodation safety, rooming, safeguarding, welfare, and out-of-hours emergency risks.",
      whoAtRisk: "Attendees, committee members, and accommodation staff.",
      riskScore: "TBC - committee to confirm",
      actionsBeforeEvent: `Confirm the accommodation booking, rooming plan, fire/evacuation information, supervision and safeguarding arrangements, and an out-of-hours emergency contact. Accommodation plan: ${text(
        input.accommodationPlan,
      )}.`,
      actionsDuringEvent:
        "Keep a named committee contact on call overnight, check welfare, follow the accommodation's fire/safety rules, and escalate safeguarding or welfare concerns through the agreed route.",
      owner,
    });
  }

  if (input.onSiteOvernightStay) {
    activityRisks.push({
      hazardIdentified: "On-site Overnight Stay and Welfare",
      whyHazard:
        "Participants staying overnight on-site (for example coding through the night) face fatigue, welfare, security, lone-working, and out-of-hours first-aid and evacuation risks.",
      whoAtRisk: "Attendees, committee members, and venue/security staff.",
      riskScore: "TBC - committee to confirm",
      actionsBeforeEvent:
        "Confirm the venue permits overnight use, agree overnight supervision and security cover, set rest/quiet areas and break expectations, confirm out-of-hours first-aid and evacuation routes, and share an overnight emergency contact.",
      actionsDuringEvent:
        "Keep a named committee lead on-site overnight, encourage breaks and rest, monitor welfare and fatigue, keep exits and first-aid access clear, and escalate medical or security concerns immediately.",
      owner,
    });
  }

  return { coreRisks, activityRisks };
}

export function buildRiskAssessmentScalarReplacements(input: EventPackInput) {
  const dateCompleted = generatedDisplayDate(input);

  return {
    "{{society_name}}": SOCIETY_NAME,
    "{{event_name}}": input.eventName,
    "{{event_organiser_name}}": text(input.organiserName),
    "{{event_organiser_lse_email}}": text(input.organiserLseEmail),
    "{{event_organiser_contact_number}}": text(input.organiserContactNumber),
    "{{event_dates_times}}": eventDateTimeWithSetup(input),
    "{{event_location}}": text(input.preferredLocation),
    "{{first_aid_plan}}": text(input.firstAidPlan),
    "{{date_completed}}": dateCompleted,
    "{{placeholders}}": "draft fields",
  };
}

export function budgetRequirement(
  input: EventPackInput,
  includeBudget: "auto" | "always" | "never" = "auto",
): BudgetRequirement {
  const requiredReasons: string[] = [];
  const planningReasons: string[] = [];
  const overCostThreshold =
    typeof input.estimatedCost === "number" && input.estimatedCost > 500;
  const overBalanceThreshold =
    typeof input.estimatedCost === "number" &&
    typeof input.societyBalanceEstimate === "number" &&
    input.societyBalanceEstimate > 0 &&
    input.estimatedCost > input.societyBalanceEstimate * 0.5;
  const required = overCostThreshold || overBalanceThreshold;

  if (overCostThreshold) {
    requiredReasons.push("Estimated event cost is over GBP 500.");
  }

  if (overBalanceThreshold) {
    requiredReasons.push(
      "Estimated event cost is over 50% of the society balance estimate.",
    );
  }

  if (includeBudget === "always") {
    planningReasons.push("Budget sheet explicitly requested for internal planning.");
  }

  const reasons = [...requiredReasons, ...planningReasons];

  return {
    shouldGenerateBudget:
      includeBudget !== "never" && (required || planningReasons.length > 0),
    required,
    requiredReasons,
    planningReasons,
    reasons,
  };
}

function blankTextRows(count: number) {
  return Array.from({ length: count }, () => [""] as [string]);
}

function blankNumberRows(count: number) {
  return Array.from({ length: count }, () => ["", ""] as [string | number, string | number]);
}

function normalizeExpenses(input: EventPackInput) {
  const explicit = (input.budget?.expenses ?? []).slice(0, 10);
  if (explicit.length > 0) return explicit;

  if (typeof input.estimatedCost === "number" && input.estimatedCost > 0) {
    return [
      {
        description: "Estimated event costs",
        pricePerItem: input.estimatedCost,
        quantity: 1,
        notes:
          "Placeholder planning estimate. Committee should replace with itemised costs before submission.",
      },
    ];
  }

  return [];
}

function incomeRow(value: BudgetIncomeLine | undefined) {
  return [value?.pricePerItem ?? "", value?.quantity ?? ""] as [
    string | number,
    string | number,
  ];
}

function incomeNote(value: BudgetIncomeLine | undefined) {
  return [value?.notes ?? ""] as [string];
}

export function buildBudgetSheetUpdates(input: EventPackInput): SheetValueUpdate[] {
  const expenses = normalizeExpenses(input);
  const expenseDescriptions = blankTextRows(10);
  const expenseNumbers = blankNumberRows(10);
  const expenseNotes = blankTextRows(10);

  expenses.forEach((expense, index) => {
    expenseDescriptions[index] = [expense.description];
    expenseNumbers[index] = [expense.pricePerItem, expense.quantity];
    expenseNotes[index] = [expense.notes ?? ""];
  });

  const income = input.budget?.income ?? {};
  const incomeRows = [
    incomeRow(income.memberTicket),
    incomeRow(income.nonMemberTicket),
    incomeRow(income.nonLseTicket),
    incomeRow(income.sponsorship),
    incomeRow(income.societyAccountContribution),
    incomeRow(income.sufRequested),
    incomeRow(income.otherIncome),
  ];
  const incomeNotes = [
    incomeNote(income.memberTicket),
    incomeNote(income.nonMemberTicket),
    incomeNote(income.nonLseTicket),
    incomeNote(income.sponsorship),
    incomeNote(income.societyAccountContribution),
    incomeNote(income.sufRequested),
    incomeNote(income.otherIncome),
  ];

  return [
    {
      range: "'Budget Template'!C3:C4",
      values: [[SOCIETY_NAME], [input.eventName]],
      valueInputOption: "RAW",
    },
    {
      range: "'Budget Template'!B7:B16",
      values: expenseDescriptions,
      valueInputOption: "RAW",
    },
    {
      range: "'Budget Template'!C7:D16",
      values: expenseNumbers,
      valueInputOption: "USER_ENTERED",
    },
    {
      range: "'Budget Template'!F7:F16",
      values: expenseNotes,
      valueInputOption: "RAW",
    },
    {
      range: "'Budget Template'!C20:D26",
      values: incomeRows,
      valueInputOption: "USER_ENTERED",
    },
    {
      range: "'Budget Template'!F20:F26",
      values: incomeNotes,
      valueInputOption: "RAW",
    },
  ];
}

function attachmentLine(label: string, value: string | undefined) {
  return `- ${label}: ${value ?? "TBC"}`;
}

function formRouteName(route: EventRoute | undefined) {
  if (route === "regular_event_candidate") return "Regular Event Form";
  if (route === "trip_process") return "Trips process";
  return "Large Event or Speaker Event Form";
}

function answerNeedsReview(answer: string, forceReview = false) {
  const normalized = answer.toLowerCase();
  return (
    forceReview ||
    normalized.includes("tbc") ||
    normalized.includes("needs") ||
    normalized.includes("confirm") ||
    normalized.includes("checking")
  );
}

function taskIdPart(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "task"
  );
}

function eventTaskId(input: EventPackInput, prefix: string, label: string) {
  return `${input.eventId}-${prefix}-${taskIdPart(label)}`;
}

function taskIdHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).slice(0, 6);
}

function deadlineTaskId(input: EventPackInput, item: DeadlinePlanItem) {
  const slug = taskIdPart(`${item.deadlineType ?? "deadline"}-${item.task}`);
  const stableKey = [item.task, item.deadlineType ?? "", item.sourceRule ?? ""].join("|");
  return `${input.eventId}-deadline-${slug}-${taskIdHash(stableKey)}`;
}

function complianceDueDate(input: EventPackInput) {
  return (
    input.deadlines?.find(
      (item) => item.deadlineType === "internal_gate" && item.dueDate,
    )?.dueDate ?? ""
  );
}

export function buildFormFieldPackSheet(
  input: EventPackInput,
  links: EventPackFileLinks = {},
): GeneratedSheet {
  const route = input.classificationRoute;
  const routeIsRegular = route === "regular_event_candidate";
  const routeIsTrip = route === "trip_process";
  const fieldSectionHeading = routeIsRegular
    ? "Event Fields"
    : routeIsTrip
      ? "Trip Event Fields"
      : "Core Event Fields";
  const rows: GeneratedSheetCell[][] = [
    ["Section", "Official form field", "Draft answer", "Entered?", "Needs review?", "Notes"],
  ];
  const add = (
    section: string,
    field: string,
    answer: string,
    notes = "",
    forceReview = false,
  ) => {
    rows.push([
      section,
      field,
      answer,
      false,
      answerNeedsReview(answer, forceReview) ? "yes" : "",
      notes,
    ]);
  };

  add("Submission Metadata", "Event ID", input.eventId);
  add("Submission Metadata", "Form route", formRouteName(route));
  add("Submission Metadata", "Event classification", routeLabel(route));
  add("Submission Metadata", "Classification reason", text(input.classificationReason));
  add("Submission Metadata", "Submission readiness", submissionReadiness(input));
  add("Submission Metadata", "Generated on", generatedDisplayDate(input));
  add(
    "Submission Metadata",
    "Rules source set",
    input.rulesSourceSetId ?? DEFAULT_RULES_SOURCE_SET,
  );
  add(
    "Submission Metadata",
    "Official submission",
    "Humans submit the current live SU/Podio form manually.",
  );

  add(fieldSectionHeading, "What is the name of your event?", input.eventName);
  add(fieldSectionHeading, "What type of group are you submitting on behalf of?", "Society");
  add(fieldSectionHeading, "What club/society are you submitting on behalf of?", SOCIETY_NAME);
  if (!routeIsRegular && !routeIsTrip) {
    add(fieldSectionHeading, "Is this sports training or a match?", "No");
  }
  add(fieldSectionHeading, "Name of Student Lead", text(input.organiserName));
  add(fieldSectionHeading, "Committee Role", text(input.organiserRole));
  add(fieldSectionHeading, "LSE Email Address", text(input.organiserLseEmail));
  add(
    fieldSectionHeading,
    "Date and time of activity, including setup time",
    eventDateTimeWithSetup(input),
  );
  add(
    fieldSectionHeading,
    "Is your activity repeated across multiple dates?",
    yesNo(input.isRepeatedEvent),
  );
  add(fieldSectionHeading, "Repeated dates, if any", text(input.repeatedEventDates));
  add(fieldSectionHeading, "Preferred event location", text(input.preferredLocation));
  add(fieldSectionHeading, "External venue details, if relevant", text(input.externalVenueDetails));
  if (routeIsRegular) {
    add(
      fieldSectionHeading,
      "Confirmation: no external speakers",
      hasSpeakers(input)
        ? "No, external speakers are recorded, use Speaker/Large route."
        : "Confirmed from current intake, no external speakers recorded.",
      "Route check",
      hasSpeakers(input),
    );
  }
  add(fieldSectionHeading, "Overview of the event", text(input.eventDescription));
  add(
    fieldSectionHeading,
    "Who will be attending?",
    input.publicOrNonLseAttendees
      ? "LSE students plus public/non-LSE attendees, confirm access controls."
      : "Primarily LSE students/Velocity community, confirm final audience.",
  );
  if (routeIsRegular) {
    add(
      fieldSectionHeading,
      "Public/open academic chair note, if relevant",
      text(
        input.publicEventAcademicChairNote,
        input.publicOrNonLseAttendees
          ? "Needs checking because public/non-LSE attendance is in scope."
          : "Not indicated.",
      ),
    );
  }
  add(fieldSectionHeading, "Approximate number of attendees", String(input.expectedAttendance ?? "TBC"));
  add(
    fieldSectionHeading,
    !routeIsRegular && !routeIsTrip
      ? "Under-18s / schools / vulnerable adults / DBS details"
      : "Under-18s / vulnerable adults involved?",
    !routeIsRegular && !routeIsTrip
      ? input.under18sOrVulnerableAdults
        ? "Yes, details and DBS/safeguarding route need confirmation."
        : "No / not indicated from current intake."
      : yesNo(input.under18sOrVulnerableAdults),
  );
  add(fieldSectionHeading, "Film screening?", yesNo(input.filmScreening));
  add(fieldSectionHeading, "Food or refreshments?", yesNo(input.foodOrRefreshments));
  add(fieldSectionHeading, "Alcohol?", yesNo(input.alcohol));
  add(fieldSectionHeading, "Ticketing", text(input.ticketingPlan));
  add(fieldSectionHeading, "Attendee registration / entry plan", text(input.attendeeRegistrationEntryPlan));
  if (!routeIsRegular && !routeIsTrip) {
    add(fieldSectionHeading, "SUF status", text(input.sufStatus));
    add(fieldSectionHeading, "Contracts attached?", text(input.contractsAttachedStatus));
  }
  add(
    fieldSectionHeading,
    "Total event cost",
    typeof input.estimatedCost === "number" ? `GBP ${input.estimatedCost}` : "TBC",
  );
  add(fieldSectionHeading, "Risk Assessment attached?", links.riskAssessmentLink ? "Draft linked in pack" : "TBC");
  add(fieldSectionHeading, "Budget attached?", links.budgetLink ? "Draft linked in pack" : "Not generated or TBC");

  if (routeIsTrip) {
    add("Trips Process Fields", "Trip type", text(input.tripType));
    add("Trips Process Fields", "Beyond the M25?", yesNo(input.tripBeyondM25));
    add("Trips Process Fields", "Overnight stay?", yesNo(input.overnightTrip));
    add("Trips Process Fields", "Transport plan", text(input.transportPlan));
    add("Trips Process Fields", "Accommodation plan, if relevant", text(input.accommodationPlan));
    add(
      "Trips Process Fields",
      "Trips process note",
      "Use the SU trips process rather than the ordinary event form. Verify current trip guidance before final readiness.",
      "Process check",
      true,
    );
  } else if (!routeIsRegular) {
    add("External Speaker Fields", "External speakers?", hasSpeakers(input) ? "Yes" : "No / TBC");
    add(
      "External Speaker Fields",
      "Full names, job titles, organisations, and descriptions of speakers",
      speakerDetails(input),
    );
    add("External Speaker Fields", "What topics will speakers be discussing?", speakerTopics(input));
    add(
      "External Speaker Fields",
      "Academic Chair status",
      text(input.academicChairStatus, hasSpeakers(input) ? "Needs checking" : "Not applicable"),
    );
    add(
      "External Speaker Fields",
      "Academic Chair full name and email, if confirmed",
      text(input.academicChairNameEmail),
    );
    add("External Speaker Fields", "Speaker approval status", "Not approved until SU confirms.", "Approval gate", true);
    add(
      "External Speaker Fields",
      "Promotion gate",
      "Speaker promotion blocked until SU speaker approval is clear.",
      "Approval gate",
      true,
    );
    add("External Organisation / Sponsor Fields", "External organisation involved?", yesNo(input.externalOrganisationInvolved));
    add("External Organisation / Sponsor Fields", "Organisation name", text(input.externalOrganisationName));
    add(
      "External Organisation / Sponsor Fields",
      "How is the event society-led and fully organised by Velocity?",
      text(input.societyLedExplanation),
    );
    add(
      "External Organisation / Sponsor Fields",
      "Sponsor / employer involvement details",
      input.sponsorInvolved ? text(input.sponsorName, "Sponsor involved, details TBC") : "No sponsor recorded.",
    );
    add(
      "External Organisation / Sponsor Fields",
      "LSE Careers contact required?",
      input.externalOrganisationInvolved || input.sponsorInvolved
        ? "Needs checking for employer/careers-style event."
        : "Not indicated.",
    );
    add(
      "External Organisation / Sponsor Fields",
      "Sponsorship contract status",
      input.sponsorInvolved
        ? "Needs sponsorship process check before final readiness."
        : "Not indicated.",
    );
  }

  add("Attachment Checklist", "Risk Assessment", links.riskAssessmentLink ?? "TBC");
  add("Attachment Checklist", "Budget, if required or useful", links.budgetLink ?? "TBC");
  add("Attachment Checklist", "Deadline plan", links.deadlinePlanLink ?? "TBC");
  add("Attachment Checklist", "Internal review summary", links.internalReviewSummaryLink ?? "TBC");
  add(
    "Attachment Checklist",
    "Accessibility tasks",
    links.accessibilityTasksStatus ?? "Tracked in Compliance Tasks when tracker updates are enabled.",
  );

  for (const missing of effectiveMissingCriticalFields(input)) {
    add("Missing Information", missing, "TBC", "Required before final submission readiness", true);
  }

  return {
    sheetTitle: "Form Fields",
    values: rows,
    frozenRowCount: 1,
    checkboxColumns: [4],
    columnWidths: [220, 360, 520, 95, 120, 320],
  };
}

export function buildDeadlinePlanSheet(input: EventPackInput): GeneratedSheet {
  const values: GeneratedSheetCell[][] = [
    [
      "Task ID",
      "Event ID",
      "Event Name",
      "Task",
      "Owner",
      "Role",
      "Due Date",
      "Deadline Type",
      "Source Rule",
      "Status",
      "Blocker?",
      "Notes",
    ],
  ];
  const items = input.deadlines ?? [];

  if (items.length === 0) {
    values.push([
      eventTaskId(input, "deadline", "compute-deadlines"),
      input.eventId,
      input.eventName,
      "Run compute_deadlines for this event route/date and update this plan.",
      riskOwner(input),
      "Event lead",
      "",
      "verification_needed",
      "No computed deadlines were supplied to generate_event_pack.",
      "not started",
      "yes",
      "Draft aid only. Check current SU guidance and live forms before submission.",
    ]);
  } else {
    for (const [index, item] of items.entries()) {
      values.push([
        deadlineTaskId(input, item),
        input.eventId,
        input.eventName,
        item.task,
        riskOwner(input),
        item.blocksFinalSubmissionReadiness ? "Event lead" : "Committee",
        item.dueDate ?? "",
        item.deadlineType ?? "TBC",
        item.sourceRule ?? "TBC",
        "not started",
        item.blocksFinalSubmissionReadiness ? "yes" : "no",
        item.notes?.join(" ") ?? "",
      ]);
    }
  }

  return {
    sheetTitle: "Deadline Plan",
    values,
    frozenRowCount: 1,
    columnWidths: [320, 300, 260, 520, 220, 150, 120, 170, 420, 130, 110, 420],
  };
}

export function buildDeadlineComplianceTaskRows(input: EventPackInput) {
  const items = input.deadlines ?? [];

  if (items.length === 0) {
    return [
      {
        "Task ID": eventTaskId(input, "deadline", "compute-deadlines"),
        "Event ID": input.eventId,
        Task: "Run compute_deadlines for this event route/date and update this plan.",
        Owner: riskOwner(input),
        Role: "Event lead",
        "Due Date": "",
        "Deadline Type": "verification_needed",
        "Source Rule": "No computed deadlines were supplied to generate_event_pack.",
        Status: "not started",
        "Blocker?": "yes",
        Notes: "Draft aid only. Check current SU guidance and live forms before submission.",
      },
    ];
  }

  return items.map((item, index) => ({
    "Task ID": deadlineTaskId(input, item),
    "Event ID": input.eventId,
    Task: item.task,
    Owner: riskOwner(input),
    Role: item.blocksFinalSubmissionReadiness ? "Event lead" : "Committee",
    "Due Date": item.dueDate ?? "",
    "Deadline Type": item.deadlineType ?? "TBC",
    "Source Rule": item.sourceRule ?? "TBC",
    Status: "not started",
    "Blocker?": item.blocksFinalSubmissionReadiness ? "yes" : "no",
    Notes: item.notes?.join(" ") ?? "",
  }));
}

export function buildAccessibilityComplianceTaskRows(input: EventPackInput) {
  const dueDate = complianceDueDate(input);
  const tasks = [
    {
      id: "venue-access",
      task: "Confirm step-free route, lift access, accessible toilets, and seating layout for the venue.",
      blocker: true,
      notes: `Venue: ${text(input.preferredLocation)}.`,
    },
    {
      id: "request-route",
      task: "Confirm how students can request accessibility accommodations without sharing sensitive access needs in Slack.",
      blocker: !input.accessibilityContactOrRequestRoute,
      notes: `Current route: ${text(input.accessibilityContactOrRequestRoute)}.`,
    },
    {
      id: "promotion-contact",
      task: "Include an accessibility contact or accommodation-request route in internal planning and event promotion.",
      blocker: !input.accessibilityContactOrRequestRoute,
      notes: "Do not store individual access needs in tracker rows.",
    },
    {
      id: "room-layout",
      task: "Check room layout for wheelchair spaces, sight lines, microphone/audio access, and a quiet route if needed.",
      blocker: false,
      notes: "Use venue-approved layouts and room guidance.",
    },
    {
      id: "food-allergens",
      task: "If food or refreshments are provided, confirm dietary and allergen information.",
      blocker: Boolean(input.foodOrRefreshments),
      notes: input.foodOrRefreshments ? "Food is in scope." : "Food is not currently in scope.",
    },
    {
      id: "registration-access",
      task: "If ticketing or registration is used, confirm it can capture operational access requests through an approved route.",
      blocker: false,
      notes: `Ticketing plan: ${text(input.ticketingPlan)}.`,
    },
    {
      id: "sensitive-data-minimisation",
      task: "Keep individual access needs out of tracker rows unless a separately approved process exists.",
      blocker: false,
      notes: "Record process status only, not personal access details.",
    },
  ];

  return tasks.map((task) => ({
    "Task ID": eventTaskId(input, "accessibility", task.id),
    "Event ID": input.eventId,
    Task: task.task,
    Owner: riskOwner(input),
    Role: "Event lead",
    "Due Date": dueDate,
    "Deadline Type": "accessibility_check",
    "Source Rule": "LSESU accessibility planning checklist; verify current guidance before submission.",
    Status: "not started",
    "Blocker?": task.blocker ? "yes" : "no",
    Notes: task.notes,
  }));
}

export function buildFormFieldPackBody(
  input: EventPackInput,
  links: EventPackFileLinks = {},
) {
  const route = input.classificationRoute;
  const routeIsRegular = route === "regular_event_candidate";
  const routeIsTrip = route === "trip_process";
  const generatedOn = generatedDisplayDate(input);
  const rulesLastVerifiedDate =
    input.rulesLastVerifiedDate ?? DEFAULT_RULES_LAST_VERIFIED;
  const heading = routeIsRegular
    ? "Regular Event Form Field Pack"
    : routeIsTrip
      ? "Trips Process Field Pack"
      : "Large / Speaker Event Form Field Pack";
  const fieldSectionHeading = routeIsRegular
    ? "Event Fields"
    : routeIsTrip
      ? "Trip Event Fields"
      : "Core Event Fields";
  const regularOnlyRows = routeIsRegular
    ? `| Confirmation: no external speakers | ${hasSpeakers(input) ? "No, external speakers are recorded, use Speaker/Large route." : "Confirmed from current intake, no external speakers recorded."} |
`
    : "";
  const publicAcademicChairRow = routeIsRegular
    ? `| Public/open academic chair note, if relevant | ${text(input.publicEventAcademicChairNote, input.publicOrNonLseAttendees ? "Needs checking because public/non-LSE attendance is in scope." : "Not indicated.")} |
`
    : "";
  const largeOnlyOpeningRows = !routeIsRegular && !routeIsTrip
    ? "| Is this sports training or a match? | No |\n"
    : "";
  const under18sRowLabel = !routeIsRegular && !routeIsTrip
    ? "Under-18s / schools / vulnerable adults / DBS details"
    : "Under-18s / vulnerable adults involved?";
  const under18sRowAnswer = !routeIsRegular && !routeIsTrip
    ? input.under18sOrVulnerableAdults
      ? "Yes, details and DBS/safeguarding route need confirmation."
      : "No / not indicated from current intake."
    : yesNo(input.under18sOrVulnerableAdults);
  const largeOnlyClosingRows = !routeIsRegular && !routeIsTrip
    ? `| SUF status | ${text(input.sufStatus)} |
| Contracts attached? | ${text(input.contractsAttachedStatus)} |
`
    : "";

  const common = `# ${heading}

${FIELD_PACK_DISCLAIMER} Rules/templates last manually verified on ${rulesLastVerifiedDate}.

## Submission Metadata

- Event ID: ${input.eventId}
- Form route: ${routeIsRegular ? "Regular Event Form" : routeIsTrip ? "Trips process" : "Large Event or Speaker Event Form"}
- Event classification: ${routeLabel(route)}
- Classification reason: ${text(input.classificationReason)}
- Submission readiness: ${submissionReadiness(input)}
- Generated on: ${generatedOn}
- Rules source set: ${input.rulesSourceSetId ?? DEFAULT_RULES_SOURCE_SET}
- Official submission: Humans submit the current live SU/Podio form manually.

## ${fieldSectionHeading}

| Official form field | Draft answer |
|---|---|
| What is the name of your event? | ${input.eventName} |
| What type of group are you submitting on behalf of? | Society |
| What club/society are you submitting on behalf of? | ${SOCIETY_NAME} |
${largeOnlyOpeningRows}| Name of Student Lead | ${text(input.organiserName)} |
| Committee Role | ${text(input.organiserRole)} |
| LSE Email Address | ${text(input.organiserLseEmail)} |
| Date and time of activity, including setup time | ${eventDateTimeWithSetup(input)} |
| Is your activity repeated across multiple dates? | ${yesNo(input.isRepeatedEvent)} |
| Repeated dates, if any | ${text(input.repeatedEventDates)} |
| Preferred event location | ${text(input.preferredLocation)} |
| External venue details, if relevant | ${text(input.externalVenueDetails)} |
${regularOnlyRows}| Overview of the event | ${text(input.eventDescription)} |
| Who will be attending? | ${input.publicOrNonLseAttendees ? "LSE students plus public/non-LSE attendees, confirm access controls." : "Primarily LSE students/Velocity community, confirm final audience."} |
${publicAcademicChairRow}| Approximate number of attendees | ${input.expectedAttendance ?? "TBC"} |
| ${under18sRowLabel} | ${under18sRowAnswer} |
| Film screening? | ${yesNo(input.filmScreening)} |
| Food or refreshments? | ${yesNo(input.foodOrRefreshments)} |
| Alcohol? | ${yesNo(input.alcohol)} |
| Ticketing | ${text(input.ticketingPlan)} |
| Attendee registration / entry plan | ${text(input.attendeeRegistrationEntryPlan)} |
${largeOnlyClosingRows}| Total event cost | ${typeof input.estimatedCost === "number" ? `GBP ${input.estimatedCost}` : "TBC"} |
| Risk Assessment attached? | ${links.riskAssessmentLink ? "Draft linked below" : "TBC"} |
| Budget attached? | ${links.budgetLink ? "Draft linked below" : "Not generated or TBC"} |
`;

  if (routeIsRegular) {
    return `${common}
## Regular Event Route Checks

- External speaker route check: ${hasSpeakers(input) ? "External speakers are recorded; use Speaker/Large route." : "No external speakers recorded from current intake."}
- Public/open academic chair check: ${text(input.publicEventAcademicChairNote, input.publicOrNonLseAttendees ? "Needs checking because public/non-LSE attendance is in scope." : "Not indicated.")}

## Attachment Checklist

${attachmentLine("Risk Assessment", links.riskAssessmentLink)}
${attachmentLine("Budget, if required or useful", links.budgetLink)}
${attachmentLine("Accessibility tasks", links.accessibilityTasksStatus ?? links.accessibilityChecklistLink)}
${attachmentLine("Deadline plan", links.deadlinePlanLink)}
${attachmentLine("Internal review summary", links.internalReviewSummaryLink)}

## Missing Information

${listOrNone(effectiveMissingCriticalFields(input))}
`;
  }

  if (routeIsTrip) {
    return `${common}
## Trips Process Fields

| Trips field | Draft answer |
|---|---|
| Trip type | ${text(input.tripType)} |
| Beyond the M25? | ${yesNo(input.tripBeyondM25)} |
| Overnight stay? | ${yesNo(input.overnightTrip)} |
| Transport plan | ${text(input.transportPlan)} |
| Accommodation plan, if relevant | ${text(input.accommodationPlan)} |
| Trips process note | Use the SU trips process rather than the ordinary event form. Verify current trip guidance before final readiness. |

## Attachment Checklist

${attachmentLine("Risk Assessment", links.riskAssessmentLink)}
${attachmentLine("Budget, if required or useful", links.budgetLink)}
${attachmentLine("Accessibility tasks", links.accessibilityTasksStatus ?? links.accessibilityChecklistLink)}
${attachmentLine("Deadline plan", links.deadlinePlanLink)}
${attachmentLine("Internal review summary", links.internalReviewSummaryLink)}

## Missing Information

${listOrNone(effectiveMissingCriticalFields(input))}
`;
  }

  return `${common}
## External Speaker Fields

| Official form field | Draft answer |
|---|---|
| External speakers? | ${hasSpeakers(input) ? "Yes" : "No / TBC"} |
| Full names, job titles, organisations, and descriptions of speakers | ${speakerDetails(input)} |
| What topics will speakers be discussing? | ${speakerTopics(input)} |
| Academic Chair status | ${text(input.academicChairStatus, hasSpeakers(input) ? "Needs checking" : "Not applicable")} |
| Academic Chair full name and email, if confirmed | ${text(input.academicChairNameEmail)} |
| Speaker approval status | Not approved until SU confirms. |
| Promotion gate | Speaker promotion blocked until SU speaker approval is clear. |

## External Organisation / Sponsor Fields

| Official form field | Draft answer |
|---|---|
| External organisation involved? | ${yesNo(input.externalOrganisationInvolved)} |
| Organisation name | ${text(input.externalOrganisationName)} |
| How is the event society-led and fully organised by Velocity? | ${text(input.societyLedExplanation)} |
| Sponsor / employer involvement details | ${input.sponsorInvolved ? text(input.sponsorName, "Sponsor involved, details TBC") : "No sponsor recorded."} |
| LSE Careers contact required? | ${input.externalOrganisationInvolved || input.sponsorInvolved ? "Needs checking for employer/careers-style event." : "Not indicated."} |
| Sponsorship contract status | ${input.sponsorInvolved ? "Needs sponsorship process check before final readiness." : "Not indicated."} |

## Attachment Checklist

${attachmentLine("Risk Assessment", links.riskAssessmentLink)}
${attachmentLine("Budget, if required or useful", links.budgetLink)}
${attachmentLine("Accessibility tasks", links.accessibilityTasksStatus ?? links.accessibilityChecklistLink)}
${attachmentLine("Deadline plan", links.deadlinePlanLink)}
${attachmentLine("Internal review summary", links.internalReviewSummaryLink)}

## Missing Information

${listOrNone(effectiveMissingCriticalFields(input))}
`;
}

export function buildAccessibilityChecklistBody(input: EventPackInput) {
  return `# Accessibility Checklist

${FIELD_PACK_DISCLAIMER} Rules/templates last manually verified on ${input.rulesLastVerifiedDate ?? DEFAULT_RULES_LAST_VERIFIED}.

- Event ID: ${input.eventId}
- Event: ${input.eventName}
- Location: ${text(input.preferredLocation)}
- Accessibility contact or request route: ${text(input.accessibilityContactOrRequestRoute)}
- Current accessibility plan: ${text(input.accessibilityPlan)}

## Checklist

- [ ] Confirm step-free route, lift access, accessible toilets, and seating layout for the venue.
- [ ] Confirm how students can request accommodations without sharing sensitive access needs in Slack.
- [ ] Include an accessibility contact or request route in internal planning and event promotion.
- [ ] Check room layout for wheelchair spaces, sight lines, microphone/audio access, and quiet route if needed.
- [ ] If food or refreshments are provided, confirm dietary and allergen information.
- [ ] If ticketing or registration is used, confirm it can capture operational access requests through an approved route.
- [ ] Keep individual access needs out of tracker rows unless a separately approved process exists.

## Notes

${input.publicOrNonLseAttendees ? "- Public/non-LSE attendance is in scope, access-control and arrival support need explicit review." : "- Public/non-LSE attendance not indicated."}
${input.externalVenue ? "- External venue is in scope, request venue accessibility information before final readiness." : "- External venue not indicated."}
`;
}

export function buildDeadlinePlanBody(input: EventPackInput) {
  const items = input.deadlines ?? [];
  const lines =
    items.length > 0
      ? items
          .map((item, index) => {
            const notes = item.notes?.length ? ` Notes: ${item.notes.join(" ")}` : "";
            return `${index + 1}. ${item.task}
   Due date: ${item.dueDate ?? "TBC"}
   Type: ${item.deadlineType ?? "TBC"}
   Source rule: ${item.sourceRule ?? "TBC"}
   Blocks final readiness: ${item.blocksFinalSubmissionReadiness ? "yes" : "no"}${notes}`;
          })
          .join("\n\n")
      : "No computed deadline items were supplied. Run compute_deadlines for this event route/date and regenerate or update this plan.";

  return `# Deadline Plan

${FIELD_PACK_DISCLAIMER} Rules/templates last manually verified on ${input.rulesLastVerifiedDate ?? DEFAULT_RULES_LAST_VERIFIED}.

- Event ID: ${input.eventId}
- Event: ${input.eventName}
- Event date: ${eventDateRangeDisplay(input)}
- Classification: ${routeLabel(input.classificationRoute)}
- Timezone: Europe/London
- Working-day note: Indicative deadline, excludes weekends but not bank holidays unless a bank-holiday calendar is configured.

## Deadline Items

${lines}
`;
}

export function buildInternalReviewSummaryBody(
  input: EventPackInput,
  links: EventPackFileLinks = {},
  budget: BudgetRequirement = budgetRequirement(input),
) {
  return `# Internal Review Summary

${FIELD_PACK_DISCLAIMER} Rules/templates last manually verified on ${input.rulesLastVerifiedDate ?? DEFAULT_RULES_LAST_VERIFIED}.

## Event

- Event ID: ${input.eventId}
- Pack ID: ${buildPackId(input.eventId, input.packVersion ?? 1)}
- Event: ${input.eventName}
- Date: ${eventDateRangeDisplay(input)}
- Location: ${text(input.preferredLocation)}
- Classification: ${routeLabel(input.classificationRoute)}
- Classification reason: ${text(input.classificationReason)}
- Generated by: ${text(input.generatedBy)}
- Generated on: ${generatedDisplayDate(input)}
- Rules source set: ${input.rulesSourceSetId ?? DEFAULT_RULES_SOURCE_SET}

## Status

- Submission readiness: ${submissionReadiness(input)}
- Promotion gate: Blocked until event form/SU approval is clear.
- Speaker promotion gate: ${hasSpeakers(input) ? "Blocked until SU speaker approval is clear." : "Not applicable."}
- Sponsor-branded promotion gate: ${input.sponsorInvolved ? "Blocked until sponsorship/logo/contract approval is clear." : "Not applicable."}
- Budget status: ${links.budgetLink ? (budget.required ? "Generated because required by threshold." : "Generated for internal planning.") : "Not generated."}

## Triggers

${listOrNone(input.triggers)}

## Missing Critical Fields

${listOrNone(effectiveMissingCriticalFields(input))}

## Final-Readiness Blockers

${listOrNone(input.blocksFinalSubmissionReadiness)}

## Pack Links

${attachmentLine("Pack folder", links.packFolderLink)}
${attachmentLine("Risk assessment", links.riskAssessmentLink)}
${attachmentLine("Budget", links.budgetLink)}
- Budget decision reasons: ${budget.reasons.length > 0 ? budget.reasons.join("; ") : "No budget threshold or request recorded."}
${attachmentLine("Field pack", links.fieldPackLink)}
${attachmentLine("Accessibility tasks", links.accessibilityTasksStatus ?? links.accessibilityChecklistLink)}
${attachmentLine("Deadline plan", links.deadlinePlanLink)}

## Human Actions

- Committee must review every draft document before use.
- Humans submit SU forms manually.
- Humans handle room confirmation, payments, contracts, and public promotion.
- Current SU guidance and live templates/forms remain authoritative.
`;
}

export function buildEventTrackerRow(
  input: EventPackInput,
  links: EventPackFileLinks,
) {
  return {
    "Event ID": input.eventId,
    "Event Name": input.eventName,
    Date: eventDateRangeDisplay(input),
    Time: eventDateTimeWithSetup(input),
    Owner: text(input.organiserName, ""),
    "Channel Thread Link": "",
    Classification: routeLabel(input.classificationRoute),
    "Classification Reason": text(input.classificationReason, ""),
    "Expected Attendance": input.expectedAttendance ?? "",
    "Budget Estimate": input.estimatedCost ?? "",
    "External Speaker?": hasSpeakers(input) ? "yes" : "no",
    "External Organisation?": input.externalOrganisationInvolved ? "yes" : "no",
    "Sponsor?": input.sponsorInvolved ? "yes" : "no",
    "Food?": input.foodOrRefreshments ? "yes" : "no",
    "Alcohol?": input.alcohol ? "yes" : "no",
    "Trip/External Venue?": input.tripBeyondM25 || input.overnightTrip || input.externalVenue ? "yes" : "no",
    "Risk Assessment Status": links.riskAssessmentLink ? "draft generated" : "not generated",
    "Budget Status": links.budgetLink ? "draft generated" : "not generated",
    "Form Field Pack Status": links.fieldPackLink ? "draft generated" : "not generated",
    "Missing Critical Fields": effectiveMissingCriticalFields(input).join("; "),
    "Submission Readiness": submissionReadiness(input),
    "SU Submission Status": "not submitted by Vichita",
    "SU Approval Status": "not recorded",
    "Room Confirmed?": "TBC",
    "Promotion Gate": "BLOCKED until SU approval is clear",
    "Ticketing Status": text(input.ticketingPlan, ""),
    "Pack Folder Link": links.packFolderLink ?? "",
    "Last Updated": new Date().toISOString(),
  };
}

export function buildPackIndexRow(
  input: EventPackInput,
  links: EventPackFileLinks,
) {
  return {
    "Pack ID": buildPackId(input.eventId, input.packVersion ?? 1),
    "Event ID": input.eventId,
    "Event Name": input.eventName,
    "Pack Folder Link": links.packFolderLink ?? "",
    "Risk Assessment Link": links.riskAssessmentLink ?? "",
    "Budget Link": links.budgetLink ?? "",
    "Field Pack Link": links.fieldPackLink ?? "",
    "Accessibility Checklist Link": links.accessibilityChecklistLink ?? "",
    "Internal Review Summary Link": links.internalReviewSummaryLink ?? "",
    "Generated By": text(input.generatedBy, ""),
    "Generated At": new Date().toISOString(),
    "Rules Last Verified":
      input.rulesLastVerifiedDate ?? DEFAULT_RULES_LAST_VERIFIED,
    "Internal Approval Status": "draft generated",
    "Approved By": "",
    "Approved At": "",
  };
}

export function documentBaseName(input: EventPackInput) {
  // Visible names use the start date only; the full range lives in the
  // human-facing content fields (date/time, deadline plan, internal review).
  return `${displayDate(input.proposedDate)} - ${input.eventName}`;
}

export type PackDocumentType =
  | "risk-assessment"
  | "budget"
  | "field-pack-sheet"
  | "deadline-plan-sheet"
  | "internal-review-summary";

export const PACK_DOCUMENT_LABELS: Record<PackDocumentType, string> = {
  "risk-assessment": "Risk Assessment",
  budget: "Budget",
  "field-pack-sheet": "LSESU Form Field Pack",
  "deadline-plan-sheet": "Deadline Plan",
  "internal-review-summary": "Internal Review Summary",
};

// Visible file name for a generated pack document, for example
// "14-03-2027 - Velocity Build Night - Risk Assessment v1". Centralised so
// initial generation and in-place rename produce identical names.
export function packDocumentFileName({
  baseName,
  documentType,
  packVersion,
}: {
  baseName: string;
  documentType: PackDocumentType;
  packVersion: number;
}) {
  return `${baseName} - ${PACK_DOCUMENT_LABELS[documentType]} v${packVersion}`;
}

// Quantity columns in the tagged budget template inherit a currency format from
// the neighbouring price column, so a quantity like 80 renders as a currency
// amount. After the numeric values are written, these ranges are reset to a
// plain integer number format. Expressed as data so the request shape can be
// unit-tested without a live Sheets client.
export const BUDGET_QUANTITY_GRID_RANGES = [
  // Expense quantity column D7:D16 (0-based rows 6-15, column index 3).
  { startRowIndex: 6, endRowIndex: 16, startColumnIndex: 3, endColumnIndex: 4 },
  // Income quantity column D20:D26 (0-based rows 19-25, column index 3).
  { startRowIndex: 19, endRowIndex: 26, startColumnIndex: 3, endColumnIndex: 4 },
] as const;

export function buildBudgetQuantityNumberFormatRequests(
  sheetId: number,
): sheets_v4.Schema$Request[] {
  return BUDGET_QUANTITY_GRID_RANGES.map((range) => ({
    repeatCell: {
      range: { sheetId, ...range },
      cell: {
        userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "0" } },
      },
      fields: "userEnteredFormat.numberFormat",
    },
  }));
}

