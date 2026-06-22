# Vichita - Data Handling Note for LSESU Review

Last updated: 2026-06-22

This note is for checking the proposed Vichita Slack agent with LSESU before the bot is finalised. It is not legal advice and should be reviewed against current LSESU, LSE, and UK GDPR expectations.

## 1. What the agent is for

Vichita is a reactive Slack-based operations assistant for LSESU Velocity committee members. It prepares draft administrative packs for committee review, especially event risk assessments, event form field packs, budgets, sponsorship admin packs, finance checklists, and marketing operations calendars.

The agent does **not** submit LSESU forms, sign contracts, send external messages, or publish public marketing. Humans review and submit everything.

## 2. MVP data minimisation choices

The MVP is deliberately limited:

- Reactive only: the agent only acts when mentioned in Slack, used in a DM, or triggered through a Slack modal.
- Slack modal answers are limited to the requested operational fields, for example event lead name/email. Runtime diagnostics should log request/session metadata only, not the submitted answer text.
- No passive channel monitoring.
- No proactive watching or scheduled scans.
- No email drafting/sending.
- No social media caption or image generation.
- No public posting by the agent.
- No direct LSESU form submission.
- No Launchpad student idea ingestion in MVP.
- No attendee list ingestion in MVP unless specifically approved later.
- No long-term storage of supplier bank details in the agent database or logs.

## 3. Data categories likely to be processed

| Data category | Examples | MVP status | Notes |
|---|---|---|---|
| Committee member data | Name, Slack user ID, committee role, LSE email | In scope | Needed for ownership, event lead fields, and approval routing. Slack modal submissions may collect this where the user provides it. |
| Event data | Event name, date, time, location, expected attendance, food/alcohol, speaker status, budget | In scope | Stored in Google Sheets/Docs event trackers and generated packs. |
| External speaker data | Name, job title, organisation, topic, public bio | In scope where relevant | Used only for draft LSESU field packs. SU background checks remain an SU process. |
| Sponsor/business contact data | Sponsor company, contact name, role, business email, invoice contact | V2, not true MVP | Store only when sponsorship workflows are enabled and reviewed. |
| Supplier/invoice data | Supplier name, address, invoice number, invoice amount, bank details | V2, high caution | The agent should validate completeness but should not retain bank details in logs/DB. Store official evidence in the approved SU/Google Drive process only. |
| Attendee data | Attendee names/emails, access needs | Out of MVP | Avoid unless a specific approved process exists. |
| Accessibility requirements | Dietary/access requirements, accessibility contact | Mostly out of MVP | Event page should include a contact; avoid unnecessary storage of sensitive individual needs. |
| Student startup ideas | Launchpad ideas, founder names, idea details | Out of MVP | Treat as confidential. Use only anonymised trends later with explicit consent. |

## 4. Proposed storage locations

| Location | What may be stored | Notes |
|---|---|---|
| Slack | User prompt, agent response, modal submissions, approval cards, links to generated files | Use private committee channels for admin work. Avoid pasting sensitive finance/banking details. |
| Vercel runtime / logs / traces | Minimal request metadata, tool outcomes, and non-sensitive diagnostic breadcrumbs | Configure logging to avoid full document bodies, modal answer text, and sensitive invoice/banking fields where possible. |
| Google Drive | Generated event packs, risk assessments, budgets, sponsorship packs, finance checklists | Use a dedicated `Vichita` folder owned by the society Google account with restricted committee access. The agent service account should only be shared into this folder. |
| Google Sheets | Trackers: events, packs index, marketing ops calendar, compliance tasks, sponsorship tracker later | Avoid storing unnecessary PII. Do not store bank details in tracker rows. |
| Vercel Blob or object storage | Only if needed for temporary file export | Prefer Google Drive as source of truth. Delete temporary files after upload where possible. |
| Postgres/Supabase | Not in MVP | Add later only if audit/approval state needs more reliable persistence. |

## 5. Access control proposal

- Create a dedicated Google Drive folder: `Vichita`.
- The society Google account should own the folder.
- The Google service account should have editor access only to the `Vichita` folder, not a personal President Drive.
- Share only with the current Velocity committee and relevant SU staff if requested.
- Use role-based Slack approval gates:
  - President: can approve all internal write/export actions.
  - Head of Operations: can approve event pack/tracker updates.
  - Head of Events: can approve event records and event logistics updates.
  - Head of Marketing: can approve marketing operations calendar updates.
  - Head of Outreach/Partnerships: can approve sponsor tracker/contract pack updates when sponsorship module is enabled.
- Role checks should use configured Slack user IDs or Slack user group IDs, not display names.
- Keep generated packs review-only until a human marks them as internally approved.
- Do not allow the agent to sign contracts, submit forms, or send external communications.

## 6. Retention proposal

These are proposed defaults to confirm with LSESU:

| Data | Proposed retention |
|---|---|
| Event trackers and generated event packs | Current academic year + 12 months, then archive or delete depending on SU guidance. |
| Risk assessments and budgets for delivered events | Retain according to SU records guidance; confirm exact period. |
| Sponsorship records/contracts | Retain according to SU finance/contract guidance; confirm exact period. |
| Invoice evidence | Store in the approved finance process only. Do not duplicate bank details in the agent database. |
| Agent temporary files | Delete after upload/export or within 30 days maximum. |
| Slack prompts/responses | Retained according to Slack workspace retention; avoid sensitive content in prompts. |
| Student startup idea data | Out of MVP. If later enabled, require explicit consent and separate retention policy. |

## 7. Questions to ask LSESU before finalising

1. Is LSESU comfortable with Velocity using a Slack-based Vercel-hosted agent to prepare draft event admin packs, provided humans review and submit all official forms?
2. Is Google Drive/Docs/Sheets acceptable as the committee source of truth for draft risk assessments, budgets, sponsorship documents, and event trackers?
3. Are there any rules about storing sponsor contact details, sponsorship contracts, or invoice metadata in a student group Google Drive folder?
4. Are there any restrictions on using third-party AI tools for draft risk assessments, budgets, and event form field packs?
5. What retention period should Velocity use for event packs, risk assessments, budgets, sponsorship records, and finance documents?
6. Is it acceptable for a Google service account, scoped only to the restricted Velocity Drive folder, to create draft documents and update trackers?
7. Should any SU staff have access to the generated folder or just receive final manually submitted documents?
8. Are there any event categories where LSESU does not want AI-assisted draft document preparation?
9. What wording should appear on generated drafts to make clear that LSESU guidance and staff review are authoritative?
10. Are there any data categories the agent should explicitly not process, even reactively?

## 8. Standard disclaimer for all generated Slack/document outputs

> Draft aid only. LSESU's current published guidance and the live form/template are authoritative. This pack was generated for internal Velocity review and must be checked by the committee before submission. Rules/templates last manually verified on `{{rules_last_verified_date}}`.
