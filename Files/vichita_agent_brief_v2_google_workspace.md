# Vichita Agent Brief v2

**Project:** LSESU Velocity internal Slack operations agent  
**Creator:** Yamin Mushtaq  
**Owner:** Velocity President  
**Committee context:** President, Head of Operations, Head of Marketing, Head of Events, Head of Outreach/Partnerships  
**Workspace:** Slack committee workspace  
**Source of truth:** Google Drive, Google Docs, and Google Sheets  
**Agent framework:** Vercel Eve  
**Primary channel integration:** Slack through Vercel Connect  
**MVP posture:** Reactive only; no proactive monitoring; no template version monitor  
**Last source review:** 2026-06-21
**Last implementation status update:** 2026-06-22

---

## 0. Executive summary

Build **Vichita**, a Slack-native operations and compliance agent for LSESU Velocity. The agent should not be a generic chatbot, marketing copywriter, poster generator, or email writer. Its value is in turning messy committee plans into structured, reviewable, SU-ready administrative packs and trackers.

The true MVP is:

1. A reactive Slack agent that responds to @mentions/DMs and Slack modals.
2. An event classifier that decides which LSESU route an event probably falls under.
3. A missing-information engine that blocks final submission readiness when required details are missing.
4. A document-pack generator that prepares:
   - Risk Assessment from a tagged LSESU template.
   - Budget Sheet from a tagged LSESU template where required/useful.
   - LSESU form field pack for manual copy/paste into the official Podio form.
   - Deadlines and dependencies checklist.
   - Accessibility checklist.
   - Internal review summary.
5. A Google Drive/Sheets tracker update after human approval.

Humans must review and submit everything. The agent must not sign contracts, submit forms, make payments, send emails, or publish public marketing.

### 0.1 Current implementation status

As of 2026-06-22, the project has a working Slack deployment, the core event-pack workflow is live-tested, and the two live follow-up bugs have code fixes in the working tree pending production smoke after deploy.

Complete:

- Repository, license, README, setup checklist, and template/secret exclusion policy.
- Eve project scaffold.
- Vercel production deployment at `https://vichita.vercel.app`.
- GitHub-to-Vercel deployment connection.
- Vercel Connect Slack connector for the Velocity Committee workspace.
- Slack @mention replies in the private `#vichita` test channel.
- Slack route fixed to `POST /triggers/slack`, matching Vercel Connect's default trigger path.
- Runtime model selection through `EVE_MODEL`, defaulting to `zai/glm-5.2`.
- Same-provider `EVE_MODEL_FALLBACKS` guard to avoid known cross-provider Gateway routing errors.
- Initial event-admin tools:
  - `classify_event`
  - `collect_missing_event_fields`
  - `compute_deadlines`
- Runtime instructions and skills for reactive-only behaviour, LSESU event rules, risk scoring, reminders, Google Workspace write gates, and data handling.
- Phase 2 Google Workspace foundation:
  - `googleapis` dependency for Drive/Sheets API access.
  - Env/config validation for Google and deployment settings.
  - Service-account auth from `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64`.
  - Read-only Drive root folder access check.
  - One-spreadsheet `Vichita Trackers` tab/header schema, approval-gated tab/header creation, and under-width tab expansion before header writes.
  - Canonical Event ID, pack ID, and idempotency helpers.
  - Approval-gated event pack folder creation by Event ID and stored Slack thread key when available.
  - Source Registry tab schema and approval-gated row upsert foundation.
  - Live production smoke on 2026-06-21: Google setup check passed, tracker tabs/headers matched, and approval-gated Drive pack folder creation produced a clean `DD-MM-YYYY - Event Name` folder with Event ID/thread-key metadata.
- Phase 4 event-pack generation:
  - Approval-gated `generate_event_pack` creates/updates the risk assessment Google Doc from the tagged template, budget Google Sheet when required/requested, LSESU form-field Google Sheet, deadline plan Google Sheet, internal review summary Google Doc, Event Packs Index row, Events Tracker row, and Compliance Tasks rows.
  - Same-version `update_event_pack_fields` patches existing packs in place for changed fields instead of creating fresh hallucinated packs.
  - Generated field packs and deadline plans are now native Google Sheets, not flat Markdown/Docs.
  - Accessibility checklist actions and deadline actions are also represented in the `Compliance Tasks` tracker with stable task IDs.
  - Pre-approval Slack output is deliberately short so Eve can checkpoint approval cards before Vercel's 300-second Hobby runtime cap.
  - Live Slack test confirmed fast, accurate pack generation after the short pre-approval fix.
- Date validation now rejects impossible calendar dates such as February 30 before identity/deadline/Drive writes.
- Diagnostics hooks and Google-write breadcrumbs exist to identify future timeout locations.
- Slack modal submission false-failure UX is fixed in code by wrapping the Eve Slack route in-process: `view_submission` keeps Eve answer recording but returns Slack's expected empty `200`; approval button actions stay on Eve's default path.
- Route classification now trusts the model's structured trip flags (`tripBeyondM25`, `overnightTrip`, `multiDayAtSingleVenue`) instead of re-parsing prose with broad regexes. The deterministic backstop only demotes the common over-flag of an on-site multi-day overnight event with no away travel or external venue.

Partially complete:

- Event classification and deadline behaviour works through Slack. Helper regression tests cover the reported single-venue hackathon bug, real away/overnight trips, on-site overnight events, and external-university attendance; a separate formal eval harness is still optional/future work.
- Source/rule versioning is represented in env/config and tracker tooling, but current source rows still need manual verification and entry.
- Slack modal and classifier fixes need production smoke after deployment on the real production URL.

Not complete yet:

- Marketing operations row creation.
- Vercel Cron reminder processor.
- Sponsorship, finance, automation-intake, website, and Launchpad-adjacent v2 modules.

---

## 1. Background and society context

LSESU Velocity is an LSE student society focused on helping students build, test, and launch practical products using modern AI/product-building tools.

Velocity is building **lsesuvelocity.com**, which currently or plannedly includes:

1. **Launchpad**  
   A student startup idea workflow that helps students take an idea from zero to one. It may use a council of analyst agents to research competitors, market size, customer segments, monetisation, distribution, and generate artifacts such as waitlist pages and pitch decks.

2. **Automation Intake**  
   A workflow that helps identify areas where automation could improve real processes. The outputs become student project opportunities for Velocity members.

3. **Resources Hub**  
   A hub for an AI tool directory, UK student discounts, blogs, case studies, and starter templates.

The committee is also planning next-term events, sponsorships/partnerships, website work, marketing operations, and admin processes.

The agent exists to make the committee more operationally reliable, not to replace human judgement or produce generic content.

---

## 2. Product direction: no slop, high-value admin only

### 2.1 Build this

Vichita should automate structured, high-friction administrative work:

- Event classification.
- Risk-assessment drafting against official template structure.
- Budget-sheet drafting against official template structure.
- LSESU form field packs for manual submission.
- Missing-info checklists.
- Approval readiness checks.
- Deadline/dependency calculation.
- Accessibility checklists.
- Sponsorship contract/admin packs in v2.
- Finance/invoice readiness checks in v2.
- Marketing operations calendars and launch gates.
- Google Drive folder creation and Google Sheet tracker updates.
- Audit notes showing who approved which internal write action.

### 2.2 Do not build this as core functionality

Do not make generic content generation the point of this agent.

Non-goals:

- Generic email writer.
- Generic sponsor outreach writer.
- Generic social media caption generator.
- Poster/image generator.
- Generic video script generator.
- Generic brainstormer for event ideas.
- Generic ChatGPT-style advice bot.
- Passive monitor that comments on conversations without being asked.
- Bot that auto-submits SU forms or signs contracts.

The agent may produce short operational text inside structured documents, but only where it is necessary to fill an admin pack or tracker.

