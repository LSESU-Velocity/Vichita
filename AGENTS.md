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

## Local Commands

- `pnpm dev`: run Eve locally.
- `pnpm build`: build the agent.
- `pnpm typecheck`: run TypeScript checks.
