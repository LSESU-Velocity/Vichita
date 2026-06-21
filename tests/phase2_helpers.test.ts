import assert from "node:assert/strict";
import test from "node:test";

import type { docs_v1 } from "googleapis";

import {
  buildEventIdentity,
  buildPackId,
  buildSlackThreadKey,
  parseEventId,
  slugifyEventName,
} from "../agent/lib/eventIdentity.ts";
import {
  dateDisplaySortKey,
  displayDateFromEventDatePart,
  displayDateFromIsoDate,
} from "../agent/lib/dateLabels.ts";
import { eventPackFolderName } from "../agent/lib/googleWorkspace/drive.ts";
import { minimalTextEdit } from "../agent/lib/googleWorkspace/docs.ts";
import {
  buildColumnExpansionRequest,
  columnLetter,
  compareHeaders,
  trackerGridProperties,
  trackerRequiredColumnCount,
} from "../agent/lib/googleWorkspace/sheets.ts";
import { buildSourceRegistryEntry } from "../agent/lib/sourceRegistry.ts";
import {
  budgetRequirement,
  buildBudgetSheetUpdates,
  buildFormFieldPackBody,
  buildInternalReviewSummaryBody,
  buildRiskAssessmentScalarReplacements,
  type EventPackInput,
} from "../agent/lib/eventPack.ts";
import {
  buildGeneratedRiskRowDeleteRequests,
  buildGeneratedRiskRowInsertRequests,
  buildNoActivityRiskRow,
  buildRiskHeaderScalarUpdateRequests,
  buildRiskTableFillRequests,
  buildRiskTableRowInsertRequests,
  fillRiskAssessmentTables,
  findGeneratedRiskSections,
  findRiskTemplateRow,
  generatedRiskHazardsForDetection,
  riskRowsForDocument,
  riskRowToTableCells,
  sortDocsRequestsDescending,
  type IndexedDocsRequest,
} from "../agent/lib/googleWorkspace/riskAssessmentDoc.ts";

function fakeTextCell(
  text: string,
  startIndex: number,
): docs_v1.Schema$TableCell {
  const endIndex = startIndex + text.length;

  return {
    startIndex: startIndex - 1,
    endIndex: endIndex + 1,
    content: [
      {
        startIndex,
        endIndex,
        paragraph: {
          elements: [
            {
              startIndex,
              endIndex,
              textRun: { content: text },
            },
          ],
        },
      },
    ],
  };
}

function fakeRiskTemplateRow({
  marker,
  startIndex,
}: {
  marker?: string;
  startIndex: number;
}): docs_v1.Schema$TableRow {
  const placeholders = [
    "{{hazard_identified}}\n",
    "{{why_hazard}}\n",
    "{{who_at_risk}}\n",
    "{{risk_score}}\n",
    "{{actions_before_event}}\n",
    "{{actions_during_event}}\n",
    "{{owner}}\n",
  ];

  return {
    startIndex,
    endIndex: startIndex + 700,
    tableCells: placeholders.map((placeholder, index) =>
      fakeTextCell(
        `${index === 0 && marker ? marker : ""}${placeholder}`,
        startIndex + 10 + index * 80,
      ),
    ),
  };
}

function fakeRiskDocument(
  marker = "{{#core_risks}}",
): docs_v1.Schema$Document {
  return {
    body: {
      content: [
        {
          startIndex: 20,
          endIndex: 2000,
          table: {
            tableRows: [
              fakeRiskTemplateRow({ marker, startIndex: 30 }),
              fakeRiskTemplateRow({ startIndex: 800 }),
            ],
          },
        },
      ],
    },
  };
}

function fakeRiskTemplateDocumentWithRows({
  marker,
  rowCount,
}: {
  marker: string;
  rowCount: number;
}): docs_v1.Schema$Document {
  return {
    body: {
      content: [
        {
          startIndex: 20,
          endIndex: 4000,
          table: {
            tableRows: Array.from({ length: rowCount }, (_, index) =>
              fakeRiskTemplateRow({
                marker: index === 0 ? marker : undefined,
                startIndex: 30 + index * 760,
              }),
            ),
          },
        },
      ],
    },
  };
}

