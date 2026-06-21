import type { docs_v1, drive_v3 } from "googleapis";

import {
  buildRiskAssessmentScalarReplacements,
  buildRiskRows,
  type EventPackInput,
  type RiskRow,
} from "../eventPack.js";
import {
  createDocsClient,
  createDriveClient,
  googleApiErrorSummary,
} from "./client.js";
import { exportGoogleDriveFileText } from "./docs.js";

const CORE_RISKS_MARKER = "{{#core_risks}}";
const ACTIVITY_RISKS_MARKER = "{{#activity_risks}}";
const RISK_COLUMN_COUNT = 7;
const PLACEHOLDER_PATTERN = /{{[^}\n]+}}/g;

const RISK_HEADER_FIELD_SPECS = [
  {
    field: "society_name",
    placeholder: "{{society_name}}",
    labels: ["Name of Group", "Society/Club"],
  },
  {
    field: "event_name",
    placeholder: "{{event_name}}",
    labels: ["Name of Event"],
  },
  {
    field: "event_organiser_name",
    placeholder: "{{event_organiser_name}}",
    labels: ["Event Organiser Name"],
  },
  {
    field: "event_organiser_lse_email",
    placeholder: "{{event_organiser_lse_email}}",
    labels: ["Event Organiser LSE Email Address"],
  },
  {
    field: "event_organiser_contact_number",
    placeholder: "{{event_organiser_contact_number}}",
    labels: ["Event Organiser Contact Number"],
  },
  {
    field: "event_dates_times",
    placeholder: "{{event_dates_times}}",
    labels: ["Event Dates"],
  },
  {
    field: "event_location",
    placeholder: "{{event_location}}",
    labels: ["Event Location"],
  },
  {
    field: "first_aid_plan",
    placeholder: "{{first_aid_plan}}",
    labels: ["Name of First Aiders Present", "First Aiders"],
  },
  {
    field: "date_completed",
    placeholder: "{{date_completed}}",
    labels: ["Date Completed"],
  },
] as const;

const RISK_DETECTION_INPUT: EventPackInput = {
  // Keep this fixture in sync with every conditional activity-risk trigger in buildRiskRows().
  eventId: "EVT-20260101-risk-detection-0000",
  eventName: "Risk detection fixture",
  foodOrRefreshments: true,
  alcohol: true,
  externalSpeakers: [{ name: "External speaker" }],
  publicOrNonLseAttendees: true,
  sponsorInvolved: true,
  externalOrganisationInvolved: true,
  under18sOrVulnerableAdults: true,
  externalVenue: true,
};
type DocumentBody = {
  content: docs_v1.Schema$StructuralElement[];
  tabId?: string;
};

export type RiskTemplateRowMatch = {
  marker: string;
  tabId?: string;
  tableStartIndex: number;
  rowIndex: number;
  rowStartIndex: number;
  rowText: string;
  tableRows: docs_v1.Schema$TableRow[];
};

export type IndexedDocsRequest = {
  request: docs_v1.Schema$Request;
  startIndex: number;
  sequence: number;
};

export type RiskAssessmentTableFillResult = {
  coreRiskRows: number;
  activityRiskRows: number;
  sections: Array<{
    section: "core" | "activity";
    rowCount: number;
    status: "filled" | "updated";
  }>;
};

export type RiskAssessmentTextQaResult = {
  ok: boolean;
  checkedExpectedText: string[];
  missingExpectedText: string[];
  leakedPlaceholders: string[];
  exportedCharacterCount: number;
};

function getDocsClient(client?: docs_v1.Docs) {
  return client ?? createDocsClient();
}

function getDriveClient(client?: drive_v3.Drive) {
  return client ?? createDriveClient();
}

function optionalTabLocation(index: number, tabId?: string) {
  return tabId ? { index, tabId } : { index };
}

function optionalTabRange(startIndex: number, endIndex: number, tabId?: string) {
  return tabId ? { startIndex, endIndex, tabId } : { startIndex, endIndex };
}

function flattenTabs(tabs: docs_v1.Schema$Tab[] = []): docs_v1.Schema$Tab[] {
  return tabs.flatMap((tab) => [tab, ...flattenTabs(tab.childTabs ?? [])]);
}