---

## 3. Current Slack channels and routing

The current Slack channel list is:

1. `#announcements`
2. `#automation-projects`
3. `#events`
4. `#general`
5. `#marketing`
6. `#sponsors-partners`
7. `#website`

Use these as the canonical channel numbers everywhere in the project. Do not have a separate channel list in another section.

### 3.1 Suggested optional additions

Recommended additions, but not required:

8. `#agent-test` or `#vichita`  
   Private beta/testing channel for trying workflows before adding the agent to real committee channels.

9. `#ops`  
   Useful if the Head of Operations needs a dedicated place for deadlines, admin packs, finance checks, room booking, and compliance tasks. If the committee wants fewer channels, keep ops inside `#events` and `#general`.

Do **not** create a separate `#event-packs` channel for documents. Store generated packs in Google Drive and link them from `#events` or `#agent-test`.

### 3.2 Channel routing

| Channel | Agent use |
|---|---|
| `#announcements` | No agent writes in MVP. Humans post final announcements only. |
| `#automation-projects` | Later: automation intake summaries and project brief trackers. Reactive only. |
| `#events` | Main event intake, classification, missing-info checks, pack links, event deadlines. |
| `#general` | General committee questions and summaries when asked. |
| `#marketing` | Marketing operations calendar, launch gates, campaign task tracker. No captions/images. |
| `#sponsors-partners` | Sponsorship admin packs, sponsor compliance, contract checklist in v2. |
| `#website` | Later: website task specs and GitHub issues. |
| `#agent-test` / `#vichita` | Safe testing ground for all MVP workflows. |
| `#ops` | Optional admin command centre if created. |

---

## 4. Reactive-only MVP

The MVP is deliberately **reactive only**.

The agent may act only when:

- A committee member @mentions it in a channel.
- A committee member DMs it.
- A committee member opens a Slack modal/button that invokes it.

The agent must not:

- Passively read all channel messages.
- Watch for premature promotion and interject unprompted.
- Run proactive scans.
- Create reminders without an explicit human request and confirmation.
- Auto-detect template changes.
- Auto-submit forms.
- Auto-create public announcements.

Instead of proactive warnings, the agent should maintain status fields such as:

- `Promotion status: BLOCKED until LSESU approval`.
- `Speaker promotion: BLOCKED until speaker approved`.
- `Sponsor-branded promotion: BLOCKED until sponsorship/logo approval is clear`.
- `Submission readiness: DRAFT ONLY / BLOCKED / READY FOR INTERNAL REVIEW`.

These statuses are shown only when the agent is asked or when a human opens the relevant event record.

### 4.1 Explicit reminders via Vercel Cron

Scheduled reminders are allowed only as user-requested tasks. They do not change the no-passive-monitoring rule.

Allowed pattern:

1. A committee member asks in Slack, DM, or a modal, e.g. `@Vichita remind @Maya every Monday until the sponsor invoice is uploaded`.
2. The agent confirms the target, wording, recurrence, timezone, related Event ID/task, and stop condition.
3. After confirmation, the agent writes one row to the `Reminders` tracker.
4. A single protected Vercel Cron route, `/api/cron/reminders`, runs on a fixed schedule, checks due active rows, sends the reminder, and updates `Last Sent At` / `Next Run At`.

The cron route must not scan Slack to infer tasks. It may only process stored reminder rows created by explicit human action.

Initial schedule: run once daily, which is enough for weekly committee nudges and works on Vercel Hobby. If the society later needs minute-level precision or multiple daily checks, move to a Pro plan and update the cron expression.

Store user-facing recurrence in `Europe/London`, store execution timestamps in UTC, and treat `done`, `paused`, and `cancelled` as hard stops.

---

## 5. Standing compliance language

Every classification, deadline output, or generated pack must include this line or a short equivalent:

> Draft aid only. LSESU's current published guidance and the live form/template are authoritative. This was generated for internal Velocity review and must be checked before submission. Rules/templates last manually verified on `{{rules_last_verified_date}}`.

The agent must never sound like it is giving final compliance approval. It should say “likely”, “appears to”, “requires committee/SU confirmation”, or “draft readiness” where appropriate.

---

## 6. LSESU event rules to encode

This section records the current public guidance that should be encoded into `agent/skills/lsesu-events.md`. The coding agent should verify these sources again before production launch and before each academic year.

### 6.1 Event form requirement

Every planned LSESU club/society event should have an event form and a risk assessment. Event form submissions should include a completed risk assessment. Trips beyond the M25 or involving overnight stays should use the Trips process instead of the ordinary event form.

### 6.2 Regular Event route

Use the Regular Event route only for smaller, regular activities that do **not** trigger the large/speaker criteria.

Examples include smaller society meetings, picnics, film screenings, pub quizzes, and restaurant visits.

A proposed event is **not** a Regular Event if it has any of the large/speaker triggers below.

### 6.3 Large / Speaker Event route

Use the Large Event or Speaker Event route if any of these are true:

- External speaker involved.
- Flagship event.
- Event budget over £500.
- Event budget is a large proportion of the society balance.
- **More than 75 attendees.**
- Organised alongside an external organisation.
- Centred around alcohol.
- Involves foreign dignitaries or potentially high-profile/high-risk characteristics.

### 6.4 The 75-attendee boundary fix

Classifier rule:

- `expected_attendance <= 75` does **not** trigger Large Event status on attendance alone.
- `expected_attendance > 75` triggers Large Event status.
- Exactly `75` attendees is therefore still potentially Regular **if and only if** no other large/speaker trigger applies.
- Missing or uncertain expected attendance should produce a missing-field warning, not a guessed classification.

Required evals:

- 74 attendees, no other trigger -> regular candidate.
- 75 attendees, no other trigger -> regular candidate.
- 76 attendees, no other trigger -> large event.
- 75 attendees + external speaker -> large/speaker event.
- 75 attendees + budget £650 -> large event.

### 6.5 Speaker events and academic chair

If an external speaker is involved:

- Speaker names and brief descriptions should be included in the event form.
- The SU conducts background checks.
- Speakers should not be advertised until SU approval.
- An academic chair may be required for public events, high-profile speakers, security-sensitive speakers, or topics likely to attract strongly differing views.

Academic chair handling:

- Missing academic chair status must **not** block draft-pack generation.
- Missing academic chair status must block `Ready for final submission` when the classifier believes an academic chair may be required.
- Output should say: `Academic chair: unresolved - draft generated, final submission readiness blocked until confirmed.`

### 6.6 External organisations and sponsor involvement

If an external organisation or sponsor is involved:

- The event must be demonstrably led and fully organised by Velocity for LSE students.
- If the external organisation is effectively organising the event, it may need to book through the LSE Events Team instead.
- Employer/careers-style events involving external organisations may require LSE Careers contact at least 8 weeks before the event.

### 6.7 Risk assessment requirements

Risk assessment is required for all events.

Core risk rows to include:

1. Capacity Control.
2. Crowd Control.
3. Electrical Hazards.
4. Fire Hazards.
5. First Aid Emergencies.
6. Trips, Slips and Falls.

Activity-specific risks to add when relevant:

- Food/allergens/hygiene.
- Alcohol.
- External speakers.
- Controversial content or protest risk.
- Public or non-LSE attendees.
- Sponsor/employer involvement.
- Under-18s or vulnerable adults.
- External venue.
- Zoom/online security.
- Lighting/sound/ventilation.
- Crowd arrival/departure patterns.
- Accessibility requirements.
- Equipment/manual handling.

Risk table fields:

- Hazard identified.
- Why this is a hazard.
- Who is at risk.
- Risk score.
- Actions before the event.
- Actions during the event.
- Owner/responsible person.

Risk scoring policy:

