import { defineTool } from "eve/tools";
import { z } from "zod";

const Input = z.object({
  eventName: z.string().optional(),
  eventDescription: z.string().optional(),
  proposedDate: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  location: z.string().optional(),
  expectedAttendance: z.number().int().nonnegative().optional(),
  organiserName: z.string().optional(),
  organiserLseEmail: z.string().email().optional(),
  firstAidPlan: z.string().optional(),
  accessibilityPlan: z.string().optional(),
  accessibilityContactOrRequestRoute: z
    .string()
    .optional()
    .describe(
      "How attendees can request access accommodations, for example a named contact or form link.",
    ),
  externalSpeakers: z.array(z.string()).default([]),
  academicChairStatus: z.string().optional(),
  openToPublicOrAlumni: z
    .boolean()
    .optional()
    .describe("True if the event is open to alumni, non-LSE students, or the public."),
  highProfileSpeaker: z.boolean().optional(),
  securitySensitiveSpeaker: z.boolean().optional(),
  topicLikelyToAttractStronglyDifferingViews: z.boolean().optional(),
});

function missing(value: unknown) {
  return typeof value !== "string" || value.trim().length === 0;
}

export default defineTool({
  description:
    "List missing event intake fields and whether they block draft generation or final readiness.",
  inputSchema: Input,
  async execute(input) {
    const critical: string[] = [];
    const finalReadiness: string[] = [];
    const recommendedChecklist: string[] = [];

    if (missing(input.eventName)) critical.push("Event name");
    if (missing(input.eventDescription)) critical.push("Event description");
    if (missing(input.proposedDate)) critical.push("Proposed date");
    if (missing(input.startTime)) critical.push("Start time");
    if (missing(input.endTime)) critical.push("End time");
    if (missing(input.location)) critical.push("Exact location");
    if (typeof input.expectedAttendance !== "number") {
      critical.push("Expected attendance");
    }
    if (missing(input.organiserName)) critical.push("Organiser name");
    if (missing(input.organiserLseEmail)) critical.push("Organiser LSE email");

    if (missing(input.firstAidPlan)) finalReadiness.push("First-aid plan");
    if (
      missing(input.accessibilityContactOrRequestRoute) &&
      missing(input.accessibilityPlan)
    ) {
      finalReadiness.push("Accessibility contact or accommodation-request route");
    }
    if (missing(input.accessibilityPlan)) {
      recommendedChecklist.push("Accessibility considerations or accommodations plan");
    }
    const hasExternalSpeakers = input.externalSpeakers.length > 0;
    const academicChairCriteriaValues = [
      input.openToPublicOrAlumni,
      input.highProfileSpeaker,
      input.securitySensitiveSpeaker,
      input.topicLikelyToAttractStronglyDifferingViews,
    ];
    const academicChairCriteriaChecked = academicChairCriteriaValues.every(
      (value) => typeof value === "boolean",
    );
    const academicChairLikelyRequired =
      input.openToPublicOrAlumni === true ||
      input.highProfileSpeaker === true ||
      input.securitySensitiveSpeaker === true ||
      input.topicLikelyToAttractStronglyDifferingViews === true;
    const academicChairApplicability = !hasExternalSpeakers
      ? "not_applicable"
      : academicChairLikelyRequired
        ? "likely_required"
        : academicChairCriteriaChecked
          ? "not_indicated"
          : "needs_checking";

    if (
      hasExternalSpeakers &&
      academicChairLikelyRequired &&
      missing(input.academicChairStatus)
    ) {
      finalReadiness.push(
        "Academic chair status where public/high-profile/security-sensitive/strongly differing views criteria apply",
      );
    } else if (hasExternalSpeakers && !academicChairCriteriaChecked) {
      finalReadiness.push(
        "Academic chair criteria check for speaker event",
      );
    }

    return {
      missingCriticalFields: critical,
      blocksFinalSubmissionReadiness: finalReadiness,
      recommendedChecklist,
      canGenerateDraftPack: critical.length === 0,
      speakerApprovalRequired: hasExternalSpeakers,
      academicChairApplicability,
      academicChairCriteriaChecked,
      academicChairLikelyRequired,
      academicChairRule:
        "Required only if the speaker event is public/open to alumni or non-LSE students, high-profile/security-sensitive, or likely to attract strongly differing views.",
      disclaimer:
        "Draft aid only. Check current SU guidance and live forms before submission.",
    };
  },
});
