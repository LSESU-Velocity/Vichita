import { defineTool } from "eve/tools";
import type { sheets_v4 } from "googleapis";
import { always } from "eve/tools/approval";
import { z } from "zod";

import { buildPackId, parseEventId } from "../lib/eventIdentity.js";
import { isIsoCalendarDate } from "../lib/dateLabels.js";
import {
  buildAccessibilityComplianceTaskRows,
  buildBudgetSheetUpdates,
  buildDeadlineComplianceTaskRows,
  buildDeadlinePlanSheet,
  buildEventTrackerRow,
  buildFormFieldPackSheet,
  buildInternalReviewSummaryBody,
  buildPackIndexRow,
  buildRiskAssessmentScalarReplacements,
  plainGoogleDocText,
  budgetRequirement,
  documentBaseName,
  type EventPackFileLinks,
  type GeneratedSheet,
} from "../lib/eventPack.js";
import { createDriveClient, createSheetsClient } from "../lib/googleWorkspace/client.js";
import {
  copyDriveFileToFolder,
  createGoogleDocWithText,
  createGoogleSheetFile,
  replaceGoogleDocText,
  updateGoogleDocText,
} from "../lib/googleWorkspace/docs.js";
import {
  fillRiskAssessmentTables,
  updateRiskAssessmentHeaderFields,
  verifyRiskAssessmentText,
} from "../lib/googleWorkspace/riskAssessmentDoc.js";
import { createOrFindEventPackFolder } from "../lib/googleWorkspace/drive.js";
import { readGoogleWorkspaceConfig } from "../lib/googleWorkspace/config.js";
import {
  checkTrackerSpreadsheet,
  upsertTrackerRow,
  upsertTrackerRows,
} from "../lib/googleWorkspace/sheets.js";

const GOOGLE_DOC_MIME_TYPE = "application/vnd.google-apps.document";
const GOOGLE_SHEET_MIME_TYPE = "application/vnd.google-apps.spreadsheet";

const Route = z.enum([
  "regular_event_candidate",
  "large_event",
  "speaker_event",
  "large_speaker_event",
  "trip_process",
  "needs_human_review",
]);

const Speaker = z.object({
  name: z.string().optional(),
  role: z.string().optional(),
  organisation: z.string().optional(),
  topic: z.string().optional(),
});

const BudgetLineItem = z.object({
  description: z.string().min(1),
  pricePerItem: z.number().nonnegative(),
  quantity: z.number().nonnegative(),
  notes: z.string().optional(),
});

const BudgetIncomeLine = z.object({
  pricePerItem: z.number().nonnegative(),
  quantity: z.number().nonnegative(),
  notes: z.string().optional(),
});

const Budget = z.object({
  expenses: z.array(BudgetLineItem).max(10).default([]),
  income: z
    .object({
      memberTicket: BudgetIncomeLine.optional(),
      nonMemberTicket: BudgetIncomeLine.optional(),
      nonLseTicket: BudgetIncomeLine.optional(),
      sponsorship: BudgetIncomeLine.optional(),
      societyAccountContribution: BudgetIncomeLine.optional(),
      sufRequested: BudgetIncomeLine.optional(),
      otherIncome: BudgetIncomeLine.optional(),
    })
    .default({}),
});

const DeadlinePlanItem = z.object({
  task: z.string().min(1),
  dueDate: z.string().optional(),
  deadlineType: z.string().optional(),
  sourceRule: z.string().optional(),
  blocksFinalSubmissionReadiness: z.boolean().optional(),
  notes: z.array(z.string()).default([]),
});

