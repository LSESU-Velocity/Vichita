import type { sheets_v4 } from "googleapis";

import { createSheetsClient } from "./client.js";
import { readGoogleWorkspaceConfig } from "./config.js";
import { TRACKER_TAB_DEFINITIONS } from "./trackerSchemas.js";

export type HeaderComparison = {
  exactMatch: boolean;
  hasHeaderRow: boolean;
  missingHeaders: string[];
  unexpectedHeaders: string[];
};

export type TrackerTabStatus = {
  title: string;
  exists: boolean;
  sheetId?: number;
  columnCount?: number;
  requiredColumnCount: number;
  headerStatus: "missing_tab" | "missing_header" | "matches" | "differs";
  missingHeaders: string[];
  unexpectedHeaders: string[];
  notes?: string;
};

export type TrackerSpreadsheetStatus = {
  ok: boolean;
  spreadsheetId: string;
  spreadsheetTitle?: string;
  spreadsheetUrl?: string;
  missingTabs: string[];
  tabsWithMissingHeaders: string[];
  tabsWithHeaderDifferences: string[];
  tabStatuses: TrackerTabStatus[];
};

export type EnsureTrackerTabsOptions = {
  createMissingTabs?: boolean;
  writeMissingHeaders?: boolean;
  repairHeaderRows?: boolean;
};

export type EnsureTrackerTabsResult = TrackerSpreadsheetStatus & {
  createdTabs: string[];
  wroteHeaders: string[];
  repairedHeaders: string[];
  skippedHeaderRepairs: string[];
};

function quoteSheetName(title: string) {
  return `'${title.replace(/'/g, "''")}'`;
}

export function compareHeaders(
  existingHeaders: string[],
  expectedHeaders: string[],
): HeaderComparison {
  const normalizedExisting = existingHeaders.map((header) => header.trim());
  const nonBlankExisting = normalizedExisting.filter(Boolean);
  const exactMatch =
    expectedHeaders.length === normalizedExisting.length &&
    expectedHeaders.every((header, index) => normalizedExisting[index] === header);

  return {
    exactMatch,
    hasHeaderRow: nonBlankExisting.length > 0,
    missingHeaders: expectedHeaders.filter(
      (header) => !nonBlankExisting.includes(header),
    ),
    unexpectedHeaders: nonBlankExisting.filter(
      (header) => !expectedHeaders.includes(header),
    ),
  };
}

export function columnLetter(columnNumber: number) {
  if (!Number.isInteger(columnNumber) || columnNumber < 1) {
    throw new Error("columnNumber must be a positive integer.");
  }

  let column = "";
  let cursor = columnNumber;

  while (cursor > 0) {
    const remainder = (cursor - 1) % 26;
    column = String.fromCharCode(65 + remainder) + column;
    cursor = Math.floor((cursor - 1) / 26);
  }

  return column;
}

export function trackerRequiredColumnCount(headerCount: number) {
  if (!Number.isInteger(headerCount) || headerCount < 1) {
    throw new Error("headerCount must be a positive integer.");
  }

  return Math.max(26, headerCount);
}

export function trackerGridProperties(headerCount: number) {
  if (!Number.isInteger(headerCount) || headerCount < 1) {
    throw new Error("headerCount must be a positive integer.");
  }

  return {
    rowCount: 1000,
    columnCount: trackerRequiredColumnCount(headerCount),
    frozenRowCount: 1,
  };
}

function headerRange(title: string, headerCount: number) {
  return `${quoteSheetName(title)}!A1:${columnLetter(headerCount)}1`;
}

export function buildColumnExpansionRequest({
  sheetId,
  currentColumnCount,
  headerCount,
}: {
  sheetId: number;
  currentColumnCount?: number;
  headerCount: number;
}): sheets_v4.Schema$Request | undefined {
  if (!Number.isInteger(sheetId) || sheetId < 0) {
    throw new Error("sheetId must be a non-negative integer.");
  }

  const requiredColumnCount = trackerRequiredColumnCount(headerCount);
  if ((currentColumnCount ?? 0) >= requiredColumnCount) {
    return undefined;
  }

  return {
    updateSheetProperties: {
      properties: {
        sheetId,
        gridProperties: {
          columnCount: requiredColumnCount,
        },
      },
      fields: "gridProperties.columnCount",
    },
  };
}

function getSheetsClient(client?: sheets_v4.Sheets) {
  return client ?? createSheetsClient();
}

async function getSpreadsheetMetadata(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
) {
  const response = await sheets.spreadsheets.get({
    spreadsheetId,
    fields:
      "spreadsheetId,spreadsheetUrl,properties(title),sheets(properties(sheetId,title,gridProperties(columnCount,rowCount,frozenRowCount)))",
  });

  return response.data;
}

