import { defineAgent } from "eve";

const defaultModel = "zai/glm-5.2";

function readCsvEnv(name: string) {
  const value = process.env[name];
  if (!value) return undefined;

  const values = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return values.length > 0 ? values : undefined;
}

function providerFor(modelId: string) {
  return modelId.split("/", 1)[0];
}

const model = process.env.EVE_MODEL?.trim() || defaultModel;
const modelProvider = providerFor(model);
const fallbackModels = (readCsvEnv("EVE_MODEL_FALLBACKS") ?? [])
  .filter((fallbackModel) => fallbackModel !== model)
  .filter((fallbackModel) => {
    const fallbackProvider = providerFor(fallbackModel);
    const isSameProvider = fallbackProvider === modelProvider;

    if (!isSameProvider) {
      console.warn(
        `[vichita] Ignoring EVE_MODEL_FALLBACKS entry "${fallbackModel}" because Eve currently routes "${model}" through provider "${modelProvider}". Cross-provider fallbacks caused AI Gateway invalid_request errors.`,
      );
    }

    return isSameProvider;
  });

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