const Input = z.object({
  eventId: z.string().min(1),
  eventName: z.string().min(1),
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
  isRepeatedEvent: z.boolean().optional(),
  repeatedEventDates: z.string().optional(),
  accessibilityPlan: z.string().optional(),
  accessibilityContactOrRequestRoute: z.string().optional(),
  externalSpeakers: z.array(Speaker).default([]),
  academicChairStatus: z.string().optional(),
  academicChairNameEmail: z.string().optional(),
  externalOrganisationInvolved: z.boolean().optional(),
  externalOrganisationName: z.string().optional(),
  sponsorInvolved: z.boolean().optional(),
  sponsorName: z.string().optional(),
  estimatedCost: z.number().nonnegative().optional(),
  societyBalanceEstimate: z.number().nonnegative().optional(),
  foodOrRefreshments: z.boolean().optional(),
  alcohol: z.boolean().optional(),
  publicOrNonLseAttendees: z.boolean().optional(),
  under18sOrVulnerableAdults: z.boolean().optional(),
  filmScreening: z.boolean().optional(),
  tripBeyondM25: z.boolean().optional(),
  overnightTrip: z.boolean().optional(),
  externalVenue: z.boolean().optional(),
  classificationRoute: Route.optional(),
  classificationReason: z.string().optional(),
  triggers: z.array(z.string()).default([]),
  missingCriticalFields: z.array(z.string()).default([]),
  blocksFinalSubmissionReadiness: z.array(z.string()).default([]),
  ticketingPlan: z.string().optional(),
  attendeeRegistrationEntryPlan: z.string().optional(),
  publicEventAcademicChairNote: z.string().optional(),
  sufStatus: z.string().optional(),
  contractsAttachedStatus: z.string().optional(),
  tripType: z.string().optional(),
  transportPlan: z.string().optional(),
  accommodationPlan: z.string().optional(),
  societyLedExplanation: z.string().optional(),
  highRiskOrHighProfileSpeaker: z.boolean().optional(),
  budget: Budget.optional(),
  deadlines: z.array(DeadlinePlanItem).default([]),
  includeBudget: z.enum(["auto", "always", "never"]).default("auto"),
  packFolderId: z
    .string()
    .optional()
    .describe("Existing Google Drive event pack folder ID. If omitted, the tool creates or finds the folder from Event ID."),
  packFolderLink: z.string().url().optional(),
  sourceSlackChannelId: z.string().optional(),
  sourceSlackThreadTs: z.string().optional(),
  createEventPacksParentIfMissing: z.boolean().default(false),
  packVersion: z.number().int().positive().default(1),
  updateExistingDrafts: z
    .boolean()
    .default(true)
    .describe("When same-version draft files already exist, read and update those files in place instead of creating a new packVersion."),
  generatedBy: z.string().optional(),
  rulesLastVerifiedDate: z.string().optional(),
  rulesSourceSetId: z.string().optional(),
  updateTrackers: z.boolean().default(true),
});

type ExistingFile = {
  id?: string | null;
  name?: string | null;
  mimeType?: string | null;
  webViewLink?: string | null;
  appProperties?: Record<string, string> | null;
};

type DriveFileOutput = Awaited<ReturnType<typeof copyDriveFileToFolder>>;

function driveFolderUrl(folderId: string) {
  return `https://drive.google.com/drive/folders/${folderId}`;
}

function escapeDriveQueryValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function documentAppProperties({
  eventId,
  packId,
  packVersion,
  documentType,
}: {
  eventId: string;
  packId: string;
  packVersion: number;
  documentType: string;
}) {
  return {
    vichitaKind: "event-pack-document",
    vichitaEventId: eventId,
    vichitaPackId: packId,
    vichitaPackVersion: String(packVersion),
    vichitaDocumentType: documentType,
  };
}
function existingFileOutput(file: ExistingFile): DriveFileOutput {
  if (!file.id) throw new Error("Google Drive returned a file without an id.");

  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    webViewLink: file.webViewLink ?? `https://drive.google.com/file/d/${file.id}/view`,
    appProperties: file.appProperties,
  };
}

