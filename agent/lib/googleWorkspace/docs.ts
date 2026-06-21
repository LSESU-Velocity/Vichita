import type { docs_v1, drive_v3 } from "googleapis";

import {
  createDocsClient,
  createDriveClient,
  googleApiErrorSummary,
} from "./client.js";

const GOOGLE_DOC_MIME_TYPE = "application/vnd.google-apps.document";
const GOOGLE_SHEET_MIME_TYPE = "application/vnd.google-apps.spreadsheet";

function getDriveClient(client?: drive_v3.Drive) {
  return client ?? createDriveClient();
}

function getDocsClient(client?: docs_v1.Docs) {
  return client ?? createDocsClient();
}

export function driveFileUrl(fileId: string) {
  return `https://drive.google.com/file/d/${fileId}/view`;
}

function fileOutput(file: drive_v3.Schema$File) {
  if (!file.id) throw new Error("Google Drive returned a file without an id.");

  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    webViewLink: file.webViewLink ?? driveFileUrl(file.id),
    appProperties: file.appProperties,
  };
}

export async function copyDriveFileToFolder({
  sourceFileId,
  parentFolderId,
  name,
  appProperties,
  driveClient,
}: {
  sourceFileId: string;
  parentFolderId: string;
  name: string;
  appProperties?: Record<string, string>;
  driveClient?: drive_v3.Drive;
}) {
  const drive = getDriveClient(driveClient);
  const response = await drive.files.copy({
    fileId: sourceFileId,
    fields: "id,name,mimeType,webViewLink,appProperties",
    supportsAllDrives: true,
    requestBody: {
      name,
      parents: [parentFolderId],
      appProperties,
    },
  });

  return fileOutput(response.data);
}

export async function createGoogleSheetFile({
  parentFolderId,
  name,
  appProperties,
  driveClient,
}: {
  parentFolderId: string;
  name: string;
  appProperties?: Record<string, string>;
  driveClient?: drive_v3.Drive;
}) {
  const drive = getDriveClient(driveClient);
  const response = await drive.files.create({
    fields: "id,name,mimeType,webViewLink,appProperties",
    supportsAllDrives: true,
    requestBody: {
      name,
      mimeType: GOOGLE_SHEET_MIME_TYPE,
      parents: [parentFolderId],
      appProperties,
    },
  });

  return fileOutput(response.data);
}

export async function createGoogleDocWithText({
  parentFolderId,
  name,
  text,
  appProperties,
  driveClient,
  docsClient,
}: {
  parentFolderId: string;
  name: string;
  text: string;
  appProperties?: Record<string, string>;
  driveClient?: drive_v3.Drive;
  docsClient?: docs_v1.Docs;
}) {
  const drive = getDriveClient(driveClient);
  const docs = getDocsClient(docsClient);
  const response = await drive.files.create({
    fields: "id,name,mimeType,webViewLink,appProperties",
    supportsAllDrives: true,
    requestBody: {
      name,
      mimeType: GOOGLE_DOC_MIME_TYPE,
      parents: [parentFolderId],
      appProperties,
    },
  });
  const file = fileOutput(response.data);

  if (text.length > 0) {
    await docs.documents.batchUpdate({
      documentId: file.id,
      requestBody: {
        requests: [
          {
            insertText: {
              location: { index: 1 },
              text,
            },
          },
        ],
      },
    });
  }

  return file;
}

export async function exportGoogleDriveFileText({
  fileId,
  driveClient,
}: {
  fileId: string;
  driveClient?: drive_v3.Drive;
}) {
  const drive = getDriveClient(driveClient);

  try {
    const response = await drive.files.export(
      {
        fileId,
        mimeType: "text/plain",
      },
      { responseType: "arraybuffer" },
    );
    const data = response.data as unknown;

    if (typeof data === "string") return data;
    if (Buffer.isBuffer(data)) return data.toString("utf8");
    if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
    if (ArrayBuffer.isView(data)) {
      return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString(
        "utf8",
      );
    }

    throw new Error("Google Drive export returned an unsupported payload.");
  } catch (error) {
    throw new Error(
      `Google Drive text export failed: ${JSON.stringify(
        googleApiErrorSummary(error),
      )}`,
    );
  }
}

type TextSegment = {
  textStart: number;
  textEnd: number;
  docStart: number;
  docEnd: number;
};

export type MinimalTextEdit = {
  startOffset: number;
  endOffset: number;
  insertText: string;
};

function flattenTabs(tabs: docs_v1.Schema$Tab[] = []): docs_v1.Schema$Tab[] {
  return tabs.flatMap((tab) => [tab, ...flattenTabs(tab.childTabs ?? [])]);
}

function firstDocumentBody(document: docs_v1.Schema$Document) {
  const tab = flattenTabs(document.tabs ?? []).find(
    (candidate) => (candidate.documentTab?.body?.content ?? []).length > 0,
  );

  if (tab) {
    return {
      content: tab.documentTab?.body?.content ?? [],
      tabId: tab.tabProperties?.tabId ?? undefined,
    };
  }

  return {
    content: document.body?.content ?? [],
    tabId: undefined,
  };
}

