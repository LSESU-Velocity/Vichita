import assert from "node:assert/strict";
import test from "node:test";

import type { docs_v1 } from "googleapis";

import {
  assertPackFolderEventIdMatches,
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
  isIsoCalendarDate,
  isoDatePart,
} from "../agent/lib/dateLabels.ts";
import {
  createOrFindEventPackFolder,
  findEventPackFolderForUpdate,
  eventPackFolderDisplayEventName,
  eventPackFolderMatchesEventName,
  eventPackFolderName,
} from "../agent/lib/googleWorkspace/drive.ts";
import { minimalTextEdit } from "../agent/lib/googleWorkspace/docs.ts";
import {
  buildColumnExpansionRequest,
  columnLetter,
  compareHeaders,
  trackerGridProperties,
  trackerRequiredColumnCount,
  patchTrackerRow,
  upsertTrackerRows,
} from "../agent/lib/googleWorkspace/sheets.ts";
import { buildSourceRegistryEntry } from "../agent/lib/sourceRegistry.ts";
import { isSlackViewSubmissionBody } from "../agent/lib/slackProxy.ts";
import { classifyEventInput } from "../agent/tools/classify_event.ts";
import { getTrackerTabDefinition } from "../agent/lib/googleWorkspace/trackerSchemas.ts";
import {
  budgetRequirement,
  buildAccessibilityComplianceTaskRows,
  buildBudgetQuantityNumberFormatRequests,
  buildBudgetSheetUpdates,
  buildDeadlineComplianceTaskRows,
  buildDeadlinePlanBody,
  buildDeadlinePlanSheet,
  buildEventTrackerRow,
  buildFormFieldPackBody,
  buildFormFieldPackSheet,
  buildInternalReviewSummaryBody,
  buildRiskAssessmentScalarReplacements,
  buildRiskRows,
  effectiveMissingCriticalFields,
  packDocumentFileName,
  plainGoogleDocText,
  type EventPackInput,
} from "../agent/lib/eventPack.ts";
import {
  buildGeneratedRiskCellUpdateRequests,
  buildGeneratedRiskRowDeleteRequests,
  buildGeneratedRiskRowInsertRequests,
  buildNoActivityRiskRow,
  buildRiskHeaderFieldValueUpdateRequests,
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
import {
  eventPackRoutingContext,
  eventPackUpdateFastPathContext,
  matchesEventPackRegenerateInPlace,
  matchesEventPackUpdateFastPath,
} from "../agent/lib/eventPackFastPath.ts";
import {
  applyStaleReplacements,
  buildStaleReplacements,
  changedFieldNames,
  changesRequireDeadlineRecompute,
  choosePackVersion,
  dateTimeAnswerFromChanges,
  eventDateLabelFromChanges,
  formFieldUpdatesFromChanges,
  listPackVersions,
  oldDateReferenceVariants,
  parseDateTimeAnswer,
  renamedPackBaseName,
} from "../agent/tools/update_event_pack_fields.ts";

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

test("event identity rejects impossible calendar dates", () => {
  assert.equal(parseEventId("EVT-20270230-global-build-cafe"), null);
  assert.throws(
    () =>
      buildEventIdentity({
        eventName: "Global Build 2027",
        proposedDate: "2027-02-30",
      }),
    /real ISO calendar date/,
  );
  assert.throws(
    () => buildPackId("EVT-20270230-global-build-cafe"),
    /EVT-YYYYMMDD-event-slug-shortid/,
  );
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
  assert.equal(displayDateFromIsoDate("2027-02-30"), undefined);
  assert.equal(displayDateFromEventDatePart("20270230"), undefined);
  assert.equal(isIsoCalendarDate("2027-02-28"), true);
  assert.equal(isIsoCalendarDate("2027-02-30"), false);
  assert.equal(isoDatePart("2027-02-28"), "20270228");
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

test("event pack folder matching detects same visible event names", () => {
  assert.equal(
    eventPackFolderDisplayEventName("04-11-2026 - AI Startup Sprint"),
    "AI Startup Sprint",
  );
  assert.equal(
    eventPackFolderMatchesEventName({
      folderName: "04-11-2026 - AI Startup Sprint",
      eventName: "AI startup sprint",
    }),
    true,
  );
  assert.equal(
    eventPackFolderMatchesEventName({
      folderName: "04-11-2026 - Cafe Demo Night",
      eventName: "Café demo night",
    }),
    true,
  );
  assert.equal(
    eventPackFolderMatchesEventName({
      folderName: "04-11-2026 - AI Startup Sprint",
      eventName: "AI Policy Workshop",
    }),
    false,
  );
});

function withFakeGoogleWorkspaceEnv(run: () => Promise<void>) {
  const originalEnv = {
    GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64,
    GOOGLE_DRIVE_ROOT_FOLDER_ID: process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID,
    GOOGLE_TRACKERS_SPREADSHEET_ID: process.env.GOOGLE_TRACKERS_SPREADSHEET_ID,
  };
  const credentials = {
    client_email: "service@example.iam.gserviceaccount.com",
    private_key: "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n",
  };
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 = Buffer.from(
    JSON.stringify(credentials),
  ).toString("base64");
  process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID = "drive-root";
  process.env.GOOGLE_TRACKERS_SPREADSHEET_ID = "tracker-sheet";

  return run().finally(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });
}

test("event pack folder creation refuses same-name duplicates when identity does not match", async () => {
  await withFakeGoogleWorkspaceEnv(async () => {
    const calls = { create: 0 };
    const fakeDrive = {
      files: {
        get: async () => ({
          data: {
            id: "drive-root",
            name: "Vichita",
            mimeType: "application/vnd.google-apps.folder",
            driveId: "shared-drive",
            trashed: false,
            webViewLink: "https://drive/folders/drive-root",
            capabilities: { canAddChildren: true, canEdit: true },
          },
        }),
        list: async ({ q }: { q: string }) => {
          if (q.includes("name = 'Event Packs'")) {
            return {
              data: {
                files: [
                  {
                    id: "event-packs-root",
                    name: "Event Packs",
                    webViewLink: "https://drive/folders/event-packs-root",
                  },
                ],
              },
            };
          }

          if (q.includes("appProperties has")) {
            return { data: { files: [] } };
          }

          if (q.includes("'event-packs-root' in parents")) {
            return {
              data: {
                files: [
                  {
                    id: "existing-pack",
                    name: "04-11-2026 - AI Startup Sprint",
                    webViewLink: "https://drive/folders/existing-pack",
                    appProperties: {
                      vichitaEventId: "EVT-20261104-ai-startup-sprint-aaaabbbb",
                    },
                  },
                ],
              },
            };
          }

          return { data: { files: [] } };
        },
        create: async () => {
          calls.create += 1;
          return { data: { id: "new-pack", name: "21-06-2026 - AI startup sprint" } };
        },
      },
    };

    await assert.rejects(
      () =>
        createOrFindEventPackFolder({
          eventId: "EVT-20260621-ai-startup-sprint-ccccdddd",
          eventName: "AI startup sprint",
          client: fakeDrive as never,
        }),
      /same event name already exists/,
    );
    assert.equal(calls.create, 0);
  });
});
test("event pack update lookup can find a unique existing folder by visible event name", async () => {
  await withFakeGoogleWorkspaceEnv(async () => {
    const fakeDrive = {
      files: {
        get: async () => ({
          data: {
            id: "drive-root",
            name: "Vichita",
            mimeType: "application/vnd.google-apps.folder",
            driveId: "shared-drive",
            trashed: false,
            webViewLink: "https://drive/folders/drive-root",
            capabilities: { canAddChildren: true, canEdit: true },
          },
        }),
        list: async ({ q }: { q: string }) => {
          if (q.includes("name = 'Event Packs'")) {
            return {
              data: {
                files: [
                  {
                    id: "event-packs-root",
                    name: "Event Packs",
                    webViewLink: "https://drive/folders/event-packs-root",
                  },
                ],
              },
            };
          }
          if (q.includes("'event-packs-root' in parents")) {
            return {
              data: {
                files: [
                  {
                    id: "existing-pack",
                    name: "04-11-2026 - AI Startup Sprint",
                    webViewLink: "https://drive/folders/existing-pack",
                    appProperties: {
                      vichitaEventId: "EVT-20261104-ai-startup-sprint-aaaabbbb",
                    },
                  },
                ],
              },
            };
          }
          return { data: { files: [] } };
        },
      },
    };

    const result = await findEventPackFolderForUpdate({
      eventName: "AI startup sprint",
      client: fakeDrive as never,
    });

    assert.equal(result.matchedBy, "event_name");
    assert.equal(result.folder.id, "existing-pack");
    assert.equal(
      result.folder.appProperties?.vichitaEventId,
      "EVT-20261104-ai-startup-sprint-aaaabbbb",
    );
  });
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

test("event pack budget sheet reconciles partial expenses to the stated event cost", () => {
  const updates = buildBudgetSheetUpdates({
    eventId: "EVT-20261015-ai-build-night-312f884a",
    eventName: "AI Build Night",
    estimatedCost: 650,
    budget: {
      expenses: [
        {
          description: "Pizza",
          pricePerItem: 15,
          quantity: 20,
          notes: "Notion-sponsored",
        },
        {
          description: "Soft drinks",
          pricePerItem: 1.5,
          quantity: 100,
          notes: "Notion-sponsored",
        },
        {
          description: "Room/setup supplies",
          pricePerItem: 50,
          quantity: 1,
        },
      ],
      income: {
        sponsorship: {
          pricePerItem: 300,
          quantity: 1,
          notes: "Notion sponsorship",
        },
        societyAccountContribution: {
          pricePerItem: 350,
          quantity: 1,
          notes: "Society balance contribution",
        },
      },
    },
  });
  const expenseDescriptions = updates.find((update) => update.range === "'Budget Template'!B7:B16");
  const expenseNumbers = updates.find((update) => update.range === "'Budget Template'!C7:D16");
  const expenseNotes = updates.find((update) => update.range === "'Budget Template'!F7:F16");

  assert.equal(expenseDescriptions?.values[3][0], "Unitemised estimated costs");
  assert.equal(expenseNumbers?.values[3][0], 150);
  assert.equal(expenseNumbers?.values[3][1], 1);
  assert.match(String(expenseNotes?.values[3][0]), /matches the total event cost estimate/);

  const expenditureTotal = expenseNumbers?.values.reduce((total, row) => {
    const price = typeof row[0] === "number" ? row[0] : 0;
    const quantity = typeof row[1] === "number" ? row[1] : 0;
    return total + price * quantity;
  }, 0);

  assert.equal(expenditureTotal, 650);
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
test("partial risk assessment header updates touch only requested fields", () => {
  const plan = buildRiskHeaderFieldValueUpdateRequests(fakeHeaderDocument(), {
    event_location: "Saw Swee Hock SU07",
  });
  const insertedText = plan.requests
    .map((request) => request.insertText?.text)
    .filter((value): value is string => Boolean(value));

  assert.deepEqual(plan.missingFields, []);
  assert.deepEqual(plan.updatedFields, ["event_location"]);
  assert.deepEqual(insertedText, ["Saw Swee Hock SU07"]);
});

test("partial risk row updates target generated cells without rebuilding tables", () => {
  const input: EventPackInput = {
    eventId: "EVT-20261104-ai-startup-sprint-c91d",
    eventName: "AI Startup Sprint",
    expectedAttendance: 120,
  };
  const plan = buildGeneratedRiskCellUpdateRequests(
    fakeGeneratedRiskDocument({ input, activityRowCount: 1 }),
    [
      {
        hazardIdentified: "Capacity Control",
        column: "actions_before_event",
        text: "Confirm expected attendance (150) against venue capacity.",
      },
    ],
  );
  const insertedText = plan.requests
    .map((request) => request.insertText?.text)
    .filter((value): value is string => Boolean(value));

  assert.deepEqual(plan.missingCells, []);
  assert.deepEqual(plan.updatedCells, ["Capacity Control:actions_before_event"]);
  assert.deepEqual(insertedText, ["Confirm expected attendance (150) against venue capacity."]);
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

test("form field pack sheet carries copy-ready rows and check columns", () => {
  const sheet = buildFormFieldPackSheet(
    {
      eventId: "EVT-20261104-ai-startup-sprint-c91d",
      eventName: "AI Startup Sprint",
      proposedDate: "2026-11-04",
      expectedAttendance: 120,
      classificationRoute: "large_speaker_event",
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
      missingCriticalFields: ["Academic chair status"],
    },
    {
      riskAssessmentLink: "https://docs.google.com/document/d/risk/edit",
      deadlinePlanLink: "https://docs.google.com/spreadsheets/d/deadline/edit",
      accessibilityTasksStatus: "Tracked in Compliance Tasks (7 rows).",
    },
  );

  assert.equal(sheet.sheetTitle, "Form Fields");
  assert.deepEqual(sheet.values[0], [
    "Section",
    "Official form field",
    "Draft answer",
    "Entered?",
    "Needs review?",
    "Notes",
  ]);
  assert.deepEqual(sheet.checkboxColumns, [4]);
  assert.ok(
    sheet.values.some(
      (row) => row[1] === "Attendee registration / entry plan" && row[3] === false,
    ),
  );
  assert.ok(
    sheet.values.some(
      (row) => row[1] === "Accessibility tasks" && String(row[2]).includes("Compliance Tasks"),
    ),
  );
  assert.ok(
    sheet.values.some(
      (row) => row[1] === "Academic chair status" && row[4] === "yes",
    ),
  );
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




test("plain Google Doc text strips Markdown syntax before support docs are written", () => {
  const raw = `# LSESU Form Field Pack

## Core Event Fields

| Official form field | Draft answer |
|---|---|
| What is the name of your event? | AI Startup Sprint |
| Budget attached? | Draft linked below |

- [ ] Confirm venue accessibility.
- Event ID: EVT-20261104-ai-startup-sprint-c91d
`;
  const body = plainGoogleDocText(raw);

  assert.match(body, /^LSESU Form Field Pack$/m);
  assert.match(body, /^Core Event Fields$/m);
  assert.match(body, /What is the name of your event\?: AI Startup Sprint/);
  assert.match(body, /Budget attached\?: Draft linked below/);
  assert.match(body, /TODO: Confirm venue accessibility\./);
  assert.match(body, /Event ID: EVT-20261104-ai-startup-sprint-c91d/);
  assert.doesNotMatch(body, /^\s*#/m);
  assert.doesNotMatch(body, /^\|/m);
  assert.doesNotMatch(body, /- \[ \]/);
});

test("deadline sheet rows match compliance task upsert keys", () => {
  const input = {
    eventId: "EVT-20261104-ai-startup-sprint-c91d",
    eventName: "AI Startup Sprint",
    organiserName: "Velocity President",
    deadlines: [
      {
        task: "Submit large event form",
        dueDate: "2026-08-31",
        deadlineType: "hard_gate",
        sourceRule: "Large event term deadline",
        blocksFinalSubmissionReadiness: true,
        notes: ["Verify current academic year."],
      },
    ],
  };
  const sheet = buildDeadlinePlanSheet(input);
  const taskRows = buildDeadlineComplianceTaskRows(input);

  const changedDateRows = buildDeadlineComplianceTaskRows({
    ...input,
    deadlines: [{ ...input.deadlines[0], dueDate: "2026-09-01" }],
  });
  const reorderedRows = buildDeadlineComplianceTaskRows({
    ...input,
    deadlines: [
      {
        task: "Confirm catering request",
        dueDate: "2026-10-21",
        deadlineType: "dependency",
        sourceRule: "Catering lead time",
      },
      input.deadlines[0],
    ],
  });

  assert.equal(sheet.sheetTitle, "Deadline Plan");
  assert.equal(sheet.values[1][0], taskRows[0]["Task ID"]);
  assert.equal(sheet.values[1][3], "Submit large event form");
  assert.equal(taskRows[0]["Blocker?"], "yes");
  assert.equal(taskRows[0].Owner, "Velocity President");
  assert.doesNotMatch(String(taskRows[0]["Task ID"]), /deadline-01-/);
  assert.equal(changedDateRows[0]["Task ID"], taskRows[0]["Task ID"]);
  assert.equal(reorderedRows[1]["Task ID"], taskRows[0]["Task ID"]);
});

test("accessibility checklist is represented as compliance task rows", () => {
  const rows = buildAccessibilityComplianceTaskRows({
    eventId: "EVT-20261104-ai-startup-sprint-c91d",
    eventName: "AI Startup Sprint",
    organiserName: "Velocity President",
    preferredLocation: "MAR 2.08",
    foodOrRefreshments: true,
    deadlines: [
      {
        task: "Internal target",
        dueDate: "2026-08-24",
        deadlineType: "internal_gate",
      },
    ],
  });

  assert.equal(rows.length, 7);
  assert.ok(rows.every((row) => String(row["Task ID"]).includes("accessibility")));
  assert.equal(rows[0]["Due Date"], "2026-08-24");
  assert.equal(rows.find((row) => String(row["Task ID"]).endsWith("request-route"))?.["Blocker?"], "yes");
  assert.equal(rows.find((row) => String(row["Task ID"]).endsWith("food-allergens"))?.["Blocker?"], "yes");
});
test("tracker row patches update only supplied columns", async () => {
  await withFakeGoogleWorkspaceEnv(async () => {
    const headers = getTrackerTabDefinition("Events Tracker")?.headers ?? [];
    const calls = {
      get: [] as unknown[],
      batchUpdate: [] as unknown[],
    };
    const existing = headers.map((header) => {
      if (header === "Event ID") return "EVT-20261104-ai-startup-sprint-c91d";
      if (header === "Event Name") return "AI Startup Sprint";
      if (header === "Expected Attendance") return 120;
      if (header === "Pack Folder Link") return "https://drive/folders/pack";
      return "";
    });
    const fakeClient = {
      spreadsheets: {
        values: {
          get: async (args: unknown) => {
            calls.get.push(args);
            const range = (args as { range: string }).range;
            return range.endsWith("!1:1")
              ? { data: { values: [headers] } }
              : { data: { values: [existing] } };
          },
          batchUpdate: async (args: unknown) => {
            calls.batchUpdate.push(args);
            return { data: {} };
          },
        },
      },
    };

    const result = await patchTrackerRow({
      tabName: "Events Tracker",
      keyColumn: "Event ID",
      keyValue: "EVT-20261104-ai-startup-sprint-c91d",
      patch: {
        "Expected Attendance": 150,
        "Last Updated": "2026-06-21T08:20:00.000Z",
      },
      client: fakeClient as never,
    });
    const data = (calls.batchUpdate[0] as { requestBody: { data: Array<{ range: string; values: unknown[][] }> } }).requestBody.data;

    assert.equal(result.action, "patched");
    assert.deepEqual(result.patchedColumns, ["Expected Attendance", "Last Updated"]);
    assert.equal(calls.get.length, 2);
    assert.equal(calls.batchUpdate.length, 1);
    assert.equal(data.length, 2);
    assert.deepEqual(data.map((entry) => entry.values[0][0]), [150, "2026-06-21T08:20:00.000Z"]);
  });
});
test("batch tracker upsert reads once and writes mixed task rows together", async () => {
  const originalEnv = {
    GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64,
    GOOGLE_DRIVE_ROOT_FOLDER_ID: process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID,
    GOOGLE_TRACKERS_SPREADSHEET_ID: process.env.GOOGLE_TRACKERS_SPREADSHEET_ID,
  };
  const credentials = {
    client_email: "service@example.iam.gserviceaccount.com",
    private_key: "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n",
  };
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 = Buffer.from(
    JSON.stringify(credentials),
  ).toString("base64");
  process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID = "drive-root";
  process.env.GOOGLE_TRACKERS_SPREADSHEET_ID = "tracker-sheet";

  const headers = getTrackerTabDefinition("Compliance Tasks")?.headers ?? [];
  const calls = {
    get: [] as unknown[],
    batchUpdate: [] as unknown[],
    append: [] as unknown[],
  };
  const existing = headers.map((header) => {
    if (header === "Task ID") return "task-existing";
    if (header === "Event ID") return "EVT-20261104-ai-startup-sprint-c91d";
    if (header === "Task") return "Old task";
    return "";
  });
  const fakeClient = {
    spreadsheets: {
      values: {
        get: async (args: unknown) => {
          calls.get.push(args);
          const range = (args as { range: string }).range;
          return range.endsWith("!1:1")
            ? { data: { values: [headers] } }
            : { data: { values: [existing] } };
        },
        batchUpdate: async (args: unknown) => {
          calls.batchUpdate.push(args);
          return { data: {} };
        },
        append: async (args: unknown) => {
          calls.append.push(args);
          return { data: { updates: { updatedRange: "'Compliance Tasks'!A3:K3" } } };
        },
      },
    },
  };

  try {
    const result = await upsertTrackerRows({
      tabName: "Compliance Tasks",
      keyColumn: "Task ID",
      rows: [
        {
          "Task ID": "task-existing",
          "Event ID": "EVT-20261104-ai-startup-sprint-c91d",
          Task: "Updated task",
          Owner: "Velocity President",
        },
        {
          "Task ID": "task-new",
          "Event ID": "EVT-20261104-ai-startup-sprint-c91d",
          Task: "New task",
          Owner: "Velocity President",
        },
      ],
      client: fakeClient as never,
    });

    assert.equal(result.updatedRows, 1);
    assert.equal(result.appendedRows, 1);
    assert.equal(calls.get.length, 2);
    assert.equal(calls.batchUpdate.length, 1);
    assert.equal(calls.append.length, 1);
  } finally {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("slack modal helper recognises view submissions", () => {
  const body = new URLSearchParams({
    payload: JSON.stringify({
      type: "view_submission",
      view: { callback_id: "eve_input_freeform_submit" },
    }),
  }).toString();

  assert.equal(
    isSlackViewSubmissionBody("application/x-www-form-urlencoded", body),
    true,
  );
  assert.equal(isSlackViewSubmissionBody("application/json", body), false);
});

test("classifier treats a multi-day single-venue hackathon as large event, not trip", () => {
  const result = classifyEventInput({
    eventName: "Global Build 2027",
    eventDescription:
      "Create an event pack for February 27-Mar 1, a hackathon called Global Build 2027 at the LSE Generate hub. Around 100 people are expected, including students from KCL and UCL. Food is sponsored by Base for GBP 500.",
    expectedAttendance: 100,
    estimatedBudgetGbp: 500,
    sponsorInvolved: true,
    overnightTrip: true,
    multiDayAtSingleVenue: true,
  });

  assert.equal(result.route, "large_event");
  assert.ok(result.triggers.includes("Expected attendance over 75"));
  assert.doesNotMatch(result.triggers.join("\n"), /trip|m25|overnight/i);
  assert.ok(
    result.nonTriggers.some((entry) =>
      /Multi-day duration at one named venue/.test(entry),
    ),
  );
  assert.ok(
    result.nonTriggers.some((entry) =>
      /External university attendees/.test(entry),
    ),
  );
});

test("classifier sends actual beyond-M25 overnight travel to the trips process", () => {
  const result = classifyEventInput({
    eventName: "Oxford Build Retreat",
    eventDescription:
      "A weekend trip to Oxford beyond the M25 with coach transport and hostel accommodation overnight.",
    expectedAttendance: 35,
    tripBeyondM25: true,
    overnightTrip: true,
  });

  assert.equal(result.route, "trip_process");
  assert.match(result.triggers.join("\n"), /beyond-M25|overnight|trip/i);
});

test("classifier does not treat external universities attending as a trip", () => {
  const result = classifyEventInput({
    eventName: "Inter-university Build Night",
    eventDescription:
      "A workshop at the LSE Generate hub with students from KCL and UCL attending. No travel or accommodation is planned.",
    expectedAttendance: 60,
  });

  assert.equal(result.route, "regular_event_candidate");
  assert.ok(
    result.nonTriggers.some((entry) =>
      /External university attendees/.test(entry),
    ),
  );
});

test("classifier does not promote venue keywords to trips without trip flags", () => {
  const hotelGala = classifyEventInput({
    eventName: "Sponsor Gala Dinner",
    eventDescription: "A gala dinner at the Marriott Hotel for 50 people.",
    expectedAttendance: 50,
  });
  const campusTour = classifyEventInput({
    eventName: "Freshers Welcome",
    eventDescription: "Freshers welcome including a short campus tour.",
    expectedAttendance: 50,
  });

  assert.equal(hotelGala.route, "regular_event_candidate");
  assert.equal(campusTour.route, "regular_event_candidate");
});

test("classifier demotes an on-site overnight but trusts an away overnight flag", () => {
  // overnightTrip + multiDayAtSingleVenue with no beyond-M25 travel = an on-site
  // overnight at the usual venue, which is not a trip.
  const onSiteOvernight = classifyEventInput({
    eventName: "On-site Hack",
    eventDescription:
      "A multi-day hackathon at the LSE Generate hub where some participants sleep on-site.",
    expectedAttendance: 100,
    overnightTrip: true,
    multiDayAtSingleVenue: true,
  });
  // A bare overnightTrip flag is the model's away-overnight judgement and is trusted.
  const awayOvernight = classifyEventInput({
    eventName: "Away Overnight",
    expectedAttendance: 40,
    overnightTrip: true,
  });

  assert.equal(onSiteOvernight.route, "large_event");
  assert.equal(awayOvernight.route, "trip_process");
  assert.ok(
    onSiteOvernight.humanReview.some((entry) => /off-site trip/.test(entry)),
  );
});

test("classifier preserves explicitly flagged beyond-M25 day trips", () => {
  const result = classifyEventInput({
    eventName: "Thorpe Park Day Trip",
    eventDescription: "Taking the team to Thorpe Park for the day.",
    expectedAttendance: 40,
    tripBeyondM25: true,
  });

  assert.equal(result.route, "trip_process");

  const noOvernight = classifyEventInput({
    eventName: "Oxford Founder Visit",
    eventDescription:
      "Taking the team outside London to Oxford for the day, not staying overnight.",
    expectedAttendance: 35,
    tripBeyondM25: true,
  });

  assert.equal(noOvernight.route, "trip_process");
});

test("classifier preserves real trips when transport is not provided", () => {
  const dayTrip = classifyEventInput({
    eventName: "Bletchley Park Visit",
    eventDescription:
      "A day trip outside London to Bletchley Park. No transport is provided; attendees make their own way.",
    expectedAttendance: 30,
    tripBeyondM25: true,
  });
  const residential = classifyEventInput({
    eventName: "Oxford Residential Retreat",
    eventDescription:
      "An overnight residential retreat in Oxford with hostel accommodation. No transport is provided; attendees make their own way.",
    expectedAttendance: 30,
    overnightTrip: true,
  });

  assert.equal(dayTrip.route, "trip_process");
  assert.equal(residential.route, "trip_process");
});

test("classifier preserves explicit multi-day trips that mention the home campus", () => {
  // A departure-point mention of LSE/campus plus a date range must not let the
  // multi-day-single-venue heuristic demote an explicitly flagged trip.
  const lakeDistrict = classifyEventInput({
    eventName: "Lake District Retreat",
    eventDescription:
      "An overnight residential trip beyond the M25 to the Lake District, departing from LSE, 28th to 30th March.",
    expectedAttendance: 30,
    tripBeyondM25: true,
    overnightTrip: true,
    multiDayAtSingleVenue: true,
  });
  const oxfordCoach = classifyEventInput({
    eventName: "Oxford Hack Exchange",
    eventDescription:
      "A multi-day coach trip to Oxford with an overnight hostel stay. The coach leaves campus on Friday.",
    expectedAttendance: 40,
    overnightTrip: true,
  });

  assert.equal(lakeDistrict.route, "trip_process");
  assert.doesNotMatch(
    lakeDistrict.nonTriggers.join("\n"),
    /Multi-day duration at one named venue/,
  );
  assert.equal(oxfordCoach.route, "trip_process");
});

test("classifier trusts the away flag, not prose, for trip routing", () => {
  // Real away trip: the model sets tripBeyondM25, so it routes to the trips
  // process regardless of unrelated campus-tour wording in the description.
  const awayTrip = classifyEventInput({
    eventName: "Oxford Day Visit",
    eventDescription:
      "A campus tour at LSE followed by a trip to Oxford for the day.",
    expectedAttendance: 30,
    tripBeyondM25: true,
  });
  // When the prompt negates the trip, the model leaves the flag unset, so it
  // routes as a normal event with no prose-negation parsing required.
  const notATrip = classifyEventInput({
    eventName: "Campus-only Session",
    eventDescription:
      "This is not a trip to Oxford; it is a campus tour at LSE only.",
    expectedAttendance: 30,
  });

  assert.equal(awayTrip.route, "trip_process");
  assert.equal(notATrip.route, "regular_event_candidate");
});

test("classifier routes an away or external-venue overnight to the trips process", () => {
  // Away destination: the model sets tripBeyondM25 (it does not mark an off-site
  // destination as multiDayAtSingleVenue).
  const brightonHotel = classifyEventInput({
    eventName: "Brighton Hack Retreat",
    eventDescription:
      "A two-day hack retreat in Brighton with hotel accommodation overnight.",
    expectedAttendance: 30,
    tripBeyondM25: true,
    overnightTrip: true,
  });
  // externalVenue overrides the on-site demotion even when multiDayAtSingleVenue
  // is also set: a multi-day overnight at an external venue is still a trip.
  const externalVenueOvernight = classifyEventInput({
    eventName: "Residential Bootcamp",
    eventDescription:
      "A two-day residential bootcamp at an external venue with hostel accommodation booked off-site overnight.",
    expectedAttendance: 35,
    overnightTrip: true,
    multiDayAtSingleVenue: true,
    externalVenue: true,
  });

  assert.equal(brightonHotel.route, "trip_process");
  assert.equal(externalVenueOvernight.route, "trip_process");
});

test("classifier keeps an on-site overnight at a single venue out of the trips process", () => {
  // Accommodation/overnight wording alone - with no transport or destination
  // beyond the home venue - must not override an explicit single-venue assertion.
  // Multi-day hackathons routinely run overnight on-site at the home campus.
  const residentialStyle = classifyEventInput({
    eventName: "Residential-style Hack",
    eventDescription:
      "A multi-day residential-style coding hackathon at the LSE Generate hub, 28th to 30th.",
    expectedAttendance: 80,
    overnightTrip: true,
    multiDayAtSingleVenue: true,
  });
  const onSiteOvernight = classifyEventInput({
    eventName: "48h Hack",
    eventDescription:
      "A 48-hour hackathon at the LSE Generate hub with an overnight stay for participants who keep coding, 28th to 30th.",
    expectedAttendance: 100,
    overnightTrip: true,
    multiDayAtSingleVenue: true,
  });

  assert.equal(residentialStyle.route, "large_event");
  assert.equal(onSiteOvernight.route, "large_event");
});

test("fast path matches real pack corrections and ignores status reads", () => {
  const triggers = [
    "@vichita the velocity build night 2027 event is now happening from march 1st to 2nd, and it will be at lse old building 4.01 instead. update the pack and all relevant files with this info",
    "update the pack: the venue is now SAW 4.01",
    "move build night to march 2nd",
    "the hackathon is now in room 4.01",
    "set the date to 2027-03-01",
    "attendance should be 150 now",
    "reschedule the demo to friday and fix the files",
    // Supported status fields must still fast-path (not caught by the
    // event-status bail).
    "update the ticketing status to sold out",
    "update the academic chair status to confirmed",
  ];
  for (const message of triggers) {
    assert.equal(matchesEventPackUpdateFastPath(message), true, message);
    assert.match(
      eventPackUpdateFastPathContext(message) ?? "",
      /automated_routing_hint/,
    );
  }

  const nonTriggers = [
    "hey vichita, can you update me on the tracker?",
    "any updates on the pack?",
    "what's the status of build night?",
    "thanks, that looks great",
    "create a pack for our new workshop",
    "can you book a room for tuesday?",
    // Creation / scheduling must not be steered into the existing-pack flow.
    "set up a pack for our new workshop",
    "set up an event pack for build night",
    "can you move my meeting to friday",
    // Event-level status is not a field this tool patches.
    "update the status of the event to confirmed",
  ];
  for (const message of nonTriggers) {
    assert.equal(matchesEventPackUpdateFastPath(message), false, message);
    assert.equal(eventPackUpdateFastPathContext(message), undefined);
  }

  // A create verb far from an unrelated "pack" must not bail a real correction.
  assert.equal(
    matchesEventPackUpdateFastPath(
      "make the venue bigger and update the pack",
    ),
    true,
  );
});

test("regenerate-in-place routing resolves the existing pack before generate_event_pack", () => {
  const message =
    "@vichita regenerate the Velocity QA Build Night 2028 pack in place using the same Event ID and same pack version, with updateExistingDrafts=true. Use March 1 to 2nd 2028, LSE Old Building 4.01, 90 attendees, Notion pizza sponsorship worth 500 GBP, and on-site overnight stay.";

  assert.equal(matchesEventPackRegenerateInPlace(message), true);
  assert.equal(matchesEventPackUpdateFastPath(message), false);

  const context = eventPackRoutingContext(message) ?? "";
  assert.match(context, /find_event_pack/);
  assert.match(context, /generate_event_pack once/);
  assert.match(context, /Do not call prepare_event_identity/);
});

test("provided pack folder rejects a re-minted Event ID instead of duplicating drafts", () => {
  const storedEventId = "EVT-20280215-velocity-qa-build-night-2028-abcd1234";
  const folderName = "01-03-2028 - Velocity QA Build Night 2028";
  const folderLink =
    "https://drive.google.com/drive/folders/REDACTED-TEST-FOLDER-ID";

  // A date-derived Event ID (March 1) must not be written into a folder that
  // already belongs to the original Event ID, or the draft dedupe misses the
  // existing files and silently creates a second set of drafts in the folder.
  assert.throws(
    () =>
      assertPackFolderEventIdMatches({
        storedEventId,
        expectedEventId: "EVT-20280301-velocity-qa-build-night-2028-efd5f254",
        folderName,
        folderLink,
      }),
    /stores Event ID EVT-20280215.*not EVT-20280301.*find_event_pack/s,
  );

  // The resolved (matching) Event ID is accepted.
  assert.doesNotThrow(() =>
    assertPackFolderEventIdMatches({
      storedEventId,
      expectedEventId: storedEventId,
      folderName,
      folderLink,
    }),
  );

  // A legacy/manual folder with no stored Event ID is not blocked.
  assert.doesNotThrow(() =>
    assertPackFolderEventIdMatches({
      storedEventId: undefined,
      expectedEventId: "EVT-20280301-velocity-qa-build-night-2028-efd5f254",
    }),
  );
});

test("event pack date label captures multi-day ranges and preserves omitted parts", () => {
  // Multi-day correction stores a real range.
  assert.equal(
    eventDateLabelFromChanges({
      changes: { proposedDate: "2027-03-01", proposedEndDate: "2027-03-02" },
      currentDate: undefined,
    }),
    "01-03-2027 to 02-03-2027",
  );
  // A new start date defaults to a single day even if the prior label was a
  // range, so a moved start is never paired with a stale earlier end.
  assert.equal(
    eventDateLabelFromChanges({
      changes: { proposedDate: "2027-04-05" },
      currentDate: "01-03-2027 to 02-03-2027",
    }),
    "05-04-2027",
  );
  // A time-only change keeps the existing range.
  assert.equal(
    eventDateLabelFromChanges({
      changes: { eventStartTime: "18:00" },
      currentDate: "01-03-2027 to 02-03-2027",
    }),
    "01-03-2027 to 02-03-2027",
  );
  // Extending the end without moving the start keeps the start day.
  assert.equal(
    eventDateLabelFromChanges({
      changes: { proposedEndDate: "2027-03-03" },
      currentDate: "01-03-2027",
    }),
    "01-03-2027 to 03-03-2027",
  );
});

test("date/time answer renders multi-day ranges and round-trips through the parser", () => {
  const answer = dateTimeAnswerFromChanges({
    changes: {
      proposedDate: "2027-03-01",
      proposedEndDate: "2027-03-02",
      eventStartTime: "18:00",
      eventEndTime: "22:00",
    },
  });
  assert.equal(answer, "01-03-2027 to 02-03-2027, setup TBC, event 18:00-22:00");

  const parsed = parseDateTimeAnswer(answer);
  assert.equal(parsed?.date, "01-03-2027 to 02-03-2027");
  assert.equal(parsed?.eventStartTime, "18:00");
  assert.equal(parsed?.eventEndTime, "22:00");

  // No date/time change means nothing to patch.
  assert.equal(
    dateTimeAnswerFromChanges({ changes: { eventName: "X" } }),
    undefined,
  );
});

test("date changes flag deadline recompute unless non-empty replacement deadlines are supplied", () => {
  assert.equal(
    changesRequireDeadlineRecompute({ proposedDate: "2027-03-01" }),
    true,
  );
  assert.equal(
    changesRequireDeadlineRecompute({ proposedEndDate: "2027-03-02" }),
    true,
  );
  // An empty array is "no deadlines supplied" and must still flag recompute
  // (it must never silently blank the deadline plan).
  assert.equal(
    changesRequireDeadlineRecompute({
      proposedDate: "2027-03-01",
      deadlines: [],
    }),
    true,
  );
  // Real replacement rows suppress the warning.
  assert.equal(
    changesRequireDeadlineRecompute({
      proposedDate: "2027-03-01",
      deadlines: [{ task: "Submit form", notes: [] }],
    }),
    false,
  );
  assert.equal(
    changesRequireDeadlineRecompute({ preferredLocation: "Room 1" }),
    false,
  );
});

test("changedFieldNames ignores empty arrays so the update log stays accurate", () => {
  assert.deepEqual(
    changedFieldNames({ proposedDate: "2027-03-01", deadlines: [] }),
    ["proposedDate"],
  );
  assert.deepEqual(
    changedFieldNames({
      preferredLocation: "Room 1",
      deadlines: [{ task: "Submit form", notes: [] }],
    }),
    ["preferredLocation", "deadlines"],
  );
});

test("listPackVersions returns distinct ascending versions in the folder", async () => {
  const fakeDrive = {
    files: {
      list: async () => ({
        data: {
          files: [
            { appProperties: { vichitaPackVersion: "2" } },
            { appProperties: { vichitaPackVersion: "1" } },
            { appProperties: { vichitaPackVersion: "2" } },
            { appProperties: {} },
          ],
        },
      }),
    },
  };
  assert.deepEqual(
    await listPackVersions({
      drive: fakeDrive as never,
      folderId: "folder",
      eventId: "EVT-1",
    }),
    [1, 2],
  );

  const emptyDrive = {
    files: { list: async () => ({ data: { files: [] } }) },
  };
  assert.deepEqual(
    await listPackVersions({
      drive: emptyDrive as never,
      folderId: "folder",
      eventId: "EVT-1",
    }),
    [],
  );
});

test("choosePackVersion honours an explicit version and refuses to guess across multiple", () => {
  // Explicit request always wins, even when others exist.
  assert.equal(choosePackVersion(2, [1, 2, 3]), 2);
  // Single existing version is used.
  assert.equal(choosePackVersion(undefined, [2]), 2);
  // No versioned files yet falls back to v1 (the no-files case is caught later).
  assert.equal(choosePackVersion(undefined, []), 1);
  // Several versions with no explicit choice must fail rather than edit the
  // wrong (possibly archived) snapshot.
  assert.throws(
    () => choosePackVersion(undefined, [1, 2]),
    /multiple versions/i,
  );
});

test("multi-day events render a date range across generated artifacts", () => {
  const input: EventPackInput = {
    eventId: "EVT-20270301-velocity-build-night-a1b2c3d4",
    eventName: "Velocity Build Night",
    proposedDate: "2027-03-01",
    proposedEndDate: "2027-03-02",
    preferredLocation: "LSE Old Building 4.01",
  };

  // Risk assessment header date/time field.
  assert.equal(
    buildRiskAssessmentScalarReplacements(input)["{{event_dates_times}}"],
    "01-03-2027 to 02-03-2027, setup TBC, event TBC-TBC",
  );

  // Form field pack date/time row.
  const dateRow = buildFormFieldPackSheet(input).values.find(
    (row) => row[1] === "Date and time of activity, including setup time",
  );
  assert.match(String(dateRow?.[2]), /01-03-2027 to 02-03-2027/);

  // Events tracker Date + Time columns.
  const trackerRow = buildEventTrackerRow(input, {});
  assert.equal(trackerRow.Date, "01-03-2027 to 02-03-2027");
  assert.match(String(trackerRow.Time), /01-03-2027 to 02-03-2027/);

  // Deadline plan body event-date line.
  assert.match(
    buildDeadlinePlanBody(input),
    /Event date: 01-03-2027 to 02-03-2027/,
  );

  // A single-day event still renders one date with no "to".
  assert.equal(
    buildRiskAssessmentScalarReplacements({
      ...input,
      proposedEndDate: undefined,
    })["{{event_dates_times}}"],
    "01-03-2027, setup TBC, event TBC-TBC",
  );
});

test("form field pack keeps supplied overview and classification content with the date range", () => {
  const cellOf = (field: string) =>
    buildFormFieldPackSheet({
      eventId: "EVT-20270301-velocity-build-night-a1b2c3d4",
      eventName: "Velocity Build Night",
      proposedDate: "2027-03-01",
      proposedEndDate: "2027-03-02",
      classificationRoute: "large_event",
      classificationReason: "Attendance over 75 at LSE Generate Hub.",
      eventDescription: "Overnight buildathon at LSE Generate Hub.",
    }).values.find((row) => row[1] === field)?.[2];

  assert.match(
    String(cellOf("Date and time of activity, including setup time")),
    /01-03-2027 to 02-03-2027/,
  );
  assert.equal(cellOf("Classification reason"), "Attendance over 75 at LSE Generate Hub.");
  assert.equal(cellOf("Overview of the event"), "Overnight buildathon at LSE Generate Hub.");
});

test("internal review summary shows the date range and the merged location", () => {
  const body = buildInternalReviewSummaryBody({
    eventId: "EVT-20270301-velocity-build-night-a1b2c3d4",
    eventName: "Velocity Build Night",
    proposedDate: "2027-03-01",
    proposedEndDate: "2027-03-02",
    preferredLocation: "LSE Old Building 4.01",
  });

  assert.match(body, /Date: 01-03-2027 to 02-03-2027/);
  assert.match(body, /Location: LSE Old Building 4\.01/);
});

test("accessibility venue task note reflects the current location", () => {
  const venue = buildAccessibilityComplianceTaskRows({
    eventId: "EVT-20270301-velocity-build-night-a1b2c3d4",
    eventName: "Velocity Build Night",
    preferredLocation: "LSE Old Building 4.01",
  }).find((row) => String(row["Task ID"]).endsWith("venue-access"));

  assert.match(String(venue?.Notes), /LSE Old Building 4\.01/);
});

test("missing critical fields surface TBCs instead of None recorded", () => {
  const input: EventPackInput = {
    eventId: "EVT-20270301-velocity-build-night-a1b2c3d4",
    eventName: "Velocity Build Night",
    proposedDate: "2027-03-01",
    proposedEndDate: "2027-03-02",
    preferredLocation: "LSE Generate Hub",
    expectedAttendance: 90,
    missingCriticalFields: ["Sponsor agreement"],
  };
  const missing = effectiveMissingCriticalFields(input);

  // Model-supplied entry is preserved and deterministically derived TBCs are added.
  assert.ok(missing.includes("Sponsor agreement"));
  assert.ok(missing.includes("Event start/end time"));
  assert.ok(missing.includes("First-aid plan"));
  assert.ok(missing.includes("Event lead contact number"));

  const summary = buildInternalReviewSummaryBody(input);
  assert.match(summary, /- First-aid plan/);
  assert.doesNotMatch(summary, /Missing Critical Fields\s+- None recorded/);

  // A fully populated event derives no missing fields.
  assert.deepEqual(
    effectiveMissingCriticalFields({
      ...input,
      missingCriticalFields: [],
      eventStartTime: "18:00",
      eventEndTime: "22:00",
      firstAidPlan: "Named first aider plus LSE Security route.",
      organiserName: "Velocity President",
      organiserLseEmail: "velocity@lse.ac.uk",
      organiserContactNumber: "07000000000",
    }),
    [],
  );
});

test("trip and on-site overnight inputs add the expected activity risk rows", () => {
  const tripHazards = buildRiskRows({
    eventId: "EVT-20260418-cambridge-society-trip-c0ffee01",
    eventName: "Cambridge Society Trip",
    tripBeyondM25: true,
    overnightTrip: true,
    transportPlan: "Return coach from campus.",
    accommodationPlan: "Shared hostel rooms.",
  }).activityRisks.map((row) => row.hazardIdentified);
  assert.ok(tripHazards.includes("Coach Transport and Travel Delays"));
  assert.ok(tripHazards.includes("Overnight Accommodation, Rooming and Welfare"));

  const buildathonHazards = buildRiskRows({
    eventId: "EVT-20270314-velocity-build-night-a1b2c3d4",
    eventName: "Velocity Build Night",
    onSiteOvernightStay: true,
    multiDayAtSingleVenue: true,
  }).activityRisks.map((row) => row.hazardIdentified);
  assert.ok(buildathonHazards.includes("On-site Overnight Stay and Welfare"));

  // A plain on-site event triggers none of the trip/overnight rows.
  const plainHazards = buildRiskRows({
    eventId: "EVT-20261104-ai-startup-sprint-c91d0000",
    eventName: "AI Startup Sprint",
    expectedAttendance: 60,
  }).activityRisks.map((row) => row.hazardIdentified);
  assert.ok(!plainHazards.includes("Coach Transport and Travel Delays"));
  assert.ok(!plainHazards.includes("On-site Overnight Stay and Welfare"));

  // The new hazards must be detectable so in-place updates can find their rows.
  const detectable = generatedRiskHazardsForDetection().activity;
  assert.ok(detectable.includes("Coach Transport and Travel Delays"));
  assert.ok(detectable.includes("Overnight Accommodation, Rooming and Welfare"));
  assert.ok(detectable.includes("On-site Overnight Stay and Welfare"));
});

test("budget quantity columns are reset to a plain number format", () => {
  const requests = buildBudgetQuantityNumberFormatRequests(7);

  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.repeatCell?.range?.sheetId, 7);
    assert.equal(request.repeatCell?.range?.startColumnIndex, 3);
    assert.equal(request.repeatCell?.range?.endColumnIndex, 4);
    assert.equal(
      request.repeatCell?.cell?.userEnteredFormat?.numberFormat?.type,
      "NUMBER",
    );
  }
  // Expense quantity D7:D16 and income quantity D20:D26.
  assert.deepEqual(
    requests.map((request) => [
      request.repeatCell?.range?.startRowIndex,
      request.repeatCell?.range?.endRowIndex,
    ]),
    [
      [6, 16],
      [19, 26],
    ],
  );
});

test("generated pack file names share the rename base name", () => {
  assert.equal(
    packDocumentFileName({
      baseName: "01-03-2027 - Velocity Build Night",
      documentType: "risk-assessment",
      packVersion: 1,
    }),
    "01-03-2027 - Velocity Build Night - Risk Assessment v1",
  );
});

test("update merge refreshes stale date and location text, including prose dates", () => {
  const replacements = buildStaleReplacements({
    changes: {
      preferredLocation: "LSE Old Building 4.01",
      proposedDate: "2027-03-01",
      proposedEndDate: "2027-03-02",
    },
    currentState: {
      location: "LSE Generate Hub",
      dateTimeAnswer: "14-03-2027 to 15-03-2027, setup TBC, event TBC-TBC",
    },
    newDateLabel: "01-03-2027 to 02-03-2027",
  });

  // Location is the first replacement; the date side expands to numeric and prose forms.
  assert.deepEqual(replacements[0], {
    from: "LSE Generate Hub",
    to: "LSE Old Building 4.01",
  });
  const froms = replacements.map((replacement) => replacement.from);
  assert.ok(froms.includes("14-03-2027 to 15-03-2027"));
  assert.ok(froms.includes("14-15 March 2027"));
  assert.ok(
    replacements.every(
      (replacement) =>
        replacement.to === "01-03-2027 to 02-03-2027" ||
        replacement.to === "LSE Old Building 4.01",
    ),
  );

  // Numeric range label, compact prose range, and a single prose date are all refreshed.
  assert.equal(
    applyStaleReplacements(
      "Hackathon at LSE Generate Hub on 14-03-2027 to 15-03-2027.",
      replacements,
    ),
    "Hackathon at LSE Old Building 4.01 on 01-03-2027 to 02-03-2027.",
  );
  assert.equal(
    applyStaleReplacements("Buildathon on 14-15 March 2027 at the hub.", replacements),
    "Buildathon on 01-03-2027 to 02-03-2027 at the hub.",
  );
  assert.equal(
    applyStaleReplacements(
      "Classification: large event scheduled 14 March 2027.",
      replacements,
    ),
    "Classification: large event scheduled 01-03-2027 to 02-03-2027.",
  );

  // The original Slack-style month-first range is replaced as one unit, and
  // matching is case-insensitive so a lowercase month is refreshed too.
  assert.equal(
    applyStaleReplacements("Event on March 14 to 15th.", replacements),
    "Event on 01-03-2027 to 02-03-2027.",
  );
  assert.equal(
    applyStaleReplacements("event on march 14 to 15th at the hub.", replacements),
    "event on 01-03-2027 to 02-03-2027 at the hub.",
  );
  assert.equal(
    applyStaleReplacements("Buildathon March 14-15 in the hub.", replacements),
    "Buildathon 01-03-2027 to 02-03-2027 in the hub.",
  );

  // A short or TBC current value is never used as a replacement source.
  assert.deepEqual(
    buildStaleReplacements({
      changes: { preferredLocation: "Room 1" },
      currentState: { location: "TBC" },
    }),
    [],
  );
});

test("old date reference variants cover numeric, compact, and spelled-out prose, longest first", () => {
  const variants = oldDateReferenceVariants("14-03-2027", "15-03-2027");

  assert.ok(variants.includes("14-03-2027 to 15-03-2027"));
  assert.ok(variants.includes("14-15 March 2027"));
  assert.ok(variants.includes("14-15 March"));
  assert.ok(variants.includes("14 March 2027"));
  assert.ok(variants.includes("15 March 2027"));
  assert.ok(variants.includes("14th-15th March 2027"));
  // Month-first ranges (the original Slack form).
  assert.ok(variants.includes("March 14 to 15th"));
  assert.ok(variants.includes("March 14 to 15"));
  assert.ok(variants.includes("March 14-15"));

  // Longest first so a range form is replaced before its day sub-forms.
  for (let index = 1; index < variants.length; index += 1) {
    assert.ok(variants[index - 1].length >= variants[index].length);
  }

  // A single-day event still produces specific forms but no range form.
  const single = oldDateReferenceVariants("14-03-2027");
  assert.ok(single.includes("14-03-2027"));
  assert.ok(single.includes("14 March 2027"));
  assert.ok(!single.some((variant) => variant.includes(" to ")));
});

test("a trip with no cost records a budget blocker as a missing field", () => {
  const missing = effectiveMissingCriticalFields({
    eventId: "EVT-20270414-cambridge-society-trip-c0ffee01",
    eventName: "Cambridge Society Trip",
    proposedDate: "2027-04-14",
    proposedEndDate: "2027-04-18",
    expectedAttendance: 25,
    classificationRoute: "trip_process",
    organiserName: "Event Lead",
    organiserLseEmail: "lead@lse.ac.uk",
    organiserContactNumber: "07000000000",
    preferredLocation: "Cambridge",
    eventStartTime: "09:00",
    eventEndTime: "17:00",
    firstAidPlan: "Trip first-aid kit and named lead.",
    tripBeyondM25: true,
    overnightTrip: true,
    transportPlan: "Return coach.",
    accommodationPlan: "Hostel.",
  });
  assert.deepEqual(missing, ["Trip cost / budget estimate"]);

  // A known cost clears the budget blocker.
  assert.ok(
    !effectiveMissingCriticalFields({
      eventId: "EVT-20270414-cambridge-society-trip-c0ffee01",
      eventName: "Cambridge Society Trip",
      classificationRoute: "trip_process",
      tripBeyondM25: true,
      transportPlan: "Return coach.",
      estimatedCost: 1200,
    }).includes("Trip cost / budget estimate"),
  );
});

test("update form field patches include trip transport and accommodation rows", () => {
  const fields = formFieldUpdatesFromChanges({
    changes: { transportPlan: "Return coach there and back.", accommodationPlan: "Shared hostel." },
  }).map((update) => update.field);

  assert.ok(fields.includes("Transport plan"));
  assert.ok(fields.includes("Accommodation plan, if relevant"));
});

test("renamed pack base name keeps the date prefix on a rename and moves it on a date change", () => {
  assert.equal(
    renamedPackBaseName({
      folderName: "14-03-2027 - Velocity Build Night",
      newEventName: "Velocity Build Night 2027",
    }),
    "14-03-2027 - Velocity Build Night 2027",
  );
  assert.equal(
    renamedPackBaseName({
      folderName: "14-03-2027 - Velocity Build Night",
      newEventName: "Velocity Build Night",
      newStartIsoDate: "2027-03-01",
    }),
    "01-03-2027 - Velocity Build Night",
  );
});

test("location risk update targets the generated Crowd Control row, not an example row", () => {
  const input: EventPackInput = {
    eventId: "EVT-20270301-velocity-build-night-a1b2c3d4",
    eventName: "Velocity Build Night",
    expectedAttendance: 90,
    preferredLocation: "LSE Old Building 4.01",
  };
  const generated = riskRowsForDocument(input);

  // A worked-example row that also says "Crowd Control" sits ABOVE the generated
  // section with low document indices.
  const exampleRow = fakeRiskDataRow(
    [
      "Crowd Control",
      "example why",
      "example who",
      "9",
      "EXAMPLE flow for Old Example Hall",
      "during",
      "owner",
    ],
    30,
  );
  let cursor = 2000;
  const nextRow = (values: string[]) => {
    const row = fakeRiskDataRow(values, cursor);
    cursor += 760;
    return row;
  };
  const headerRow = nextRow([
    "Hazard Identified",
    "Why",
    "Who",
    "Score",
    "Before",
    "During",
    "Owner",
  ]);
  const coreRows = generated.coreRisks.map((row) => nextRow(riskRowToTableCells(row)));
  const activityHeader = nextRow(["Activity-Related Risks"]);
  const activityRows = generated.activityRisks.map((row) =>
    nextRow(riskRowToTableCells(row)),
  );
  const document: docs_v1.Schema$Document = {
    body: {
      content: [
        {
          startIndex: 20,
          endIndex: 100000,
          table: {
            tableRows: [
              exampleRow,
              headerRow,
              ...coreRows,
              activityHeader,
              ...activityRows,
            ],
          },
        },
      ],
    },
  };

  const plan = buildGeneratedRiskCellUpdateRequests(document, [
    {
      hazardIdentified: "Crowd Control",
      column: "actions_before_event",
      text: "NEW flow for LSE Old Building 4.01",
    },
  ]);

  assert.deepEqual(plan.updatedCells, ["Crowd Control:actions_before_event"]);
  assert.deepEqual(plan.missingCells, []);

  const insert = plan.requests.find((request) => request.insertText);
  assert.equal(insert?.insertText?.text, "NEW flow for LSE Old Building 4.01");
  // The targeted index is in the generated section (>= 2000), not the example
  // row near index 400.
  assert.ok((insert?.insertText?.location?.index ?? 0) > 1000);
});