async function validateProvidedPackFolder(folderId: string) {
  const drive = createDriveClient();
  const response = await drive.files.get({
    fileId: folderId,
    fields: "id,name,mimeType,trashed,webViewLink,capabilities(canAddChildren,canEdit)",
    supportsAllDrives: true,
  });
  const file = response.data;

  if (file.mimeType !== "application/vnd.google-apps.folder") {
    throw new Error("packFolderId does not point to a Google Drive folder.");
  }
  if (file.trashed) {
    throw new Error("packFolderId points to a trashed folder.");
  }
  if (file.capabilities?.canAddChildren !== true) {
    throw new Error(
      "The service account cannot add files to the provided packFolderId.",
    );
  }

  return {
    id: file.id ?? folderId,
    name: file.name,
    webViewLink: file.webViewLink ?? driveFolderUrl(folderId),
  };
}

async function assertTrackersReadyForPackWrites() {
  const status = await checkTrackerSpreadsheet();
  if (!status.ok) {
    throw new Error(
      `Vichita Trackers are not ready. Run ensure_google_tracker_tabs before generating packs. Missing tabs: ${status.missingTabs.join(", ") || "none"}; missing headers: ${status.tabsWithMissingHeaders.join(", ") || "none"}; header differences: ${status.tabsWithHeaderDifferences.join(", ") || "none"}.`,
    );
  }
}

async function findExistingDraftFile({
  folderId,
  eventId,
  packVersion,
  documentType,
}: {
  folderId: string;
  eventId: string;
  packVersion: number;
  documentType: string;
}) {
  const drive = createDriveClient();
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
  const existing = (response.data.files ?? []) as ExistingFile[];

  if (existing.length > 1) {
    const names = existing
      .map((file) => `${file.name ?? "unnamed"} (${file.webViewLink ?? file.id ?? "no link"})`)
      .join("; ");
    throw new Error(
      `Multiple ${documentType} drafts exist for ${eventId} v${packVersion}: ${names}. Resolve duplicates manually before generating again.`,
    );
  }

  return existing[0] ? existingFileOutput(existing[0]) : undefined;
}

async function copyDriveFileToFolderOrReuse({
  sourceFileId,
  parentFolderId,
  name,
  appProperties,
  documentType,
  reusedFiles,
  updateExistingDrafts,
}: {
  sourceFileId: string;
  parentFolderId: string;
  name: string;
  appProperties: Record<string, string>;
  documentType: string;
  reusedFiles: string[];
  updateExistingDrafts: boolean;
}) {
  const existing = await findExistingDraftFile({
    folderId: parentFolderId,
    eventId: appProperties.vichitaEventId,
    packVersion: Number(appProperties.vichitaPackVersion),
    documentType,
  });

  if (existing) {
    if (!updateExistingDrafts) {
      throw new Error(
        `A ${documentType} draft already exists for ${appProperties.vichitaEventId} v${appProperties.vichitaPackVersion}: ${existing.webViewLink}. Set updateExistingDrafts=true to update the existing pack in place, or bump packVersion to create a separate snapshot.`,
      );
    }

    reusedFiles.push(documentType);
    return existing;
  }

  return copyDriveFileToFolder({
    sourceFileId,
    parentFolderId,
    name,
    appProperties,
  });
}

