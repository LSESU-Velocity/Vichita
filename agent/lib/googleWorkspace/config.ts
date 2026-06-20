type Env = NodeJS.ProcessEnv;

export const GOOGLE_WORKSPACE_SCOPES = [
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/spreadsheets",
];

const REQUIRED_GOOGLE_ENV = [
  "GOOGLE_SERVICE_ACCOUNT_JSON_BASE64",
  "GOOGLE_DRIVE_ROOT_FOLDER_ID",
  "GOOGLE_TRACKERS_SPREADSHEET_ID",
] as const;

const RECOMMENDED_ENV = [
  "EVE_MODEL",
  "SLACK_CONNECTOR",
  "APP_BASE_URL",
  "VICHITA_ENV",
  "DEFAULT_TIMEZONE",
  "RULES_SOURCE_SET_ID",
  "RULES_LAST_VERIFIED_DATE",
] as const;

export type GoogleServiceAccountCredentials = {
  client_email: string;
  private_key: string;
  project_id?: string;
  token_uri?: string;
};

export type GoogleWorkspaceConfig = {
  serviceAccountEmail: string;
  serviceAccountProjectId?: string;
  driveRootFolderId: string;
  trackersSpreadsheetId: string;
};

export type ConfigValidation = {
  readyForGoogleWorkspace: boolean;
  serviceAccountEmail?: string;
  serviceAccountProjectId?: string;
  missingRequiredEnv: string[];
  missingRecommendedEnv: string[];
  configuredEnv: string[];
  errors: string[];
  warnings: string[];
};

function present(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function parseServiceAccountCredentials(
  encoded: string,
): GoogleServiceAccountCredentials {
  let decoded: string;
  try {
    decoded = Buffer.from(encoded.trim(), "base64").toString("utf8");
  } catch {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 is not valid base64-encoded JSON.",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 is not valid base64-encoded JSON.",
    );
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Google service account credential must be a JSON object.");
  }

  const candidate = parsed as Partial<GoogleServiceAccountCredentials>;
  if (!present(candidate.client_email)) {
    throw new Error("Google service account credential is missing client_email.");
  }

  if (!present(candidate.private_key)) {
    throw new Error("Google service account credential is missing private_key.");
  }

  if (!candidate.private_key.includes("BEGIN PRIVATE KEY")) {
    throw new Error("Google service account credential private_key is invalid.");
  }

  return {
    client_email: candidate.client_email.trim(),
    private_key: candidate.private_key,
    project_id: candidate.project_id,
    token_uri: candidate.token_uri,
  };
}

export function validateVichitaConfig(env: Env = process.env): ConfigValidation {
  const missingRequiredEnv = REQUIRED_GOOGLE_ENV.filter((name) => !present(env[name]));
  const missingRecommendedEnv = RECOMMENDED_ENV.filter((name) => !present(env[name]));
  const configuredEnv = [...REQUIRED_GOOGLE_ENV, ...RECOMMENDED_ENV].filter((name) =>
    present(env[name]),
  );
  const errors: string[] = [];
  const warnings: string[] = [];
  let serviceAccountEmail: string | undefined;
  let serviceAccountProjectId: string | undefined;

  if (present(env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64)) {
    try {
      const credentials = parseServiceAccountCredentials(
        env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64,
      );
      serviceAccountEmail = credentials.client_email;
      serviceAccountProjectId = credentials.project_id;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Google credential is invalid.");
    }
  }

  if (!present(env.AI_GATEWAY_API_KEY)) {
    warnings.push(
      "AI_GATEWAY_API_KEY is not set. This is acceptable only if the deployment uses another supported AI Gateway auth path.",
    );
  }

  if (env.VICHITA_ENV === "production" && !present(env.APP_BASE_URL)) {
    warnings.push("APP_BASE_URL should be set in production.");
  }

  return {
    readyForGoogleWorkspace:
      missingRequiredEnv.length === 0 && errors.length === 0,
    serviceAccountEmail,
    serviceAccountProjectId,
    missingRequiredEnv,
    missingRecommendedEnv,
    configuredEnv,
    errors,
    warnings,
  };
}

export function readGoogleWorkspaceConfig(
  env: Env = process.env,
): GoogleWorkspaceConfig {
  const validation = validateVichitaConfig(env);
  const encodedCredential = env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64;
  const driveRootFolderId = env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  const trackersSpreadsheetId = env.GOOGLE_TRACKERS_SPREADSHEET_ID;

  if (
    !validation.readyForGoogleWorkspace ||
    !present(encodedCredential) ||
    !present(driveRootFolderId) ||
    !present(trackersSpreadsheetId)
  ) {
    throw new Error(
      `Google Workspace config is incomplete: ${[
        ...validation.missingRequiredEnv,
        ...validation.errors,
      ].join("; ")}`,
    );
  }

  const credentials = parseServiceAccountCredentials(encodedCredential);

  return {
    serviceAccountEmail: credentials.client_email,
    serviceAccountProjectId: credentials.project_id,
    driveRootFolderId: driveRootFolderId.trim(),
    trackersSpreadsheetId: trackersSpreadsheetId.trim(),
  };
}

export function readServiceAccountCredentials(env: Env = process.env) {
  const value = env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64;
  if (!present(value)) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 is not set.");
  }

  return parseServiceAccountCredentials(value);
}
