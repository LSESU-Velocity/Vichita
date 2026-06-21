import { defineTool } from "eve/tools";
import { z } from "zod";

import {
  dateDisplaySortKey,
  displayDateFromIsoDate,
  formatDateForDisplay,
} from "../lib/dateLabels.js";

const Route = z.enum([
  "regular_event_candidate",
  "large_event",
  "speaker_event",
  "large_speaker_event",
  "trip_process",
  "needs_human_review",
]);

type Route = z.infer<typeof Route>;

const Input = z.object({
  eventDate: z
    .string()
    .describe("Event date as YYYY-MM-DD, for example 2026-10-15."),
  route: z
    .string()
    .describe(
      "Canonical route or natural label, for example large_speaker_event, large speaker event, regular event, or trip.",
    ),
  highRiskOrHighProfileSpeaker: z
    .boolean()
    .optional()
    .describe(
      "True when a speaker event involves a high-risk or high-profile speaker.",
    ),
  tripType: z
    .enum(["domestic_uk", "international", "unknown"])
    .optional()
    .describe("Use for trip_process routes when known."),
  term1LargeEventDeadline: z
    .string()
    .optional()
    .describe("Optional current-year Term 1 large/flagship deadline as YYYY-MM-DD."),
  term2LargeEventDeadline: z
    .string()
    .optional()
    .describe("Optional current-year Term 2 large/flagship deadline as YYYY-MM-DD."),
  rulesLastVerifiedDate: z.string().optional(),
  rulesSourceSetId: z.string().optional(),
});

const DAY_MS = 24 * 60 * 60 * 1000;

type DeadlineType =
  | "hard_gate"
  | "internal_gate"
  | "dependency"
  | "verification_needed";

type Deadline = {
  task: string;
  deadlineType: DeadlineType;
  dueDate?: string;
  sourceRule: string;
  precision: string;
  blocksFinalSubmissionReadiness: boolean;
  notes?: string[];
};

type TripType = "domestic_uk" | "international" | "unknown";

function parseIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

function formatDate(date: Date) {
  return formatDateForDisplay(date);
}

function addCalendarDays(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY_MS);
}

function subtractCalendarMonths(date: Date, months: number) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const targetMonth = month - months;
  const lastDay = new Date(Date.UTC(year, targetMonth + 1, 0)).getUTCDate();

  return new Date(Date.UTC(year, targetMonth, Math.min(day, lastDay)));
}

function subtractWeeks(date: Date, weeks: number) {
  return addCalendarDays(date, -7 * weeks);
}

function isWorkingDay(date: Date) {
  const day = date.getUTCDay();
  return day >= 1 && day <= 5;
}

function subtractWorkingDays(date: Date, workingDays: number) {
  let cursor = date;
  let remaining = workingDays;

  while (remaining > 0) {
    cursor = addCalendarDays(cursor, -1);
    if (isWorkingDay(cursor)) remaining -= 1;
  }

  return cursor;
}

function addWorkingDays(date: Date, workingDays: number) {
  let cursor = date;
  let remaining = workingDays;

  while (remaining > 0) {
    cursor = addCalendarDays(cursor, 1);
    if (isWorkingDay(cursor)) remaining -= 1;
  }

  return cursor;
}

function earlierDate(first: Date, second: Date) {
  return first.getTime() <= second.getTime() ? first : second;
}

function normalizeRoute(input: string): { route: Route; warning?: string } {
  const value = input.trim();
  const canonical = Route.safeParse(value);
  if (canonical.success) return { route: canonical.data };

  const normalized = value.toLowerCase().replace(/[\s/-]+/g, "_");
  const normalizedCanonical = Route.safeParse(normalized);
  if (normalizedCanonical.success) return { route: normalizedCanonical.data };

  const compact = value.toLowerCase();
  if (/\b(trip|tour|overnight|m25)\b/u.test(compact)) {
    return { route: "trip_process" };
  }
  if (/\blarge\b/u.test(compact) && /\bspeaker\b/u.test(compact)) {
    return { route: "large_speaker_event" };
  }
  if (/\bspeaker\b/u.test(compact)) {
    return { route: "speaker_event" };
  }
  const attendanceOver75 =
    /(?:>\s*75|over\s+75|more than\s+75|above\s+75)/u.test(compact);
  const budgetOver500 =
    /(?:>\s*(?:\u00a3|gbp)?\s*500|over\s+(?:\u00a3|gbp)?\s*500|more than\s+(?:\u00a3|gbp)?\s*500|above\s+(?:\u00a3|gbp)?\s*500|budget[^\n.]{0,40}(?:over|above|more than)\s+(?:\u00a3|gbp)?\s*500)/u.test(
      compact,
    );
  if (
    /\b(large|flagship|external organisation|external organization|alcohol)\b/u.test(
      compact,
    ) ||
    attendanceOver75 ||
    budgetOver500
  ) {
    return { route: "large_event" };
  }
  if (/\b(regular|small|ordinary)\b/u.test(compact)) {
    return { route: "regular_event_candidate" };
  }

  return {
    route: "needs_human_review",
    warning: `Route "${input}" was not recognised; deadline output is limited until the event route is confirmed.`,
  };
}