function fakeRiskDataRow(
  values: string[],
  startIndex: number,
): docs_v1.Schema$TableRow {
  return {
    startIndex,
    endIndex: startIndex + 700,
    tableCells: values.map((value, index) =>
      fakeTextCell(`${value}\n`, startIndex + 10 + index * 90),
    ),
  };
}

function fakeHeaderDocument(): docs_v1.Schema$Document {
  const rows = [
    ["Name of Group (Society/Club):", "Old Society"],
    ["Name of Event:", "Old Event"],
    ["Event Organiser Name:", "Old Organiser"],
    ["Event Organiser LSE Email Address:", "old@example.com"],
    ["Event Organiser Contact Number:", "000"],
    ["Event Dates: (Include start and end date and time)", "Old Date"],
    [
      "Event Location: (Include as much information as possible, including addresses)",
      "Old Location",
    ],
    [
      "Name of First Aiders Present:(If no first aider is present, what action will be taken if First Aid is required?)",
      "Old First Aid",
    ],
    ["Date Completed:", "Old Completed Date"],
  ];

  return {
    body: {
      content: [
        {
          startIndex: 20,
          endIndex: 2000,
          table: {
            tableRows: rows.map(([label, value], index) =>
              fakeRiskDataRow([label, value], 30 + index * 180),
            ),
          },
        },
      ],
    },
  };
}

function fakeGeneratedRiskDocument({
  input,
  activityRowCount,
  lowerCaseHazards = false,
}: {
  input: EventPackInput;
  activityRowCount?: number;
  lowerCaseHazards?: boolean;
}): docs_v1.Schema$Document {
  const rows = riskRowsForDocument(input);
  const activityRows = rows.activityRisks.slice(
    0,
    activityRowCount ?? rows.activityRisks.length,
  );
  let rowStart = 30;
  const nextRow = (values: string[]) => {
    const row = fakeRiskDataRow(values, rowStart);
    rowStart += 760;
    return row;
  };
  const rowValues = (
    row: ReturnType<typeof riskRowsForDocument>["coreRisks"][number],
  ) => {
    const values = riskRowToTableCells(row);
    if (lowerCaseHazards) values[0] = values[0].toLowerCase();
    return values;
  };

  return {
    body: {
      content: [
        {
          startIndex: 20,
          endIndex: 9000,
          table: {
            tableRows: [
              nextRow([
                "Hazard Identified",
                "Why",
                "Who",
                "Score",
                "Before",
                "During",
                "Owner",
              ]),
              ...rows.coreRisks.map((row) => nextRow(rowValues(row))),
              nextRow(["Activity-Related Risks"]),
              ...activityRows.map((row) => nextRow(rowValues(row))),
            ],
          },
        },
      ],
    },
  };
}

function fakeDocsClientSequence(documents: docs_v1.Schema$Document[]) {
  let getCount = 0;
  const batchUpdates: docs_v1.Schema$Request[][] = [];
  const docsClient = {
    documents: {
      get: async () => ({
        data: documents[Math.min(getCount++, documents.length - 1)],
      }),
      batchUpdate: async ({
        requestBody,
      }: {
        requestBody: { requests?: docs_v1.Schema$Request[] };
      }) => {
        batchUpdates.push(requestBody.requests ?? []);
        return { data: {} };
      },
    },
  } as unknown as docs_v1.Docs;

  return { docsClient, batchUpdates };
}

