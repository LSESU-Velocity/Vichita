---
description: Use when a committee member asks Vichita to remind someone or track a recurring task.
---

Reminders must be explicitly requested by a human.

Required fields:

- Target user or channel.
- Reminder text.
- One-off date or recurrence.
- Timezone, defaulting to Europe/London.
- Stop condition, such as "until done".
- Optional related Event ID or task ID.

Do not infer reminders from passive Slack monitoring. Scheduled execution should process only stored reminder rows.