- Use the LSESU-style 4x4 probability/severity matrix from the reviewed risk-assessment example.
- Probability values:
  - Very unlikely = 1.
  - Unlikely = 2.
  - Possible = 3.
  - Likely = 4.
- Severity values:
  - 1 = minor impact.
  - 2 = moderate impact.
  - 3 = serious impact.
  - 4 = severe impact.
- `risk_score = probability_value * severity_value`.
- Possible scores are `1, 2, 3, 4, 6, 8, 9, 12, 16`.
- The agent should generate a draft residual score after proposed controls, not claim final safety approval.
- If the risk is uncertain, unusually severe, or depends on venue/SU confirmation, set the score to `TBC - committee to confirm` and block final submission readiness.
- Generated risk rows should include enough text in the actions fields for humans to understand why the proposed score is low/medium/high.

### 6.8 Budget requirements

A budget template is required if:

- Event cost is over £500.
- Event cost is over 50% of the society balance.

Even when not strictly required, the agent may offer to generate a budget for internal planning.

### 6.9 Promotion and payment gates

The agent should encode these gates:

- Submit the event form first.
- Await SU approval before promoting the event.
- Await SU approval before making concrete plans with external companies/speakers.
- Do not make event-related payments until the event form is approved.
- Rooms are confirmed only after SU approval.
- Do not advertise external speakers until SU approval.

For MVP, the agent does not proactively police these gates. It shows them in the event status and marketing operations calendar when asked.

---

## 7. Deadlines and date handling

### 7.1 Date calculation policy

Use `Europe/London` timezone.

Use `DD-MM-YYYY` for human-facing dates in Slack summaries, Drive folder names, tracker display formats, and generated documents. Keep Event IDs, API inputs, environment variables, and source-set IDs in their required machine formats such as `YYYY-MM-DD` or `EVT-YYYYMMDD-...`.

Working-day calculations in MVP:

- Monday-Friday only.
- If a UK/England bank holiday calendar is configured, exclude bank holidays.
- If no holiday calendar is configured, label the date as: `Indicative deadline, excludes weekends but not bank holidays`.

For compliance-sensitive deadlines, prefer a conservative internal deadline earlier than the minimum official deadline.

### 7.2 Source identification and rule versioning

Every rule-backed output should carry both:

- `rules_last_verified_date`, e.g. `2026-06-20`.
- `rules_source_set_id`, e.g. `lsesu-events-2026-06-20`.

Maintain a source registry in the project, not just prose notes. The registry should record:

- Source name.
- URL.
- Topic/module, such as events, trips, sponsorship, promotion, pay/reimbursement, accessibility, Eve, Vercel Connect, Google Workspace APIs.
- Last verified date and verifier.
- Whether the rule is stable, academic-year-specific, or needs re-check before real use.
- Short note of what was encoded.

For current-year deadlines, admissions windows, trip deadlines, sponsorship process changes, and form-field changes, the agent should block final readiness if the relevant source has not been verified for the current academic year.

### 7.3 Event deadlines

| Requirement | External/minimum deadline | Recommended internal deadline | Precision note |
|---|---:|---:|---|
| Regular event form | At least 10 working days before event | 12 working days before event | Exclude bank holidays if calendar configured. |
| High-risk or high-profile speaker event | 1 calendar month before event | 6 weeks before event | Treat as minimum; SU back-and-forth can add time. |
| LSE Careers contact for relevant external organisation/careers event | At least 8 weeks before event | 9 weeks before event | Only where applicable. |
| Catering | At least 10 working days before event; form wording may ask 2 weeks | Use the earlier/conservative of 10 working days and 14 calendar days | Include in budget and risk assessment. |
| AV support | At least 10 working days before event | 12 working days before event | Include room/tech dependencies. |
| Extra furniture | At least 5 working days before event | 7 working days before event | Only after location known. |
| SU response target | SU aims to respond within 5 working days | Add 5 working days buffer after submission | Not a guarantee. |
| Flagship / large Term 1 deadline | 31 August in current public guidance | Verify for current year | **VERIFY FOR CURRENT YEAR**. |
| Flagship / large Term 2 deadline | 31 October in current public guidance | Verify for current year | **VERIFY FOR CURRENT YEAR**. |
| 2026/27 event form acceptance | From 1 August 2026 in current public guidance | Verify before use | **VERIFY FOR CURRENT YEAR**. |

### 7.4 Trips and tours deadlines

Trips beyond the M25 or overnight trips should use the Trips process, not the standard event form.

Current public guidance references the following, but all year-specific dates must be verified before use:

| Requirement | Deadline | Note |
|---|---:|---|
| International trip | At least 6 weeks before departure | Verify current guidance. |
| Domestic UK trip | At least 4 weeks before departure | Verify current guidance. |
| Travel information form | 14 days before trip | Verify current guidance. |
| Autumn Term 2025/26 trip deadline | 1 September | **OLD/YEAR-SPECIFIC - VERIFY FOR CURRENT YEAR**. |
| Winter Term 2025/26 trip deadline | 31 October | **OLD/YEAR-SPECIFIC - VERIFY FOR CURRENT YEAR**. |
| Spring Term 2025/26 trip deadline | 28 February | **OLD/YEAR-SPECIFIC - VERIFY FOR CURRENT YEAR**. |

The agent should not produce final trip deadlines without a current-year verification note.

---

## 8. Sponsorship/admin rules for v2

Sponsorship is v2, not true MVP, unless the committee urgently needs it.

Rules to encode later:

- Student groups should not sign sponsorship contracts themselves.
- Sponsor signs/dates first, then the contract is submitted to LSESU for review/signature.
- LSESU signs on behalf of the student group.
- Sponsorship submission portal asks for sponsor/company details, invoice amount, invoice contact, overview, foreign government/embassy declaration, society contact, attachments, and special requests.
- FIRS/foreign entity checks may be needed if funding comes from a foreign government/entity.
- Employer events must not be purely promotional or recruitment-only.
- Student Group x Employer events should include skills development, sector education, networking, or genuine collaboration.
- On-campus Careers Fairs should go through LSE Careers.
- Events with sponsors/external organisations should still be society-led and organised for LSE students.
- Sponsorship deliverables involving attendee data must be consent-gated and treated as high-risk.

Sponsorship pack v2 outputs:

- Sponsorship Contract Draft from tagged LSESU template.
- Sponsorship Submission Field Pack.
- Foreign Entity / FIRS checklist.
- Employer Event Compliance Note.
- Sponsor Benefits Tracker.
- Invoice Details Checklist.
- Contract Review Checklist.

---

## 9. Marketing operations, not marketing content

The marketing module should make the Head of Marketing’s job easier without generating slop.

Build:

- Marketing operations calendar.
- Launch gates.
- Asset/task ownership.
- Dependencies on SU approval, room confirmation, Native/ticketing, speaker approval, sponsor/logo approval, accessibility note.
- Channel plan and posting dates, but not generated captions/images.
- Post-event recap task tracker.

Do not build as MVP:

- Caption generator.
- Poster/image generator.
- Generic video script generator.
- Generic social brainstormer.

Marketing calendar fields:

- Event.
- Approval status.
- Room confirmation status.
- Ticketing status.
- Target audience.
- Channels.
- Asset owner.
- Copy owner.
- Design owner.
- Sponsor approval needed.
- Accessibility note included.
- SU promotion request status.
- Poster/stall/flyer status.
- Launch gate status.
- Publish dates.
- Dependencies.

Launch gates:

- Block public promotion until event form approved.
- Block speaker promotion until speaker approved.
- Block sponsor-branded promotion until sponsor/logo approval and contract status are clear.
- Block ticket push until Native/ticketing or approved registration route is ready.
- Block external-attendee promotion unless ticketing/access-list plan is ready.

---

