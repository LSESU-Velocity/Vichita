import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import type { drive_v3, sheets_v4 } from "googleapis";
import { z } from "zod";

import {
  displayDateFromIsoDate,
  isIsoCalendarDate,
  splitDateRangeLabel,
} from "../lib/dateLabels.js";
import {
  buildAccessibilityComplianceTaskRows,
  buildDeadlineComplianceTaskRows,
  buildDeadlinePlanSheet,
  buildRiskRows,
  packDocumentFileName,
  PACK_DOCUMENT_LABELS,
  type DeadlinePlanItem,
  type EventPackInput,
  type GeneratedSheet,
  type PackDocumentType,
} from "../lib/eventPack.js";
import { createDriveClient, createSheetsClient } from "../lib/googleWorkspace/client.js";
import {
  exportGoogleDriveFileText,
  updateGoogleDocText,
} from "../lib/googleWorkspace/docs.js";
import {
  eventPackFolderDisplayEventName,
  findEventPackFolderForUpdate,
  renameDriveFile,
} from "../lib/googleWorkspace/drive.js";
import {
  patchTrackerRow,
  upsertTrackerRows,
  columnLetter,
} from "../lib/googleWorkspace/sheets.js";
import {
  updateGeneratedRiskAssessmentCells,
  updateRiskAssessmentHeaderFieldValues,
  type RiskGeneratedCellUpdate,
  type RiskHeaderFieldName,
} from "../lib/googleWorkspace/riskAssessmentDoc.js";

const GOOGLE_DOC_MIME_TYPE = "application/vnd.google-apps.document";
const GOOGLE_SHEET_MIME_TYPE = "application/vnd.google-apps.spreadsheet";

const DeadlinePlanItemInput = z.object({
  task: z.string().min(1),
  dueDate: z.string().optional(),
  deadlineType: z.string().optional(),
  sourceRule: z.string().optional(),
  blocksFinalSubmissionReadiness: z.boolean().optional(),
  notes: z.array(z.string()).default([]),
});

const Changes = z.object({
  eventName: z.string().min(1).optional(),
  eventDescription: z.string().optional(),
  proposedDate: z.string().optional(),
  proposedEndDate: z
    .string()
    .optional()
    .describe(
      "Last day for a multi-day or rescheduled-range event (YYYY-MM-DD). Omit for a single-day event.",
    ),
  setupStartTime: z.string().optional(),
  eventStartTime: z.string().optional(),
  eventEndTime: z.string().optional(),
  expectedAttendance: z.number().int().nonnegative().optional(),
  preferredLocation: z.string().optional(),
  externalVenueDetails: z.string().optional(),
  organiserName: z.string().optional(),
  organiserRole: z.string().optional(),
  organiserLseEmail: z.string().email().optional(),
  organiserContactNumber: z.string().optional(),
  firstAidPlan: z.string().optional(),
  accessibilityContactOrRequestRoute: z.string().optional(),
  publicOrNonLseAttendees: z.boolean().optional(),
  foodOrRefreshments: z.boolean().optional(),
  alcohol: z.boolean().optional(),
  ticketingPlan: z.string().optional(),
  attendeeRegistrationEntryPlan: z.string().optional(),
  academicChairStatus: z.string().optional(),
  academicChairNameEmail: z.string().optional(),
  externalOrganisationInvolved: z.boolean().optional(),
  externalOrganisationName: z.string().optional(),
  sponsorInvolved: z.boolean().optional(),
  sponsorName: z.string().optional(),
  estimatedCost: z.number().nonnegative().optional(),
  transportPlan: z.string().optional(),
  accommodationPlan: z.string().optional(),
  onSiteOvernightStay: z
    .boolean()
    .optional()
    .describe(
      "Participants stay overnight at the event's own venue. Adding this needs a pack regenerate to insert the on-site overnight risk row; update patches existing rows only.",
    ),
  multiDayAtSingleVenue: z.boolean().optional(),
  deadlines: z.array(DeadlinePlanItemInput).optional(),
});

const Input = z
  .object({
    eventId: z
      .string()
      .optional()
      .describe("Existing Event ID. Prefer this when known."),
    eventName: z
      .string()
      .optional()
      .describe("Existing visible event name used to find exactly one pack folder."),
    packFolderId: z.string().optional(),
    packFolderLink: z.string().url().optional(),
    sourceSlackChannelId: z.string().optional(),
    sourceSlackThreadTs: z.string().optional(),
    packVersion: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "Existing pack version to patch. Leave unset to patch the single existing version; the tool fails and asks for this only when several versions exist in the folder.",
      ),
    changes: Changes,
    updateTrackers: z.boolean().default(true),
    updateReason: z.string().optional(),
    generatedBy: z.string().optional(),
  })
  .refine(
    (input) =>
      Boolean(
        input.eventId?.trim() ||
          input.eventName?.trim() ||
          input.packFolderId?.trim() ||
          input.packFolderLink?.trim() ||
          (input.sourceSlackChannelId?.trim() && input.sourceSlackThreadTs?.trim()),
      ),
    "Provide an existing Event ID, event name, pack folder link/ID, or Slack root thread context.",
  )
  .refine(
    (input) => Object.keys(input.changes).length > 0,
    "Provide at least one changed field.",
  );

type ExistingFile = {
  id?: string | null;
  name?: string | null;
  mimeType?: string | null;
  webViewLink?: string | null;
  appProperties?: Record<string, string> | null;
};

type SheetPatch = {
  field: string;
  answer: string | number | boolean;
  needsReview?: string;
  notes?: string;
};

function escapeDriveQueryValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function quoteSheetTitle(title: string) {
  return `'${title.replace(/'/g, "''")}'`;
}

function packFolderIdFromLink(link: string | undefined) {
  if (!link) return undefined;
  const foldersMatch = /\/folders\/([a-zA-Z0-9_-]+)/.exec(link);
  if (foldersMatch) return foldersMatch[1];
  const idMatch = /[?&]id=([a-zA-Z0-9_-]+)/.exec(link);
  return idMatch?.[1];
}

function displayDate(value: string | undefined) {
  return displayDateFromIsoDate(value) ?? value?.trim() ?? "TBC";
}

function yesNo(value: boolean | undefined) {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return undefined;
}

function trackerYesNo(value: boolean | undefined) {
  if (value === true) return "yes";
  if (value === false) return "no";
  return undefined;
}

