import type { drive_v3 } from "googleapis";

import {
  displayDateFromEventDatePart,
  displayDateFromIsoDate,
} from "../dateLabels.js";
import { buildSlackThreadKey } from "../eventIdentity.js";
import { createDriveClient } from "./client.js";
import { readGoogleWorkspaceConfig } from "./config.js";

const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

function getDriveClient(client?: drive_v3.Drive) {
  return client ?? createDriveClient();
}

function escapeDriveQueryValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function driveFolderUrl(folderId: string) {
  return `https://drive.google.com/drive/folders/${folderId}`;
}

export async function checkDriveRootFolderAccess(client?: drive_v3.Drive) {
  const config = readGoogleWorkspaceConfig();
  const drive = getDriveClient(client);
  const response = await drive.files.get({
    fileId: config.driveRootFolderId,
    fields:
      "id,name,mimeType,trashed,webViewLink,capabilities(canAddChildren,canEdit)",
    supportsAllDrives: true,
  });
  const file = response.data;
  const warnings: string[] = [];

  if (file.mimeType !== FOLDER_MIME_TYPE) {
    warnings.push("GOOGLE_DRIVE_ROOT_FOLDER_ID does not point to a Drive folder.");
  }

  if (file.trashed) {
    warnings.push("The configured Drive root folder is trashed.");
  }

  if (file.capabilities?.canAddChildren !== true) {
    warnings.push(
      "The service account cannot add children to the Drive root folder. Share the folder with the service account as Editor.",
    );
  }

  return {
    ok:
      file.mimeType === FOLDER_MIME_TYPE &&
      file.trashed !== true &&
      file.capabilities?.canAddChildren === true,
    folder: {
      id: file.id,
      name: file.name,
      webViewLink: file.webViewLink ?? driveFolderUrl(config.driveRootFolderId),
      canEdit: file.capabilities?.canEdit === true,
      canAddChildren: file.capabilities?.canAddChildren === true,
    },
    warnings,
  };
}