function deadline(input: Deadline): Deadline {
  return input;
}

function inferTripType(routeInput: string): TripType {
  const value = routeInput.toLowerCase();

  if (/\b(international|abroad|overseas|outside the uk|outside uk)\b/u.test(value)) {
    return "international";
  }

  if (/\b(domestic|uk|within the uk|inside the uk)\b/u.test(value)) {
    return "domestic_uk";
  }

  return "unknown";
}

function configuredDate(
  value: string | undefined,
  fallback: string,
): { date?: Date; value: string; usedFallback: boolean; warning?: string } {
  const candidate = value?.trim() || fallback;
  const date = parseIsoDate(candidate);

  if (!date) {
    return {
      value: candidate,
      usedFallback: !value,
      warning: `Configured deadline "${candidate}" is not a real YYYY-MM-DD date.`,
    };
  }

  return {
    date,
    value: formatDate(date),
    usedFallback: !value,
  };
}

function termDeadline(
  eventDate: Date,
  term1Override: string | undefined,
  term2Override: string | undefined,
) {
  const month = eventDate.getUTCMonth() + 1;
  const year = eventDate.getUTCFullYear();

  if (month >= 8 && month <= 12) {
    const configured = configuredDate(term1Override, `${year}-08-31`);
    if (!configured.date) {
      return {
        label: "Term 1 large/flagship published deadline",
        warning: configured.warning,
      };
    }

    if (configured.date.getTime() >= eventDate.getTime()) {
      return {
        label: "Term 1 large/flagship published deadline",
        warning:
          "The configured Term 1 large/flagship deadline falls on or after the event date; verify this event directly with SU.",
      };
    }

    return {
      date: configured.date,
      dueDate: configured.value,
      label: "Term 1 large/flagship published deadline",
      source: configured.usedFallback
        ? "Current encoded fallback: 31 August; verify current academic year"
        : "Configured current-year deadline",
    };
  }

  if (month >= 1 && month <= 4) {
    const configured = configuredDate(term2Override, `${year - 1}-10-31`);
    if (!configured.date) {
      return {
        label: "Term 2 large/flagship published deadline",
        warning: configured.warning,
      };
    }

    if (configured.date.getTime() >= eventDate.getTime()) {
      return {
        label: "Term 2 large/flagship published deadline",
        warning:
          "The configured Term 2 large/flagship deadline falls on or after the event date; verify this event directly with SU.",
      };
    }

    return {
      date: configured.date,
      dueDate: configured.value,
      label: "Term 2 large/flagship published deadline",
      source: configured.usedFallback
        ? "Current encoded fallback: 31 October; verify current academic year"
        : "Configured current-year deadline",
    };
  }

  return {
    label: "Large/flagship published term deadline",
    warning:
      "No encoded large/flagship term deadline applies to this event month; verify the current SU deadline directly.",
  };
}