## 10. Google Workspace instead of Notion

The committee uses Google Docs and Sheets for everything. Do not use Notion as the source of truth.

### 10.1 Recommended Google Drive structure

Create a restricted Google Drive folder:

```text
Vichita/
  Templates/
    Official Raw/
    Tagged Automation Copies/
  Event Packs/
    DD-MM-YYYY - Event Name/
      Risk Assessment.docx or Google Doc
      Budget.xlsx or Google Sheet
      LSESU Form Field Pack Google Sheet
      Deadline Plan Google Sheet
      Internal Review Summary Google Doc
      Accessibility and deadline actions tracked in Compliance Tasks when tracker writes are enabled
  Sponsorship Packs/
  Finance Checks/
  Marketing Ops/
  Archive/
```

### 10.2 Google Sheets as trackers

Use one Google spreadsheet instead of Notion databases or many separate tracker files.

Spreadsheet name:

```text
Vichita Trackers
```

Tabs:

1. `Events Tracker`
2. `Event Packs Index`
3. `Compliance Tasks`
4. `Marketing Ops Calendar`
5. `Sponsorship Tracker` v2
6. `Sponsorship Contracts` v2
7. `Finance & Reimbursements` v2
8. `Reminders`
9. `Template Inventory` manual only, no monitor
10. `Source Registry`

Use `GOOGLE_TRACKERS_SPREADSHEET_ID` for the spreadsheet file. Use tab names internally for reads/writes. Recommended manual setup is to create/share the spreadsheet file and let `ensure_google_tracker_tabs` create or verify the tabs after approval; if tabs are hand-created, the tool expands under-width tabs before writing headers.

### 10.3 Connector strategy

Use Vercel Connect for Slack because Slack is the main channel and Eve Slack templates use Vercel Connect for Slack credentials.

Use Vercel AI Gateway for model routing, cost tracking, and provider flexibility. Store the gateway key in `AI_GATEWAY_API_KEY` if using API-key auth, or use Vercel OIDC where supported. Current runtime default is `EVE_MODEL=zai/glm-5.2`. Keep `EVE_MODEL_FALLBACKS` empty at first, or use only same-provider fallbacks unless `agent/agent.ts` is changed to use an explicit Gateway model wrapper.

For Google Workspace, use a Google Cloud service account scoped to the dedicated `Vichita` Drive folder.

Chosen approach:

- A society-owned Google identity, preferably the society Gmail / society Google account, owns the `Vichita` Drive folder, templates, and trackers.
- A Google Cloud service account is created for the agent runtime, for example `vichita-agent@PROJECT_ID.iam.gserviceaccount.com`.
- The service account is shared into only the `Vichita` Drive folder as editor.
- Use Google Drive API, Docs API, and Sheets API.
- Store service account credentials only in environment variables or Vercel secret/env storage; never commit keys.
- For early local/dev work, a JSON service-account key is acceptable if stored outside git.
- For production, prefer Vercel OIDC / Google Workload Identity Federation so the deployment does not rely on a long-lived JSON key.
- The President's email is a human approver/admin identity, not the runtime identity used by the agent.

Do not use personal President Google Drive access as the agent runtime. This creates handover risk and over-broad personal access.

### 10.4 Google API operations needed

- Create a folder for each event pack.
- Upload/import generated working documents into Google Drive.
- Maintain non-technical working copies as native Google Docs/Sheets where practical.
- Preserve exportable `.docx` / `.xlsx` copies where LSESU submission or formatting fidelity needs them.
- Append/update tracker rows in Google Sheets.
- Store stable links back into Slack and the event tracker.
- Store Drive file IDs and folder IDs in the pack index for idempotent updates.
- Export `.docx`, `.xlsx`, or PDF copies when needed for SU/manual submission.

---

## 11. Template handling

### 11.1 Official templates downloaded

The following official/public LSESU files were found and downloaded for one-time tagging:

1. `Risk-Assessment-Template-LSESU.docx`
2. `NEW-Budget-Template-1.xlsx`
3. `LSESU-Sponsorship-Contract-Template-2025-26.doc`

The sponsorship contract was converted to `.docx` to allow tagged editing.

### 11.2 Tagged templates created

Tagged automation copies should live separately from official raw templates:

```text
templates/
  official_raw/
    Risk-Assessment-Template-LSESU.docx
    NEW-Budget-Template-1.xlsx
    LSESU-Sponsorship-Contract-Template-2025-26.doc
    LSESU-Sponsorship-Contract-Template-2025-26.docx
  tagged/
    Risk-Assessment-Template-LSESU-TAGGED.docx
    NEW-Budget-Template-1-TAGGED.xlsx
    LSESU-Sponsorship-Contract-Template-2025-26-TAGGED.docx
```

The tagged copies contain placeholders such as:

- `{{society_name}}`
- `{{event_name}}`
- `{{event_organiser_name}}`
- `{{event_dates_times}}`
- `{{event_location}}`
- `{{first_aid_plan}}`
- `{{#core_risks}} ... {{/core_risks}}`
- `{{#activity_risks}} ... {{/activity_risks}}`
- `{{sponsor_company_name}}`
- `{{sponsorship_amount_inclusive_vat}}`

### 11.3 Template filling caveat

Do not assume an arbitrary official Word file is directly fillable. The automation should fill only the tagged copies.

Document output policy:

- The automation engine should fill local `.docx` / `.xlsx` tagged templates using deterministic libraries.
- The committee-facing working copy should be a native Google Doc or Google Sheet where practical, because non-technical committee members can edit, comment, and review there.
- Keep an exportable `.docx` / `.xlsx` copy in the same Drive folder for LSESU/manual submission and formatting fallback.
- Risk assessments and sponsorship contracts should be generated from `.docx` templates, uploaded to Drive, and imported to native Google Docs for review where conversion quality is acceptable.
- Budgets should be generated from `.xlsx` templates with formulas and numeric cells preserved, uploaded/imported to native Google Sheets for committee editing, and kept exportable as `.xlsx`.
- Field packs and deadline plans should be generated as native Google Sheets, because they are row-oriented working artifacts. Internal review summaries should remain Google Docs. Accessibility checklist actions should be written to the `Compliance Tasks` tracker and, where useful, reflected in the internal review summary rather than created as a separate checklist document.
- Use the tagged templates generated from the current public LSESU files.
- If a template changes, do a manual re-tagging pass.
- Do not build a template version monitor.
- Generated packs should include `Rules/templates last manually verified on DATE`.

Budget numeric rule:

- Expense prices, expense quantities, ticket prices, ticket quantities, sponsorship amounts, society-account contributions, SUF requested amounts, and other income values must be written as real numeric cells, not strings.
- In Google Sheets writes, use value input semantics that preserve numbers/formulas rather than forcing text.
- In `.xlsx` generation, set numeric cell values as numbers and preserve formulas in total/profit/loss cells.
- Required eval: generated sample budget with non-zero inputs must calculate non-zero line totals, total expenditure, total income, and profit/loss.
- A test that only checks "formulas are present" is insufficient.

### 11.4 Podio forms

The Regular Event Form, Large/Speaker Event Form, and Sponsorship Submission Form are web forms, not downloadable fillable documents. The agent should generate copy-ready field packs matching the current visible form fields, then a human should manually submit the live form.

Do not automate Podio submission unless a future, separately approved workflow explicitly allows it. For the planned build, generate copy-ready field packs only and leave official form submission to humans.

---

## 12. Data handling and SU review

Create `docs/DATA_HANDLING_FOR_SU_REVIEW.md` and keep it updated.

Core data-handling principles:

- MVP is reactive only.
- No passive Slack monitoring.
- No Launchpad student idea ingestion in MVP.
- No attendee list ingestion in MVP unless explicitly approved later.
- No unnecessary storage of supplier bank details.
- Google Drive/Sheets is the source of truth.
- Vercel logs should not store full sensitive document bodies where avoidable.
- Generated packs are drafts for internal review, not final compliance approval.
- Humans submit all official forms and sign nothing through the agent.

Before final launch, ask LSESU:

1. Is a Vercel-hosted Slack agent acceptable for preparing draft event admin packs?
2. Is Google Drive/Docs/Sheets acceptable for storing draft event packs and trackers?
3. Are there restrictions on storing sponsor contacts, contracts, invoices, or supplier details in committee Google Drive?
4. What retention period should Velocity use for event, sponsor, and finance records?
5. Are there categories of data the agent should not process?
6. Should generated drafts include any specific LSESU-approved disclaimer?

---

## 13. How to use Eve correctly

### 13.1 Framework notes

Use Vercel Eve as a filesystem-first TypeScript agent framework.

Eve project structure should treat:

- `agent/agent.ts` as optional runtime/model configuration.
- `agent/instructions.md` as the concise, always-on system prompt for the runtime agent.
- `agent/tools/*.ts` as typed tool files.
- `agent/skills/*.md` as detailed operational rulebooks loaded contextually.
- `agent/channels/slack.ts` as Slack channel integration.
- `agent/schedules/` as unused in MVP; explicit reminders should be handled by the protected Vercel Cron API route, not a separate autonomous scheduler.

### 13.2 AGENTS.md vs agent/instructions.md vs /agents.md

Three different things, easy to conflate. Keep them separate:

- `AGENTS.md` (repo root): guidance for the **coding/IDE agent** that edits this repo — build/test commands, dev loop, where canonical rules live, security rules. It should not duplicate all LSESU rules. **The Eve scaffold/Slack template already ships an `AGENTS.md`** (it opens "Guidance for AI coding agents working in this repository"), so **extend that file rather than author a competing one.** Keep Eve's required dev-loop content — read `node_modules/eve/docs/` before coding; `pnpm typecheck`, `pnpm check`, and `npx eve info` must report 0 errors / 0 warnings; never commit secrets — and add Vichita-specific pointers. Not read by the runtime agent.
- `agent/instructions.md`: the **runtime system prompt** Eve puts in front of every model call — Vichita's always-on behaviour in Slack. This is the only always-on runtime prompt.
- `/agents.md` (lowercase, Eve framework): Eve's **API/MCP discovery surface**. A framework concept, not the repo coding guide and not the runtime prompt — you don't author or ship it. Named here only so it isn't confused with `AGENTS.md`.
- `agent/skills/lsesu-events.md`: canonical detailed LSESU event rules.
- `agent/skills/data-handling.md`: canonical data-handling rules.
- `docs/PROJECT_CONTEXT.md`: human/project context for future developers.

Avoid separate documents all restating the same rules. The detailed operational rules should live in skills and docs, with `AGENTS.md` and `instructions.md` pointing to them rather than restating them.

### 13.3 Eve Slack template

A public `vercel-labs/eve-slack-agent-template` repository and Vercel template page exist. It appears to be the intended Slack starter and includes an Eve Slack agent scaffold, Slack webhook handling, Vercel Connect, and starter tools.

Security stance:

- It appears legitimate/official from visible repository/template metadata.
- Still do a normal supply-chain review before cloning or deploying:
  - Inspect `package.json` scripts.
  - Inspect lockfile changes.
  - Run package audit tooling.
  - Avoid adding secrets to the repo.
  - Prefer the official Vercel template page or `npx eve@latest init` route.

### 13.4 Recommended scaffold path

Use one of these:

```bash
# Option A: official Eve scaffold
npx eve@latest init vichita
```

or:

```bash
# Option B: official Slack starter template
# Use the official Vercel template page or verified GitHub repo only.
```

Then add the Vercel Connect setup skill if using an agentic IDE that supports it:

```bash
npx skills add vercel/vercel-plugin --skill vercel-connect
```

---

## 14. Technical architecture

### 14.1 High-level flow

```text
Slack @mention / DM / modal
  -> Eve Slack channel
  -> agent/instructions.md
  -> classify intent
  -> load relevant skill markdown
  -> call typed tool(s)
  -> generate draft/checklist/pack
  -> ask for approval before any Google Drive/Sheets write
  -> create Google Drive folder/docs/sheets
  -> return links and status in Slack thread
```

### 14.2 MVP file structure

```text
vichita/
  AGENTS.md
  README.md
  package.json
  vercel.json
  app/
    api/
      cron/
        reminders/
          route.ts
  agent/
    agent.ts
    instructions.md
    channels/
      slack.ts
    connections/
      slack.ts
      google_workspace.ts
    tools/
      classify_event.ts
      collect_missing_event_fields.ts
      compute_deadlines.ts
      create_google_drive_pack_folder.ts
      copy_google_doc_template.ts
      fill_google_doc_placeholders.ts
      fill_google_sheet_budget.ts
      fill_risk_assessment.ts
      generate_lsesu_form_field_pack.ts
      generate_accessibility_checklist.ts
      generate_internal_review_summary.ts
      create_marketing_ops_calendar_row.ts
      update_events_tracker_sheet.ts
      create_reminder.ts
      list_reminders.ts
      complete_reminder.ts
      send_due_reminders.ts
      export_pack_index.ts
    skills/
      lsesu-events.md
      risk-assessment.md
      google-workspace-ops.md
      marketing-ops.md
      reminders.md
      data-handling.md
      sponsorship-admin.v2.md
      finance-admin.v2.md
  docs/
    PROJECT_CONTEXT.md
    DATA_HANDLING_FOR_SU_REVIEW.md
    GOOGLE_WORKSPACE_SETUP.md
    TEMPLATE_FIELD_MAP.md
    DEMO_SCRIPT.md
  templates/
    official_raw/
    tagged/
  tests/
    event-classifier.test.ts
    deadlines.test.ts
    missing-fields.test.ts
    approval-gates.test.ts
    google-workspace.test.ts
    data-handling.test.ts
    reminders.test.ts
    cron-auth.test.ts
  evals/
    event-classification.eval.ts
    risk-assessment-pack.eval.ts
    no-slop.eval.ts
    reactive-only.eval.ts
```

No independent `agent/schedules/` worker in MVP. If the scaffold creates it, leave it empty and unused. Scheduled execution should go through Vercel Cron calling a protected API route.

### 14.3 Core tools

| Tool | Purpose |
|---|---|
| `classify_event.ts` | Determine likely LSESU route and blockers. |
| `collect_missing_event_fields.ts` | Return missing fields with owner/deadline/document impact. |
| `compute_deadlines.ts` | Calculate indicative and official deadlines with precision labels. |
| `create_google_drive_pack_folder.ts` | Create event pack folder after approval. |
| `copy_google_doc_template.ts` | Copy tagged Google Doc/docx templates. |
| `fill_google_doc_placeholders.ts` | Replace placeholders in Google Docs or generated docs. |
| `fill_google_sheet_budget.ts` | Fill budget sheet from structured data. |
| `fill_risk_assessment.ts` | Generate risk rows and fill tagged risk template. |
| `generate_lsesu_form_field_pack.ts` | Create copy-ready Regular or Large/Speaker field pack. |
| `generate_accessibility_checklist.ts` | Create accessibility checklist. |
| `generate_internal_review_summary.ts` | Summarise pack readiness, blockers, and human review points. |
| `create_marketing_ops_calendar_row.ts` | Add campaign/task row with launch gates. |
| `update_events_tracker_sheet.ts` | Update Google Sheets event tracker after approval. |
| `create_reminder.ts` | Create an explicit one-off or recurring reminder after user confirmation. |
| `list_reminders.ts` | Show active reminders for an event, task, user, or channel. |
| `complete_reminder.ts` | Mark a reminder done, paused, cancelled, or snoozed from Slack. |
| `send_due_reminders.ts` | Internal cron processor for due active reminders. |