async function readHeaderRows(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  titles: string[],
) {
  if (titles.length === 0) return new Map<string, string[]>();

  const response = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: titles.map((title) => `${quoteSheetName(title)}!1:1`),
    majorDimension: "ROWS",
  });
  const result = new Map<string, string[]>();

  for (const [index, title] of titles.entries()) {
    const values = response.data.valueRanges?.[index]?.values?.[0] ?? [];
    result.set(
      title,
      values.map((value) => String(value)),
    );
  }

  return result;
}

export async function checkTrackerSpreadsheet(
  client?: sheets_v4.Sheets,
): Promise<TrackerSpreadsheetStatus> {
  const config = readGoogleWorkspaceConfig();
  const sheets = getSheetsClient(client);
  const metadata = await getSpreadsheetMetadata(
    sheets,
    config.trackersSpreadsheetId,
  );
  const sheetProperties = metadata.sheets?.map((sheet) => sheet.properties) ?? [];
  const sheetByTitle = new Map(
    sheetProperties
      .filter((properties): properties is sheets_v4.Schema$SheetProperties =>
        Boolean(properties?.title),
      )
      .map((properties) => [properties.title!, properties]),
  );
  const existingRequiredTitles = TRACKER_TAB_DEFINITIONS.map(
    (definition) => definition.title,
  ).filter((title) => sheetByTitle.has(title));
  const headerRows = await readHeaderRows(
    sheets,
    config.trackersSpreadsheetId,
    existingRequiredTitles,
  );

  const tabStatuses = TRACKER_TAB_DEFINITIONS.map((definition) => {
    const properties = sheetByTitle.get(definition.title);
    const requiredColumnCount = trackerRequiredColumnCount(
      definition.headers.length,
    );
    if (!properties) {
      return {
        title: definition.title,
        exists: false,
        requiredColumnCount,
        headerStatus: "missing_tab" as const,
        missingHeaders: definition.headers,
        unexpectedHeaders: [],
        notes: definition.notes,
      };
    }

    const comparison = compareHeaders(
      headerRows.get(definition.title) ?? [],
      definition.headers,
    );
    const headerStatus: TrackerTabStatus["headerStatus"] = !comparison.hasHeaderRow
      ? "missing_header"
      : comparison.exactMatch
        ? "matches"
        : "differs";

    return {
      title: definition.title,
      exists: true,
      sheetId: properties.sheetId ?? undefined,
      columnCount: properties.gridProperties?.columnCount ?? undefined,
      requiredColumnCount,
      headerStatus,
      missingHeaders: comparison.missingHeaders,
      unexpectedHeaders: comparison.unexpectedHeaders,
      notes: definition.notes,
    };
  });

  const missingTabs = tabStatuses
    .filter((status) => status.headerStatus === "missing_tab")
    .map((status) => status.title);
  const tabsWithMissingHeaders = tabStatuses
    .filter((status) => status.headerStatus === "missing_header")
    .map((status) => status.title);
  const tabsWithHeaderDifferences = tabStatuses
    .filter((status) => status.headerStatus === "differs")
    .map((status) => status.title);

  return {
    ok:
      missingTabs.length === 0 &&
      tabsWithMissingHeaders.length === 0 &&
      tabsWithHeaderDifferences.length === 0,
    spreadsheetId: config.trackersSpreadsheetId,
    spreadsheetTitle: metadata.properties?.title ?? undefined,
    spreadsheetUrl: metadata.spreadsheetUrl ?? undefined,
    missingTabs,
    tabsWithMissingHeaders,
    tabsWithHeaderDifferences,
    tabStatuses,
  };
}