test("event identity is stable when Slack thread context is provided", () => {
  const input = {
    eventName: "AI Startup Sprint",
    proposedDate: "2026-11-04",
    sourceSlackChannelId: "C123",
    sourceSlackThreadTs: "1770000000.123456",
  };

  const first = buildEventIdentity(input);
  const second = buildEventIdentity(input);

  assert.equal(first.eventId, second.eventId);
  assert.equal(first.displayDate, "04-11-2026");
  assert.equal(first.idempotencyKey, "slack-thread:C123:1770000000.123456");
  assert.equal(first.slackThreadKey, "slack-thread:C123:1770000000.123456");
  assert.match(first.eventId, /^EVT-20261104-ai-startup-sprint-[a-f0-9]{8}$/);
});

test("event IDs round-trip when slug contains a hex-looking segment", () => {
  const parsed = parseEventId("EVT-20260316-lse-a7f3-cafe");

  assert.deepEqual(parsed, {
    eventId: "EVT-20260316-lse-a7f3-cafe",
    datePart: "20260316",
    eventSlug: "lse-a7f3",
    shortId: "cafe",
  });
  assert.equal(buildPackId("EVT-20260316-lse-a7f3-cafe"), "EVT-20260316-lse-a7f3-cafe-PACK-v1");
});

test("slack thread key is only created when both parts are present", () => {
  assert.equal(
    buildSlackThreadKey({ sourceSlackChannelId: "C1", sourceSlackThreadTs: "123.45" }),
    "slack-thread:C1:123.45",
  );
  assert.equal(buildSlackThreadKey({ sourceSlackChannelId: "C1" }), undefined);
});

test("event slugs stay lowercase ASCII", () => {
  assert.equal(slugifyEventName("LSE Build: Café Night!"), "lse-build-cafe-night");
});
test("human-facing dates use day-month-year while sort keys stay chronological", () => {
  assert.equal(displayDateFromIsoDate("2026-10-05"), "05-10-2026");
  assert.equal(displayDateFromEventDatePart("20261104"), "04-11-2026");
  assert.equal(dateDisplaySortKey("05-10-2026"), "2026-10-05");
});

test("event pack folder names are human-readable and keep IDs out of the visible name", () => {
  assert.equal(
    eventPackFolderName({
      eventId: "EVT-20261005-notion-workshop-fd8d014a",
      eventName: "Notion workshop",
      proposedDate: "2026-10-05",
    }),
    "05-10-2026 - Notion workshop",
  );
  assert.equal(
    eventPackFolderName({
      eventId: "EVT-20261005-notion-workshop-fd8d014a",
      eventName: "Bad / File: Name?",
    }),
    "05-10-2026 - Bad File Name",
  );
});

test("tracker tab grid helpers allocate and expand enough columns for wide schemas", () => {
  assert.equal(columnLetter(1), "A");
  assert.equal(columnLetter(26), "Z");
  assert.equal(columnLetter(28), "AB");
  assert.equal(trackerRequiredColumnCount(28), 28);
  assert.equal(trackerRequiredColumnCount(10), 26);
  assert.deepEqual(trackerGridProperties(28), {
    rowCount: 1000,
    columnCount: 28,
    frozenRowCount: 1,
  });
  assert.deepEqual(trackerGridProperties(10), {
    rowCount: 1000,
    columnCount: 26,
    frozenRowCount: 1,
  });
  assert.deepEqual(
    buildColumnExpansionRequest({
      sheetId: 123,
      currentColumnCount: 26,
      headerCount: 28,
    }),
    {
      updateSheetProperties: {
        properties: {
          sheetId: 123,
          gridProperties: {
            columnCount: 28,
          },
        },
        fields: "gridProperties.columnCount",
      },
    },
  );
  assert.equal(
    buildColumnExpansionRequest({
      sheetId: 123,
      currentColumnCount: 28,
      headerCount: 28,
    }),
    undefined,
  );
});

test("header comparison distinguishes exact, missing, and unexpected headers", () => {
  assert.deepEqual(compareHeaders(["A", "B"], ["A", "B"]), {
    exactMatch: true,
    hasHeaderRow: true,
    missingHeaders: [],
    unexpectedHeaders: [],
  });
  assert.deepEqual(compareHeaders(["A", "Extra"], ["A", "B"]), {
    exactMatch: false,
    hasHeaderRow: true,
    missingHeaders: ["B"],
    unexpectedHeaders: ["Extra"],
  });
});

