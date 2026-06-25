# Vichita

Vichita is an AI operations agent for student society committees. It runs as a reactive Slack agent that helps with event admin: SU route classification, internal readiness and compliance checks, Google Workspace document packs (risk assessment, budget, LSESU form-field pack, deadline plan, internal review), committee reminders, and later sponsorship and finance workflows.

It was built for LSESU Velocity, but it is structured so any society can adapt it: bring your own rules, templates, Google Workspace, Slack workspace, and data-handling policy.

*Built on the [Eve](https://vercel.com/eve) agent framework and deployed on Vercel.

## What it does

- Classifies an event's SU route and flags missing intake fields, from a Slack @mention.
- Generates an approval-gated Google Workspace pack (risk assessment Doc, budget Sheet, LSESU form-field pack, deadline plan, internal review summary) plus tracker and compliance-task rows.
- Patches existing packs in place for corrections (new date, venue, attendance, organiser) without minting a new event.
- Sends committee reminders only when a member explicitly asks.

Reactive by design: it acts only on an @mention, DM, or approved Slack modal/button. It does not passively monitor channels, submit SU forms, or give final compliance approval.

## Status

This repository has a working deployed Eve Slack agent and the planning documents for the full build.

Completed:

- Repository setup, open-source policy, Apache-2.0 license, and secret/template gitignore rules.
- Eve agent scaffold with runtime instructions, skills, and initial event-admin tools.
- Vercel deployment at `https://vichita.vercel.app`, connected to GitHub.
- Vercel Connect Slack integration. The bot responds to @mentions in the private `#vichita` test channel.
- Slack trigger route fixed to match Vercel Connect's default path: `POST /triggers/slack`.
- Vercel AI Gateway model routing configured through `EVE_MODEL`, with same-provider fallback protection.
- Initial Slack-tested event classification flow with draft-only disclaimer.
- Phase 2 Google Workspace foundation is live-tested: env/config validation, Google service-account auth via `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64`, Drive root access check, one-spreadsheet tracker schema setup with under-width tab expansion, stable Slack-thread Event ID/idempotency helpers, approval-gated Drive folder creation, tracker verification, and RAW Source Registry upsert foundation.
- Phase 4 event-pack generation is implemented and live-tested: approval-gated pack generation creates/updates the risk assessment Google Doc, budget Google Sheet, LSESU form-field Google Sheet, deadline plan Google Sheet, internal review summary Google Doc, and tracker/compliance-task rows.
- Budget Google Sheets compute line and category totals and reconcile expense lines against the stated event cost.
- Same-version event-pack patching is implemented for corrections to existing packs, with lookup by visible event name, Event ID, folder link, or Slack thread context.
- The pre-approval Slack step was shortened so Eve can checkpoint approval cards reliably before Vercel's 300-second Hobby runtime cap.
- Slack modal submissions are handled through an in-process Eve Slack route wrapper that returns Slack's expected empty `200` for `view_submission` while preserving Eve's answer recording.
- Route classification now uses the model's structured trip flags, with one deterministic correction for on-site multi-day/overnight events. Multi-day hackathons at one normal venue and external universities attending do not imply trips.

In progress / next:

- Production smoke after deploy for Slack modal submission UX, approval cards, and representative route-classification prompts.
- Source Registry rows and current-year source verification before real pack reliance.
- Formal classifier eval harness if the helper regression tests need to become a standalone eval suite.
- Reminder tracker plus protected Vercel Cron route.

Not started:

- Sponsorship/finance v2 modules.
- Website/GitHub issue workflow.
- Automation Intake / Launchpad-adjacent workflows.

The canonical implementation plan lives in:

- `Files/vichita_agent_brief_v2_google_workspace.md`
- `Files/docs/MANUAL_SETUP_CHECKLIST.md`
- `Files/docs/DATA_HANDLING_FOR_SU_REVIEW.md`

Runtime agent files live in:

- `agent/agent.ts`
- `agent/instructions.md`
- `agent/channels/slack.ts`
- `agent/tools/`
- `agent/skills/`

## Development

Install dependencies:

```bash
corepack pnpm install
```

Copy the environment template and fill values locally:

```bash
cp .env.example .env.local
```

Run local development:

```bash
corepack pnpm dev
```

Useful checks:

```bash
corepack pnpm typecheck
corepack pnpm test:helpers
corepack pnpm build
```

For Slack, use Vercel Connect and set `SLACK_CONNECTOR`. This project mounts the Slack
channel at Vercel Connect's default trigger path, `/triggers/slack`.

## Core Idea

Vichita is deliberately narrow. Beyond the workflows above, and sponsorship, finance, website, and automation support in later phases, it should not:

- Passively monitor Slack channels.
- Submit SU forms automatically.
- Give final compliance approval.
- Generate generic marketing posts, emails, or images as a core workflow.
- Store secrets or private society data in the repository.

## Open Source Intent

The goal is for other student societies to be able to adapt Vichita for their own workflows.

This project is licensed under Apache-2.0. This keeps the project permissive and easy to reuse while providing a clearer patent grant, contribution handling, attribution structure, and trademark boundary.

## Template Policy

Do not commit downloaded official LSESU templates or private tagged copies derived from those templates unless LSESU has explicitly allowed redistribution.

Keep these local/private:

- `Files/templates/official_raw/`
- `Files/templates/tagged/`
- `Files/templates/private/`
- Generated event packs, sponsor packs, finance packs, exports, and local test outputs.

The public repository may include:

- Code that fills templates.
- Documentation explaining where templates are expected.
- Field maps that describe placeholders.
- Sanitized example templates created for demo/testing.
- Instructions for other societies to download their own current official templates.

Other societies should bring their own templates and rules. Vichita should not imply that LSESU-specific templates, deadlines, or approval rules apply elsewhere.

## Data And Safety

Never commit:

- `.env` files.
- Google service account JSON keys.
- Slack tokens.
- Vercel tokens.
- Model provider keys.
- Committee private data.
- Sponsor contracts, invoices, bank/payment details, or generated admin packs.

The planned production setup uses:

- A society-owned Google Drive folder as the source of truth.
- A Google Cloud service account shared only into that folder.
- Vercel environment variables for secrets.
- Vercel OIDC / Google Workload Identity Federation later, replacing long-lived JSON keys.

## Disclaimer

Vichita is a draft aid for internal society administration. It does not replace the Students' Union process, official guidance, live forms, or human committee review.

For LSESU Velocity, generated outputs should include language like:

```text
Draft aid only. LSESU's current published guidance and the live form/template are authoritative. This was generated for internal Velocity review and must be checked before submission.
```

## License

Apache-2.0. See `LICENSE` and `NOTICE`.
