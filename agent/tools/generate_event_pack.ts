import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";

import { buildPackId, parseEventId } from "../lib/eventIdentity.js";
import {
  buildAccessibilityChecklistBody,
  buildBudgetSheetUpdates,
  buildDeadlinePlanBody,
  buildEventTrackerRow,
  buildFormFieldPackBody,
  buildInternalReviewSummaryBody,
  buildPackIndexRow,
  buildRiskAssessmentScalarReplacements,
  budgetRequirement,
  documentBaseName,
  type EventPackFileLinks,
} from "../lib/eventPack.js";
import { createDriveClient, createSheetsClient } from "../lib/googleWorkspace/client.js";
import {
  copyDriveFileToFolder,
  createGoogleDocWithText,
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

    await updateGoogleDocText({ documentId: existing.id, text });
    reusedFiles.push(documentType);
    return existing;
  }

  return createGoogleDocWithText({
    parentFolderId,
    name,
    text,
    appProperties,
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

export default defineTool({
  description:
    "Approval-gated Google Workspace write. Generate a draft event pack for an Event ID: fill the tagged risk-assessment Google Doc template, copy/fill the budget Google Sheet when required or requested, create form-field/accessibility/deadline/review Google Docs, and upsert tracker links. Humans still review and submit all SU forms manually.",
  inputSchema: Input,
  needsApproval: always(),
  async execute(input) {
    if (!parseEventId(input.eventId)) {
      throw new Error("eventId must use EVT-YYYYMMDD-event-slug-shortid format.");
    }

    const config = readGoogleWorkspaceConfig();
    if (!config.riskAssessmentTemplateFileId) {
      throw new Error(
        "GOOGLE_TEMPLATE_RISK_ASSESSMENT_FILE_ID is required before generating event packs.",
      );
    }

    const packId = buildPackId(input.eventId, input.packVersion);
    const baseName = documentBaseName(input);
    const budgetDecision = budgetRequirement(input, input.includeBudget);
    const reusedFiles: string[] = [];

    if (budgetDecision.shouldGenerateBudget && !config.budgetTemplateFileId) {
      throw new Error(
        "GOOGLE_TEMPLATE_BUDGET_FILE_ID is required because this event needs or requested a budget sheet.",
      );
    }

    if (input.updateTrackers) {
      await assertTrackersReadyForPackWrites();
    }

    const folder = input.packFolderId
      ? {
          action: "provided" as const,
          folder: await validateProvidedPackFolder(input.packFolderId),
        }
      : await createOrFindEventPackFolder({
          eventId: input.eventId,
          eventName: input.eventName,
          proposedDate: input.proposedDate,
          createEventPacksParentIfMissing: input.createEventPacksParentIfMissing,
          sourceSlackChannelId: input.sourceSlackChannelId,
          sourceSlackThreadTs: input.sourceSlackThreadTs,
        });
    const folderId = folder.folder.id;

    const riskAssessment = await copyDriveFileToFolderOrReuse({
      sourceFileId: config.riskAssessmentTemplateFileId,
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
    });

    if (riskAssessment.mimeType !== GOOGLE_DOC_MIME_TYPE) {
      throw new Error(
        "The risk-assessment template copy is not a native Google Doc. Convert the tagged template to Google Docs before runtime filling.",
      );
    }

    const riskAssessmentTableFill = await fillRiskAssessmentTables({
      documentId: riskAssessment.id,
      input,
      allowAlreadyFilled: input.updateExistingDrafts && reusedFiles.includes("risk-assessment"),
    });

    const riskAssessmentHeaderUpdate = await updateRiskAssessmentHeaderFields({
      documentId: riskAssessment.id,
      input,
    });

    const riskAssessmentScalarReplacements = buildRiskAssessmentScalarReplacements(input);
    await replaceGoogleDocText({
      documentId: riskAssessment.id,
      replacements: {
        "{{placeholders}}": riskAssessmentScalarReplacements["{{placeholders}}"],
      },
    });

    const riskAssessmentTextQa = await verifyRiskAssessmentText({
      documentId: riskAssessment.id,
      input,
    });

    let budget:
      | Awaited<ReturnType<typeof copyDriveFileToFolder>>
      | undefined;
    if (budgetDecision.shouldGenerateBudget) {
      budget = await copyDriveFileToFolderOrReuse({
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
      });

      if (budget.mimeType !== GOOGLE_SHEET_MIME_TYPE) {
        throw new Error(
          "The budget template copy is not a native Google Sheet. Convert the tagged template to Google Sheets before runtime filling.",
        );
      }

      await fillBudgetSheet(budget.id, input);
    }

    const firstLinks: EventPackFileLinks = {
      packFolderLink: folder.folder.webViewLink,
      riskAssessmentLink: riskAssessment.webViewLink,
      budgetLink: budget?.webViewLink,
    };

    const accessibilityChecklist = await createGoogleDocWithTextOrReuse({
      parentFolderId: folderId,
      name: `${baseName} - Accessibility Checklist v${input.packVersion}`,
      text: buildAccessibilityChecklistBody(input),
      documentType: "accessibility-checklist",
      reusedFiles,
      updateExistingDrafts: input.updateExistingDrafts,
      appProperties: documentAppProperties({
        eventId: input.eventId,
        packId,
        packVersion: input.packVersion,
        documentType: "accessibility-checklist",
      }),
    });

    const deadlinePlan = await createGoogleDocWithTextOrReuse({
      parentFolderId: folderId,
      name: `${baseName} - Deadline Plan v${input.packVersion}`,
      text: buildDeadlinePlanBody(input),
      documentType: "deadline-plan",
      reusedFiles,
      updateExistingDrafts: input.updateExistingDrafts,
      appProperties: documentAppProperties({
        eventId: input.eventId,
        packId,
        packVersion: input.packVersion,
        documentType: "deadline-plan",
      }),
    });

    const fieldPackLinks: EventPackFileLinks = {
      ...firstLinks,
      accessibilityChecklistLink: accessibilityChecklist.webViewLink,
      deadlinePlanLink: deadlinePlan.webViewLink,
    };
    const fieldPack = await createGoogleDocWithTextOrReuse({
      parentFolderId: folderId,
      name: `${baseName} - LSESU Form Field Pack v${input.packVersion}`,
      text: buildFormFieldPackBody(input, fieldPackLinks),
      documentType: "field-pack",
      reusedFiles,
      updateExistingDrafts: input.updateExistingDrafts,
      appProperties: documentAppProperties({
        eventId: input.eventId,
        packId,
        packVersion: input.packVersion,
        documentType: "field-pack",
      }),
    });

    const summaryLinks: EventPackFileLinks = {
      ...fieldPackLinks,
      fieldPackLink: fieldPack.webViewLink,
    };
    const internalReviewSummary = await createGoogleDocWithTextOrReuse({
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
    });

    const links: EventPackFileLinks = {
      ...summaryLinks,
      internalReviewSummaryLink: internalReviewSummary.webViewLink,
    };
    const trackerUpdates: unknown[] = [];

    if (input.updateTrackers) {
      trackerUpdates.push(
        await upsertTrackerRow({
          tabName: "Event Packs Index",
          keyColumn: "Pack ID",
          keyValue: packId,
          row: buildPackIndexRow(input, links),
          valueInputOption: "RAW",
        }),
      );
      trackerUpdates.push(
        await upsertTrackerRow({
          tabName: "Events Tracker",
          keyColumn: "Event ID",
          keyValue: input.eventId,
          row: buildEventTrackerRow(input, links),
          valueInputOption: "RAW",
        }),
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
        accessibilityChecklist,
        deadlinePlan,
        internalReviewSummary,
      },
      budgetDecision,
      riskAssessmentTableFill,
      riskAssessmentHeaderUpdate,
      riskAssessmentTextQa,
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
          accessibilityChecklist: output.files.accessibilityChecklist.webViewLink,
          deadlinePlan: output.files.deadlinePlan.webViewLink,
          internalReviewSummary:
            output.files.internalReviewSummary.webViewLink,
        },
        budgetDecision: output.budgetDecision,
        riskAssessmentTableFill: output.riskAssessmentTableFill,
        riskAssessmentHeaderUpdate: output.riskAssessmentHeaderUpdate,
        riskAssessmentTextQa: output.riskAssessmentTextQa,
        reusedFiles: output.reusedFiles,
        trackerUpdates: output.trackerUpdates,
        disclaimer: output.disclaimer,
      },
    };
  },
});