test("source registry rejects impossible ISO-like dates", () => {
  assert.throws(
    () =>
      buildSourceRegistryEntry({
        sourceName: "Events guidance",
        url: "https://www.lsesu.com/communities/hub/activities/events/",
        topicModule: "events",
        lastVerifiedDate: "2026-13-40",
        verifiedBy: "Velocity President",
        sourceStability: "academic_year_specific",
        academicYearSpecific: true,
        encodedRuleNotes: "Boundary rules checked.",
        sourceSetId: "lsesu-events-2026-06-20",
      }),
    /real calendar date/,
  );
});

test("source registry preserves formula-looking free text for RAW writes", () => {
  const entry = buildSourceRegistryEntry({
    sourceName: "Formula-looking source",
    url: "https://example.com/source",
    topicModule: "test",
    lastVerifiedDate: "2026-06-20",
    verifiedBy: "Velocity President",
    sourceStability: "stable",
    academicYearSpecific: false,
    encodedRuleNotes: "=do not evaluate this as a formula",
    sourceSetId: "test-2026-06-20",
  });

  assert.equal(
    entry.row["Encoded Rule Notes"],
    "=do not evaluate this as a formula",
  );
});

test("event pack budget requirement follows GBP 500 and 50 percent thresholds", () => {
  const base = {
    eventId: "EVT-20261104-ai-startup-sprint-c91d",
    eventName: "AI Startup Sprint",
  };

  assert.equal(
    budgetRequirement({ ...base, estimatedCost: 500 }, "auto").shouldGenerateBudget,
    false,
  );
  assert.equal(
    budgetRequirement({ ...base, estimatedCost: 501 }, "auto").shouldGenerateBudget,
    true,
  );
  assert.equal(
    budgetRequirement(
      { ...base, estimatedCost: 300, societyBalanceEstimate: 500 },
      "auto",
    ).shouldGenerateBudget,
    true,
  );
  assert.equal(
    budgetRequirement({ ...base, estimatedCost: 650 }, "never").shouldGenerateBudget,
    false,
  );
});

test("event pack budget sheet updates preserve numeric planning values", () => {
  const updates = buildBudgetSheetUpdates({
    eventId: "EVT-20261104-ai-startup-sprint-c91d",
    eventName: "AI Startup Sprint",
    estimatedCost: 650,
    budget: {
      income: {
        memberTicket: {
          pricePerItem: 3,
          quantity: 80,
          notes: "Planning assumption only.",
        },
      },
    },
  });
  const expenseDescriptions = updates.find((update) => update.range === "'Budget Template'!B7:B16");
  const expenseNumbers = updates.find((update) => update.range === "'Budget Template'!C7:D16");
  const expenseNotes = updates.find((update) => update.range === "'Budget Template'!F7:F16");
  const incomeRows = updates.find((update) => update.range === "'Budget Template'!C20:D26");

  assert.equal(expenseDescriptions?.values[0][0], "Estimated event costs");
  assert.equal(expenseDescriptions?.valueInputOption, "RAW");
  assert.equal(expenseNumbers?.values[0][0], 650);
  assert.equal(typeof expenseNumbers?.values[0][0], "number");
  assert.equal(expenseNumbers?.valueInputOption, "USER_ENTERED");
  assert.equal(expenseNotes?.valueInputOption, "RAW");
  assert.equal(incomeRows?.values[0][0], 3);
  assert.equal(typeof incomeRows?.values[0][0], "number");
});

