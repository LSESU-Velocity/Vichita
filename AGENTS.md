# AGENTS.md - Coding Agent Instructions for Vichita

This repository uses the Eve framework. Before editing runtime agent code after dependencies are installed, read the relevant guide in `node_modules/eve/docs/` or `node_modules/eve/dist/docs/public/`, depending on the installed Eve package layout.

## Read First

1. `Files/vichita_agent_brief_v2_google_workspace.md`
2. `Files/docs/DATA_HANDLING_FOR_SU_REVIEW.md`
3. `Files/docs/MANUAL_SETUP_CHECKLIST.md`
4. `agent/instructions.md`

## Product Rule

Build Vichita as a reactive Slack operations/compliance agent for student societies. Do not build generic marketing, email, or image generation as core workflows.

## Runtime Structure

- `agent/agent.ts`: model/runtime configuration.
- `agent/instructions.md`: always-on runtime instructions.
- `agent/channels/slack.ts`: Slack channel through Vercel Connect.
- `agent/tools/*.ts`: deterministic tools the model can call.
- `agent/skills/*.md`: deeper operational procedures loaded contextually.

## Safety Rules

- Never commit secrets, service account JSON, Slack tokens, Vercel tokens, or model provider keys.
- Never commit official raw templates, private tagged templates, generated packs, or private society data.
- Google Drive/Docs/Sheets writes must be approval-gated.
- The agent must not passively monitor Slack.
- Humans submit SU forms manually.

## Runtime Notes

- Eve 0.11.7 exposes approval gates through `needsApproval` (`always`, `once`, `never`, or a predicate with `approvedTools`, `toolInput`, and `toolName`). It does not expose an authored-tool idempotency key for a specific pending approval card. If a Vercel timeout kills the model step before `input.requested` / `session.waiting`, Eve may re-run that step and emit another approval card. Do not build a brittle app-layer workaround unless Eve adds a supported key. Current mitigation: keep pre-approval Slack output short, and keep Drive/document writes idempotent by Event ID, Slack thread key, pack version, and document type.
- Slack modal false-failure UX is fixed in code with an in-process Slack route wrapper: `view_submission` keeps Eve answer recording but returns Slack's expected empty `200`. Approval button/block actions intentionally stay on Eve's default path.
- Route classification intentionally trusts the model's structured `tripBeyondM25`, `overnightTrip`, and `multiDayAtSingleVenue` flags. The deterministic backstop only demotes the common over-flag of an on-site multi-day overnight event with no away travel or external venue. Do not reintroduce broad prose regex trip parsing unless a new production bug justifies it.

## Local Commands

- `pnpm dev`: run Eve locally.
- `pnpm build`: build the agent.
- `pnpm typecheck`: run TypeScript checks.