function text(value: string | undefined, fallback = "TBC") {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

export function parseDateTimeAnswer(value: string | undefined) {
  const match = /^(.*?),\s*setup\s+([^,]+),\s*event\s+(.+?)-(.+)$/.exec(
    value?.trim() ?? "",
  );
  if (!match) return undefined;

  return {
    date: match[1].trim(),
    setupStartTime: match[2].trim(),
    eventStartTime: match[3].trim(),
    eventEndTime: match[4].trim(),
  };
}

// Resolves the human-facing event date label, supporting multi-day ranges.
// A new start date (proposedDate) defaults to a single day; the prior end date
// is only kept when restated via proposedEndDate, which avoids pairing a moved
// start with a stale (possibly earlier) end date.
export function eventDateLabelFromChanges({
  changes,
  currentDate,
}: {
  changes: z.infer<typeof Changes>;
  currentDate?: string;
}) {
  const current = splitDateRangeLabel(currentDate);
  const start = changes.proposedDate
    ? displayDate(changes.proposedDate)
    : current.start ?? "TBC";
  const end = changes.proposedEndDate
    ? displayDate(changes.proposedEndDate)
    : changes.proposedDate
      ? undefined
      : current.end;

  return end && end !== start ? `${start} to ${end}` : start;
}

export function dateTimeAnswerFromChanges({
  changes,
  currentAnswer,
}: {
  changes: z.infer<typeof Changes>;
  currentAnswer?: string;
}) {
  const hasDateTimeChange = Boolean(
    changes.proposedDate !== undefined ||
      changes.proposedEndDate !== undefined ||
      changes.setupStartTime !== undefined ||
      changes.eventStartTime !== undefined ||
      changes.eventEndTime !== undefined,
  );
  if (!hasDateTimeChange) return undefined;

  const current = parseDateTimeAnswer(currentAnswer);
  const date = eventDateLabelFromChanges({
    changes,
    currentDate: current?.date,
  });
  const setup = changes.setupStartTime ?? current?.setupStartTime ?? "TBC";
  const start = changes.eventStartTime ?? current?.eventStartTime ?? "TBC";
  const end = changes.eventEndTime ?? current?.eventEndTime ?? "TBC";

  return `${date}, setup ${setup}, event ${start}-${end}`;
}

// True only when a non-empty replacement deadline set was supplied. An empty
// array is treated as "no deadlines supplied" so it can never blank-out the
// existing deadline plan (buildDeadlinePlanSheet turns an empty list into a
// single "Run compute_deadlines" placeholder row).
function hasReplacementDeadlines(changes: z.infer<typeof Changes>) {
  return Array.isArray(changes.deadlines) && changes.deadlines.length > 0;
}

// A date move shifts every deadline due date, but this tool only rewrites
// deadline rows when replacement rows are supplied. Surfaces the gap so callers
// recompute deadlines explicitly. See agent/instructions.md fast-path rules.
export function changesRequireDeadlineRecompute(
  changes: z.infer<typeof Changes>,
) {
  return (
    (changes.proposedDate !== undefined ||
      changes.proposedEndDate !== undefined) &&
    !hasReplacementDeadlines(changes)
  );
}

export function changedFieldNames(changes: z.infer<typeof Changes>) {
  // Skip empty arrays (e.g. deadlines: []) so the update log / returned
  // changedFields never claim a field changed when it was actually ignored.
  return Object.entries(changes)
    .filter(
      ([, value]) =>
        value !== undefined && !(Array.isArray(value) && value.length === 0),
    )
    .map(([key]) => key);
}

function fileOutput(file: ExistingFile) {
  if (!file.id) throw new Error("Google Drive returned a file without an id.");
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    webViewLink: file.webViewLink ?? `https://drive.google.com/file/d/${file.id}/view`,
    appProperties: file.appProperties,
  };
}

