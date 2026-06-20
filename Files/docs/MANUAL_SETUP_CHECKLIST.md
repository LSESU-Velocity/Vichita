# Vichita Manual Setup Checklist

Last updated: 2026-06-20

Use this checklist for the full Vichita build, including MVP and later v2 modules.

## 1. Ownership decisions

- Use the society Gmail / society Google account as the owner of the `Vichita` Google Drive folder, templates, and trackers.
- Do not use the President's personal Google Drive as the agent runtime identity.
- The President remains a human approver/admin and can approve every internal write/export action.
- Create a private Slack test channel such as `#vichita` or `#agent-test`.
- Collect Slack user IDs or Slack user group IDs for:
  - President.
  - Head of Operations/General Secretary.
  - Head of Engagement.
  - Head of Marketing.
  - Head of Outreach/Partnerships.

## 2. Google Cloud setup

Manual steps:

1. Sign in with the society Google account, or with the Google account that will own the society project.
2. Create a Google Cloud project named something like `your-society-vichita-agent`.
3. Enable these APIs:
  - Google Drive API.
  - Google Docs API.
  - Google Sheets API.
  - IAM API.
  - Service Account Credentials API, for later OIDC/impersonation.
  - Security Token Service API, for later Vercel OIDC / Workload Identity Federation.
4. Create a service account:
  - Name: `vichita-agent`.
  - Description: `Runtime identity for Vichita Slack operations agent`.
5. Copy the service account email, for example `vichita-agent@YOUR_PROJECT_ID.iam.gserviceaccount.com`.
6. For local/dev only, create a JSON service-account key and download it once.
7. Store the JSON key outside the repo.
8. Never commit the JSON key.
9. For production, plan to replace the JSON key with Vercel OIDC / Google Workload Identity Federation.

Important: Drive/Docs/Sheets do not need a simple browser-style "API key" for this project. The service account credential is the server-side credential.

## 3. Google Drive setup

Manual steps:

1. In the society Google Drive, create a restricted root folder named `Vichita`.
2. Share the `Vichita` folder with the service account email as Editor.
3. Share the folder only with current committee members and any SU staff if requested.
4. Create this folder structure:

```text
Vichita/
  Templates/
    Official Raw/
    Tagged Automation Copies/
  Event Packs/
  Sponsorship Packs/
  Finance Checks/
  Marketing Ops/
  Archive/
```

1. Upload official raw templates into `Templates/Official Raw/`.
2. Upload tagged templates into `Templates/Tagged Automation Copies/`.
3. Copy the root `Vichita` folder ID from the Drive URL.
4. Copy file IDs for each template after upload.

Needed IDs:

- `GOOGLE_DRIVE_ROOT_FOLDER_ID`
- `GOOGLE_TEMPLATE_RISK_ASSESSMENT_FILE_ID`
- `GOOGLE_TEMPLATE_BUDGET_FILE_ID`
- `GOOGLE_TEMPLATE_SPONSORSHIP_CONTRACT_FILE_ID`

## 4. Google Sheets trackers

Create one Google spreadsheet named `Vichita Trackers`, either manually now or with the agent after service-account access is working.

Inside that spreadsheet, create these tabs:

- `Events Tracker`
- `Event Packs Index`
- `Compliance Tasks`
- `Marketing Ops Calendar`
- `Sponsorship Tracker`
- `Sponsorship Contracts`
- `Finance/Reimbursements`
- `Reminders`
- `Template Inventory`
- `Source Registry`

If created manually, copy the spreadsheet ID from the URL into environment variables or config.

Recommended env/config names:

- `GOOGLE_TRACKERS_SPREADSHEET_ID`

Keep template file IDs separate. They point to individual Drive files, not tracker tabs.

## 5. Vercel setup

Manual steps:

1. Create or choose a Vercel team/account for the project.
2. Create a Vercel project for Vichita after the Eve repo is scaffolded.
3. Connect the GitHub repository to Vercel.
4. Add environment variables in Vercel:
  - Google service account credential for dev/early deployment, preferably base64 encoded.
  - Google folder/template/tracker IDs.
  - Slack/Vercel Connect values once configured.
  - `AI_GATEWAY_API_KEY`, if using a Vercel AI Gateway API key instead of OIDC-only auth.
  - `EVE_MODEL`, for example `openai/gpt-5.4-mini`.
  - `CRON_SECRET` for protected Vercel Cron routes.
  - `RULES_SOURCE_SET_ID`.
  - `RULES_LAST_VERIFIED_DATE`.