test("minimal Google Doc text edits replace only the changed span", () => {
  assert.deepEqual(
    minimalTextEdit("alpha\nbeta\ngamma", "alpha\nBETA\ngamma"),
    {
      startOffset: 6,
      endOffset: 10,
      insertText: "BETA",
    },
  );
  assert.equal(minimalTextEdit("same", "same"), undefined);
});
test("risk assessment scalar replacements exclude table loop placeholders", () => {
  const replacements = buildRiskAssessmentScalarReplacements({
    eventId: "EVT-20261104-ai-startup-sprint-c91d",
    eventName: "AI Startup Sprint",
  });

  assert.equal(replacements["{{event_name}}"], "AI Startup Sprint");
  assert.equal(replacements["{{placeholders}}"], "draft fields");
  assert.equal(replacements["{{#core_risks}}"], undefined);
  assert.equal(replacements["{{hazard_identified}}"], undefined);
});

test("risk table helpers preserve official column ordering and no-activity fallback", () => {
  const fallback = buildNoActivityRiskRow({
    eventId: "EVT-20261104-ai-startup-sprint-c91d",
    eventName: "AI Startup Sprint",
    organiserName: "Test Lead",
  });

  assert.deepEqual(riskRowToTableCells(fallback), [
    "No activity-specific risks recorded",
    fallback.whyHazard,
    "N/A",
    "N/A",
    fallback.actionsBeforeEvent,
    fallback.actionsDuringEvent,
    "Test Lead",
  ]);

  const rows = riskRowsForDocument({
    eventId: "EVT-20261104-ai-startup-sprint-c91d",
    eventName: "AI Startup Sprint",
  });
  assert.equal(rows.activityRisks.length, 1);
  assert.equal(
    rows.activityRisks[0].hazardIdentified,
    "No activity-specific risks recorded",
  );
});

test("risk table request builders locate tagged rows and fill cells descending by index", () => {
  const document = fakeRiskDocument();
  const match = findRiskTemplateRow(document, "{{#core_risks}}");
  assert.equal(match?.tableStartIndex, 20);
  assert.equal(match?.rowIndex, 0);

  const insertRows = buildRiskTableRowInsertRequests(match!, 3);
  assert.equal(insertRows.length, 2);
  assert.equal(
    insertRows[0].insertTableRow?.tableCellLocation?.tableStartLocation?.index,
    20,
  );
  assert.equal(insertRows[0].insertTableRow?.tableCellLocation?.rowIndex, 0);

  const riskRows = riskRowsForDocument({
    eventId: "EVT-20261104-ai-startup-sprint-c91d",
    eventName: "AI Startup Sprint",
    expectedAttendance: 120,
  }).coreRisks.slice(0, 2);
  const fillRequests = buildRiskTableFillRequests(
    document,
    "{{#core_risks}}",
    riskRows,
  );
  const insertedText = fillRequests
    .map((request) => request.insertText?.text)
    .filter((value): value is string => Boolean(value));

  assert.ok(insertedText.includes("Capacity Control"));
  assert.ok(insertedText.includes("Crowd Control"));
  assert.equal(fillRequests[0].deleteContentRange?.range?.startIndex, 1290);
  assert.equal(fillRequests[1].insertText?.location?.index, 1290);
});

test("risk assessment header updates replace generated scalar fields by template label", () => {
  const plan = buildRiskHeaderScalarUpdateRequests(fakeHeaderDocument(), {
    eventId: "EVT-20261104-ai-startup-sprint-c91d",
    eventName: "AI Startup Sprint",
    proposedDate: "2026-11-04",
    setupStartTime: "17:00",
    eventStartTime: "18:00",
    eventEndTime: "20:00",
    preferredLocation: "Saw Swee Hock Student Centre",
    organiserName: "Velocity President",
    organiserLseEmail: "velocity@example.com",
    organiserContactNumber: "07123456789",
    firstAidPlan: "Named first aider plus LSE Security escalation route.",
    generatedAtUtc: "2026-06-21T09:00:00.000Z",
  });
  const insertedText = plan.requests
    .map((request) => request.insertText?.text)
    .filter((value): value is string => Boolean(value));

  assert.deepEqual(plan.missingFields, []);
  assert.ok(plan.updatedFields.includes("event_location"));
  assert.ok(insertedText.includes("AI Startup Sprint"));
  assert.ok(insertedText.includes("Saw Swee Hock Student Centre"));
  assert.ok(insertedText.includes("04-11-2026, setup 17:00, event 18:00-20:00"));
  assert.ok(insertedText.includes("21-06-2026"));
});

