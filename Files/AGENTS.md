# AGENTS.md - Coding Agent Instructions for Vichita

This file is for the IDE/coding agent that builds the repository. It is not the runtime prompt for the Slack agent.

## Read first

1. `vichita_agent_brief_v2_google_workspace.md`
2. `docs/DATA_HANDLING_FOR_SU_REVIEW.md`
3. `docs/LSESU_Form_Field_Pack_Template.md`
4. `templates/tagged/` field placeholders
5. Official Eve docs bundled in `node_modules/eve/docs` or `node_modules/eve/dist/docs/public` after install.

## Product rule

Build **Vichita** as a reactive Slack operations/compliance agent. Do not build generic marketing/email/image generation.

## Canonical operational rules

The canonical runtime rules should live in:

- `agent/instructions.md` for concise always-on behaviour.
- `agent/skills/lsesu-events.md` for detailed LSESU event rules.
- `agent/skills/risk-assessment.md` for risk row generation rules.
- `agent/skills/google-workspace-ops.md` for Google Drive/Docs/Sheets behaviour.
- `agent/skills/data-handling.md` for privacy/data handling.

Do not duplicate long rule blocks in multiple places. Link to the canonical source.

## MVP boundaries

- Reactive only.
- No proactive watching.
- No scheduled scans.
- No template version monitor.
- No Notion.
- Google Drive/Docs/Sheets are the source of truth.
- Humans submit LSESU forms manually.
- All Google Drive/Sheets writes require approval.

## Build order

1. Scaffold Eve Slack agent.
2. Configure Slack through Vercel Connect.
3. Add Google Workspace connection.
4. Add event intake modal and classifier.
5. Add missing-info and deadline tools.
6. Add risk assessment and budget template generation.
7. Add field pack generation.
8. Add Google Sheets trackers.
9. Add evals/tests.
10. Demo polish.

## Testing required

Before reporting done, run:

- Typecheck.
- Unit tests.
- Event classifier tests including exactly 75 attendees.
- Approval-gate tests.
- No-slop tests.
- Reactive-only tests.
- Google Workspace idempotency tests.

## Never commit secrets

Do not put Slack, Google, Vercel, or service-account secrets in the repository.