function documentBodies(document: docs_v1.Schema$Document): DocumentBody[] {
  const tabBodies = flattenTabs(document.tabs ?? [])
    .map((tab) => ({
      content: tab.documentTab?.body?.content ?? [],
      tabId: tab.tabProperties?.tabId ?? undefined,
    }))
    .filter((body) => body.content.length > 0);

  if (tabBodies.length > 0) return tabBodies;

  return [
    {
      content: document.body?.content ?? [],
    },
  ];
}

function paragraphElementText(element: docs_v1.Schema$ParagraphElement) {
  return element.textRun?.content ?? "";
}

function structuralElementText(element: docs_v1.Schema$StructuralElement): string {
  if (element.paragraph) {
    return (element.paragraph.elements ?? []).map(paragraphElementText).join("");
  }

  if (element.table) {
    return (element.table.tableRows ?? [])
      .map((row) => rowText(row))
      .join("\n");
  }

  return "";
}

function cellText(cell: docs_v1.Schema$TableCell) {
  return (cell.content ?? []).map(structuralElementText).join("");
}

function rowText(row: docs_v1.Schema$TableRow) {
  return (row.tableCells ?? []).map(cellText).join("\t");
}

function collectTextRunRanges(
  element: docs_v1.Schema$StructuralElement,
  ranges: Array<{ startIndex: number; endIndex: number }>,
) {
  if (element.paragraph) {
    for (const paragraphElement of element.paragraph.elements ?? []) {
      const startIndex = paragraphElement.startIndex;
      const endIndex = paragraphElement.endIndex;
      if (
        paragraphElement.textRun &&
        typeof startIndex === "number" &&
        typeof endIndex === "number"
      ) {
        ranges.push({ startIndex, endIndex });
      }
    }
  }

  if (element.table) {
    for (const row of element.table.tableRows ?? []) {
      for (const cell of row.tableCells ?? []) {
        for (const child of cell.content ?? []) {
          collectTextRunRanges(child, ranges);
        }
      }
    }
  }
}

function editableTextRangeForCell(cell: docs_v1.Schema$TableCell) {
  const textRanges: Array<{ startIndex: number; endIndex: number }> = [];
  for (const element of cell.content ?? []) {
    collectTextRunRanges(element, textRanges);
  }

  if (textRanges.length > 0) {
    const startIndex = Math.min(...textRanges.map((range) => range.startIndex));
    const lastEndIndex = Math.max(...textRanges.map((range) => range.endIndex));
    return {
      startIndex,
      deleteEndIndex: Math.max(startIndex, lastEndIndex - 1),
    };
  }

  if (typeof cell.startIndex === "number") {
    return {
      startIndex: cell.startIndex + 1,
      deleteEndIndex: cell.startIndex + 1,
    };
  }

  throw new Error("Could not resolve a writable text range for a risk table cell.");
}

export function riskRowToTableCells(row: RiskRow) {
  return [
    row.hazardIdentified,
    row.whyHazard,
    row.whoAtRisk,
    row.riskScore,
    row.actionsBeforeEvent,
    row.actionsDuringEvent,
    row.owner,
  ];
}

export function buildNoActivityRiskRow(input: EventPackInput): RiskRow {
  const owner = input.organiserName?.trim() || "Velocity event lead";

  return {
    hazardIdentified: "No activity-specific risks recorded",
    whyHazard:
      "No food, alcohol, speaker, public attendee, external organisation, safeguarding, or external venue risks were triggered by the current intake.",
    whoAtRisk: "N/A",
    riskScore: "N/A",
    actionsBeforeEvent:
      "Committee should revisit this row if the event scope changes before submission.",
    actionsDuringEvent:
      "Committee should pause and escalate if new activity-specific risks arise during delivery.",
    owner,
  };
}

export function riskRowsForDocument(input: EventPackInput) {
  const { coreRisks, activityRisks } = buildRiskRows(input);

  return {
    coreRisks,
    activityRisks:
      activityRisks.length > 0 ? activityRisks : [buildNoActivityRiskRow(input)],
  };
}

export type RiskAssessmentHeaderUpdatePlan = {
  requests: docs_v1.Schema$Request[];
  updatedFields: string[];
  missingFields: string[];
};