async function createGoogleDocWithTextOrReuse({
  parentFolderId,
  name,
  text,
  appProperties,
  documentType,
  reusedFiles,
  updateExistingDrafts,
}: {
  parentFolderId: string;
  name: string;
  text: string;
  appProperties: Record<string, string>;
  documentType: string;
  reusedFiles: string[];
  updateExistingDrafts: boolean;
}) {
  const docText = plainGoogleDocText(text);
  const existing = await findExistingDraftFile({
    folderId: parentFolderId,
    eventId: appProperties.vichitaEventId,
    packVersion: Number(appProperties.vichitaPackVersion),
    documentType,
  });

  if (existing) {
    if (!updateExistingDrafts) {
      throw new Error(
        `A ${documentType} draft already exists for ${appProperties.vichitaEventId} v${appProperties.vichitaPackVersion}: ${existing.webViewLink}. Set updateExistingDrafts=true to update the existing pack in place, or bump packVersion to create a separate snapshot.`,
      );
    }

    if (existing.mimeType !== GOOGLE_DOC_MIME_TYPE) {
      throw new Error(
        `Existing ${documentType} draft is not a native Google Doc and cannot be updated in place: ${existing.webViewLink}.`,
      );
    }

    await updateGoogleDocText({ documentId: existing.id, text: docText });
    reusedFiles.push(documentType);
    return existing;
  }

  return createGoogleDocWithText({
    parentFolderId,
    name,
    text: docText,
    appProperties,
  });
}
async function createGoogleSheetOrReuse({
  parentFolderId,
  name,
  appProperties,
  documentType,
  reusedFiles,
  updateExistingDrafts,
}: {
  parentFolderId: string;
  name: string;
  appProperties: Record<string, string>;
  documentType: string;
  reusedFiles: string[];
  updateExistingDrafts: boolean;
}) {
  const existing = await findExistingDraftFile({
    folderId: parentFolderId,
    eventId: appProperties.vichitaEventId,
    packVersion: Number(appProperties.vichitaPackVersion),
    documentType,
  });

  if (existing) {
    if (!updateExistingDrafts) {
      throw new Error(
        `A ${documentType} draft already exists for ${appProperties.vichitaEventId} v${appProperties.vichitaPackVersion}: ${existing.webViewLink}. Set updateExistingDrafts=true to update the existing pack in place, or bump packVersion to create a separate snapshot.`,
      );
    }

    if (existing.mimeType !== GOOGLE_SHEET_MIME_TYPE) {
      throw new Error(
        `Existing ${documentType} draft is not a native Google Sheet and cannot be updated in place: ${existing.webViewLink}.`,
      );
    }

    reusedFiles.push(documentType);
    return existing;
  }

  return createGoogleSheetFile({
    parentFolderId,
    name,
    appProperties,
  });
}

function quoteSheetTitle(title: string) {
  return `'${title.replace(/'/g, "''")}'`;
}

async function ensureSheetTab({
  spreadsheetId,
  title,
  sheets,
}: {
  spreadsheetId: string;
  title: string;
  sheets: sheets_v4.Sheets;
}) {
  const metadata = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(sheetId,title,index))",
  });
  const sheetProperties = metadata.data.sheets
    ?.map((sheet) => sheet.properties)
    .filter((properties): properties is sheets_v4.Schema$SheetProperties =>
      Boolean(properties?.sheetId !== undefined && properties?.title),
    ) ?? [];
  const existing = sheetProperties.find((properties) => properties.title === title);
  if (typeof existing?.sheetId === "number") return existing.sheetId;

  const first = sheetProperties[0];
  if (sheetProperties.length <= 1 && typeof first?.sheetId === "number") {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            updateSheetProperties: {
              properties: { sheetId: first.sheetId, title },
              fields: "title",
            },
          },
        ],
      },
    });
    return first.sheetId;
  }

  const response = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: { title },
          },
        },
      ],
    },
  });
  const sheetId = response.data.replies?.[0]?.addSheet?.properties?.sheetId;
  if (typeof sheetId !== "number") {
    throw new Error(`Google Sheets did not return a sheetId for ${title}.`);
  }

  return sheetId;
}

