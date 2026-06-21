import { google } from "googleapis";

import {
  GOOGLE_WORKSPACE_SCOPES,
  readServiceAccountCredentials,
} from "./config.js";

// Cap every Google API request so a single stuck call fails fast (~20s) instead
// of hanging until the serverless function's hard limit, which previously
// surfaced as silent 300s Vercel runtime timeouts. gaxios applies this global
// option to every googleapis request.
const GOOGLE_REQUEST_TIMEOUT_MS = 20_000;
google.options({ timeout: GOOGLE_REQUEST_TIMEOUT_MS });

let cachedAuthClient: InstanceType<typeof google.auth.JWT> | undefined;

// Reuse a single JWT auth client so the OAuth access token is fetched once and
// cached, instead of re-authenticating on every Drive/Docs/Sheets call.
export function createGoogleAuthClient() {
  if (!cachedAuthClient) {
    const credentials = readServiceAccountCredentials();
    cachedAuthClient = new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: GOOGLE_WORKSPACE_SCOPES,
    });
  }

  return cachedAuthClient;
}

export function createDriveClient() {
  return google.drive({
    version: "v3",
    auth: createGoogleAuthClient(),
  });
}

export function createSheetsClient() {
  return google.sheets({
    version: "v4",
    auth: createGoogleAuthClient(),
  });
}

export function createDocsClient() {
  return google.docs({
    version: "v1",
    auth: createGoogleAuthClient(),
  });
}

export function googleApiErrorSummary(error: unknown) {
  const candidate = error as {
    code?: number;
    status?: number;
    message?: string;
    errors?: Array<{ reason?: string; message?: string }>;
  };

  return {
    code: candidate.code ?? candidate.status,
    message:
      typeof candidate.message === "string"
        ? candidate.message
        : "Google API request failed.",
    reasons: Array.isArray(candidate.errors)
      ? candidate.errors
          .map((entry) => entry.reason)
          .filter((reason): reason is string => Boolean(reason))
      : [],
  };
}