async function listChildFoldersByName({
  parentFolderId,
  name,
  client,
}: {
  parentFolderId: string;
  name: string;
  client?: drive_v3.Drive;
}) {
  const drive = getDriveClient(client);
  const response = await drive.files.list({
    q: [
      `mimeType = '${FOLDER_MIME_TYPE}'`,
      "trashed = false",
      `'${escapeDriveQueryValue(parentFolderId)}' in parents`,
      `name = '${escapeDriveQueryValue(name)}'`,
    ].join(" and "),
    fields: "files(id,name,webViewLink,appProperties)",
    spaces: "drive",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  return response.data.files ?? [];
}

async function listEventPackFoldersByAppProperty({
  parentFolderId,
  key,
  value,
  client,
}: {
  parentFolderId: string;
  key: "vichitaEventId" | "vichitaThreadKey";
  value: string;
  client?: drive_v3.Drive;
}) {
  const drive = getDriveClient(client);
  const response = await drive.files.list({
    q: [
      `mimeType = '${FOLDER_MIME_TYPE}'`,
      "trashed = false",
      `'${escapeDriveQueryValue(parentFolderId)}' in parents`,
      `appProperties has { key='${key}' and value='${escapeDriveQueryValue(
        value,
      )}' }`,
    ].join(" and "),
    fields: "files(id,name,webViewLink,appProperties)",
    spaces: "drive",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  return response.data.files ?? [];
}

async function createFolder({
  parentFolderId,
  name,
  appProperties,
  client,
}: {
  parentFolderId: string;
  name: string;
  appProperties?: Record<string, string>;
  client?: drive_v3.Drive;
}) {
  const drive = getDriveClient(client);
  const response = await drive.files.create({
    fields: "id,name,webViewLink,appProperties",
    supportsAllDrives: true,
    requestBody: {
      name,
      mimeType: FOLDER_MIME_TYPE,
      parents: [parentFolderId],
      appProperties,
    },
  });

  return response.data;
}

function dateLabelFromEventId(eventId: string) {
  const match = /^EVT-(\d{8})-/.exec(eventId);
  return displayDateFromEventDatePart(match?.[1]);
}

export function eventPackFolderName({
  eventId,
  eventName,
  proposedDate,
}: {
  eventId: string;
  eventName: string;
  proposedDate?: string;
}) {
  const datePrefix =
    displayDateFromIsoDate(proposedDate) ??
    proposedDate?.trim() ??
    dateLabelFromEventId(eventId);
  const safeName = eventName
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const displayName = safeName || "Event";

  return datePrefix ? `${datePrefix} - ${displayName}` : displayName;
}

function uniqueFolders(folders: drive_v3.Schema$File[]) {
  const byId = new Map<string, drive_v3.Schema$File>();

  for (const folder of folders) {
    if (folder.id) byId.set(folder.id, folder);
  }

  return [...byId.values()];
}

function folderOutput(folder: drive_v3.Schema$File) {
  if (!folder.id) throw new Error("Google Drive returned a folder without an id.");

  return {
    id: folder.id,
    name: folder.name,
    webViewLink: folder.webViewLink ?? driveFolderUrl(folder.id),
    appProperties: folder.appProperties,
  };
}

export async function createOrFindEventPackFolder({
  eventId,
  eventName,
  proposedDate,
  createEventPacksParentIfMissing = false,
  sourceSlackChannelId,
  sourceSlackThreadTs,
  client,
}: {
  eventId: string;
  eventName: string;
  proposedDate?: string;
  createEventPacksParentIfMissing?: boolean;
  sourceSlackChannelId?: string;
  sourceSlackThreadTs?: string;
  client?: drive_v3.Drive;
}) {
  const config = readGoogleWorkspaceConfig();
  const drive = getDriveClient(client);
  const threadKey = buildSlackThreadKey({
    sourceSlackChannelId,
    sourceSlackThreadTs,
  });
  const rootAccess = await checkDriveRootFolderAccess(drive);

  if (!rootAccess.ok) {
    throw new Error(
      `Google Drive root folder is not writable: ${rootAccess.warnings.join(" ")}`,
    );
  }

  let eventPacksParents = await listChildFoldersByName({
    parentFolderId: config.driveRootFolderId,
    name: "Event Packs",
    client: drive,
  });

  if (eventPacksParents.length > 1) {
    throw new Error(
      "Multiple Event Packs folders exist under the Vichita root. Resolve manually before writing.",
    );
  }

  if (eventPacksParents.length === 0 && createEventPacksParentIfMissing) {
    const createdParent = await createFolder({
      parentFolderId: config.driveRootFolderId,
      name: "Event Packs",
      appProperties: {
        vichitaKind: "event-packs-root",
      },
      client: drive,
    });
    eventPacksParents = [createdParent];
  }

  const eventPacksParent = eventPacksParents[0];
  if (!eventPacksParent?.id) {
    throw new Error(
      "Event Packs folder is missing under the configured Vichita root. Create it manually or approve createEventPacksParentIfMissing.",
    );
  }

  const eventIdMatches = await listEventPackFoldersByAppProperty({
    parentFolderId: eventPacksParent.id,
    key: "vichitaEventId",
    value: eventId,
    client: drive,
  });
  const threadMatches = threadKey
    ? await listEventPackFoldersByAppProperty({
        parentFolderId: eventPacksParent.id,
        key: "vichitaThreadKey",
        value: threadKey,
        client: drive,
      })
    : [];
  const existingFolders = uniqueFolders([...threadMatches, ...eventIdMatches]);

  if (existingFolders.length > 1) {
    throw new Error(
      `Multiple event pack folders match eventId=${eventId}${
        threadKey ? ` or threadKey=${threadKey}` : ""
      }. Resolve duplicates manually before writing.`,
    );
  }

  if (existingFolders.length === 1) {
    const existing = existingFolders[0];
    return {
      action: "found_existing" as const,
      eventPacksParentFolderId: eventPacksParent.id,
      matchedBy: threadMatches.some((folder) => folder.id === existing.id)
        ? "thread_key"
        : "event_id",
      threadKey,
      folder: folderOutput(existing),
    };
  }

  const appProperties: Record<string, string> = {
    vichitaKind: "event-pack-folder",
    vichitaEventId: eventId,
    vichitaPackVersion: "1",
  };
  if (threadKey) appProperties.vichitaThreadKey = threadKey;

  const created = await createFolder({
    parentFolderId: eventPacksParent.id,
    name: eventPackFolderName({ eventId, eventName, proposedDate }),
    appProperties,
    client: drive,
  });

  return {
    action: "created" as const,
    eventPacksParentFolderId: eventPacksParent.id,
    matchedBy: "created" as const,
    threadKey,
    folder: folderOutput(created),
  };
}
