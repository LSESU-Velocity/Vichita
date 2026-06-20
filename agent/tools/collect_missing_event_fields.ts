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
  externalSpeakers: z.array(z.string()).default([]),
  academicChairStatus: z.string().optional(),
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
    if (missing(input.accessibilityPlan)) {
      finalReadiness.push("Accessibility plan");
    }
    if (input.externalSpeakers.length > 0 && missing(input.academicChairStatus)) {
      finalReadiness.push("Academic chair status for speaker event");
    }

    return {
      missingCriticalFields: critical,
      blocksFinalSubmissionReadiness: finalReadiness,
      canGenerateDraftPack: critical.length === 0,
      disclaimer:
        "Draft aid only. Current published guidance and the live form/template are authoritative.",
    };
  },
});