### 14.4 V2 tools

| Tool | Purpose |
|---|---|
| `check_sponsorship_compliance.ts` | Validate sponsor deal risks and LSESU constraints. |
| `generate_sponsorship_contract_pack.ts` | Fill tagged sponsorship contract + submission field pack. |
| `finance_invoice_readiness_check.ts` | Check invoice/payment evidence completeness. |
| `generate_automation_project_brief.ts` | Turn approved automation intake into project brief. |
| `create_github_issue.ts` | Website tasks only, if GitHub workflow is enabled. |

---

## 15. Google Sheets schemas

### 15.1 Events Tracker

Columns:

- Event ID
- Event Name
- Date
- Time
- Owner
- Channel Thread Link
- Classification
- Classification Reason
- Expected Attendance
- Budget Estimate
- External Speaker?
- External Organisation?
- Sponsor?
- Food?
- Alcohol?
- Trip/External Venue?
- Risk Assessment Status
- Budget Status
- Form Field Pack Status
- Missing Critical Fields
- Submission Readiness
- SU Submission Status
- SU Approval Status
- Room Confirmed?
- Promotion Gate
- Ticketing Status
- Pack Folder Link
- Last Updated

### 15.2 Event Packs Index

Columns:

- Pack ID
- Event ID
- Event Name
- Pack Folder Link
- Risk Assessment Link
- Budget Link
- Field Pack Link
- Accessibility Checklist Link
- Internal Review Summary Link
- Generated By
- Generated At
- Rules Last Verified
- Internal Approval Status
- Approved By
- Approved At

### 15.3 Compliance Tasks

Columns:

- Task ID
- Event ID
- Task
- Owner
- Role
- Due Date
- Deadline Type
- Source Rule
- Status
- Blocker?
- Notes

### 15.4 Marketing Ops Calendar

Columns:

- Campaign ID
- Event ID
- Event Name
- Event Date
- Approval Status
- Room Confirmation
- Ticketing Status
- Target Audience
- Channel
- Asset Owner
- Copy Owner
- Design Owner
- Sponsor Approval Needed
- Accessibility Note Included
- SU Promotion Request Status
- Poster/Stall/Flyer Status
- Launch Gate Status
- Planned Publish Date
- Dependency
- Notes

### 15.5 Reminders

Columns:

- Reminder ID
- Event ID
- Related Task ID
- Created By Slack User ID
- Target Slack User ID
- Target Slack Channel ID
- Reminder Text
- Recurrence Rule
- Timezone
- Next Run At UTC
- Last Sent At UTC
- Status
- Stop Condition
- Completion Source
- Created At
- Updated At
- Notes

Statuses:

- `active`
- `done`
- `paused`
- `cancelled`

The agent should generate stable reminder IDs and use them as idempotency keys. A cron retry or overlapping run must not send the same reminder twice for the same scheduled occurrence.

---

## 16. Approval policy

Before writing to Google Drive/Sheets, the agent should show a Slack action card:

```text
Event pack draft ready
Classification: Large/Speaker Event
Submission readiness: BLOCKED - missing academic chair status and first-aid plan
Files to create:
- Risk Assessment
- Budget
- Large/Speaker Event Field Pack
- Accessibility Checklist
- Deadline Plan

[Create draft pack in Google Drive]
[Ask for missing fields]
[Cancel]
```

Approval rules:

- Summary/classification can be generated without approval.
- Creating a Drive folder requires approval.
- Creating/filling Docs/Sheets requires approval.
- Updating tracker rows requires approval.
- Creating or changing a reminder requires requester confirmation because it writes to the `Reminders` tracker and can send future Slack messages.
- The President can approve every internal write/export action.
- Relevant role approvers can approve their own area:
  - Head of Operations: event pack/tracker updates.
  - Head of Events: event record and logistics updates.
  - Head of Marketing: marketing operations calendar updates.
  - Head of Outreach/Partnerships: sponsorship tracker/contract pack updates.
- Marking an event as internally approved requires President approval or the explicitly configured relevant role approval.
- Reminder targets should be able to mark their own reminders done, pause them, or ask who created them.
- Role checks must use configured Slack user IDs or Slack user group IDs, not display names.
- Store the approver Slack user ID, role, timestamp, action type, and affected file/sheet IDs in the audit note/tracker.
- Public promotion remains human-only.
- SU submission remains human-only.

---

## 17. Phased full build plan

### Phase 0 - Source and template setup

Status: partially complete.

Complete for current setup:

- Google Drive folder structure exists.
- `Vichita Trackers` exists as a native Google Sheet and has been live-verified through the service account.
- Spreadsheet and document templates have been converted to native Google Workspace files for runtime use.

Still required before real pack reliance:

- Verify current LSESU public pages manually.
- Store approved Source Registry rows after verification.
- Confirm current-year large/flagship deadline values before setting deadline env vars.
- Finish tagged template field maps/placeholders for generated packs.
- Confirm data-handling questions with SU before broad use.

### Phase 1 - Eve Slack foundation

Status: complete for the test channel.

- Scaffold Eve project using `npx eve@latest init` or verified Eve Slack starter.
- Configure Slack via Vercel Connect.
- Confirm @mention reply in `#agent-test` / `#vichita`.
- Add `agent/instructions.md` with reactive-only, no-slop, approval-gate, and disclaimer rules.
- Add `AGENTS.md` for IDE/coding instructions.

### Phase 2 - Google Workspace integration

Status: complete for the Phase 2 foundation and live-smoke-tested in Slack.

- Implemented Google Workspace connection using the Google service account approach.
- Implemented JSON service-account auth through `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64` for local/dev and early deployment.
- Keep Vercel OIDC / Google Workload Identity Federation as the preferred production hardening path later.
- Implemented read-only Drive root folder access checks.
- Implemented approval-gated event pack folder creation by canonical Event ID and stored Slack thread key when available.
- Implemented the one-spreadsheet tracker foundation, required tabs, required headers, approval-gated tab/header creation, and column expansion for manually created under-width tabs.
- Implemented Source Registry row upsert foundation.
- Implemented Event ID, pack ID, and idempotency helper utilities. Slack-originated events now derive a stable Event ID from channel/thread context and Drive folder creation dedupes by stored `vichitaThreadKey` when those Slack fields are supplied.
- Live-smoke-tested on 2026-06-21 from Slack: read-only setup check passed, tracker tab/header verification found no differences, approval-gated folder creation worked, and folder naming now uses `DD-MM-YYYY - Event Name` while keeping IDs in metadata.
- Template copy/fill and event-pack document generation moved into Phase 4 and are now implemented; future work in this area is polish, eval coverage, and live bug fixing.

### Phase 3 - Event intake and classification

Status: partially complete.

- Slack modal for new event intake.
- Classifier tool.
- Exactly-75 boundary tests.
- Missing-info engine.
- Deadlines tool.
- Status output with disclaimer.

### Phase 4 - Event pack generation

Status: implemented and live-tested in Slack, with follow-up polish pending.

Complete:

- Fill tagged native Google Docs risk assessment template, including structured risk table rows and scalar header updates.
- Fill budget Google Sheet where required/useful, preserving numeric budget values.
- Generate Regular/Large/Speaker LSESU form-field pack as a native Google Sheet.
- Generate deadline plan as a native Google Sheet.
- Write accessibility checklist actions and deadline actions into the `Compliance Tasks` tracker with stable task IDs.
- Generate internal review summary as a Google Doc.
- Save/reuse files in Drive after Eve approval, deduped by Event ID, pack ID, document type, and Slack thread metadata where available.
- Link generated pack files in Slack and tracker rows.
- Patch existing same-version packs in place with `update_event_pack_fields` for changed event details.
- Keep pre-approval Slack output short to avoid repeated approval-card generation before Eve checkpointing.