async function fillGeneratedSheet(spreadsheetId: string, sheet: GeneratedSheet) {
  const sheets = createSheetsClient();
  const sheetId = await ensureSheetTab({
    spreadsheetId,
    title: sheet.sheetTitle,
    sheets,
  });
  const values = sheet.values;
  const columnCount = Math.max(...values.map((row) => row.length), 1);
  const rowCount = Math.max(values.length, 1);

  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${quoteSheetTitle(sheet.sheetTitle)}!A:Z`,
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${quoteSheetTitle(sheet.sheetTitle)}!A1`,
    valueInputOption: "RAW",
    requestBody: { values },
  });

  const requests: sheets_v4.Schema$Request[] = [
    {
      updateSheetProperties: {
        properties: {
          sheetId,
          gridProperties: {
            frozenRowCount: sheet.frozenRowCount ?? 1,
            rowCount: Math.max(rowCount + 25, 100),
            columnCount: Math.max(columnCount, 12),
          },
        },
        fields: "gridProperties.frozenRowCount,gridProperties.rowCount,gridProperties.columnCount",
      },
    },
    {
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: 0,
          endRowIndex: 1,
          startColumnIndex: 0,
          endColumnIndex: columnCount,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.9, green: 0.93, blue: 0.97 },
            textFormat: { bold: true },
            wrapStrategy: "WRAP",
          },
        },
        fields: "userEnteredFormat(backgroundColor,textFormat,wrapStrategy)",
      },
    },
    {
      setBasicFilter: {
        filter: {
          range: {
            sheetId,
            startRowIndex: 0,
            endRowIndex: rowCount,
            startColumnIndex: 0,
            endColumnIndex: columnCount,
          },
        },
      },
    },
  ];

  for (const [index, width] of (sheet.columnWidths ?? []).entries()) {
    requests.push({
      updateDimensionProperties: {
        range: {
          sheetId,
          dimension: "COLUMNS",
          startIndex: index,
          endIndex: index + 1,
        },
        properties: { pixelSize: width },
        fields: "pixelSize",
      },
    });
  }

  for (const column of sheet.checkboxColumns ?? []) {
    requests.push({
      setDataValidation: {
        range: {
          sheetId,
          startRowIndex: 1,
          endRowIndex: rowCount,
          startColumnIndex: column - 1,
          endColumnIndex: column,
        },
        rule: {
          condition: { type: "BOOLEAN" },
          strict: true,
          showCustomUi: true,
        },
      },
    });
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests },
  });
}

async function fillBudgetSheet(spreadsheetId: string, input: z.infer<typeof Input>) {
  const sheets = createSheetsClient();
  const updates = buildBudgetSheetUpdates(input);
  const byInputOption = new Map<"RAW" | "USER_ENTERED", typeof updates>();

  for (const update of updates) {
    const existing = byInputOption.get(update.valueInputOption) ?? [];
    existing.push(update);
    byInputOption.set(update.valueInputOption, existing);
  }

  for (const [valueInputOption, data] of byInputOption) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption,
        data: data.map(({ range, values }) => ({ range, values })),
      },
    });
  }
}

type PackTraceLogger = (
  step: string,
  status: "start" | "done" | "failed",
  details?: Record<string, unknown>,
) => void;

function googleWriteTraceLogger({
  eventId,
  packId,
  packVersion,
}: {
  eventId: string;
  packId: string;
  packVersion: number;
}): PackTraceLogger {
  return (step, status, details = {}) => {
    try {
      console.info("[vichita] generate_event_pack.google", {
        eventId,
        packId,
        packVersion,
        step,
        status,
        ...details,
      });
    } catch {
      // Diagnostic logging must not affect pack generation.
    }
  };
}

async function tracePackOperation<T>(
  trace: PackTraceLogger,
  step: string,
  operation: () => Promise<T>,
): Promise<T> {
  trace(step, "start");
  try {
    const result = await operation();
    trace(step, "done");
    return result;
  } catch (error) {
    trace(step, "failed", {
      errorType: error instanceof Error ? error.name : typeof error,
    });
    throw error;
  }
}