async function findEventPackFile({
  drive,
  folderId,
  eventId,
  packVersion,
  documentType,
}: {
  drive: drive_v3.Drive;
  folderId: string;
  eventId: string;
  packVersion: number;
  documentType: string;
}) {
  const response = await drive.files.list({
    q: [
      "trashed = false",
      `'${escapeDriveQueryValue(folderId)}' in parents`,
      `appProperties has { key='vichitaEventId' and value='${escapeDriveQueryValue(eventId)}' }`,
      `appProperties has { key='vichitaPackVersion' and value='${packVersion}' }`,
      `appProperties has { key='vichitaDocumentType' and value='${escapeDriveQueryValue(documentType)}' }`,
    ].join(" and "),
    fields: "files(id,name,mimeType,webViewLink,appProperties)",
    spaces: "drive",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const files = (response.data.files ?? []) as ExistingFile[];

  if (files.length > 1) {
    const names = files
      .map((file) => `${file.name ?? "unnamed"} (${file.webViewLink ?? file.id ?? "no link"})`)
      .join("; ");
    throw new Error(
      `Multiple ${documentType} files exist for ${eventId} v${packVersion}: ${names}. Resolve duplicates manually before patching.`,
    );
  }

  return files[0] ? fileOutput(files[0]) : undefined;
}

// Distinct vichitaPackVersion values stamped on the folder's pack files for
// this event, ascending. Empty when the folder holds no versioned pack files.
export async function listPackVersions({
  drive,
  folderId,
  eventId,
}: {
  drive: drive_v3.Drive;
  folderId: string;
  eventId: string;
}): Promise<number[]> {
  const response = await drive.files.list({
    q: [
      "trashed = false",
      `'${escapeDriveQueryValue(folderId)}' in parents`,
      `appProperties has { key='vichitaEventId' and value='${escapeDriveQueryValue(eventId)}' }`,
    ].join(" and "),
    fields: "files(appProperties)",
    spaces: "drive",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const versions = ((response.data.files ?? []) as ExistingFile[])
    .map((file) => Number(file.appProperties?.vichitaPackVersion))
    .filter((value) => Number.isInteger(value) && value > 0);

  return [...new Set(versions)].sort((a, b) => a - b);
}

// Chooses which pack version to patch. An explicit request always wins.
// Otherwise patch the single existing version; refuse to guess when several
// versions exist (the highest is not necessarily the active one - it may be an
// archive snapshot), and fall back to v1 when the folder has no versioned
// files yet (the no-files case is then caught downstream).
export function choosePackVersion(
  requested: number | undefined,
  available: number[],
): number {
  if (requested !== undefined) return requested;
  if (available.length > 1) {
    throw new Error(
      `This event pack has multiple versions (${available
        .map((version) => `v${version}`)
        .join(", ")}). Pass packVersion to choose which one to update.`,
    );
  }
  return available[0] ?? 1;
}

async function readSheetValues({
  sheets,
  spreadsheetId,
  sheetTitle,
}: {
  sheets: sheets_v4.Sheets;
  spreadsheetId: string;
  sheetTitle: string;
}) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${quoteSheetTitle(sheetTitle)}!A:Z`,
  });
  return response.data.values ?? [];
}

function currentAnswerForField(values: unknown[][], field: string) {
  const headers = values[0]?.map((value) => String(value)) ?? [];
  const fieldIndex = headers.indexOf("Official form field");
  const answerIndex = headers.indexOf("Draft answer");
  if (fieldIndex < 0 || answerIndex < 0) return undefined;

  const row = values
    .slice(1)
    .find((candidate) => String(candidate[fieldIndex] ?? "") === field);
  const answer = row?.[answerIndex];
  return answer === undefined ? undefined : String(answer);
}

function answerNeedsReview(answer: string | number | boolean) {
  const value = String(answer).toLowerCase();
  return /\btbc\b|needs checking|not indicated|not generated/.test(value)
    ? "yes"
    : "";
}

async function patchFormFieldSheet({
  sheets,
  spreadsheetId,
  updates,
}: {
  sheets: sheets_v4.Sheets;
  spreadsheetId: string;
  updates: SheetPatch[];
}) {
  if (updates.length === 0) {
    return { updatedFields: [], missingFields: [], requestCount: 0 };
  }

  const values = await readSheetValues({
    sheets,
    spreadsheetId,
    sheetTitle: "Form Fields",
  });
  const headers = values[0]?.map((value) => String(value)) ?? [];
  const fieldIndex = headers.indexOf("Official form field");
  const answerIndex = headers.indexOf("Draft answer");
  const enteredIndex = headers.indexOf("Entered?");
  const reviewIndex = headers.indexOf("Needs review?");
  const notesIndex = headers.indexOf("Notes");

  if (fieldIndex < 0 || answerIndex < 0) {
    throw new Error("Form field pack sheet is missing required columns.");
  }

  const data: sheets_v4.Schema$ValueRange[] = [];
  const updatedFields: string[] = [];
  const missingFields: string[] = [];

  for (const update of updates) {
    const matchingRows = values
      .slice(1)
      .map((row, index) => ({ row, rowNumber: index + 2 }))
      .filter(({ row }) => String(row[fieldIndex] ?? "") === update.field);

    if (matchingRows.length === 0) {
      missingFields.push(update.field);
      continue;
    }
    if (matchingRows.length > 1) {
      throw new Error(
        `Form field pack has duplicate rows for field "${update.field}".`,
      );
    }

    const rowNumber = matchingRows[0].rowNumber;
    const addCell = (columnIndex: number, value: string | number | boolean) => {
      const letter = columnLetter(columnIndex + 1);
      data.push({
        range: `${quoteSheetTitle("Form Fields")}!${letter}${rowNumber}`,
        values: [[value]],
      });
    };

    addCell(answerIndex, update.answer);
    if (enteredIndex >= 0) addCell(enteredIndex, false);
    if (reviewIndex >= 0) {
      addCell(reviewIndex, update.needsReview ?? answerNeedsReview(update.answer));
    }
    if (notesIndex >= 0 && update.notes !== undefined) {
      addCell(notesIndex, update.notes);
    }
    updatedFields.push(update.field);
  }

  if (data.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: "RAW",
        data,
      },
    });
  }

  return {
    updatedFields,
    missingFields,
    requestCount: data.length,
  };
}

async function fillGeneratedSheetBasic({
  sheets,
  spreadsheetId,
  sheet,
}: {
  sheets: sheets_v4.Sheets;
  spreadsheetId: string;
  sheet: GeneratedSheet;
}) {
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${quoteSheetTitle(sheet.sheetTitle)}!A:Z`,
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${quoteSheetTitle(sheet.sheetTitle)}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: sheet.values },
  });

  return { rows: Math.max(sheet.values.length - 1, 0) };
}

export function formFieldUpdatesFromChanges({
  changes,
  dateTimeAnswer,
}: {
  changes: z.infer<typeof Changes>;
  dateTimeAnswer?: string;
}) {
  const updates: SheetPatch[] = [];
  const add = (
    field: string,
    answer: string | number | boolean | undefined,
    notes?: string,
  ) => {
    if (answer !== undefined) updates.push({ field, answer, notes });
  };

  add("What is the name of your event?", changes.eventName);
  add("Name of Student Lead", changes.organiserName);
  add("Committee Role", changes.organiserRole);
  add("LSE Email Address", changes.organiserLseEmail);
  add("Date and time of activity, including setup time", dateTimeAnswer);
  add("Preferred event location", changes.preferredLocation);
  add("External venue details, if relevant", changes.externalVenueDetails);
  add("Overview of the event", changes.eventDescription);
  if (changes.publicOrNonLseAttendees !== undefined) {
    add(
      "Who will be attending?",
      changes.publicOrNonLseAttendees
        ? "LSE students plus public/non-LSE attendees, confirm access controls."
        : "Primarily LSE students/Velocity community, confirm final audience.",
    );
  }
  add("Approximate number of attendees", changes.expectedAttendance);
  add("Food or refreshments?", yesNo(changes.foodOrRefreshments));
  add("Alcohol?", yesNo(changes.alcohol));
  add("Ticketing", changes.ticketingPlan);
  add("Attendee registration / entry plan", changes.attendeeRegistrationEntryPlan);
  add("Academic Chair status", changes.academicChairStatus);
  add("Academic Chair full name and email, if confirmed", changes.academicChairNameEmail);
  add("Transport plan", changes.transportPlan);
  add("Accommodation plan, if relevant", changes.accommodationPlan);
  add("External organisation involved?", yesNo(changes.externalOrganisationInvolved));
  add("Organisation name", changes.externalOrganisationName);
  add(
    "Sponsor / employer involvement details",
    changes.sponsorInvolved === undefined && changes.sponsorName === undefined
      ? undefined
      : changes.sponsorInvolved
        ? text(changes.sponsorName, "Sponsor involved, details TBC")
        : "No sponsor recorded.",
  );
  add(
    "Total event cost",
    changes.estimatedCost === undefined ? undefined : `GBP ${changes.estimatedCost}`,
  );

  return updates;
}