function collectTextSegments(
  element: docs_v1.Schema$StructuralElement,
  segments: TextSegment[],
  textParts: string[],
) {
  if (element.paragraph) {
    for (const paragraphElement of element.paragraph.elements ?? []) {
      const content = paragraphElement.textRun?.content;
      const startIndex = paragraphElement.startIndex;
      const endIndex = paragraphElement.endIndex;
      if (
        content &&
        typeof startIndex === "number" &&
        typeof endIndex === "number"
      ) {
        const textStart = textParts.join("").length;
        textParts.push(content);
        segments.push({
          textStart,
          textEnd: textStart + content.length,
          docStart: startIndex,
          docEnd: endIndex,
        });
      }
    }
  }

  if (element.table) {
    for (const row of element.table.tableRows ?? []) {
      for (const cell of row.tableCells ?? []) {
        for (const child of cell.content ?? []) {
          collectTextSegments(child, segments, textParts);
        }
      }
    }
  }
}

function documentTextMap(document: docs_v1.Schema$Document) {
  const body = firstDocumentBody(document);
  const segments: TextSegment[] = [];
  const textParts: string[] = [];

  for (const element of body.content) {
    collectTextSegments(element, segments, textParts);
  }

  return {
    text: textParts.join(""),
    segments,
    tabId: body.tabId,
  };
}

function docIndexForTextOffset(segments: TextSegment[], offset: number) {
  if (segments.length === 0) return 1;

  for (const segment of segments) {
    if (offset >= segment.textStart && offset <= segment.textEnd) {
      return segment.docStart + (offset - segment.textStart);
    }
  }

  const last = segments[segments.length - 1];
  if (offset === last.textEnd) return last.docEnd;

  throw new Error(`Could not map Google Doc text offset ${offset} to an index.`);
}

export function minimalTextEdit(
  currentText: string,
  desiredText: string,
): MinimalTextEdit | undefined {
  if (currentText === desiredText) return undefined;

  let startOffset = 0;
  while (
    startOffset < currentText.length &&
    startOffset < desiredText.length &&
    currentText[startOffset] === desiredText[startOffset]
  ) {
    startOffset += 1;
  }

  let currentSuffix = currentText.length;
  let desiredSuffix = desiredText.length;
  while (
    currentSuffix > startOffset &&
    desiredSuffix > startOffset &&
    currentText[currentSuffix - 1] === desiredText[desiredSuffix - 1]
  ) {
    currentSuffix -= 1;
    desiredSuffix -= 1;
  }

  return {
    startOffset,
    endOffset: currentSuffix,
    insertText: desiredText.slice(startOffset, desiredSuffix),
  };
}

export async function updateGoogleDocText({
  documentId,
  text,
  docsClient,
}: {
  documentId: string;
  text: string;
  docsClient?: docs_v1.Docs;
}) {
  const docs = getDocsClient(docsClient);

  try {
    const response = await docs.documents.get({
      documentId,
      includeTabsContent: true,
    });
    const document = response.data;
    const textMap = documentTextMap(document);
    const hasImplicitFinalNewline = textMap.text.endsWith("\n");
    const editableText = hasImplicitFinalNewline
      ? textMap.text.slice(0, -1)
      : textMap.text;
    const edit = minimalTextEdit(editableText, text);

    if (!edit) {
      return { updated: false, deletedCharacters: 0, insertedCharacters: 0 };
    }

    const startIndex = docIndexForTextOffset(textMap.segments, edit.startOffset);
    const endIndex = docIndexForTextOffset(textMap.segments, edit.endOffset);
    const location = textMap.tabId ? { index: startIndex, tabId: textMap.tabId } : { index: startIndex };
    const requests: docs_v1.Schema$Request[] = [];

    if (endIndex > startIndex) {
      requests.push({
        deleteContentRange: {
          range: textMap.tabId
            ? { startIndex, endIndex, tabId: textMap.tabId }
            : { startIndex, endIndex },
        },
      });
    }

    if (edit.insertText.length > 0) {
      requests.push({
        insertText: {
          location,
          text: edit.insertText,
        },
      });
    }

    if (requests.length > 0) {
      await docs.documents.batchUpdate({
        documentId,
        requestBody: {
          requests,
          writeControl: document.revisionId
            ? { requiredRevisionId: document.revisionId }
            : undefined,
        },
      });
    }

    return {
      updated: true,
      deletedCharacters: edit.endOffset - edit.startOffset,
      insertedCharacters: edit.insertText.length,
    };
  } catch (error) {
    throw new Error(
      `Google Docs text update failed: ${JSON.stringify(
        googleApiErrorSummary(error),
      )}`,
    );
  }
}
export async function replaceGoogleDocText({
  documentId,
  replacements,
  docsClient,
}: {
  documentId: string;
  replacements: Record<string, string>;
  docsClient?: docs_v1.Docs;
}) {
  const docs = getDocsClient(docsClient);
  const requests = Object.entries(replacements).map(([text, replaceText]) => ({
    replaceAllText: {
      containsText: {
        text,
        matchCase: true,
      },
      replaceText,
    },
  }));

  if (requests.length === 0) {
    return { replacements: 0 };
  }

  try {
    const response = await docs.documents.batchUpdate({
      documentId,
      requestBody: { requests },
    });

    return {
      replacements: requests.length,
      replies: response.data.replies?.length ?? 0,
    };
  } catch (error) {
    throw new Error(
      `Google Docs placeholder replacement failed: ${JSON.stringify(
        googleApiErrorSummary(error),
      )}`,
    );
  }
}

