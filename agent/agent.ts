import { defineAgent } from "eve";

const defaultModel = "openai/gpt-5.4-mini";
// Fallbacks fire only when the primary model errors (e.g. a gateway 500).
// Keep them to low-cost, non-OpenAI providers so a single provider incident
// does not take down simple Slack operations.
const defaultFallbackModels = ["zai/glm-5.2", "alibaba/qwen3.7-plus"];

function readCsvEnv(name: string) {
  const value = process.env[name];
  if (!value) return undefined;

  const values = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return values.length > 0 ? values : undefined;
}

const model = process.env.EVE_MODEL?.trim() || defaultModel;
const fallbackModels = (
  readCsvEnv("EVE_MODEL_FALLBACKS") ?? defaultFallbackModels
).filter((fallbackModel) => fallbackModel !== model);

export default defineAgent({
  model,
  modelOptions:
    fallbackModels.length > 0
      ? {
          providerOptions: {
            gateway: {
              models: fallbackModels,
              tags: [
                "agent:vichita",
                `env:${process.env.VICHITA_ENV ?? "development"}`,
              ],
            },
          },
        }
      : undefined,
});
