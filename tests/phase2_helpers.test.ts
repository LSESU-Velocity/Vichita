import assert from "node:assert/strict";
import test from "node:test";

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
import {
  buildColumnExpansionRequest,
  columnLetter,
  compareHeaders,
  trackerGridProperties,
  trackerRequiredColumnCount,
} from "../agent/lib/googleWorkspace/sheets.ts";
import { buildSourceRegistryEntry } from "../agent/lib/sourceRegistry.ts";

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
