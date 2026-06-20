import { defineTool } from "eve/tools";
import { z } from "zod";

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
  return date.toISOString().slice(0, 10);
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
  if (
    /\b(large|flagship|external organisation|external organization|alcohol)\b/u.test(
      compact,
    ) ||
    />\s*75|over\s+75|budget.*500/u.test(compact)
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

function termDeadline(eventDate: Date) {
  const month = eventDate.getUTCMonth() + 1;
  const year = eventDate.getUTCFullYear();

  if (month >= 8 && month <= 12) {
    return {
      dueDate: `${year}-08-31`,
      label: "Term 1 large/flagship published deadline",
    };
  }

  if (month >= 1 && month <= 4) {
    return {
      dueDate: `${year - 1}-10-31`,
      label: "Term 2 large/flagship published deadline",
    };
  }

  return null;
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
        rulesLastVerifiedDate,
        rulesSourceSetId,
        disclaimer:
          "Draft aid only. Current published guidance and the live form/template are authoritative.",
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
      deadlines.push(
        deadline({
          task: "Use the trips process rather than the ordinary event form",
          deadlineType: "hard_gate",
          sourceRule: "Trips beyond the M25 or overnight stays use the Trips process",
          precision: "route gate",
          blocksFinalSubmissionReadiness: true,
        }),
        deadline({
          task: "International trip submission target, if applicable",
          dueDate: formatDate(subtractWeeks(eventDate, 6)),
          deadlineType: "hard_gate",
          sourceRule: "International trips: at least 6 weeks before departure",
          precision: "calendar weeks; verify current trip guidance",
          blocksFinalSubmissionReadiness: true,
        }),
        deadline({
          task: "Domestic UK trip submission target, if applicable",
          dueDate: formatDate(subtractWeeks(eventDate, 4)),
          deadlineType: "hard_gate",
          sourceRule: "Domestic UK trips: at least 4 weeks before departure",
          precision: "calendar weeks; verify current trip guidance",
          blocksFinalSubmissionReadiness: true,
        }),
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
      const isLargeOrSpeaker =
        route === "large_event" ||
        route === "speaker_event" ||
        route === "large_speaker_event";
      const officialSubmissionDue = isLargeOrSpeaker
        ? subtractCalendarMonths(eventDate, 1)
        : subtractWorkingDays(eventDate, 10);
      const internalSubmissionTarget = isLargeOrSpeaker
        ? subtractWeeks(eventDate, 6)
        : subtractWorkingDays(eventDate, 12);
      const submissionRule = isLargeOrSpeaker
        ? "Large/high-risk/speaker event: at least 1 calendar month before event"
        : "Regular event form: at least 10 working days before event";
      const internalRule = isLargeOrSpeaker
        ? "Recommended internal target: 6 weeks before event"
        : "Recommended internal target: 12 working days before event";

      deadlines.push(
        deadline({
          task: "Internal target to have event form fields, risk assessment, and budget notes ready",
          dueDate: formatDate(internalSubmissionTarget),
          deadlineType: "internal_gate",
          sourceRule: internalRule,
          precision: isLargeOrSpeaker
            ? "calendar weeks"
            : "working days; excludes weekends but not bank holidays",
          blocksFinalSubmissionReadiness: false,
        }),
        deadline({
          task: "Latest indicated SU event form and risk assessment submission date",
          dueDate: formatDate(officialSubmissionDue),
          deadlineType: "hard_gate",
          sourceRule: submissionRule,
          precision: isLargeOrSpeaker
            ? "calendar month"
            : "working days; excludes weekends but not bank holidays",
          blocksFinalSubmissionReadiness: true,
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

      if (route === "speaker_event" || route === "large_speaker_event") {
        deadlines.push(
          deadline({
            task: "Confirm speaker details and academic chair status",
            dueDate: formatDate(internalSubmissionTarget),
            deadlineType: "hard_gate",
            sourceRule:
              "External speaker events need speaker details; academic chair status may block final readiness",
            precision: "same as internal event submission target",
            blocksFinalSubmissionReadiness: true,
            notes: [
              "Do not advertise external speakers until SU approval is confirmed.",
            ],
          }),
        );
      }

      if (route === "large_event" || route === "large_speaker_event") {
        const largeTermDeadline = termDeadline(eventDate);
        if (largeTermDeadline) {
          deadlines.push(
            deadline({
              task: `Check whether the ${largeTermDeadline.label} applies`,
              dueDate: largeTermDeadline.dueDate,
              deadlineType: "verification_needed",
              sourceRule:
                "Published large/flagship term deadlines are academic-year-specific",
              precision: "verify current year before relying on this date",
              blocksFinalSubmissionReadiness: true,
            }),
          );
        }
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
          task: "Promotion, room confirmation, external company plans, and event payments remain blocked until SU approval",
          deadlineType: "hard_gate",
          sourceRule:
            "Promotion/payment gates: submit first and await SU approval before promotion, payments, and concrete external arrangements",
          precision: "approval gate",
          blocksFinalSubmissionReadiness: true,
        }),
      );
    }

    const sortedDeadlines = [...deadlines].sort((first, second) => {
      if (!first.dueDate && !second.dueDate) return 0;
      if (!first.dueDate) return 1;
      if (!second.dueDate) return -1;
      return first.dueDate.localeCompare(second.dueDate);
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
      rulesLastVerifiedDate,
      rulesSourceSetId,
      disclaimer:
        "Draft aid only. Current published guidance and the live form/template are authoritative.",
    };
  },
});