export type RiskAssessmentHeaderUpdateResult = {
  updatedFields: string[];
  missingFields: string[];
  requestCount: number;
};

function normalizeSearchText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function textIncludesNormalized(text: string, expected: string) {
  return normalizeSearchText(text).includes(normalizeSearchText(expected));
}

export function generatedRiskHazardsForDetection() {
  const { coreRisks, activityRisks } = buildRiskRows(RISK_DETECTION_INPUT);
  const noActivityRisk = buildNoActivityRiskRow(RISK_DETECTION_INPUT);

  return {
    core: coreRisks.map((row) => row.hazardIdentified),
    activity: Array.from(
      new Set([
        ...activityRisks.map((row) => row.hazardIdentified),
        noActivityRisk.hazardIdentified,
      ]),
    ),
  };
}

function scalarReplacementValues(input: EventPackInput) {
  return buildRiskAssessmentScalarReplacements(input) as Record<string, string>;
}

function riskHeaderLabelMatches(cellValue: string, labels: readonly string[]) {
  return labels.some((label) => textIncludesNormalized(cellValue, label));
}

export function buildRiskHeaderScalarUpdateRequests(
  document: docs_v1.Schema$Document,
  input: EventPackInput,
): RiskAssessmentHeaderUpdatePlan {
  const replacements = scalarReplacementValues(input);
  const indexedRequests: IndexedDocsRequest[] = [];
  const updatedFields = new Set<string>();

  for (const body of documentBodies(document)) {
    for (const element of body.content) {
      const table = element.table;
      if (!table) continue;

      for (const row of table.tableRows ?? []) {
        const cells = row.tableCells ?? [];
        if (cells.length < 2) continue;

        for (const spec of RISK_HEADER_FIELD_SPECS) {
          if (updatedFields.has(spec.field)) continue;

          const labelCellIndex = cells.findIndex((cell) =>
            riskHeaderLabelMatches(cellText(cell), spec.labels),
          );
          if (labelCellIndex < 0) continue;

          const valueCell = cells[labelCellIndex + 1];
          if (!valueCell) continue;

          indexedRequests.push(
            ...buildReplaceCellTextRequests(
              valueCell,
              replacements[spec.placeholder] ?? "",
              body.tabId,
            ),
          );
          updatedFields.add(spec.field);
        }
      }
    }
  }

  const updated = Array.from(updatedFields);
  const missingFields = RISK_HEADER_FIELD_SPECS.filter(
    (spec) => !updatedFields.has(spec.field),
  ).map((spec) => spec.field);

  return {
    requests: sortDocsRequestsDescending(indexedRequests),
    updatedFields: updated,
    missingFields,
  };
}

export function findRiskTemplateRow(
  document: docs_v1.Schema$Document,
  marker: string,
): RiskTemplateRowMatch | undefined {
  const matches: RiskTemplateRowMatch[] = [];

  for (const body of documentBodies(document)) {
    for (const element of body.content) {
      const table = element.table;
      const tableStartIndex = element.startIndex;
      if (!table || typeof tableStartIndex !== "number") continue;

      const tableRows = table.tableRows ?? [];
      tableRows.forEach((row, rowIndex) => {
        const text = rowText(row);
        if (!text.includes(marker)) return;

        matches.push({
          marker,
          tabId: body.tabId,
          tableStartIndex,
          rowIndex,
          rowStartIndex: row.startIndex ?? tableStartIndex,
          rowText: text,
          tableRows,
        });
      });
    }
  }

  if (matches.length > 1) {
    throw new Error(
      `Risk assessment template marker ${marker} appears in multiple table rows. Keep exactly one loop row per risk section.`,
    );
  }

  return matches[0];
}

type RiskSectionMatch = {
  tabId?: string;
  tableStartIndex: number;
  rowIndex: number;
  tableRows: docs_v1.Schema$TableRow[];
};

type GeneratedRiskSectionMatch = RiskSectionMatch & {
  currentRowCount: number;
};

function firstCellText(row: docs_v1.Schema$TableRow) {
  return row.tableCells?.[0] ? cellText(row.tableCells[0]).trim() : "";
}

