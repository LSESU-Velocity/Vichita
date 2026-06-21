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