test("generated risk sections are found case-insensitively from risk row builders", () => {
  const input: EventPackInput = {
    eventId: "EVT-20261104-ai-startup-sprint-c91d",
    eventName: "AI Startup Sprint",
    foodOrRefreshments: true,
  };
  const sections = findGeneratedRiskSections(
    fakeGeneratedRiskDocument({ input, activityRowCount: 1, lowerCaseHazards: true }),
  );
  const hazards = generatedRiskHazardsForDetection();

  assert.equal(sections?.core.currentRowCount, hazards.core.length);
  assert.equal(sections?.activity.currentRowCount, 1);
  assert.equal(sections?.core.rowIndex, 1);
  assert.equal(sections?.activity.rowIndex, 8);
});

test("generated activity risk rows resize without shifting earlier rows", () => {
  const input: EventPackInput = {
    eventId: "EVT-20261104-ai-startup-sprint-c91d",
    eventName: "AI Startup Sprint",
    foodOrRefreshments: true,
  };
  const sections = findGeneratedRiskSections(
    fakeGeneratedRiskDocument({ input, activityRowCount: 1 }),
  );
  assert.ok(sections);

  const inserts = buildGeneratedRiskRowInsertRequests(sections.activity, 3);
  const deletes = buildGeneratedRiskRowDeleteRequests(
    { ...sections.activity, currentRowCount: 3 },
    1,
  );

  assert.equal(inserts.length, 2);
  assert.equal(
    inserts[0].insertTableRow?.tableCellLocation?.rowIndex,
    sections.activity.rowIndex,
  );
  assert.equal(deletes.length, 2);
  assert.equal(
    deletes[0].deleteTableRow?.tableCellLocation?.rowIndex,
    sections.activity.rowIndex + 2,
  );
});

test("partial risk assessment reruns fill the remaining marker then update generated rows", async () => {
  const input: EventPackInput = {
    eventId: "EVT-20261104-ai-startup-sprint-c91d",
    eventName: "AI Startup Sprint",
    foodOrRefreshments: true,
    alcohol: true,
  };
  const partialInitial = fakeRiskTemplateDocumentWithRows({
    marker: "{{#core_risks}}",
    rowCount: 1,
  });
  const partialAfterInsert = fakeRiskTemplateDocumentWithRows({
    marker: "{{#core_risks}}",
    rowCount: riskRowsForDocument(input).coreRisks.length,
  });
  const generated = fakeGeneratedRiskDocument({ input, activityRowCount: 1 });
  const generatedAfterResize = fakeGeneratedRiskDocument({
    input,
    activityRowCount: riskRowsForDocument(input).activityRisks.length,
  });
  const { docsClient, batchUpdates } = fakeDocsClientSequence([
    partialInitial,
    partialInitial,
    partialAfterInsert,
    generated,
    generatedAfterResize,
  ]);

  const result = await fillRiskAssessmentTables({
    documentId: "risk-doc",
    input,
    allowAlreadyFilled: true,
    docsClient,
  });

  assert.deepEqual(
    result.sections.map((section) => section.status),
    ["updated", "filled"],
  );
  assert.ok(
    batchUpdates.some((requests) =>
      requests.some((request) => Boolean(request.insertTableRow)),
    ),
  );
  assert.ok(
    batchUpdates.some((requests) =>
      requests.some((request) => request.insertText?.text === "Capacity Control"),
    ),
  );
  assert.equal(result.activityRiskRows, 2);
});

