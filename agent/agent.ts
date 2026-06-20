import { defineAgent } from "eve";

export default defineAgent({
  model: process.env.EVE_MODEL ?? "anthropic/claude-haiku-4.5",
});