Post-deploy smoke checks:

- Submit a Slack modal answer on the real production URL and confirm Slack does not show "failed, try again" and the answer still reaches Eve.
- Click a Google-write approval card and confirm approval-gated writes still use Eve's default block-action handling.
- Test representative classifier prompts: reported single-venue hackathon => large event, explicit away/overnight travel => trips process, external universities attending => not a trip.

### Phase 5 - Marketing operations row

Status: not started.

- Create a marketing ops calendar row after event pack creation.
- Include launch gates and dependencies.
- Do not generate captions/images.

### Phase 6 - Vercel Cron reminders

Status: planned, not started.

- Add `vercel.json` with a cron entry for `/api/cron/reminders`.
- Protect the cron route with `CRON_SECRET`.
- Implement the `Reminders` tracker.
- Implement reminder create/list/complete tools.
- Implement `send_due_reminders.ts` as the only scheduled processor.
- Use Slack buttons for `Done`, `Pause`, `Cancel`, and `Snooze` where the Slack scaffold supports it.
- Store schedule calculations in UTC, with `Europe/London` as the default user-facing timezone.
- Add duplicate-send protection using `Reminder ID`, scheduled occurrence time, `Last Sent At UTC`, and a short processing lock if the selected storage layer supports it.
- Keep the route scoped to stored reminder rows only; no passive Slack scanning.

### Phase 7 - Tests, evals, demo

Status: helper tests, route-classifier regression coverage, Phase 2 live Google smoke, and Phase 4 live event-pack smoke complete; formal evals remain optional/future work.

- Typecheck.
- Unit tests.
- Evals.
- Demo data.
- Demo script.
- README setup instructions.
- Reminder tests: auth rejection without `CRON_SECRET`, due reminders send once, done/paused/cancelled reminders do not send, and weekly recurrence advances correctly in `Europe/London`.

### Phase 8 - V2 modules

Status: planned, not started.

- Sponsorship contract/admin pack.
- Sponsorship tracker and sponsor benefits tracker.
- Finance/invoice readiness checker.
- Automation Intake to project brief conversion.
- Website/GitHub issue generation where the website workflow is enabled.
- Launchpad anonymised trend summaries only with explicit consent and separate data rules.

---

## 18. Full roadmap after core event workflow

Build the full project in phases. The event-pack workflow remains the first acceptance gate because sponsorship, finance, website, and automation workflows depend on the same approval, document, source-registry, and Google Workspace foundations.

Features after the core event workflow works:

1. Sponsorship contract/admin pack.
2. Sponsorship tracker.
3. Finance/invoice readiness checker.
4. Automation Intake project brief conversion.
5. Website/GitHub issue generation.
6. Launchpad anonymised trend summaries with explicit consent and data rules.
7. Vercel Cron reminder engine for explicit committee task nudges, weekly follow-ups, and tracker-driven deadlines.

Removed completely:

- Template version monitor.
- Proactive watching.
- Passive Slack monitoring.
- Generic post/email/image generation.

---

## 19. Data contracts for tools

### 19.1 Event intake object

```ts
export const EventIntakeSchema = z.object({
  eventName: z.string(),
  eventDescription: z.string(),
  proposedDate: z.string().optional(),
  setupStartTime: z.string().optional(),
  eventStartTime: z.string().optional(),
  eventEndTime: z.string().optional(),
  expectedAttendance: z.number().int().nonnegative().optional(),
  preferredLocation: z.string().optional(),
  externalSpeakers: z.array(z.object({
    name: z.string().optional(),
    role: z.string().optional(),
    organisation: z.string().optional(),
    topic: z.string().optional(),
  })).default([]),
  externalOrganisationInvolved: z.boolean().optional(),
  externalOrganisationName: z.string().optional(),
  sponsorInvolved: z.boolean().optional(),
  sponsorName: z.string().optional(),
  estimatedCost: z.number().nonnegative().optional(),
  societyBalanceEstimate: z.number().nonnegative().optional(),
  foodOrRefreshments: z.boolean().optional(),
  alcohol: z.boolean().optional(),
  publicOrNonLseAttendees: z.boolean().optional(),
  under18sOrVulnerableAdults: z.boolean().optional(),
  filmScreening: z.boolean().optional(),
  tripBeyondM25: z.boolean().optional(),
  overnightTrip: z.boolean().optional(),
  externalVenue: z.boolean().optional(),
  organiserName: z.string().optional(),
  organiserRole: z.string().optional(),
  organiserLseEmail: z.string().email().optional(),
});
```

### 19.2 Event identity and idempotency

Assign a canonical Event ID when an event record is first created or when a draft pack is first generated.

Format:

```text
EVT-YYYYMMDD-event-slug-shortid
```

Examples:

```text
EVT-20260316-lse-build-a7f3
EVT-20261104-ai-startup-sprint-c91d
```

Rules:

- `YYYYMMDD` should use the proposed event date if known; otherwise use the creation date and mark the event date as missing.
- `event-slug` should be a lowercase ASCII slug derived from the event name.
- `shortid` should be stable for the event. If Slack channel/thread context is available, derive it deterministically from that context plus the event date/name; otherwise generate it once and reuse the resulting Event ID.
- Use human-readable event pack folder names, for example `05-10-2026 - Notion workshop`.
- Store the Event ID in:
  - Drive file/folder app properties.
  - Events Tracker row.
  - Event Packs Index row.
  - Compliance Tasks rows.
  - Marketing Ops Calendar row.
  - Slack thread metadata/reference where available.
  - Drive file/folder app properties or a metadata sheet where available.
- Re-running "create pack" for the same Slack thread/Event ID should update the same event record and regenerate or version files deliberately.
- If a human requests a new version, use `v2`, `v3`, etc. in file names and keep the same Event ID.
- Never create silent duplicate tracker rows for the same Event ID.

Suggested event record shape:

```ts
export const EventRecordIdentitySchema = z.object({
  eventId: z.string(),
  eventSlug: z.string(),
  version: z.number().int().positive().default(1),
  sourceSlackChannelId: z.string().optional(),
  sourceSlackThreadTs: z.string().optional(),
  packFolderId: z.string().optional(),
  packFolderUrl: z.string().url().optional(),
});
```

### 19.3 Classification output

```ts
export const EventClassificationSchema = z.object({
  route: z.enum([
    'regular_event_candidate',
    'large_event',
    'speaker_event',
    'large_speaker_event',
    'trip_process',
    'needs_human_review',
  ]),
  triggers: z.array(z.string()),
  nonTriggers: z.array(z.string()),
  missingCriticalFields: z.array(z.string()),
  blocksFinalSubmissionReadiness: z.array(z.string()),
  canGenerateDraftPack: z.boolean(),
  confidence: z.enum(['low', 'medium', 'high']),
  disclaimer: z.string(),
  rulesLastVerifiedDate: z.string(),
});
```

### 19.4 Reminder object

```ts
export const ReminderSchema = z.object({
  reminderId: z.string(),
  eventId: z.string().optional(),
  relatedTaskId: z.string().optional(),
  createdBySlackUserId: z.string(),
  targetSlackUserId: z.string().optional(),
  targetSlackChannelId: z.string().optional(),
  reminderText: z.string(),
  recurrenceRule: z.string(), // e.g. "weekly on Monday" or an RRULE-style string.
  timezone: z.string().default('Europe/London'),
  nextRunAtUtc: z.string(),
  lastSentAtUtc: z.string().optional(),
  status: z.enum(['active', 'done', 'paused', 'cancelled']),
  stopCondition: z.string().optional(),
  completionSource: z.string().optional(),
  createdAtUtc: z.string(),
  updatedAtUtc: z.string(),
});
```

