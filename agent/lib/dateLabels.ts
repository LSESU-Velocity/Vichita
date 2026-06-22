export function formatIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function formatDateForDisplay(date: Date) {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = String(date.getUTCFullYear());

  return `${day}-${month}-${year}`;
}

function parseIsoCalendarDate(value: string | undefined) {
  if (!value) return undefined;

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return undefined;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return undefined;
  }

  return { year: match[1], month: match[2], day: match[3], date };
}

export function isIsoCalendarDate(value: string | undefined) {
  return Boolean(parseIsoCalendarDate(value));
}

export function isoDatePart(value: string | undefined) {
  const parsed = parseIsoCalendarDate(value);
  return parsed ? `${parsed.year}${parsed.month}${parsed.day}` : undefined;
}

export function displayDateFromIsoDate(value: string | undefined) {
  const parsed = parseIsoCalendarDate(value);
  return parsed ? `${parsed.day}-${parsed.month}-${parsed.year}` : undefined;
}

export function displayDateFromEventDatePart(value: string | undefined) {
  if (!value) return undefined;

  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(value.trim());
  if (!match) return undefined;

  return displayDateFromIsoDate(`${match[1]}-${match[2]}-${match[3]}`);
}

export function dateDisplaySortKey(value: string | undefined) {
  if (!value) return "";

  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value.trim());
  if (!match) return value;

  return `${match[3]}-${match[2]}-${match[1]}`;
}

// Single source of truth for the human-facing event date label. Renders a single
// day ("DD-MM-YYYY") or an inclusive range ("DD-MM-YYYY to DD-MM-YYYY") from ISO
// start/end dates. Returns undefined when the start is missing/unparseable so
// callers can fall back to their own placeholder text.
export function eventDateRangeLabel({
  startIsoDate,
  endIsoDate,
}: {
  startIsoDate?: string;
  endIsoDate?: string;
}) {
  const start = displayDateFromIsoDate(startIsoDate);
  if (!start) return undefined;

  const end = displayDateFromIsoDate(endIsoDate);
  return end && end !== start ? `${start} to ${end}` : start;
}

// Splits an already-formatted display label ("DD-MM-YYYY" or "DD-MM-YYYY to
// DD-MM-YYYY") back into its start/end parts. Used when merging an existing
// human-facing label with a new ISO start/end during in-place updates.
export function splitDateRangeLabel(label: string | undefined) {
  const trimmed = label?.trim();
  if (!trimmed) return { start: undefined, end: undefined } as const;

  const match = /^(.*\S)\s+to\s+(\S.*)$/.exec(trimmed);
  if (match) return { start: match[1].trim(), end: match[2].trim() } as const;

  return { start: trimmed, end: undefined } as const;
}