function riskHeaderUpdatesFromChanges({
  changes,
  dateTimeAnswer,
}: {
  changes: z.infer<typeof Changes>;
  dateTimeAnswer?: string;
}) {
  const values: Partial<Record<RiskHeaderFieldName, string>> = {};
  if (changes.eventName !== undefined) values.event_name = changes.eventName;
  if (changes.organiserName !== undefined) {
    values.event_organiser_name = text(changes.organiserName);
  }
  if (changes.organiserLseEmail !== undefined) {
    values.event_organiser_lse_email = text(changes.organiserLseEmail);
  }
  if (changes.organiserContactNumber !== undefined) {
    values.event_organiser_contact_number = text(changes.organiserContactNumber);
  }
  if (dateTimeAnswer !== undefined) values.event_dates_times = dateTimeAnswer;
  if (changes.preferredLocation !== undefined) {
    values.event_location = text(changes.preferredLocation);
  }
  if (changes.firstAidPlan !== undefined) {
    values.first_aid_plan = text(changes.firstAidPlan);
  }

  return values;
}

function riskGeneratedCellUpdatesFromChanges({
  eventId,
  eventName,
  changes,
}: {
  eventId: string;
  eventName: string;
  changes: z.infer<typeof Changes>;
}) {
  const input: EventPackInput = {
    eventId,
    eventName,
    expectedAttendance: changes.expectedAttendance,
    preferredLocation: changes.preferredLocation,
    firstAidPlan: changes.firstAidPlan,
    organiserName: changes.organiserName,
  };
  const rows = buildRiskRows(input).coreRisks;
  const byHazard = new Map(rows.map((row) => [row.hazardIdentified, row]));
  const updates: RiskGeneratedCellUpdate[] = [];

  if (changes.expectedAttendance !== undefined) {
    const row = byHazard.get("Capacity Control");
    if (row) {
      updates.push({
        hazardIdentified: "Capacity Control",
        column: "actions_before_event",
        text: row.actionsBeforeEvent,
      });
    }
  }
  if (changes.preferredLocation !== undefined) {
    const row = byHazard.get("Crowd Control");
    if (row) {
      updates.push({
        hazardIdentified: "Crowd Control",
        column: "actions_before_event",
        text: row.actionsBeforeEvent,
      });
    }
  }
  if (changes.firstAidPlan !== undefined) {
    const row = byHazard.get("First Aid Emergencies");
    if (row) {
      updates.push({
        hazardIdentified: "First Aid Emergencies",
        column: "actions_before_event",
        text: row.actionsBeforeEvent,
      });
    }
  }

  return updates;
}

function trackerPatchFromChanges({
  changes,
  dateTimeAnswer,
  dateLabel,
}: {
  changes: z.infer<typeof Changes>;
  dateTimeAnswer?: string;
  dateLabel?: string;
}) {
  const patch: Record<string, string | number | boolean | undefined> = {
    "Event Name": changes.eventName,
    Date: dateLabel,
    Time: dateTimeAnswer,
    Owner: changes.organiserName,
    "Expected Attendance": changes.expectedAttendance,
    "Budget Estimate": changes.estimatedCost,
    "Food?": trackerYesNo(changes.foodOrRefreshments),
    "Alcohol?": trackerYesNo(changes.alcohol),
    "External Organisation?": trackerYesNo(changes.externalOrganisationInvolved),
    "Sponsor?": trackerYesNo(changes.sponsorInvolved),
    "Ticketing Status": changes.ticketingPlan,
    "Last Updated": new Date().toISOString(),
  };

  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  );
}

function eventInputForDeadlineRows({
  eventId,
  eventName,
  changes,
}: {
  eventId: string;
  eventName: string;
  changes: z.infer<typeof Changes>;
}): EventPackInput {
  return {
    eventId,
    eventName,
    organiserName: changes.organiserName,
    deadlines: changes.deadlines as DeadlinePlanItem[] | undefined,
  };
}

function updateLogText({
  changedFields,
  reason,
  generatedBy,
}: {
  changedFields: string[];
  reason?: string;
  generatedBy?: string;
}) {
  const summary =
    changedFields.length > 0
      ? `Updated ${changedFields.join(", ")}.`
      : "No field values changed.";
  const parts = [`${new Date().toISOString()}: ${summary}`];
  if (reason?.trim()) parts.push(`Reason: ${reason.trim()}.`);
  if (generatedBy?.trim()) parts.push(`Updated by: ${generatedBy.trim()}.`);
  return parts.join(" ");
}

// Human-readable "field: new value" lines for the changed fields, so the
// internal review summary records the actual corrected values rather than only
// claiming which field names changed.
function correctionValueLines({
  changes,
  dateTimeAnswer,
}: {
  changes: z.infer<typeof Changes>;
  dateTimeAnswer?: string;
}) {
  const lines: string[] = [];
  const add = (label: string, value: string | number | boolean | undefined) => {
    if (value !== undefined && value !== "") lines.push(`- ${label}: ${value}`);
  };

  add("Event name", changes.eventName);
  if (dateTimeAnswer) add("Date and time", dateTimeAnswer);
  else if (changes.proposedDate) add("Date", displayDate(changes.proposedDate));
  add("Location", changes.preferredLocation);
  add("External venue", changes.externalVenueDetails);
  add("Expected attendance", changes.expectedAttendance);
  add("Organiser", changes.organiserName);
  add("Organiser role", changes.organiserRole);
  add("Organiser email", changes.organiserLseEmail);
  add("Organiser contact", changes.organiserContactNumber);
  add("First-aid plan", changes.firstAidPlan);
  add("Food / refreshments", yesNo(changes.foodOrRefreshments));
  add("Alcohol", yesNo(changes.alcohol));
  add("Ticketing", changes.ticketingPlan);
  add("Registration / entry", changes.attendeeRegistrationEntryPlan);
  add("Academic chair status", changes.academicChairStatus);
  add("Transport plan", changes.transportPlan);
  add("Accommodation plan", changes.accommodationPlan);
  add("External organisation involved", yesNo(changes.externalOrganisationInvolved));
  add("External organisation name", changes.externalOrganisationName);
  add("Sponsor involved", yesNo(changes.sponsorInvolved));
  add("Sponsor name", changes.sponsorName);
  if (changes.estimatedCost !== undefined) {
    add("Estimated cost", `GBP ${changes.estimatedCost}`);
  }
  add("Event description", changes.eventDescription);
  if (hasReplacementDeadlines(changes)) {
    add("Deadlines", `${changes.deadlines?.length} replacement row(s) applied`);
  }

  return lines;
}

// Current human-facing values read from the existing Form Fields sheet. Used to
// build a merged "current state + supplied changes" view so derived free-text is
// refreshed rather than left stale.
type PackFieldState = {
  dateTimeAnswer?: string;
  location?: string;
  overview?: string;
  classificationReason?: string;
  eventName?: string;
};