function firstCellMatches(row: docs_v1.Schema$TableRow, hazards: string[]) {
  const text = firstCellText(row);
  return hazards.some((hazard) => textIncludesNormalized(text, hazard));
}

export function findGeneratedRiskSections(document: docs_v1.Schema$Document) {
  const hazards = generatedRiskHazardsForDetection();

  for (const body of documentBodies(document)) {
    for (const element of body.content) {
      const table = element.table;
      const tableStartIndex = element.startIndex;
      if (!table || typeof tableStartIndex !== "number") continue;

      const tableRows = table.tableRows ?? [];
      const coreRowIndex = tableRows.findIndex((row) =>
        textIncludesNormalized(firstCellText(row), hazards.core[0]),
      );
      if (coreRowIndex < 0) continue;

      const activityRowIndex = tableRows.findIndex(
        (row, index) =>
          index > coreRowIndex && firstCellMatches(row, hazards.activity),
      );
      if (activityRowIndex < 0) continue;

      let activityRowCount = 0;
      for (
        let index = activityRowIndex;
        index < tableRows.length &&
        firstCellMatches(tableRows[index], hazards.activity);
        index += 1
      ) {
        activityRowCount += 1;
      }

      return {
        core: {
          tabId: body.tabId,
          tableStartIndex,
          rowIndex: coreRowIndex,
          tableRows,
          currentRowCount: hazards.core.length,
        },
        activity: {
          tabId: body.tabId,
          tableStartIndex,
          rowIndex: activityRowIndex,
          tableRows,
          currentRowCount: activityRowCount,
        },
      };
    }
  }

  return undefined;
}
export function buildRiskTableRowInsertRequests(
  match: RiskTemplateRowMatch,
  rowCount: number,
): docs_v1.Schema$Request[] {
  if (rowCount <= 1) return [];

  return Array.from({ length: rowCount - 1 }, () => ({
    insertTableRow: {
      tableCellLocation: {
        tableStartLocation: optionalTabLocation(
          match.tableStartIndex,
          match.tabId,
        ),
        rowIndex: match.rowIndex,
        columnIndex: 0,
      },
      insertBelow: true,
    },
  }));
}

export function buildReplaceCellTextRequests(
  cell: docs_v1.Schema$TableCell,
  text: string,
  tabId?: string,
): IndexedDocsRequest[] {
  const range = editableTextRangeForCell(cell);
  const requests: IndexedDocsRequest[] = [];

  if (range.deleteEndIndex > range.startIndex) {
    requests.push({
      startIndex: range.startIndex,
      sequence: 0,
      request: {
        deleteContentRange: {
          range: optionalTabRange(
            range.startIndex,
            range.deleteEndIndex,
            tabId,
          ),
        },
      },
    });
  }

  if (text.length > 0) {
    requests.push({
      startIndex: range.startIndex,
      sequence: 1,
      request: {
        insertText: {
          location: optionalTabLocation(range.startIndex, tabId),
          text,
        },
      },
    });
  }

  return requests;
}

export function sortDocsRequestsDescending(requests: IndexedDocsRequest[]) {
  return requests
    .slice()
    .sort(
      (left, right) =>
        right.startIndex - left.startIndex || left.sequence - right.sequence,
    )
    .map((indexed) => indexed.request);
}

function buildRiskTableFillRequestsForMatch(
  match: RiskSectionMatch,
  rows: RiskRow[],
  context: string,
): docs_v1.Schema$Request[] {
  const indexedRequests: IndexedDocsRequest[] = [];

  rows.forEach((row, rowOffset) => {
    const tableRow = match.tableRows[match.rowIndex + rowOffset];
    if (!tableRow) {
      throw new Error(
        `Risk assessment table does not have enough rows for ${context}.`,
      );
    }

    const cells = tableRow.tableCells ?? [];
    if (cells.length < RISK_COLUMN_COUNT) {
      throw new Error(
        `Risk assessment ${context} row has ${cells.length} cells; expected at least ${RISK_COLUMN_COUNT}.`,
      );
    }

    riskRowToTableCells(row).forEach((cellTextValue, columnIndex) => {
      indexedRequests.push(
        ...buildReplaceCellTextRequests(
          cells[columnIndex],
          cellTextValue,
          match.tabId,
        ),
      );
    });
  });

  return sortDocsRequestsDescending(indexedRequests);
}