export default defineTool({
  description:
    "Approval-gated Google Workspace write. Generate a draft event pack for an Event ID: fill the tagged risk-assessment Google Doc template, copy/fill the budget Google Sheet when required or requested, create form-field and deadline Google Sheets, create the internal review Google Doc, and upsert tracker/task links. Before this tool, emit only a short proposal, max 6 bullets or 120 words, then call it once and let the approval card handle consent. Do not generate a long staged summary, full deadline list, separate proceed question, or repeated approval calls in the same run. Humans still review and submit all SU forms manually.",
  inputSchema: Input,
  needsApproval: always(),
  async execute(input) {
    if (!parseEventId(input.eventId)) {
      throw new Error("eventId must use EVT-YYYYMMDD-event-slug-shortid format with a real calendar date.");
    }
    if (input.proposedDate?.trim() && !isIsoCalendarDate(input.proposedDate)) {
      throw new Error(
        "proposedDate must be a real ISO calendar date in YYYY-MM-DD format. Ask the user to clarify impossible dates before generating a pack.",
      );
    }

    const config = readGoogleWorkspaceConfig();
    if (!config.riskAssessmentTemplateFileId) {
      throw new Error(
        "GOOGLE_TEMPLATE_RISK_ASSESSMENT_FILE_ID is required before generating event packs.",
      );
    }
    const riskAssessmentTemplateFileId = config.riskAssessmentTemplateFileId;

    const packId = buildPackId(input.eventId, input.packVersion);
    const traceGoogleWrite = googleWriteTraceLogger({
      eventId: input.eventId,
      packId,
      packVersion: input.packVersion,
    });
    const baseName = documentBaseName(input);
    const budgetDecision = budgetRequirement(input, input.includeBudget);
    const reusedFiles: string[] = [];

    if (budgetDecision.shouldGenerateBudget && !config.budgetTemplateFileId) {
      throw new Error(
        "GOOGLE_TEMPLATE_BUDGET_FILE_ID is required because this event needs or requested a budget sheet.",
      );
    }

    if (input.updateTrackers) {
      await tracePackOperation(traceGoogleWrite, "trackers.preflight", () =>
        assertTrackersReadyForPackWrites(),
      );
    }

    const folder = input.packFolderId
      ? await tracePackOperation(traceGoogleWrite, "folder.validateProvided", async () => ({
          action: "provided" as const,
          folder: await validateProvidedPackFolder(input.packFolderId!),
        }))
      : await tracePackOperation(traceGoogleWrite, "folder.createOrFind", () =>
          createOrFindEventPackFolder({
            eventId: input.eventId,
            eventName: input.eventName,
            proposedDate: input.proposedDate,
            createEventPacksParentIfMissing: input.createEventPacksParentIfMissing,
            sourceSlackChannelId: input.sourceSlackChannelId,
            sourceSlackThreadTs: input.sourceSlackThreadTs,
          }),
        );
    const folderId = folder.folder.id;

    const riskAssessment = await tracePackOperation(
      traceGoogleWrite,
      "riskAssessment.copyOrReuse",
      () =>
        copyDriveFileToFolderOrReuse({
          sourceFileId: riskAssessmentTemplateFileId,
          parentFolderId: folderId,
          name: `${baseName} - Risk Assessment v${input.packVersion}`,
          documentType: "risk-assessment",
          reusedFiles,
          updateExistingDrafts: input.updateExistingDrafts,
          appProperties: documentAppProperties({
            eventId: input.eventId,
            packId,
            packVersion: input.packVersion,
            documentType: "risk-assessment",
          }),
        }),
    );

    if (riskAssessment.mimeType !== GOOGLE_DOC_MIME_TYPE) {
      throw new Error(
        "The risk-assessment template copy is not a native Google Doc. Convert the tagged template to Google Docs before runtime filling.",
      );
    }

    const riskAssessmentTableFill = await tracePackOperation(
      traceGoogleWrite,
      "riskAssessment.fillTables",
      () =>
        fillRiskAssessmentTables({
          documentId: riskAssessment.id,
          input,
          allowAlreadyFilled:
            input.updateExistingDrafts && reusedFiles.includes("risk-assessment"),
        }),
    );

    const riskAssessmentHeaderUpdate = await tracePackOperation(
      traceGoogleWrite,
      "riskAssessment.updateHeader",
      () =>
        updateRiskAssessmentHeaderFields({
          documentId: riskAssessment.id,
          input,
        }),
    );

    const riskAssessmentScalarReplacements = buildRiskAssessmentScalarReplacements(input);
    await tracePackOperation(traceGoogleWrite, "riskAssessment.replacePlaceholders", () =>
      replaceGoogleDocText({
        documentId: riskAssessment.id,
        replacements: {
          "{{placeholders}}": riskAssessmentScalarReplacements["{{placeholders}}"],
        },
      }),
    );

    const riskAssessmentTextQa = await tracePackOperation(
      traceGoogleWrite,
      "riskAssessment.verifyText",
      () =>
        verifyRiskAssessmentText({
          documentId: riskAssessment.id,
          input,
        }),
    );

    let budget:
      | Awaited<ReturnType<typeof copyDriveFileToFolder>>
      | undefined;
    if (budgetDecision.shouldGenerateBudget) {
      budget = await tracePackOperation(traceGoogleWrite, "budget.copyOrReuse", () =>
        copyDriveFileToFolderOrReuse({
          sourceFileId: config.budgetTemplateFileId!,
          parentFolderId: folderId,
          name: `${baseName} - Budget v${input.packVersion}`,
          documentType: "budget",
          reusedFiles,
          updateExistingDrafts: input.updateExistingDrafts,
          appProperties: documentAppProperties({
            eventId: input.eventId,
            packId,
            packVersion: input.packVersion,
            documentType: "budget",
          }),
        }),
      );

      if (budget.mimeType !== GOOGLE_SHEET_MIME_TYPE) {
        throw new Error(
          "The budget template copy is not a native Google Sheet. Convert the tagged template to Google Sheets before runtime filling.",
        );
      }

      await tracePackOperation(traceGoogleWrite, "budget.fillSheet", () =>
        fillBudgetSheet(budget!.id, input),
      );
    }

    const firstLinks: EventPackFileLinks = {
      packFolderLink: folder.folder.webViewLink,
      riskAssessmentLink: riskAssessment.webViewLink,
      budgetLink: budget?.webViewLink,
    };

    const deadlinePlan = await tracePackOperation(
      traceGoogleWrite,
      "deadlinePlan.createOrReuse",
      () =>
        createGoogleSheetOrReuse({
          parentFolderId: folderId,
          name: `${baseName} - Deadline Plan v${input.packVersion}`,
          documentType: "deadline-plan-sheet",
          reusedFiles,
          updateExistingDrafts: input.updateExistingDrafts,
          appProperties: documentAppProperties({
            eventId: input.eventId,
            packId,
            packVersion: input.packVersion,
            documentType: "deadline-plan-sheet",
          }),
        }),
    );
    await tracePackOperation(traceGoogleWrite, "deadlinePlan.fillSheet", () =>
      fillGeneratedSheet(deadlinePlan.id, buildDeadlinePlanSheet(input)),
    );

    const deadlineTaskRows = buildDeadlineComplianceTaskRows(input);
    const accessibilityTaskRows = buildAccessibilityComplianceTaskRows(input);
    const complianceTaskRows = [...deadlineTaskRows, ...accessibilityTaskRows];
    const accessibilityTasksStatus = input.updateTrackers
      ? `Tracked in Compliance Tasks (${accessibilityTaskRows.length} rows).`
      : "Not written because tracker updates were disabled.";

    const fieldPackLinks: EventPackFileLinks = {
      ...firstLinks,
      deadlinePlanLink: deadlinePlan.webViewLink,
      accessibilityTasksStatus,
    };
    const fieldPack = await tracePackOperation(
      traceGoogleWrite,
      "fieldPack.createOrReuse",
      () =>
        createGoogleSheetOrReuse({
          parentFolderId: folderId,
          name: `${baseName} - LSESU Form Field Pack v${input.packVersion}`,
          documentType: "field-pack-sheet",
          reusedFiles,
          updateExistingDrafts: input.updateExistingDrafts,
          appProperties: documentAppProperties({
            eventId: input.eventId,
            packId,
            packVersion: input.packVersion,
            documentType: "field-pack-sheet",
          }),
        }),
    );

    const summaryLinks: EventPackFileLinks = {
      ...fieldPackLinks,
      fieldPackLink: fieldPack.webViewLink,
    };
    const internalReviewSummary = await tracePackOperation(
      traceGoogleWrite,
      "internalReviewSummary.createOrReuse",
      () =>
        createGoogleDocWithTextOrReuse({
          parentFolderId: folderId,
          name: `${baseName} - Internal Review Summary v${input.packVersion}`,
          text: buildInternalReviewSummaryBody(input, summaryLinks, budgetDecision),
          documentType: "internal-review-summary",
          reusedFiles,
          updateExistingDrafts: input.updateExistingDrafts,
          appProperties: documentAppProperties({
            eventId: input.eventId,
            packId,
            packVersion: input.packVersion,
            documentType: "internal-review-summary",
          }),
        }),
    );

    const links: EventPackFileLinks = {
      ...summaryLinks,
      internalReviewSummaryLink: internalReviewSummary.webViewLink,
    };
    await tracePackOperation(traceGoogleWrite, "fieldPack.fillSheet", () =>
      fillGeneratedSheet(fieldPack.id, buildFormFieldPackSheet(input, links)),
    );

    const trackerUpdates: unknown[] = [];

    if (input.updateTrackers) {
      trackerUpdates.push(
        await tracePackOperation(traceGoogleWrite, "tracker.eventPacksIndex.upsert", () =>
          upsertTrackerRow({
            tabName: "Event Packs Index",
            keyColumn: "Pack ID",
            keyValue: packId,
            row: buildPackIndexRow(input, links),
            valueInputOption: "RAW",
          }),
        ),
      );
      trackerUpdates.push(
        await tracePackOperation(traceGoogleWrite, "tracker.eventsTracker.upsert", () =>
          upsertTrackerRow({
            tabName: "Events Tracker",
            keyColumn: "Event ID",
            keyValue: input.eventId,
            row: buildEventTrackerRow(input, links),
            valueInputOption: "RAW",
          }),
        ),
      );

      trackerUpdates.push(
        await tracePackOperation(traceGoogleWrite, "tracker.complianceTasks.upsert", () =>
          upsertTrackerRows({
            tabName: "Compliance Tasks",
            keyColumn: "Task ID",
            rows: complianceTaskRows,
            valueInputOption: "RAW",
          }),
        ),
      );
    }
    return {
      eventId: input.eventId,
      packId,
      packVersion: input.packVersion,
      folder,
      files: {
        riskAssessment,
        budget,
        fieldPack,
        deadlinePlan,
        internalReviewSummary,
      },
      budgetDecision,
      riskAssessmentTableFill,
      riskAssessmentHeaderUpdate,
      riskAssessmentTextQa,
      deadlineTasks: { rows: deadlineTaskRows.length },
      accessibilityTasks: {
        status: accessibilityTasksStatus,
        rows: accessibilityTaskRows.length,
      },
      reusedFiles,
      trackerUpdates,
      disclaimer:
        "Draft aid only. LSESU's current published guidance and the live form/template are authoritative. This was generated for internal Velocity review and must be checked before submission.",
    };
  },
  toModelOutput(output) {
    return {
      type: "json",
      value: {
        eventId: output.eventId,
        packId: output.packId,
        packVersion: output.packVersion,
        folder: output.folder.folder,
        files: {
          riskAssessment: output.files.riskAssessment.webViewLink,
          budget: output.files.budget?.webViewLink,
          fieldPack: output.files.fieldPack.webViewLink,
          deadlinePlan: output.files.deadlinePlan.webViewLink,
          internalReviewSummary:
            output.files.internalReviewSummary.webViewLink,
        },
        budgetDecision: output.budgetDecision,
        riskAssessmentTableFill: output.riskAssessmentTableFill,
        riskAssessmentHeaderUpdate: output.riskAssessmentHeaderUpdate,
        riskAssessmentTextQa: output.riskAssessmentTextQa,
        deadlineTasks: output.deadlineTasks,
        accessibilityTasks: output.accessibilityTasks,
        reusedFiles: output.reusedFiles,
        trackerUpdates: output.trackerUpdates,
        disclaimer: output.disclaimer,
      },
    };
  },
});