function readFormFieldState(values: unknown[][]): PackFieldState {
  const get = (field: string) => currentAnswerForField(values, field);
  return {
    dateTimeAnswer: get("Date and time of activity, including setup time"),
    location: get("Preferred event location"),
    overview: get("Overview of the event"),
    classificationReason: get("Classification reason"),
    eventName: get("What is the name of your event?"),
  };
}

export type StaleReplacement = { from: string; to: string };

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function parseDisplayDate(value: string | undefined) {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value?.trim() ?? "");
  if (!match) return undefined;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  return { day, month, year, monthName: MONTH_NAMES[month - 1], display: match[0] };
}

function ordinalDay(day: number) {
  const mod100 = day % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${day}th`;
  return `${day}${["th", "st", "nd", "rd"][day % 10] ?? "th"}`;
}

type ParsedDisplayDate = NonNullable<ReturnType<typeof parseDisplayDate>>;

function singleDayVariants(date: ParsedDisplayDate) {
  return [
    date.display, // 14-03-2027
    `${date.day} ${date.monthName} ${date.year}`, // 14 March 2027
    `${ordinalDay(date.day)} ${date.monthName} ${date.year}`, // 14th March 2027
    `${date.monthName} ${date.day} ${date.year}`, // March 14 2027
    `${date.monthName} ${date.day}, ${date.year}`, // March 14, 2027
    `${date.day} ${date.monthName}`, // 14 March
    `${ordinalDay(date.day)} ${date.monthName}`, // 14th March
    `${date.monthName} ${date.day}`, // March 14
    `${date.monthName} ${ordinalDay(date.day)}`, // March 14th
  ];
}

// Plausible natural-language renderings of the OLD event date(s), most specific
// first, so a date written as prose ("14-15 March 2027", "14 March") is refreshed
// rather than only the numeric DD-MM-YYYY form. Every variant carries a month
// name or the full numeric date, so bare day numbers are never matched. The
// longest forms are returned first so a range form is replaced before its
// individual-day sub-forms.
export function oldDateReferenceVariants(
  startDisplay?: string,
  endDisplay?: string,
): string[] {
  const start = parseDisplayDate(startDisplay);
  if (!start) return [];
  const end = endDisplay ? parseDisplayDate(endDisplay) : undefined;
  const variants = new Set<string>();

  const isRange =
    end &&
    (end.day !== start.day ||
      end.month !== start.month ||
      end.year !== start.year);

  if (isRange && end) {
    // The exact numeric range label used by the date/time field and the internal
    // review "Date:" line, replaced as one unit before its day sub-forms.
    variants.add(`${start.display} to ${end.display}`);
    if (start.month === end.month && start.year === end.year) {
      // Day-first ranges: "14-15 March 2027", "14 to 15 March", etc.
      variants.add(`${start.day}-${end.day} ${start.monthName} ${start.year}`);
      variants.add(`${start.day} to ${end.day} ${start.monthName} ${start.year}`);
      variants.add(`${ordinalDay(start.day)}-${ordinalDay(end.day)} ${start.monthName} ${start.year}`);
      variants.add(`${ordinalDay(start.day)} to ${ordinalDay(end.day)} ${start.monthName} ${start.year}`);
      variants.add(`${start.day} ${start.monthName} ${start.year} to ${end.day} ${start.monthName} ${end.year}`);
      variants.add(`${start.day}-${end.day} ${start.monthName}`);
      variants.add(`${start.day} to ${end.day} ${start.monthName}`);
      variants.add(`${ordinalDay(start.day)}-${ordinalDay(end.day)} ${start.monthName}`);
      variants.add(`${ordinalDay(start.day)} to ${ordinalDay(end.day)} ${start.monthName}`);
      variants.add(`${start.day} ${start.monthName} to ${end.day} ${start.monthName}`);
      // Month-first ranges: "March 14-15", "March 14 to 15", "March 14 to 15th".
      variants.add(`${start.monthName} ${start.day}-${end.day} ${start.year}`);
      variants.add(`${start.monthName} ${start.day} to ${end.day} ${start.year}`);
      variants.add(`${start.monthName} ${start.day} to ${end.day}, ${start.year}`);
      variants.add(`${start.monthName} ${ordinalDay(start.day)} to ${ordinalDay(end.day)} ${start.year}`);
      variants.add(`${start.monthName} ${start.day}-${end.day}`);
      variants.add(`${start.monthName} ${start.day} to ${end.day}`);
      variants.add(`${start.monthName} ${start.day} to ${ordinalDay(end.day)}`);
      variants.add(`${start.monthName} ${ordinalDay(start.day)} to ${ordinalDay(end.day)}`);
    } else {
      // Cross-month ranges, day-first and month-first.
      variants.add(`${start.day} ${start.monthName} ${start.year} to ${end.day} ${end.monthName} ${end.year}`);
      variants.add(`${start.day} ${start.monthName} to ${end.day} ${end.monthName} ${end.year}`);
      variants.add(`${start.day} ${start.monthName} to ${end.day} ${end.monthName}`);
      variants.add(`${start.day} ${start.monthName} - ${end.day} ${end.monthName} ${end.year}`);
      variants.add(`${start.monthName} ${start.day} to ${end.monthName} ${end.day} ${end.year}`);
      variants.add(`${start.monthName} ${start.day} to ${end.monthName} ${end.day}`);
    }
    for (const variant of singleDayVariants(end)) variants.add(variant);
  }

  for (const variant of singleDayVariants(start)) variants.add(variant);

  return [...variants].sort((left, right) => right.length - left.length);
}

// Old -> new substring replacements for the changed date/location, so derived
// free-text (overview, classification reason, internal review body) stops
// showing stale values. `from` must be specific enough not to over-match a
// short generic word, so very short or "TBC" current values are skipped. The
// date side covers numeric and natural-language prose forms of the old date.
export function buildStaleReplacements({
  changes,
  currentState,
  newDateLabel,
}: {
  changes: z.infer<typeof Changes>;
  currentState: PackFieldState;
  newDateLabel?: string;
}): StaleReplacement[] {
  const replacements: StaleReplacement[] = [];

  if (changes.preferredLocation !== undefined) {
    const from = currentState.location?.trim();
    const to = changes.preferredLocation.trim();
    if (from && from.length >= 4 && from.toLowerCase() !== "tbc" && from !== to) {
      replacements.push({ from, to });
    }
  }

  if (newDateLabel) {
    const current = splitDateRangeLabel(
      parseDateTimeAnswer(currentState.dateTimeAnswer)?.date,
    );
    for (const variant of oldDateReferenceVariants(current.start, current.end)) {
      if (variant.length >= 4 && variant !== newDateLabel) {
        replacements.push({ from: variant, to: newDateLabel });
      }
    }
  }

  return replacements;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function applyStaleReplacements(
  text: string,
  replacements: StaleReplacement[],
) {
  let output = text;
  for (const { from, to } of replacements) {
    if (!from || from === to) continue;
    // Case-insensitive so Slack-style prose (e.g. a lowercase month "march") is
    // refreshed too. The new value is supplied via a function so a "$" inside it
    // is never treated as a regex replacement back-reference.
    output = output.replace(new RegExp(escapeRegExp(from), "gi"), () => to);
  }
  return output;
}

// Refreshes derived free-text form fields (overview, classification reason) when
// a date/location change left a stale reference. Overview is only rewritten when
// the user did not supply a fresh description; the route is never changed by this
// tool, so a stale date/location reference in the reason can always be refreshed.
function staleFormFieldUpdates({
  changes,
  currentState,
  replacements,
}: {
  changes: z.infer<typeof Changes>;
  currentState: PackFieldState;
  replacements: StaleReplacement[];
}): SheetPatch[] {
  const updates: SheetPatch[] = [];
  if (replacements.length === 0) return updates;

  if (changes.eventDescription === undefined && currentState.overview) {
    const replaced = applyStaleReplacements(currentState.overview, replacements);
    if (replaced !== currentState.overview) {
      updates.push({ field: "Overview of the event", answer: replaced });
    }
  }

  if (currentState.classificationReason) {
    const replaced = applyStaleReplacements(
      currentState.classificationReason,
      replacements,
    );
    if (replaced !== currentState.classificationReason) {
      updates.push({ field: "Classification reason", answer: replaced });
    }
  }

  return updates;
}

function currentFolderDatePrefix(folderName: string | undefined) {
  const match = /^(\d{2}-\d{2}-\d{4})\s+-\s+/.exec(folderName?.trim() ?? "");
  return match?.[1];
}

// New visible base name for the pack folder/files. Keeps the existing start-date
// prefix when only the event name changes, or applies the new start date when
// the event moves.
export function renamedPackBaseName({
  folderName,
  newEventName,
  newStartIsoDate,
}: {
  folderName: string | undefined;
  newEventName: string;
  newStartIsoDate?: string;
}) {
  const safeName =
    newEventName
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "Event";
  const datePrefix = newStartIsoDate
    ? displayDateFromIsoDate(newStartIsoDate) ?? currentFolderDatePrefix(folderName)
    : currentFolderDatePrefix(folderName);

  return datePrefix ? `${datePrefix} - ${safeName}` : safeName;
}

// Renames the pack folder and every generated file at this version so visible
// titles track the new date/name. Drive IDs, parents, appProperties, and the
// Event ID are preserved (rename only changes the title).
async function renamePackFolderAndFiles({
  drive,
  folderId,
  folderName,
  eventId,
  packVersion,
  newEventName,
  newStartIsoDate,
}: {
  drive: drive_v3.Drive;
  folderId: string;
  folderName: string | undefined;
  eventId: string;
  packVersion: number;
  newEventName: string;
  newStartIsoDate?: string;
}) {
  const baseName = renamedPackBaseName({
    folderName,
    newEventName,
    newStartIsoDate,
  });
  const renamed: Array<{ id: string; name: string; documentType: string }> = [];

  if ((folderName ?? "").trim() !== baseName) {
    const folderResult = await renameDriveFile({
      fileId: folderId,
      name: baseName,
      client: drive,
    });
    renamed.push({
      id: folderResult.id,
      name: folderResult.name,
      documentType: "folder",
    });
  }

  const response = await drive.files.list({
    q: [
      "trashed = false",
      `'${escapeDriveQueryValue(folderId)}' in parents`,
      `appProperties has { key='vichitaEventId' and value='${escapeDriveQueryValue(eventId)}' }`,
      `appProperties has { key='vichitaPackVersion' and value='${packVersion}' }`,
    ].join(" and "),
    fields: "files(id,name,appProperties)",
    spaces: "drive",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const files = (response.data.files ?? []) as ExistingFile[];

  for (const file of files) {
    if (!file.id) continue;
    const rawType = file.appProperties?.vichitaDocumentType;
    if (!rawType || !(rawType in PACK_DOCUMENT_LABELS)) continue;

    const desiredName = packDocumentFileName({
      baseName,
      documentType: rawType as PackDocumentType,
      packVersion,
    });
    if ((file.name ?? "").trim() === desiredName) continue;

    const result = await renameDriveFile({
      fileId: file.id,
      name: desiredName,
      client: drive,
    });
    renamed.push({ id: result.id, name: result.name, documentType: rawType });
  }

  return { baseName, renamed };
}

export default defineTool({
  description:
    "Fast-path approval-gated Google Workspace update for existing event-pack corrections. Patch only the supplied changed fields in an existing generated pack without creating a new pack, reclassifying the event, recomputing deadlines, or regenerating unchanged documents. Use immediately for corrections like changed date/time, venue, attendance, organiser details, first-aid plan, form-field answers, or explicit replacement deadline rows. For a multi-day or rescheduled-range event, set changes.proposedDate to the first day and changes.proposedEndDate to the last day (YYYY-MM-DD). Leave packVersion unset to patch the existing pack version; the tool fails and asks for packVersion only if several versions exist. This tool does not recompute deadlines: if a date move shifts the timeline, recompute them with compute_deadlines and pass changes.deadlines. Before this tool, emit only a short proposal, max 3 bullets or 60 words, then call it once and let the approval card handle consent. Do not call classify_event, collect_missing_event_fields, compute_deadlines, prepare_event_identity, or generate_event_pack before this tool unless the user explicitly asked for that extra work. If the user gives an event name but no folder link or Event ID, pass that visible eventName and let the tool find the unique existing pack or fail safely if ambiguous.",
  inputSchema: Input,
  needsApproval: always(),
  async execute(input) {
    if (
      input.changes.proposedDate?.trim() &&
      !isIsoCalendarDate(input.changes.proposedDate)
    ) {
      throw new Error(
        "changes.proposedDate must be a real ISO calendar date in YYYY-MM-DD format. Ask the user to clarify impossible dates before updating the pack.",
      );
    }
    if (
      input.changes.proposedEndDate?.trim() &&
      !isIsoCalendarDate(input.changes.proposedEndDate)
    ) {
      throw new Error(
        "changes.proposedEndDate must be a real ISO calendar date in YYYY-MM-DD format. Ask the user to clarify impossible dates before updating the pack.",
      );
    }
    if (
      input.changes.proposedDate?.trim() &&
      input.changes.proposedEndDate?.trim() &&
      input.changes.proposedEndDate.trim() < input.changes.proposedDate.trim()
    ) {
      throw new Error(
        "changes.proposedEndDate must be on or after changes.proposedDate for a date range.",
      );
    }

    const drive = createDriveClient();
    const sheets = createSheetsClient();
    const packFolderId = input.packFolderId ?? packFolderIdFromLink(input.packFolderLink);
    const folder = await findEventPackFolderForUpdate({
      eventId: input.eventId,
      eventName: input.eventName,
      packFolderId,
      sourceSlackChannelId: input.sourceSlackChannelId,
      sourceSlackThreadTs: input.sourceSlackThreadTs,
      client: drive,
    });
    const eventId =
      input.eventId ?? folder.folder.appProperties?.vichitaEventId ?? undefined;
    if (!eventId) {
      throw new Error(
        "Could not determine the existing Event ID from the folder metadata. Provide eventId explicitly.",
      );
    }

    const warnings: string[] = [];
    const resolvedPackVersion = choosePackVersion(
      input.packVersion,
      await listPackVersions({ drive, folderId: folder.folder.id, eventId }),
    );

    const eventName =
      input.changes.eventName ??
      input.eventName ??
      eventPackFolderDisplayEventName(folder.folder.name ?? "Event");
    const changedFields = changedFieldNames(input.changes);
    const files = {
      riskAssessment: await findEventPackFile({
        drive,
        folderId: folder.folder.id,
        eventId,
        packVersion: resolvedPackVersion,
        documentType: "risk-assessment",
      }),
      fieldPack: await findEventPackFile({
        drive,
        folderId: folder.folder.id,
        eventId,
        packVersion: resolvedPackVersion,
        documentType: "field-pack-sheet",
      }),
      deadlinePlan: await findEventPackFile({
        drive,
        folderId: folder.folder.id,
        eventId,
        packVersion: resolvedPackVersion,
        documentType: "deadline-plan-sheet",
      }),
      internalReviewSummary: await findEventPackFile({
        drive,
        folderId: folder.folder.id,
        eventId,
        packVersion: resolvedPackVersion,
        documentType: "internal-review-summary",
      }),
    };

    const anyPackFileFound = Boolean(
      files.riskAssessment ||
        files.fieldPack ||
        files.deadlinePlan ||
        files.internalReviewSummary,
    );
    if (!anyPackFileFound) {
      // The folder matched but no pack documents exist at this version. Fail
      // loudly instead of silently patching only the tracker (which would
      // leave the tracker and the pack documents inconsistent).
      throw new Error(
        `Found the pack folder "${folder.folder.name ?? eventId}" but no pack documents for ${eventId} at v${resolvedPackVersion}. Confirm the pack version (or omit packVersion to use the latest) before updating; nothing was written.`,
      );
    }

    // Build a merged "current pack state + supplied changes" snapshot from the
    // existing Form Fields sheet so derived text is refreshed, not just direct
    // fields patched.
    let currentState: PackFieldState = {};
    let formSheetAvailable = false;
    if (files.fieldPack?.mimeType === GOOGLE_SHEET_MIME_TYPE) {
      formSheetAvailable = true;
      const formValues = await readSheetValues({
        sheets,
        spreadsheetId: files.fieldPack.id,
        sheetTitle: "Form Fields",
      });
      currentState = readFormFieldState(formValues);
    }

    const dateTimeAnswer = dateTimeAnswerFromChanges({
      changes: input.changes,
      currentAnswer: currentState.dateTimeAnswer,
    });
    if (dateTimeAnswer && !formSheetAvailable) {
      warnings.push(
        "Date/time update could not preserve omitted previous date/time parts because the form field sheet was not found.",
      );
    }

    const dateChanged =
      input.changes.proposedDate !== undefined ||
      input.changes.proposedEndDate !== undefined;
    const newDateLabel = dateChanged
      ? eventDateLabelFromChanges({
          changes: input.changes,
          currentDate: parseDateTimeAnswer(currentState.dateTimeAnswer)?.date,
        })
      : undefined;
    const staleReplacements = buildStaleReplacements({
      changes: input.changes,
      currentState,
      newDateLabel,
    });

    const updates: Record<string, unknown> = {};

    const riskHeaderValues = riskHeaderUpdatesFromChanges({
      changes: input.changes,
      dateTimeAnswer,
    });
    const riskCellUpdates = riskGeneratedCellUpdatesFromChanges({
      eventId,
      eventName,
      changes: input.changes,
    });
    if (files.riskAssessment) {
      if (files.riskAssessment.mimeType !== GOOGLE_DOC_MIME_TYPE) {
        throw new Error("Existing risk assessment is not a native Google Doc.");
      }
      if (Object.keys(riskHeaderValues).length > 0) {
        updates.riskAssessmentHeader = await updateRiskAssessmentHeaderFieldValues({
          documentId: files.riskAssessment.id,
          fieldValues: riskHeaderValues,
        });
      }
      if (riskCellUpdates.length > 0) {
        updates.riskAssessmentRows = await updateGeneratedRiskAssessmentCells({
          documentId: files.riskAssessment.id,
          updates: riskCellUpdates,
        });
      }
    } else if (Object.keys(riskHeaderValues).length > 0 || riskCellUpdates.length > 0) {
      warnings.push("Risk assessment file was not found, so risk fields were not patched.");
    }

    const formUpdates = [
      ...formFieldUpdatesFromChanges({
        changes: input.changes,
        dateTimeAnswer,
      }),
      ...staleFormFieldUpdates({
        changes: input.changes,
        currentState,
        replacements: staleReplacements,
      }),
    ];
    if (files.fieldPack) {
      if (files.fieldPack.mimeType !== GOOGLE_SHEET_MIME_TYPE) {
        throw new Error("Existing form field pack is not a native Google Sheet.");
      }
      updates.fieldPack = await patchFormFieldSheet({
        sheets,
        spreadsheetId: files.fieldPack.id,
        updates: formUpdates,
      });
    } else if (formUpdates.length > 0) {
      warnings.push("Form field pack sheet was not found, so form fields were not patched.");
    }

    if (hasReplacementDeadlines(input.changes)) {
      if (files.deadlinePlan) {
        if (files.deadlinePlan.mimeType !== GOOGLE_SHEET_MIME_TYPE) {
          throw new Error("Existing deadline plan is not a native Google Sheet.");
        }
        const deadlineInput = eventInputForDeadlineRows({
          eventId,
          eventName,
          changes: input.changes,
        });
        updates.deadlinePlan = await fillGeneratedSheetBasic({
          sheets,
          spreadsheetId: files.deadlinePlan.id,
          sheet: buildDeadlinePlanSheet(deadlineInput),
        });
      } else {
        warnings.push("Deadline plan sheet was not found, so deadline rows were not patched.");
      }
    }

    if (files.internalReviewSummary) {
      if (files.internalReviewSummary.mimeType !== GOOGLE_DOC_MIME_TYPE) {
        throw new Error("Existing internal review summary is not a native Google Doc.");
      }
      const currentText = await exportGoogleDriveFileText({
        fileId: files.internalReviewSummary.id,
        driveClient: drive,
      });
      // Refresh stale date/location references in the existing body before
      // appending the log, so the main content is not left pointing at the old
      // date or venue.
      const refreshedText = applyStaleReplacements(currentText, staleReplacements);
      const correctionLines = correctionValueLines({
        changes: input.changes,
        dateTimeAnswer,
      });
      const correctionsBlock =
        correctionLines.length > 0
          ? `\nCorrections in this update:\n${correctionLines.join("\n")}`
          : "";
      const appended = `${refreshedText.trimEnd()}\n\nUpdate Log\n- ${updateLogText({
        changedFields,
        reason: input.updateReason,
        generatedBy: input.generatedBy,
      })}${correctionsBlock}\n`;
      updates.internalReviewSummary = await updateGoogleDocText({
        documentId: files.internalReviewSummary.id,
        text: appended,
      });
    } else {
      warnings.push("Internal review summary was not found, so no update log was appended.");
    }

    if (input.updateTrackers) {
      const trackerPatch = trackerPatchFromChanges({
        changes: input.changes,
        dateTimeAnswer,
        dateLabel: newDateLabel,
      });
      try {
        if (Object.keys(trackerPatch).length > 0) {
          updates.eventsTracker = await patchTrackerRow({
            tabName: "Events Tracker",
            keyColumn: "Event ID",
            keyValue: eventId,
            patch: trackerPatch,
          });
        }
        if (hasReplacementDeadlines(input.changes)) {
          updates.complianceTasks = await upsertTrackerRows({
            tabName: "Compliance Tasks",
            keyColumn: "Task ID",
            rows: buildDeadlineComplianceTaskRows(
              eventInputForDeadlineRows({
                eventId,
                eventName,
                changes: input.changes,
              }),
            ),
            valueInputOption: "RAW",
          });
        }
      } catch (error) {
        warnings.push(
          `Tracker update failed after file patches: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        );
      }

      // Refresh the accessibility venue note when the location changes. Patch
      // only the Notes cell of the venue-access task so existing due dates and
      // other accessibility rows are preserved.
      if (input.changes.preferredLocation !== undefined) {
        try {
          const venueRow = buildAccessibilityComplianceTaskRows({
            eventId,
            eventName,
            organiserName: input.changes.organiserName,
            preferredLocation: input.changes.preferredLocation,
            foodOrRefreshments: input.changes.foodOrRefreshments,
            ticketingPlan: input.changes.ticketingPlan,
            accessibilityContactOrRequestRoute:
              input.changes.accessibilityContactOrRequestRoute,
          }).find((row) => String(row["Task ID"]).endsWith("venue-access"));

          if (venueRow) {
            updates.accessibilityVenueNote = await patchTrackerRow({
              tabName: "Compliance Tasks",
              keyColumn: "Task ID",
              keyValue: String(venueRow["Task ID"]),
              patch: { Notes: venueRow.Notes },
            });
          }
        } catch (error) {
          warnings.push(
            `Accessibility venue note update failed: ${
              error instanceof Error ? error.message : "unknown error"
            }`,
          );
        }
      }
    }

    if (input.changes.estimatedCost !== undefined) {
      warnings.push(
        "Budget sheet line items were not recalculated from a single estimatedCost patch; update detailed budget rows separately if needed.",
      );
    }

    if (
      input.changes.transportPlan !== undefined ||
      input.changes.accommodationPlan !== undefined ||
      input.changes.onSiteOvernightStay !== undefined
    ) {
      warnings.push(
        "Trip/overnight details changed. If this introduces a risk category the existing risk assessment does not already cover (coach transport, overnight accommodation, on-site overnight welfare), regenerate the pack with generate_event_pack (updateExistingDrafts=true) and the full structured inputs to add those rows; this tool patches existing risk rows in place and does not add new ones.",
      );
    }

    if (changesRequireDeadlineRecompute(input.changes)) {
      warnings.push(
        "Event date changed but the deadline plan and Compliance Tasks were not recomputed. If the timeline shifted, run compute_deadlines and pass changes.deadlines (or regenerate the deadline plan).",
      );
    }

    // Rename the folder and generated files so visible titles track the new
    // date/name. Drive IDs, appProperties, and the Event ID are preserved.
    if (
      input.changes.eventName !== undefined ||
      input.changes.proposedDate !== undefined
    ) {
      try {
        const rename = await renamePackFolderAndFiles({
          drive,
          folderId: folder.folder.id,
          folderName: folder.folder.name ?? undefined,
          eventId,
          packVersion: resolvedPackVersion,
          newEventName: eventName,
          newStartIsoDate: input.changes.proposedDate,
        });
        updates.rename = rename;
        folder.folder.name = rename.baseName;
      } catch (error) {
        warnings.push(
          `Pack folder/file rename failed (content patches still applied): ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        );
      }
    }

    return {
      eventId,
      packId: `${eventId}-PACK-v${resolvedPackVersion}`,
      packVersion: resolvedPackVersion,
      folder,
      changedFields,
      files,
      updates,
      warnings,
      disclaimer:
        "Draft aid only. Check current SU guidance and live forms before submission.",
    };
  },
  toModelOutput(output) {
    return {
      type: "json",
      value: {
        eventId: output.eventId,
        packId: output.packId,
        folder: output.folder.folder,
        matchedBy: output.folder.matchedBy,
        changedFields: output.changedFields,
        updates: output.updates,
        warnings: output.warnings,
        disclaimer: output.disclaimer,
      },
    };
  },
});