export function buildRiskTableFillRequests(
  document: docs_v1.Schema$Document,
  marker: string,
  rows: RiskRow[],
): docs_v1.Schema$Request[] {
  const match = findRiskTemplateRow(document, marker);
  if (!match) {
    throw new Error(`Risk assessment template marker ${marker} was not found.`);
  }

  return buildRiskTableFillRequestsForMatch(match, rows, marker);
}

async function getGoogleDocument(docs: docs_v1.Docs, documentId: string) {
  const response = await docs.documents.get({
    documentId,
    includeTabsContent: true,
  });

  return response.data;
}

async function batchUpdateRiskDocument({
  docs,
  documentId,
  document,
  requests,
  action,
}: {
  docs: docs_v1.Docs;
  documentId: string;
  document: docs_v1.Schema$Document;
  requests: docs_v1.Schema$Request[];
  action: string;
}) {
  if (requests.length === 0) return;

  const requestBody: docs_v1.Schema$BatchUpdateDocumentRequest = { requests };
  if (document.revisionId) {
    requestBody.writeControl = { requiredRevisionId: document.revisionId };
  }

  try {
    await docs.documents.batchUpdate({
      documentId,
      requestBody,
    });
  } catch (error) {
    throw new Error(
      `Google Docs risk assessment ${action} failed: ${JSON.stringify(
        googleApiErrorSummary(error),
      )}`,
    );
  }
}

export async function updateRiskAssessmentHeaderFields({
  documentId,
  input,
  docsClient,
}: {
  documentId: string;
  input: EventPackInput;
  docsClient?: docs_v1.Docs;
}): Promise<RiskAssessmentHeaderUpdateResult> {
  const docs = getDocsClient(docsClient);
  const document = await getGoogleDocument(docs, documentId);
  const plan = buildRiskHeaderScalarUpdateRequests(document, input);

  if (plan.missingFields.length > 0) {
    throw new Error(
      `Risk assessment header update could not locate tagged template header fields: ${plan.missingFields.join(
        ", ",
      )}. Confirm the template is the tagged native Google Docs copy from Files/templates/tagged.`,
    );
  }

  await batchUpdateRiskDocument({
    docs,
    documentId,
    document,
    requests: plan.requests,
    action: "header field update",
  });

  return {
    updatedFields: plan.updatedFields,
    missingFields: plan.missingFields,
    requestCount: plan.requests.length,
  };
}

export function buildGeneratedRiskRowInsertRequests(
  match: GeneratedRiskSectionMatch,
  desiredRowCount: number,
): docs_v1.Schema$Request[] {
  const rowsToInsert = desiredRowCount - match.currentRowCount;
  if (rowsToInsert <= 0) return [];

  return Array.from({ length: rowsToInsert }, () => ({
    insertTableRow: {
      tableCellLocation: {
        tableStartLocation: optionalTabLocation(
          match.tableStartIndex,
          match.tabId,
        ),
        rowIndex: match.rowIndex + match.currentRowCount - 1,
        columnIndex: 0,
      },
      insertBelow: true,
    },
  }));
}

export function buildGeneratedRiskRowDeleteRequests(
  match: GeneratedRiskSectionMatch,
  desiredRowCount: number,
): docs_v1.Schema$Request[] {
  const rowsToDelete = match.currentRowCount - desiredRowCount;
  if (rowsToDelete <= 0) return [];

  return Array.from({ length: rowsToDelete }, (_, index) => ({
    deleteTableRow: {
      tableCellLocation: {
        tableStartLocation: optionalTabLocation(
          match.tableStartIndex,
          match.tabId,
        ),
        rowIndex: match.rowIndex + match.currentRowCount - 1 - index,
        columnIndex: 0,
      },
    },
  }));
}

