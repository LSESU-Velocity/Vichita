import { google } from "googleapis";

import {
  GOOGLE_WORKSPACE_SCOPES,
  readServiceAccountCredentials,
} from "./config.js";

export function createGoogleAuthClient() {
  const credentials = readServiceAccountCredentials();

  return new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: GOOGLE_WORKSPACE_SCOPES,
  });
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

