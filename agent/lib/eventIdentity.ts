import { createHash, randomBytes } from "node:crypto";

import { displayDateFromEventDatePart, isoDatePart } from "./dateLabels.js";

const EVENT_ID_PATTERN =
  /^EVT-(?<datePart>\d{8})-(?<eventSlug>[a-z0-9]+(?:-[a-z0-9]+)*)-(?<shortId>[a-f0-9]{4,12})$/;

export type EventIdentityInput = {
  eventName: string;
  proposedDate?: string;
  createdAtUtc?: string;
  existingEventId?: string;
  shortId?: string;
  sourceSlackChannelId?: string;
  sourceSlackThreadTs?: string;
};

export type EventIdentity = {
  eventId: string;
  eventSlug: string;
  datePart: string;
  displayDate: string;
  shortId: string;
  version: 1;
  usedCreationDateForId: boolean;
  idempotencyKey: string;
  slackThreadKey?: string;
  warnings: string[];
};

export function slugifyEventName(value: string) {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 36)
    .replace(/-+$/g, "");

  return slug || "event";
}

export function parseEventId(eventId: string) {
  const match = EVENT_ID_PATTERN.exec(eventId);
  if (!match?.groups) return null;

  if (!displayDateFromEventDatePart(match.groups.datePart)) return null;

  return {
    eventId,
    datePart: match.groups.datePart,
    eventSlug: match.groups.eventSlug,
    shortId: match.groups.shortId,
  };
}

function datePartFromTimestamp(value: string | undefined) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return null;

  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

function shortHash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 10);
}

function normalizeShortId(value: string | undefined) {
  if (!value) return randomBytes(2).toString("hex");

  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{4,12}$/.test(normalized)) {
    throw new Error("shortId must be 4 to 12 lowercase hex characters.");
  }

  return normalized;
}

export function buildSlackThreadKey({
  sourceSlackChannelId,
  sourceSlackThreadTs,
}: {
  sourceSlackChannelId?: string;
  sourceSlackThreadTs?: string;
}) {
  const channelId = sourceSlackChannelId?.trim();
  const threadTs = sourceSlackThreadTs?.trim();

  if (!channelId || !threadTs) return undefined;

  return `slack-thread:${channelId}:${threadTs}`;
}

export function buildEventIdentity(input: EventIdentityInput): EventIdentity {
  const warnings: string[] = [];
  const existing = input.existingEventId
    ? parseEventId(input.existingEventId.trim())
    : null;

  if (input.existingEventId && !existing) {
    throw new Error(
      "existingEventId must use EVT-YYYYMMDD-event-slug-shortid format.",
    );
  }

  const fallbackSlug = slugifyEventName(input.eventName);
  const eventSlug = existing?.eventSlug ?? fallbackSlug;
  const trimmedProposedDate = input.proposedDate?.trim();
  const proposedDatePart = isoDatePart(trimmedProposedDate);
  if (trimmedProposedDate && !proposedDatePart) {
    throw new Error(
      "proposedDate must be a real ISO calendar date in YYYY-MM-DD format.",
    );
  }
  let usedCreationDateForId = false;

  let datePart = existing?.datePart ?? proposedDatePart;
  if (!datePart) {
    const fallbackDatePart = datePartFromTimestamp(input.createdAtUtc);
    if (!fallbackDatePart) {
      throw new Error("createdAtUtc must be a valid timestamp when provided.");
    }

    datePart = fallbackDatePart;
    usedCreationDateForId = true;
    warnings.push(
      "No proposedDate was supplied, so the Event ID uses the creation date.",
    );
  }

  const slackThreadKey = buildSlackThreadKey(input);
  const generatedShortId = slackThreadKey
    ? shortHash(`${datePart}:${eventSlug}:${slackThreadKey}`).slice(0, 8)
    : undefined;
  const shortId =
    existing?.shortId ?? normalizeShortId(input.shortId ?? generatedShortId);
  const eventId = existing?.eventId ?? `EVT-${datePart}-${eventSlug}-${shortId}`;

  const idempotencyKey =
    slackThreadKey ?? `event-draft:${datePart}:${eventSlug}:${shortHash(eventId)}`;

  return {
    eventId,
    eventSlug,
    datePart,
    displayDate: displayDateFromEventDatePart(datePart) ?? datePart,
    shortId,
    version: 1,
    usedCreationDateForId,
    idempotencyKey,
    slackThreadKey,
    warnings,
  };
}

export function buildPackId(eventId: string, version = 1) {
  if (!parseEventId(eventId)) {
    throw new Error("eventId must use EVT-YYYYMMDD-event-slug-shortid format.");
  }

  if (!Number.isInteger(version) || version < 1) {
    throw new Error("version must be a positive integer.");
  }

  return `${eventId}-PACK-v${version}`;
}
