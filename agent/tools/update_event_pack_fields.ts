import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import type { drive_v3, sheets_v4 } from "googleapis";
import { z } from "zod";

import { displayDateFromIsoDate, isIsoCalendarDate } from "../lib/dateLabels.js";
import {
  buildDeadlineComplianceTaskRows,
  buildDeadlinePlanSheet,
  buildRiskRows,
  type DeadlinePlanItem,
  type EventPackInput,
  type GeneratedSheet,
} from "../lib/eventPack.js";
import { createDriveClient, createSheetsClient } from "../lib/googleWorkspace/client.js";
import {
  exportGoogleDriveFileText,
  updateGoogleDocText,
} from "../lib/googleWorkspace/docs.js";
import {
  eventPackFolderDisplayEventName,
  findEventPackFolderForUpdate,
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
    packVersion: z.number().int().positive().default(1),
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

function parseDateTimeAnswer(value: string | undefined) {
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

function dateTimeAnswerFromChanges({
  changes,
  currentAnswer,
}: {
  changes: z.infer<typeof Changes>;
  currentAnswer?: string;
}) {
  const hasDateTimeChange = Boolean(
    changes.proposedDate !== undefined ||
      changes.setupStartTime !== undefined ||
      changes.eventStartTime !== undefined ||
      changes.eventEndTime !== undefined,
  );
  if (!hasDateTimeChange) return undefined;

  const current = parseDateTimeAnswer(currentAnswer);
  const date = changes.proposedDate
    ? displayDate(changes.proposedDate)
    : current?.date ?? "TBC";
  const setup = changes.setupStartTime ?? current?.setupStartTime ?? "TBC";
  const start = changes.eventStartTime ?? current?.eventStartTime ?? "TBC";
  const end = changes.eventEndTime ?? current?.eventEndTime ?? "TBC";

  return `${date}, setup ${setup}, event ${start}-${end}`;
}

function changedFieldNames(changes: z.infer<typeof Changes>) {
  return Object.entries(changes)
    .filter(([, value]) => value !== undefined)
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

function formFieldUpdatesFromChanges({
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
}: {
  changes: z.infer<typeof Changes>;
  dateTimeAnswer?: string;
}) {
  const patch: Record<string, string | number | boolean | undefined> = {
    "Event Name": changes.eventName,
    Date: changes.proposedDate ? displayDate(changes.proposedDate) : undefined,
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
  const parts = [
    `${new Date().toISOString()}: Updated ${changedFields.join(", ")}.`,
  ];
  if (reason?.trim()) parts.push(`Reason: ${reason.trim()}.`);
  if (generatedBy?.trim()) parts.push(`Updated by: ${generatedBy.trim()}.`);
  return parts.join(" ");
}

export default defineTool({
  description:
    "Approval-gated Google Workspace update. Patch known fields in an existing generated event pack without creating a new pack or regenerating unchanged documents. Use for corrections like changed venue, attendance, organiser details, first-aid plan, form-field answers, or explicit replacement deadline rows. Before this tool, emit only a short proposal, max 6 bullets or 120 words, then call it once and let the approval card handle consent. Do not generate a long staged summary, separate proceed question, or repeated approval calls in the same run. If the user gives an event name but no folder link or Event ID, pass that visible eventName and let the tool find the unique existing pack or fail safely if ambiguous.",
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

    const eventName =
      input.changes.eventName ??
      input.eventName ??
      eventPackFolderDisplayEventName(folder.folder.name ?? "Event");
    const changedFields = changedFieldNames(input.changes);
    const warnings: string[] = [];
    const files = {
      riskAssessment: await findEventPackFile({
        drive,
        folderId: folder.folder.id,
        eventId,
        packVersion: input.packVersion,
        documentType: "risk-assessment",
      }),
      fieldPack: await findEventPackFile({
        drive,
        folderId: folder.folder.id,
        eventId,
        packVersion: input.packVersion,
        documentType: "field-pack-sheet",
      }),
      deadlinePlan: await findEventPackFile({
        drive,
        folderId: folder.folder.id,
        eventId,
        packVersion: input.packVersion,
        documentType: "deadline-plan-sheet",
      }),
      internalReviewSummary: await findEventPackFile({
        drive,
        folderId: folder.folder.id,
        eventId,
        packVersion: input.packVersion,
        documentType: "internal-review-summary",
      }),
    };

    let dateTimeAnswer: string | undefined;
    if (files.fieldPack?.mimeType === GOOGLE_SHEET_MIME_TYPE) {
      const formValues = await readSheetValues({
        sheets,
        spreadsheetId: files.fieldPack.id,
        sheetTitle: "Form Fields",
      });
      dateTimeAnswer = dateTimeAnswerFromChanges({
        changes: input.changes,
        currentAnswer: currentAnswerForField(
          formValues,
          "Date and time of activity, including setup time",
        ),
      });
    } else {
      dateTimeAnswer = dateTimeAnswerFromChanges({ changes: input.changes });
      if (dateTimeAnswer) {
        warnings.push(
          "Date/time update could not preserve omitted previous date/time parts because the form field sheet was not found.",
        );
      }
    }

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

    const formUpdates = formFieldUpdatesFromChanges({
      changes: input.changes,
      dateTimeAnswer,
    });
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

    if (input.changes.deadlines !== undefined) {
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
      const appended = `${currentText.trimEnd()}\n\nUpdate Log\n- ${updateLogText({
        changedFields,
        reason: input.updateReason,
        generatedBy: input.generatedBy,
      })}\n`;
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
        if (input.changes.deadlines !== undefined) {
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
    }

    if (input.changes.estimatedCost !== undefined) {
      warnings.push(
        "Budget sheet line items were not recalculated from a single estimatedCost patch; update detailed budget rows separately if needed.",
      );
    }

    return {
      eventId,
      packId: `${eventId}-PACK-v${input.packVersion}`,
      packVersion: input.packVersion,
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