async function updateGeneratedRiskAssessmentTables({
  docs,
  documentId,
  coreRisks,
  activityRisks,
  skipCoreUpdate = false,
  skipActivityUpdate = false,
}: {
  docs: docs_v1.Docs;
  documentId: string;
  coreRisks: RiskRow[];
  activityRisks: RiskRow[];
  skipCoreUpdate?: boolean;
  skipActivityUpdate?: boolean;
}): Promise<RiskAssessmentTableFillResult> {
  let document = await getGoogleDocument(docs, documentId);
  let sections = findGeneratedRiskSections(document);

  if (!sections) {
    throw new Error(
      "Risk assessment has no template markers and no generated risk rows that Vichita can update in place. Generate a new packVersion from the tagged template.",
    );
  }

  if (!skipCoreUpdate) {
    await batchUpdateRiskDocument({
      docs,
      documentId,
      document,
      requests: buildRiskTableFillRequestsForMatch(
        sections.core,
        coreRisks,
        "generated core risks",
      ),
      action: "generated core risk update",
    });

    document = await getGoogleDocument(docs, documentId);
    sections = findGeneratedRiskSections(document);
    if (!sections) {
      throw new Error("Risk assessment generated rows disappeared during update.");
    }
  }

  if (!skipActivityUpdate) {
    const rowResizeRequests = [
      ...buildGeneratedRiskRowDeleteRequests(
        sections.activity,
        activityRisks.length,
      ),
      ...buildGeneratedRiskRowInsertRequests(
        sections.activity,
        activityRisks.length,
      ),
    ];
    await batchUpdateRiskDocument({
      docs,
      documentId,
      document,
      requests: rowResizeRequests,
      action: "generated activity risk row resize",
    });

    document = await getGoogleDocument(docs, documentId);
    sections = findGeneratedRiskSections(document);
    if (!sections) {
      throw new Error(
        "Risk assessment generated activity rows disappeared during update.",
      );
    }

    await batchUpdateRiskDocument({
      docs,
      documentId,
      document,
      requests: buildRiskTableFillRequestsForMatch(
        sections.activity,
        activityRisks,
        "generated activity risks",
      ),
      action: "generated activity risk update",
    });
  }

  return {
    coreRiskRows: coreRisks.length,
    activityRiskRows: activityRisks.length,
    sections: [
      {
        section: "activity",
        rowCount: activityRisks.length,
        status: skipActivityUpdate ? "filled" : "updated",
      },
      {
        section: "core",
        rowCount: coreRisks.length,
        status: skipCoreUpdate ? "filled" : "updated",
      },
    ],
  };
}

async function fillRiskSection({
  docs,
  documentId,
  marker,
  section,
  rows,
}: {
  docs: docs_v1.Docs;
  documentId: string;
  marker: string;
  section: "core" | "activity";
  rows: RiskRow[];
}): Promise<RiskAssessmentTableFillResult["sections"][number]> {
  let document = await getGoogleDocument(docs, documentId);
  let match = findRiskTemplateRow(document, marker);

  if (!match) {
    throw new Error(
      `Risk assessment template marker ${marker} was not found. Confirm the template is the tagged native Google Docs copy from Files/templates/tagged.`,
    );
  }

  await batchUpdateRiskDocument({
    docs,
    documentId,
    document,
    requests: buildRiskTableRowInsertRequests(match, rows.length),
    action: `${section} row insertion`,
  });

  document = await getGoogleDocument(docs, documentId);
  match = findRiskTemplateRow(document, marker);
  if (!match) {
    throw new Error(
      `Risk assessment template marker ${marker} disappeared before ${section} cell fill.`,
    );
  }

  await batchUpdateRiskDocument({
    docs,
    documentId,
    document,
    requests: buildRiskTableFillRequests(document, marker, rows),
    action: `${section} cell fill`,
  });

  return { section, rowCount: rows.length, status: "filled" };
}