---

## 20. Required tests and evals

### 20.1 Classification tests

- 74 attendees, no other triggers -> regular candidate.
- 75 attendees, no other triggers -> regular candidate.
- 76 attendees, no other triggers -> large event.
- External speaker at any attendance -> speaker/large-speaker route.
- Budget £501 -> large event.
- Budget £500 exactly -> does not trigger `over £500` on budget alone.
- External organisation involved -> large event.
- Alcohol-centred event -> large event.
- Trip beyond M25 -> trip process.

### 20.2 Missing-info tests

- Missing first-aid plan blocks final submission readiness but not draft generation.
- Missing exact location blocks final readiness but not draft generation.
- Missing academic chair blocks final readiness only when academic chair likely required.
- Missing expected attendance should be listed as a critical field.

### 20.3 Reactive-only tests

- Agent does not reply to unmentioned channel messages.
- Agent does not scan channels on schedule.
- Agent does not generate proactive warnings.
- No `agent/schedules` logic active in MVP.
- Vercel Cron route only processes explicit rows in the `Reminders` tracker.

### 20.4 No-slop tests

- Request for captions returns: “I can create/update the marketing operations calendar and launch gates, but I do not generate generic social copy as a core workflow.”
- Request for poster/image returns a refusal/redirection to asset-task tracking.
- Request for sponsor outreach email returns a refusal/redirection to sponsor admin/compliance pack.

### 20.5 Google Workspace tests

- Create pack folder is approval-gated.
- Re-running create pack is idempotent.
- Budget formulas remain intact.
- Risk assessment placeholders are fully replaced in a generated sample.
- Tracker rows contain links and status, not excessive sensitive data.

### 20.6 Data-handling tests

- Supplier bank details are not written to logs/tracker rows.
- Launchpad student idea fields are rejected in MVP unless feature flag enabled.
- Attendee lists are rejected in MVP unless explicitly approved later.
- Every generated document includes draft/disclaimer text.

### 20.7 Cron reminder tests

- `/api/cron/reminders` rejects requests without `Authorization: Bearer ${CRON_SECRET}`.
- The cron route reads only the `Reminders` tracker, not Slack channel history.
- A due active reminder sends exactly once for a scheduled occurrence.
- `done`, `paused`, and `cancelled` reminders are skipped.
- Weekly recurrence advances correctly using `Europe/London`, including daylight saving changes.
- A reminder to another committee member shows creator identity and allows done/pause/cancel actions.

---

## 21. Demo video storyline

Title: **Running a student society with an AI operations agent**

Scene 1: Show Slack channels and explain the problem.  
Velocity is managing events, sponsor admin, marketing operations, website work, and automation projects.

Scene 2: In `#agent-test`, type:

```text
@Vichita new event: AI Startup Sprint, 120 attendees, two external speakers, catering, possible sponsor, estimated budget £650.
```

Scene 3: Agent classifies it:

```text
Likely Large/Speaker Event.
Triggers: >75 attendees, external speakers, budget >£500, sponsor/external organisation involvement.
Draft aid only. LSESU current guidance is authoritative. Last verified: 2026-06-19.
```

Scene 4: Agent asks missing fields:

```text
Missing critical:
- First-aid plan
- Exact location
- Speaker full names/job titles/topics
- Academic chair status
- Sponsor involvement details
```

Scene 5: Committee fills Slack modal.

Scene 6: Agent asks approval to create draft pack in Google Drive.

Scene 7: Agent creates:

- Risk Assessment.
- Budget Sheet.
- Large/Speaker Event Field Pack.
- Accessibility Checklist.
- Deadline Plan.
- Internal Review Summary.

Scene 8: Agent creates a marketing ops row with launch gates, not captions.

Scene 9: Show Google Drive folder and Google Sheets tracker.

Scene 10: Close with:

```text
Vichita does not replace the SU process. It makes the committee more reliable before the SU process.
```

---

## 22. Source links to verify during Phase 0

- Vercel Eve docs / GitHub: https://github.com/vercel/eve
- Eve Slack agent starter: https://vercel.com/templates/ai/eve-slack-agent
- Eve Slack agent template repo: https://github.com/vercel-labs/eve-slack-agent-template
- Vercel Connect docs: https://vercel.com/docs/vercel-connect
- Vercel Cron Jobs docs: https://vercel.com/docs/cron-jobs
- Vercel OIDC with Google Cloud: https://vercel.com/docs/oidc/gcp
- Google Drive API `files.copy`: https://developers.google.com/drive/api/reference/rest/v3/files/copy
- Google Docs API batch update / replace text: https://developers.google.com/docs/api/reference/rest/v1/documents/request#ReplaceAllTextRequest
- Google Sheets API values append/update: https://developers.google.com/sheets/api/reference/rest/v4/spreadsheets.values
- Google Workspace API enablement: https://developers.google.com/workspace/guides/enable-apis
- Google Cloud service account creation: https://cloud.google.com/iam/docs/service-accounts-create
- Google Cloud service account keys: https://cloud.google.com/iam/docs/keys-create-delete
- LSESU Events guidance: https://www.lsesu.com/communities/hub/activities/events/
- LSESU Regular Event Form: https://podio.com/webforms/29032944/2359222
- LSESU Large/Speaker Event Form: https://podio.com/webforms/28810709/2326853
- LSESU Speaker Events guidance: https://www.lsesu.com/communities/hub/activities/events/speakerevents/
- LSESU Sponsorship guidance: https://www.lsesu.com/communities/hub/finances/sponsorship/
- LSESU Sponsorship Submission Form: https://podio.com/webforms/27714302/2157769
- LSESU Promotion guidance: https://www.lsesu.com/communities/hub/basics/promo/
- LSESU Accessibility guidance: https://www.lsesu.com/communities/hub/activities/events/accessibility/
- LSESU Pay/Reimbursement guidance: https://www.lsesu.com/communities/hub/finances/pay/
- LSESU Trips guidance: https://www.lsesu.com/communities/hub/activities/trips/

---

## 23. Final instruction to IDE agent

Build the full Vichita project in phases. Implement the reactive event-pack workflow first as the first acceptance gate, but structure the repository so v2 sponsorship, finance, automation-intake, and website workflows can be added without rework.

Current build gate status:

Done:

1. Slack @mention works in the private `#vichita` test channel.
2. Event classifier exists and has been manually smoke-tested through Slack.
3. Missing-info engine exists.
4. Deadlines tool exists.
5. Runtime output includes draft/disclaimer language.
6. No proactive watching or template monitor exists.
7. Data-handling document is present for SU review.
8. GitHub/Vercel/Slack/AI Gateway foundation is working.
9. Google Workspace Phase 2 foundation is live-smoke-tested: service-account auth, Drive root check, tracker schema/tab helpers, stable Slack-thread Event ID/idempotency helpers, approval-gated event pack folder creation, clean human-readable folder names, and RAW Source Registry upsert foundation.
10. Phase 4 event-pack generation is implemented and live-tested: approval-gated generation creates the risk assessment Doc, budget Sheet, form-field Sheet, deadline plan Sheet, internal review Doc, tracker rows, and Compliance Tasks rows.
11. Same-version pack updates patch existing generated files instead of creating new packs when the user asks for corrections.
12. Pre-approval Slack output is short enough for Eve to checkpoint approval cards reliably in production testing.

Still required for the first full event-pack acceptance gate:

1. Production smoke for Slack modal answer submission on the real production URL.
2. Production smoke for representative route-classification prompts and approval cards after deployment.
3. Source Registry rows and current source verification for production pack reliance.
4. Optional formal route-classification eval harness beyond the helper regression tests.
5. Marketing ops calendar row with launch gates.
