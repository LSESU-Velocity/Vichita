import { defineTool } from "eve/tools";
import { z } from "zod";

const Input = z.object({
  eventDate: z.string(),
  route: z.enum([
    "regular_event_candidate",
    "large_event",
    "speaker_event",
    "large_speaker_event",
    "trip_process",
    "needs_human_review",
  ]),
  rulesLastVerifiedDate: z.string().optional(),
});

export default defineTool({
  description:
    "Return indicative deadline/checklist guidance for an event route. Does not replace current LSESU guidance.",
  inputSchema: Input,
  async execute(input) {
    const tasks = [
      {
        task: "Verify current SU guidance and live form",
        deadlineType: "hard_gate",
      },
      {
        task: "Prepare risk assessment draft",
        deadlineType: "internal_gate",
      },
      {
        task: "Prepare budget or finance notes if needed",
        deadlineType: "internal_gate",
      },
    ];

    if (
      input.route === "speaker_event" ||
      input.route === "large_speaker_event"
    ) {
      tasks.push({
        task: "Confirm speaker details and academic chair status",
        deadlineType: "hard_gate",
      });
    }

    if (input.route === "trip_process") {
      tasks.push({
        task: "Use the trips process rather than the ordinary event form",
        deadlineType: "hard_gate",
      });
    }

    return {
      eventDate: input.eventDate,
      route: input.route,
      tasks,
      precision: "indicative",
      rulesLastVerifiedDate: input.rulesLastVerifiedDate ?? "not provided",
      disclaimer:
        "Draft aid only. Current published guidance and the live form/template are authoritative.",
    };
  },
});