export default defineTool({
  description:
    "Compute indicative deadline dates and checklist gates for an event route. Accepts natural route labels like 'large speaker event'. Does not replace current LSESU guidance.",
  inputSchema: Input,
  async execute(input) {
    const { route, warning } = normalizeRoute(input.route);
    const eventDate = parseIsoDate(input.eventDate);
    const warnings = warning ? [warning] : [];
    const rulesLastVerifiedDate =
      input.rulesLastVerifiedDate ??
      process.env.RULES_LAST_VERIFIED_DATE ??
      "not provided";
    const rulesSourceSetId =
      input.rulesSourceSetId ?? process.env.RULES_SOURCE_SET_ID ?? "not provided";
    const term1LargeEventDeadline =
      input.term1LargeEventDeadline ??
      process.env.LSESU_TERM1_LARGE_EVENT_DEADLINE;
    const term2LargeEventDeadline =
      input.term2LargeEventDeadline ??
      process.env.LSESU_TERM2_LARGE_EVENT_DEADLINE;
    const displayRulesLastVerifiedDate =
      displayDateFromIsoDate(rulesLastVerifiedDate) ?? rulesLastVerifiedDate;

    if (!eventDate) {
      return {
        eventDate: input.eventDate,
        route,
        routeInput: input.route,
        canComputeDates: false,
        warnings: [
          ...warnings,
          "Event date must be a real ISO calendar date in YYYY-MM-DD format.",
        ],
        deadlines: [],
        timezone: "Europe/London",
        workingDayPolicy:
          "Monday-Friday only; excludes weekends but not bank holidays.",
        rulesLastVerifiedDate: displayRulesLastVerifiedDate,
        rulesSourceSetId,
        disclaimer:
          "Draft aid only. Check current SU guidance and live forms before submission.",
      };
    }

    const deadlines: Deadline[] = [
      deadline({
        task: "Verify current SU guidance, live form, and template before relying on this plan",
        deadlineType: "verification_needed",
        sourceRule: "Current-year source verification is required",
        precision: "manual verification gate",
        blocksFinalSubmissionReadiness: true,
        notes: [
          "Rules or academic-year-specific deadlines may change before the event.",
        ],
      }),
    ];

    if (route === "trip_process") {
      const tripType = input.tripType ?? inferTripType(input.route);

      deadlines.push(
        deadline({
          task: "Use the trips process rather than the ordinary event form",
          deadlineType: "hard_gate",
          sourceRule: "Trips beyond the M25 or overnight stays use the Trips process",
          precision: "route gate",
          blocksFinalSubmissionReadiness: true,
        }),
      );

      if (tripType === "international") {
        deadlines.push(
          deadline({
            task: "International trip submission target",
            dueDate: formatDate(subtractWeeks(eventDate, 6)),
            deadlineType: "hard_gate",
            sourceRule: "International trips: at least 6 weeks before departure",
            precision: "calendar weeks; verify current trip guidance",
            blocksFinalSubmissionReadiness: true,
          }),
        );
      } else if (tripType === "domestic_uk") {
        deadlines.push(
          deadline({
            task: "Domestic UK trip submission target",
            dueDate: formatDate(subtractWeeks(eventDate, 4)),
            deadlineType: "hard_gate",
            sourceRule: "Domestic UK trips: at least 4 weeks before departure",
            precision: "calendar weeks; verify current trip guidance",
            blocksFinalSubmissionReadiness: true,
          }),
        );
      } else {
        deadlines.push(
          deadline({
            task: "Confirm whether the trip is domestic UK or international",
            deadlineType: "verification_needed",
            sourceRule:
              "Trip deadline depends on type: international trips use 6 weeks, domestic UK trips use 4 weeks",
            precision: "trip-type gate",
            blocksFinalSubmissionReadiness: true,
          }),
        );
      }

      deadlines.push(
        deadline({
          task: "Travel information form target",
          dueDate: formatDate(addCalendarDays(eventDate, -14)),
          deadlineType: "hard_gate",
          sourceRule: "Travel information form: 14 days before trip",
          precision: "calendar days; verify current trip guidance",
          blocksFinalSubmissionReadiness: true,
        }),
      );
    } else {
      const isLargeRoute =
        route === "large_event" || route === "large_speaker_event";
      const isSpeakerRoute =
        route === "speaker_event" || route === "large_speaker_event";
      const highRiskOrHighProfileSpeaker =
        isSpeakerRoute && input.highRiskOrHighProfileSpeaker === true;
      const largeTermDeadline = isLargeRoute
        ? termDeadline(
            eventDate,
            term1LargeEventDeadline,
            term2LargeEventDeadline,
          )
        : null;

      if (largeTermDeadline?.warning) warnings.push(largeTermDeadline.warning);

      const speakerOneMonthDue = highRiskOrHighProfileSpeaker
        ? subtractCalendarMonths(eventDate, 1)
        : undefined;
      let officialSubmissionDue: Date | undefined;
      let submissionTask =
        "Latest indicated SU event form and risk assessment submission date";
      let submissionRule = "";
      let submissionPrecision =
        "working days; excludes weekends but not bank holidays";
      let submissionDeadlineType: DeadlineType = "hard_gate";

      if (isLargeRoute && largeTermDeadline?.date && speakerOneMonthDue) {
        officialSubmissionDue = earlierDate(
          largeTermDeadline.date,
          speakerOneMonthDue,
        );
        submissionTask =
          officialSubmissionDue.getTime() === largeTermDeadline.date.getTime()
            ? "Latest indicated large/flagship term submission deadline"
            : "Latest indicated high-risk/high-profile speaker submission deadline";
        submissionRule =
          "Use the earlier applicable gate: large/flagship term deadline or high-risk/high-profile speaker 1-month minimum";
        submissionPrecision =
          "earlier applicable deadline; verify current academic year";
      } else if (isLargeRoute && largeTermDeadline?.date) {
        officialSubmissionDue = largeTermDeadline.date;
        submissionTask =
          "Latest indicated large/flagship term submission deadline";
        submissionRule =
          largeTermDeadline.source ??
          "Published large/flagship term deadline; verify current academic year";
        submissionPrecision = "term deadline; verify current academic year";
      } else if (speakerOneMonthDue) {
        officialSubmissionDue = speakerOneMonthDue;
        submissionRule =
          "High-risk or high-profile speaker events: at least 1 calendar month before event";
        submissionPrecision = "calendar month";
      } else if (route === "speaker_event") {
        officialSubmissionDue = subtractWorkingDays(eventDate, 10);
        submissionRule =
          "Ordinary speaker event: external speaker approval is required; no separate ordinary-speaker notice period was found, so use the 10-working-day event-form minimum as a fallback and verify with SU";
        submissionPrecision =
          "working-day fallback; excludes weekends but not bank holidays";
        submissionDeadlineType = "verification_needed";
      } else if (route === "regular_event_candidate") {
        officialSubmissionDue = subtractWorkingDays(eventDate, 10);
        submissionRule =
          "Regular event form: at least 10 working days before event";
      }

      const internalSubmissionTarget = officialSubmissionDue
        ? isLargeRoute &&
          largeTermDeadline?.date &&
          officialSubmissionDue.getTime() === largeTermDeadline.date.getTime()
          ? subtractWorkingDays(officialSubmissionDue, 5)
          : highRiskOrHighProfileSpeaker
            ? subtractWeeks(eventDate, 6)
            : subtractWorkingDays(eventDate, 12)
        : subtractWeeks(eventDate, 6);
      const internalRule =
        isLargeRoute && largeTermDeadline?.date
          ? "Recommended internal target: 5 working days before the large/flagship term deadline"
          : highRiskOrHighProfileSpeaker
            ? "Recommended internal target: 6 weeks before event"
            : "Recommended internal target: 12 working days before event";

      deadlines.push(
        deadline({
          task: "Internal target to have event form fields, risk assessment, and budget notes ready",
          dueDate: formatDate(internalSubmissionTarget),
          deadlineType: "internal_gate",
          sourceRule: internalRule,
          precision:
            isLargeRoute && largeTermDeadline?.date
              ? "working days before term deadline"
              : highRiskOrHighProfileSpeaker
                ? "calendar weeks"
                : "working days; excludes weekends but not bank holidays",
          blocksFinalSubmissionReadiness: false,
        }),
        deadline({
          task: "Allow SU response buffer after internal submission target",
          dueDate: formatDate(addWorkingDays(internalSubmissionTarget, 5)),
          deadlineType: "dependency",
          sourceRule: "SU response target: add 5 working day buffer after submission",
          precision: "working days; response target is not a guarantee",
          blocksFinalSubmissionReadiness: false,
        }),
        deadline({
          task: "Risk assessment draft ready for committee review",
          dueDate: formatDate(internalSubmissionTarget),
          deadlineType: "internal_gate",
          sourceRule: "Risk assessment required for all events",
          precision: "same as internal event submission target",
          blocksFinalSubmissionReadiness: false,
        }),
        deadline({
          task: "Budget sheet or finance notes ready if budget threshold or planning need applies",
          dueDate: formatDate(internalSubmissionTarget),
          deadlineType: "internal_gate",
          sourceRule: "Budget template required if cost is over GBP 500 or over 50% of society balance",
          precision: "same as internal event submission target",
          blocksFinalSubmissionReadiness: false,
        }),
      );

      if (officialSubmissionDue) {
        deadlines.push(
          deadline({
            task: submissionTask,
            dueDate: formatDate(officialSubmissionDue),
            deadlineType: submissionDeadlineType,
            sourceRule: submissionRule,
            precision: submissionPrecision,
            blocksFinalSubmissionReadiness: true,
          }),
        );
      } else {
        deadlines.push(
          deadline({
            task: "Confirm the applicable large/flagship submission deadline with SU",
            deadlineType: "verification_needed",
            sourceRule:
              "Large/flagship deadline depends on current-year SU term guidance",
            precision: "manual verification gate",
            blocksFinalSubmissionReadiness: true,
          }),
        );
      }

      if (route === "speaker_event" || route === "large_speaker_event") {
        deadlines.push(
          deadline({
            task: "Confirm speaker details and check whether academic chair criteria apply",
            dueDate: formatDate(internalSubmissionTarget),
            deadlineType: "verification_needed",
            sourceRule:
              "External speaker events need speaker details; an academic chair is required only if the event is public, the speaker is high-profile/security-sensitive, or the topic may attract strongly differing views",
            precision: "same as internal event submission target",
            blocksFinalSubmissionReadiness: false,
            notes: [
              "Do not assume an academic chair is required for every external speaker event.",
              "If an academic-chair criterion applies, secure a full-time academic staff chair before final readiness.",
              "Do not advertise external speakers until SU approval is confirmed.",
            ],
          }),
        );
      }

      deadlines.push(
        deadline({
          task: "Catering request target, if food or refreshments are in scope",
          dueDate: formatDate(
            earlierDate(
              subtractWorkingDays(eventDate, 10),
              addCalendarDays(eventDate, -14),
            ),
          ),
          deadlineType: "dependency",
          sourceRule:
            "Catering: at least 10 working days before event; wording may ask 2 weeks",
          precision:
            "earlier of 10 working days and 14 calendar days; excludes bank holidays",
          blocksFinalSubmissionReadiness: false,
        }),
        deadline({
          task: "AV support request target, if AV is needed",
          dueDate: formatDate(subtractWorkingDays(eventDate, 10)),
          deadlineType: "dependency",
          sourceRule: "AV support: at least 10 working days before event",
          precision: "working days; excludes weekends but not bank holidays",
          blocksFinalSubmissionReadiness: false,
        }),
        deadline({
          task: "Extra furniture request target, if room layout changes are needed",
          dueDate: formatDate(subtractWorkingDays(eventDate, 5)),
          deadlineType: "dependency",
          sourceRule: "Extra furniture: at least 5 working days before event",
          precision: "working days; excludes weekends but not bank holidays",
          blocksFinalSubmissionReadiness: false,
        }),
        deadline({
          task: "Promotion, room confirmation, payments, and relevant external arrangements stay gated until SU approval",
          deadlineType: "hard_gate",
          sourceRule:
            "Promotion/payment gates: submit first and await SU approval before promotion, payments, and concrete external arrangements where applicable",
          precision: "approval gate",
          blocksFinalSubmissionReadiness: true,
        }),
      );
    }

    const sortedDeadlines = [...deadlines].sort((first, second) => {
      if (!first.dueDate && !second.dueDate) return 0;
      if (!first.dueDate) return 1;
      if (!second.dueDate) return -1;
      return dateDisplaySortKey(first.dueDate).localeCompare(
        dateDisplaySortKey(second.dueDate),
      );
    });

    return {
      eventDate: formatDate(eventDate),
      route,
      routeInput: input.route,
      canComputeDates: true,
      warnings,
      deadlines: sortedDeadlines,
      timezone: "Europe/London",
      workingDayPolicy:
        "Monday-Friday only; excludes weekends but not bank holidays.",
      rulesLastVerifiedDate: displayRulesLastVerifiedDate,
      rulesSourceSetId,
      disclaimer:
        "Draft aid only. Check current SU guidance and live forms before submission.",
    };
  },
});