export async function ensureTrackerTabs(
  options: EnsureTrackerTabsOptions = {},
  client?: sheets_v4.Sheets,
): Promise<EnsureTrackerTabsResult> {
  const createMissingTabs = options.createMissingTabs ?? true;
  const writeMissingHeaders = options.writeMissingHeaders ?? true;
  const repairHeaderRows = options.repairHeaderRows ?? false;
  const config = readGoogleWorkspaceConfig();
  const sheets = getSheetsClient(client);
  const before = await checkTrackerSpreadsheet(sheets);
  const createdTabs: string[] = [];
  const wroteHeaders: string[] = [];
  const repairedHeaders: string[] = [];
  const skippedHeaderRepairs: string[] = [];

  if (createMissingTabs && before.missingTabs.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: config.trackersSpreadsheetId,
      requestBody: {
        requests: before.missingTabs.map((title) => {
          const definition = TRACKER_TAB_DEFINITIONS.find(
            (candidate) => candidate.title === title,
          );
          if (!definition) throw new Error(`Unknown tracker tab "${title}".`);

          return {
            addSheet: {
              properties: {
                title,
                gridProperties: trackerGridProperties(definition.headers.length),
              },
            },
          };
        }),
      },
    });
    createdTabs.push(...before.missingTabs);
  }

  const afterTabCreation = await checkTrackerSpreadsheet(sheets);
  const writableHeaderTabs = afterTabCreation.tabStatuses.filter(
    (status) =>
      status.exists &&
      ((writeMissingHeaders && status.headerStatus === "missing_header") ||
        (repairHeaderRows && status.headerStatus === "differs")),
  );
  const columnExpansionRequests = writableHeaderTabs.flatMap((status) => {
    const definition = TRACKER_TAB_DEFINITIONS.find(
      (candidate) => candidate.title === status.title,
    );
    if (!definition || typeof status.sheetId !== "number") return [];

    const request = buildColumnExpansionRequest({
      sheetId: status.sheetId,
      currentColumnCount: status.columnCount,
      headerCount: definition.headers.length,
    });

    return request ? [request] : [];
  });

  if (columnExpansionRequests.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: config.trackersSpreadsheetId,
      requestBody: {
        requests: columnExpansionRequests,
      },
    });
  }

  for (const status of writableHeaderTabs) {
    const definition = TRACKER_TAB_DEFINITIONS.find(
      (candidate) => candidate.title === status.title,
    );
    if (!definition) continue;

    await sheets.spreadsheets.values.update({
      spreadsheetId: config.trackersSpreadsheetId,
      range: headerRange(status.title, definition.headers.length),
      valueInputOption: "RAW",
      requestBody: {
        values: [definition.headers],
      },
    });

    if (status.headerStatus === "differs") {
      repairedHeaders.push(status.title);
    } else {
      wroteHeaders.push(status.title);
    }
  }

  if (!repairHeaderRows) {
    skippedHeaderRepairs.push(...afterTabCreation.tabsWithHeaderDifferences);
  }

  const after = await checkTrackerSpreadsheet(sheets);

  return {
    ...after,
    createdTabs,
    wroteHeaders,
    repairedHeaders,
    skippedHeaderRepairs,
  };
}

export async function upsertTrackerRow({
  tabName,
  keyColumn,
  keyValue,
  row,
  valueInputOption = "RAW",
  client,
}: {
  tabName: string;
  keyColumn: string;
  keyValue: string;
  row: Record<string, string | number | boolean | null | undefined>;
  valueInputOption?: "RAW" | "USER_ENTERED";
  client?: sheets_v4.Sheets;
}) {
  const config = readGoogleWorkspaceConfig();
  const sheets = getSheetsClient(client);
  const definition = TRACKER_TAB_DEFINITIONS.find(
    (candidate) => candidate.title === tabName,
  );
  if (!definition) {
    throw new Error(`Unknown tracker tab "${tabName}".`);
  }

  const headerResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: config.trackersSpreadsheetId,
    range: `${quoteSheetName(tabName)}!1:1`,
  });
  const headers =
    headerResponse.data.values?.[0]?.map((value) => String(value)) ?? [];
  const comparison = compareHeaders(headers, definition.headers);
  if (!comparison.exactMatch) {
    throw new Error(
      `${tabName} headers are not ready. Run ensure_google_tracker_tabs first.`,
    );
  }

  const keyIndex = headers.indexOf(keyColumn);
  if (keyIndex === -1) {
    throw new Error(`${tabName} does not have key column "${keyColumn}".`);
  }

  const lastColumn = columnLetter(headers.length);
  const dataResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: config.trackersSpreadsheetId,
    range: `${quoteSheetName(tabName)}!A2:${lastColumn}`,
  });
  const rows = dataResponse.data.values ?? [];
  const matches = rows
    .map((values, index) => ({ values, rowNumber: index + 2 }))
    .filter(({ values }) => String(values[keyIndex] ?? "") === keyValue);

  if (matches.length > 1) {
    throw new Error(
      `${tabName} has duplicate rows for ${keyColumn}=${keyValue}. Resolve duplicates manually before writing.`,
    );
  }

  const values = headers.map((header) => row[header] ?? "");

  if (matches.length === 1) {
    const rowNumber = matches[0].rowNumber;
    await sheets.spreadsheets.values.update({
      spreadsheetId: config.trackersSpreadsheetId,
      range: `${quoteSheetName(tabName)}!A${rowNumber}:${lastColumn}${rowNumber}`,
      valueInputOption,
      requestBody: {
        values: [values],
      },
    });

    return {
      action: "updated" as const,
      rowNumber,
      keyColumn,
      keyValue,
      tabName,
    };
  }

  const appendResponse = await sheets.spreadsheets.values.append({
    spreadsheetId: config.trackersSpreadsheetId,
    range: `${quoteSheetName(tabName)}!A:${lastColumn}`,
    valueInputOption,
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [values],
    },
  });

  return {
    action: "appended" as const,
    updatedRange: appendResponse.data.updates?.updatedRange,
    keyColumn,
    keyValue,
    tabName,
  };
}

