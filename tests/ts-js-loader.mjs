import { existsSync } from "node:fs";

export async function resolve(specifier, context, nextResolve) {
  if (
    specifier.endsWith(".js") &&
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    context.parentURL
  ) {
    const resolved = new URL(specifier, context.parentURL);
    if (resolved.protocol === "file:") {
      const tsUrl = new URL(resolved.href.replace(/\.js$/, ".ts"));
      if (existsSync(tsUrl)) {
        return { url: tsUrl.href, shortCircuit: true };
      }
    }
  }

  return nextResolve(specifier, context);
}