test("docs request sorting keeps higher indexes first and deletes before same-index inserts", () => {
  const requests: IndexedDocsRequest[] = [
    {
      startIndex: 10,
      sequence: 1,
      request: { insertText: { location: { index: 10 }, text: "insert-low" } },
    },
    {
      startIndex: 20,
      sequence: 1,
      request: { insertText: { location: { index: 20 }, text: "insert-high" } },
    },
    {
      startIndex: 10,
      sequence: 0,
      request: { deleteContentRange: { range: { startIndex: 10, endIndex: 15 } } },
    },
  ];

  const sorted = sortDocsRequestsDescending(requests);
  assert.equal(sorted[0].insertText?.text, "insert-high");
  assert.equal(sorted[1].deleteContentRange?.range?.startIndex, 10);
  assert.equal(sorted[2].insertText?.text, "insert-low");
});

test("regular form field pack carries official regular-route fields", () => {
  const body = buildFormFieldPackBody({
    eventId: "EVT-20261104-ai-startup-sprint-c91d",
    eventName: "AI Startup Sprint",
    classificationRoute: "regular_event_candidate",
    isRepeatedEvent: true,
    repeatedEventDates: "04-11-2026; 11-11-2026",
    publicOrNonLseAttendees: true,
    publicEventAcademicChairNote: "Check whether public attendance requires an academic chair.",
  });

  assert.match(body, /Is your activity repeated across multiple dates\?/);
  assert.match(body, /Repeated dates, if any/);
  assert.match(body, /04-11-2026; 11-11-2026/);
  assert.match(body, /Confirmation: no external speakers/);
  assert.match(body, /Public\/open academic chair note, if relevant/);
});

test("large speaker form field pack carries manual submission and promotion gates", () => {
  const body = buildFormFieldPackBody(
    {
      eventId: "EVT-20261104-ai-startup-sprint-c91d",
      eventName: "AI Startup Sprint",
      eventDescription: "A practical AI product sprint.",
      proposedDate: "2026-11-04",
      expectedAttendance: 120,
      classificationRoute: "large_speaker_event",
      classificationReason: "External speaker and attendance over 75.",
      externalSpeakers: [
        {
          name: "Speaker One",
          role: "Founder",
          organisation: "Example AI",
          topic: "AI startups",
        },
      ],
      sponsorInvolved: true,
      sponsorName: "Example Sponsor",
      missingCriticalFields: ["First-aid plan"],
    },
    {
      riskAssessmentLink: "https://docs.google.com/document/d/risk/edit",
      budgetLink: "https://docs.google.com/spreadsheets/d/budget/edit",
    },
  );

  assert.match(body, /Large Event or Speaker Event Form/);
  assert.match(body, /Is this sports training or a match\?/);
  assert.match(body, /Attendee registration \/ entry plan/);
  assert.match(body, /Under-18s \/ schools \/ vulnerable adults \/ DBS details/);
  assert.match(body, /SUF status/);
  assert.match(body, /Contracts attached\?/);
  assert.match(body, /Speaker promotion blocked until SU speaker approval is clear/);
  assert.match(body, /Humans submit|manual/i);
  assert.match(body, /First-aid plan/);
});


test("internal review summary uses the actual budget generation decision", () => {
  const input = {
    eventId: "EVT-20261104-ai-startup-sprint-c91d",
    eventName: "AI Startup Sprint",
    estimatedCost: 600,
  };

  const skippedDecision = budgetRequirement(input, "never");
  const skippedSummary = buildInternalReviewSummaryBody(input, {}, skippedDecision);
  assert.match(skippedSummary, /Budget status: Not generated\./);
  assert.doesNotMatch(skippedSummary, /Generated because required by threshold/);

  const requestedDecision = budgetRequirement(
    { ...input, estimatedCost: 50 },
    "always",
  );
  const requestedSummary = buildInternalReviewSummaryBody(
    { ...input, estimatedCost: 50 },
    { budgetLink: "https://docs.google.com/spreadsheets/d/budget/edit" },
    requestedDecision,
  );
  assert.match(requestedSummary, /Budget status: Generated for internal planning\./);
  assert.doesNotMatch(requestedSummary, /Not generated by current threshold/);
});