export async function upsertTrackerRows({
  tabName,
  keyColumn,
  rows,
  valueInputOption = "RAW",
  client,
}: {
  tabName: string;
  keyColumn: string;
  rows: Array<Record<string, string | number | boolean | null | undefined>>;
  valueInputOption?: "RAW" | "USER_ENTERED";
  client?: sheets_v4.Sheets;
}) {
  const config = readGoogleWorkspaceConfig();
  const sheets = getSheetsClient(client);
  const definition = TRACKER_TAB_DEFINITIONS.find(
    (candidate) => candidate.title === tabName,
  );
  if (!definition) {
    throw new Error(`Unknown tracker tab "${tabName}".`);
  }

  if (rows.length === 0) {
    return {
      action: "noop" as const,
      tabName,
      keyColumn,
      updatedRows: 0,
      appendedRows: 0,
    };
  }

  const headerResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: config.trackersSpreadsheetId,
    range: `${quoteSheetName(tabName)}!1:1`,
  });
  const headers =
    headerResponse.data.values?.[0]?.map((value) => String(value)) ?? [];
  const comparison = compareHeaders(headers, definition.headers);
  if (!comparison.exactMatch) {
    throw new Error(
      `${tabName} headers are not ready. Run ensure_google_tracker_tabs first.`,
    );
  }

  const keyIndex = headers.indexOf(keyColumn);
  if (keyIndex === -1) {
    throw new Error(`${tabName} does not have key column "${keyColumn}".`);
  }

  const seenInputKeys = new Set<string>();
  const normalizedRows = rows.map((row) => {
    const keyValue = String(row[keyColumn] ?? "").trim();
    if (!keyValue) {
      throw new Error(`${tabName} row is missing key column "${keyColumn}".`);
    }
    if (seenInputKeys.has(keyValue)) {
      throw new Error(`${tabName} batch contains duplicate ${keyColumn}=${keyValue}.`);
    }
    seenInputKeys.add(keyValue);

    return {
      keyValue,
      values: headers.map((header) => row[header] ?? ""),
    };
  });

  const lastColumn = columnLetter(headers.length);
  const dataResponse = await sheets.spreadsheets.values.get({
    spreadsheetId: config.trackersSpreadsheetId,
    range: `${quoteSheetName(tabName)}!A2:${lastColumn}`,
  });
  const existingRows = dataResponse.data.values ?? [];
  const existingByKey = new Map<string, number[]>();

  for (const [index, values] of existingRows.entries()) {
    const keyValue = String(values[keyIndex] ?? "");
    if (!seenInputKeys.has(keyValue)) continue;
    const rowNumbers = existingByKey.get(keyValue) ?? [];
    rowNumbers.push(index + 2);
    existingByKey.set(keyValue, rowNumbers);
  }

  for (const [keyValue, rowNumbers] of existingByKey.entries()) {
    if (rowNumbers.length > 1) {
      throw new Error(
        `${tabName} has duplicate rows for ${keyColumn}=${keyValue}. Resolve duplicates manually before writing.`,
      );
    }
  }

  const updates: Array<{ range: string; values: Array<Array<string | number | boolean | null | undefined>> }> = [];
  const appends: Array<Array<string | number | boolean | null | undefined>> = [];

  for (const row of normalizedRows) {
    const rowNumber = existingByKey.get(row.keyValue)?.[0];
    if (rowNumber) {
      updates.push({
        range: `${quoteSheetName(tabName)}!A${rowNumber}:${lastColumn}${rowNumber}`,
        values: [row.values],
      });
    } else {
      appends.push(row.values);
    }
  }

  if (updates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: config.trackersSpreadsheetId,
      requestBody: {
        valueInputOption,
        data: updates,
      },
    });
  }

  let appendRange: string | undefined;
  if (appends.length > 0) {
    const appendResponse = await sheets.spreadsheets.values.append({
      spreadsheetId: config.trackersSpreadsheetId,
      range: `${quoteSheetName(tabName)}!A:${lastColumn}`,
      valueInputOption,
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: appends,
      },
    });
    appendRange = appendResponse.data.updates?.updatedRange ?? undefined;
  }

  return {
    action: "batch_upsert" as const,
    tabName,
    keyColumn,
    updatedRows: updates.length,
    appendedRows: appends.length,
    appendRange,
  };
}