5. Mark sensitive variables as sensitive/secret where Vercel supports it.
6. For production, configure Vercel OIDC with Google Cloud Workload Identity Federation and remove the long-lived JSON key.
7. Save the Vercel deployment URL for Slack slash commands/interactivity if needed by the selected Slack setup.
8. Generate a random `CRON_SECRET` of at least 16 characters and set it in Vercel.
9. Add a single reminder cron route in `vercel.json`, initially pointing to `/api/cron/reminders` on a daily schedule.
10. Remember that Vercel Cron Jobs run on production deployments, not preview deployments; local/dev testing should invoke the route manually with the bearer token.
11. If the society needs reminders more than once per day or precise minute-level timing, use a Vercel plan that supports that interval before changing the cron expression.

Suggested early env names:

- `EVE_MODEL`
- `AI_GATEWAY_API_KEY`
- `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64`
- `GOOGLE_DRIVE_ROOT_FOLDER_ID`
- `RULES_SOURCE_SET_ID`
- `RULES_LAST_VERIFIED_DATE`
- `CRON_SECRET`
- `DEFAULT_TIMEZONE`
- `APP_BASE_URL`
- `VICHITA_ENV`

## 6. Slack setup

Manual steps:

1. Confirm you have Slack admin/install permission, or identify who can approve the app.
2. Create a private `#vichita` or `#agent-test` channel.
3. Install/configure the Slack integration through the Eve Slack starter / Vercel Connect path selected during build.
4. Invite the bot to test channels first.
5. Collect:
  - Slack workspace/team ID.
  - Test channel ID.
  - Events channel ID.
  - Marketing channel ID.
  - Sponsors/partners channel ID.
  - Approver Slack user IDs or user group IDs.
6. Confirm whether the bot should respond in DMs, mentions, modals/buttons, or all three.

Important: Eve's Slack route is `/eve/v1/slack`. Vercel Connect may default to `/triggers/slack`;
either set the connector trigger path to `/eve/v1/slack`, or keep the repository's `vercel.json`
rewrite from `/triggers/slack` to `/eve/v1/slack`.

## 7. Model/provider setup

Manual steps:

1. Use Vercel AI Gateway for the default path.
2. Add `AI_GATEWAY_API_KEY` in Vercel environment variables if the project is using an AI Gateway API key. Mark it sensitive.
3. Set `EVE_MODEL` to a model slug supported by AI Gateway.
   - Recommended starting value: `openai/gpt-5.4-mini`.
   - Lower-cost experiment option: `alibaba/qwen3.5-flash`.
   - Keep stronger models available later for long or sensitive document review.
4. If using direct provider credentials instead of AI Gateway, create the required provider API key and store it only in env/secrets.
5. Decide the default model for:
  - Classification and deterministic summaries.
  - Document drafting.
  - Long-context sponsorship/finance review.
6. Set conservative usage limits if available.

## 8. Source verification setup

Manual steps:

1. Re-check current LSESU pages before real use.
2. Create/update the `Source Registry` tracker.
3. Record:
  - URL.
  - Date checked.
  - Person who checked it.
  - What rules were encoded.
  - Whether the source is academic-year-specific.
4. Use the source set ID format:

```text
lsesu-events-YYYY-MM-DD
```

1. Before each academic year, repeat verification for:
  - Event route rules.
  - Speaker event rules.
  - Trip deadlines.
  - Promotion/payment rules.
  - Sponsorship process.
  - Pay/reimbursement process.
  - Accessibility guidance.
  - Official templates and form fields.

## 9. LSESU / governance setup

Manual steps:

1. Keep the SU email response when it arrives.
2. If SU gives wording preferences, update the standard disclaimer.
3. Decide who can see generated folders.
4. Decide retention periods once SU answers.
5. Decide whether v2 sponsorship/finance workflows can process sponsor contacts, invoice metadata, and contracts.

## 10. Build-time config files to create

These should be created in the repo during implementation, with no secrets committed:

- `agent/skills/lsesu-events.md`
- `agent/skills/risk-assessment.md`
- `agent/skills/google-workspace-ops.md`
- `agent/skills/reminders.md`
- `agent/skills/data-handling.md`
- `agent/skills/sponsorship-admin.v2.md`
- `agent/skills/finance-admin.v2.md`
- `config/approvers.example.json`
- `config/google-workspace.example.json`
- `docs/SOURCE_REGISTRY.md`
- `.env.example`

Do not commit:

- `.env`
- Service account JSON.
- Slack tokens.
- Model provider keys.
- Vercel tokens.
