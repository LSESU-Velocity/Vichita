export function formatIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function formatDateForDisplay(date: Date) {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = String(date.getUTCFullYear());

  return `${day}-${month}-${year}`;
}

export function displayDateFromIsoDate(value: string | undefined) {
  if (!value) return undefined;

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return undefined;

  return `${match[3]}-${match[2]}-${match[1]}`;
}

export function displayDateFromEventDatePart(value: string | undefined) {
  if (!value) return undefined;

  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(value.trim());
  if (!match) return undefined;

  return `${match[3]}-${match[2]}-${match[1]}`;
}

export function dateDisplaySortKey(value: string | undefined) {
  if (!value) return "";

  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value.trim());
  if (!match) return value;

  return `${match[3]}-${match[2]}-${match[1]}`;
}