export async function fillRiskAssessmentTables({
  documentId,
  input,
  allowAlreadyFilled = false,
  docsClient,
}: {
  documentId: string;
  input: EventPackInput;
  allowAlreadyFilled?: boolean;
  docsClient?: docs_v1.Docs;
}): Promise<RiskAssessmentTableFillResult> {
  const docs = getDocsClient(docsClient);
  const { coreRisks, activityRisks } = riskRowsForDocument(input);
  const initialDocument = await getGoogleDocument(docs, documentId);
  const hasCoreMarker = Boolean(
    findRiskTemplateRow(initialDocument, CORE_RISKS_MARKER),
  );
  const hasActivityMarker = Boolean(
    findRiskTemplateRow(initialDocument, ACTIVITY_RISKS_MARKER),
  );

  if (allowAlreadyFilled) {
    if (hasActivityMarker) {
      await fillRiskSection({
        docs,
        documentId,
        marker: ACTIVITY_RISKS_MARKER,
        section: "activity",
        rows: activityRisks,
      });
    }

    if (hasCoreMarker) {
      await fillRiskSection({
        docs,
        documentId,
        marker: CORE_RISKS_MARKER,
        section: "core",
        rows: coreRisks,
      });
    }

    if (!hasCoreMarker || !hasActivityMarker) {
      return updateGeneratedRiskAssessmentTables({
        docs,
        documentId,
        coreRisks,
        activityRisks,
        skipCoreUpdate: hasCoreMarker,
        skipActivityUpdate: hasActivityMarker,
      });
    }

    return {
      coreRiskRows: coreRisks.length,
      activityRiskRows: activityRisks.length,
      sections: [
        { section: "activity", rowCount: activityRisks.length, status: "filled" },
        { section: "core", rowCount: coreRisks.length, status: "filled" },
      ],
    };
  }

  if (!hasCoreMarker || !hasActivityMarker) {
    const missing = [
      !hasCoreMarker ? CORE_RISKS_MARKER : undefined,
      !hasActivityMarker ? ACTIVITY_RISKS_MARKER : undefined,
    ].filter((marker): marker is string => Boolean(marker));
    throw new Error(
      `Risk assessment template markers are incomplete. Missing: ${missing.join(
        ", ",
      )}. Use updateExistingDrafts=true for a same-version rerun, or generate a new packVersion from the tagged template.`,
    );
  }

  const sections: RiskAssessmentTableFillResult["sections"] = [];

  sections.push(
    await fillRiskSection({
      docs,
      documentId,
      marker: ACTIVITY_RISKS_MARKER,
      section: "activity",
      rows: activityRisks,
    }),
  );
  sections.push(
    await fillRiskSection({
      docs,
      documentId,
      marker: CORE_RISKS_MARKER,
      section: "core",
      rows: coreRisks,
    }),
  );

  return {
    coreRiskRows: coreRisks.length,
    activityRiskRows: activityRisks.length,
    sections,
  };
}

function uniqueMatches(values: string[]) {
  return Array.from(new Set(values));
}

function riskAssessmentExpectedScalarText(input: EventPackInput) {
  const replacements = scalarReplacementValues(input);

  return RISK_HEADER_FIELD_SPECS.map((spec) =>
    replacements[spec.placeholder]?.trim(),
  ).filter((value): value is string => Boolean(value));
}

export async function verifyRiskAssessmentText({
  documentId,
  input,
  driveClient,
}: {
  documentId: string;
  input: EventPackInput;
  driveClient?: drive_v3.Drive;
}): Promise<RiskAssessmentTextQaResult> {
  const text = await exportGoogleDriveFileText({
    fileId: documentId,
    driveClient: getDriveClient(driveClient),
  });
  const { coreRisks, activityRisks } = riskRowsForDocument(input);
  const checkedExpectedText = uniqueMatches([
    ...riskAssessmentExpectedScalarText(input),
    ...[...coreRisks, ...activityRisks].map((row) => row.hazardIdentified),
  ]);
  const missingExpectedText = checkedExpectedText.filter(
    (expected) => !text.includes(expected),
  );
  const leakedPlaceholders = uniqueMatches(text.match(PLACEHOLDER_PATTERN) ?? []);

  if (missingExpectedText.length > 0 || leakedPlaceholders.length > 0) {
    throw new Error(
      `Risk assessment text QA failed. Missing expected text: ${
        missingExpectedText.join("; ") || "none"
      }. Leaked placeholders: ${leakedPlaceholders.join("; ") || "none"}.`,
    );
  }

  return {
    ok: true,
    checkedExpectedText,
    missingExpectedText,
    leakedPlaceholders,
    exportedCharacterCount: text.length,
  };
}




