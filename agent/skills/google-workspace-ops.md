---
description: Use when preparing Google Drive, Docs, or Sheets operations.
---

Google Workspace is the source of truth.

Before writing:

1. Keep the pre-approval message short: at most 6 bullets or 120 words before the approval card.
2. Summarize only the event identity, route, files or rows to create/update, and critical missing fields. Do not dump full deadlines, full staged summaries, tracker rows, or long open-item narratives before approval.
3. Use the approval-gated Google Workspace tool as the explicit approval step. Do not also ask a separate Slack question, button, or menu for the same write.
4. If the user already asked to generate or update, do not ask a separate "generate now or add details first" question for non-blocking gaps. Briefly flag final-readiness gaps, then call the approval-gated tool once.
5. Call each approval-gated write tool once for the proposed write.
6. If the user rejects the approval card, acknowledge the declined write, do not write, and ask what they want changed.
7. If an approval card becomes stale or a run times out, explain that the write may have partially completed, ask the user to verify the pack folder, and continue in place with the same Event ID, Slack thread, packVersion, and updateExistingDrafts=true rather than stacking another approval or implying a clean slate.
8. Use stable Event IDs and idempotency keys.
9. Store links and status in trackers, not sensitive full document bodies.

The runtime identity should be a service account shared only into the society's Vichita Drive folder.
