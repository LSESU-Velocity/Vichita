---
description: Use when preparing Google Drive, Docs, or Sheets operations.
---

Google Workspace is the source of truth.

Before writing:

1. Summarize exactly what files, folders, or rows will be created or updated.
2. Ask for explicit approval.
3. Use stable Event IDs and idempotency keys.
4. Store links and status in trackers, not sensitive full document bodies.

The runtime identity should be a service account shared only into the society's Vichita Drive folder.
