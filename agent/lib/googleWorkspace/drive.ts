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
      "id,name,mimeType,driveId,trashed,webViewLink,capabilities(canAddChildren,canEdit)",
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

  if (!file.driveId) {
    warnings.push(
      "GOOGLE_DRIVE_ROOT_FOLDER_ID must point to a folder in a Google Shared Drive. Service accounts have no My Drive storage quota, so template copies and generated Google Docs fail in ordinary My Drive folders.",
    );
  }

  return {
    ok:
      file.mimeType === FOLDER_MIME_TYPE &&
      file.trashed !== true &&
      file.capabilities?.canAddChildren === true &&
      Boolean(file.driveId),
    folder: {
      id: file.id,
      name: file.name,
      webViewLink: file.webViewLink ?? driveFolderUrl(config.driveRootFolderId),
      sharedDriveId: file.driveId,
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

async function listChildFolders({
  parentFolderId,
  client,
}: {
  parentFolderId: string;
  client?: drive_v3.Drive;
}) {
  const drive = getDriveClient(client);
  const response = await drive.files.list({
    q: [
      `mimeType = '${FOLDER_MIME_TYPE}'`,
      "trashed = false",
      `'${escapeDriveQueryValue(parentFolderId)}' in parents`,
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

export function eventPackFolderDisplayEventName(name: string) {
  const normalized = name.replace(/\s+/g, " ").trim();
  const match = /^\d{2}-\d{2}-\d{4}\s+-\s+(.+)$/.exec(normalized);

  return (match?.[1] ?? normalized).trim();
}

function normalizedEventNameForMatch(value: string) {
  return eventPackFolderDisplayEventName(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function eventPackFolderMatchesEventName({
  folderName,
  eventName,
}: {
  folderName: string;
  eventName: string;
}) {
  return (
    normalizedEventNameForMatch(folderName) ===
    normalizedEventNameForMatch(eventName)
  );
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
export type EventPackFolderLookup = {
  eventPacksParentFolderId?: string;
  matchedBy: "folder_id" | "event_id" | "thread_key" | "event_name";
  threadKey?: string;
  folder: ReturnType<typeof folderOutput>;
};

export async function getDriveFolderById({
  folderId,
  client,
}: {
  folderId: string;
  client?: drive_v3.Drive;
}) {
  const drive = getDriveClient(client);
  const response = await drive.files.get({
    fileId: folderId,
    fields:
      "id,name,mimeType,trashed,webViewLink,appProperties,capabilities(canAddChildren,canEdit)",
    supportsAllDrives: true,
  });
  const file = response.data;

  if (file.mimeType !== FOLDER_MIME_TYPE) {
    throw new Error("The provided pack folder ID does not point to a Google Drive folder.");
  }
  if (file.trashed) {
    throw new Error("The provided pack folder is trashed.");
  }

  return file;
}

export async function findEventPackFolderForUpdate({
  eventId,
  eventName,
  packFolderId,
  sourceSlackChannelId,
  sourceSlackThreadTs,
  client,
}: {
  eventId?: string;
  eventName?: string;
  packFolderId?: string;
  sourceSlackChannelId?: string;
  sourceSlackThreadTs?: string;
  client?: drive_v3.Drive;
}): Promise<EventPackFolderLookup> {
  const drive = getDriveClient(client);
  const threadKey = buildSlackThreadKey({
    sourceSlackChannelId,
    sourceSlackThreadTs,
  });

  if (packFolderId?.trim()) {
    const folder = await getDriveFolderById({
      folderId: packFolderId.trim(),
      client: drive,
    });
    return {
      matchedBy: "folder_id",
      threadKey,
      folder: folderOutput(folder),
    };
  }

  const config = readGoogleWorkspaceConfig();
  const rootAccess = await checkDriveRootFolderAccess(drive);

  if (!rootAccess.ok) {
    throw new Error(
      `Google Drive root folder is not writable: ${rootAccess.warnings.join(" ")}`,
    );
  }

  const eventPacksParents = await listChildFoldersByName({
    parentFolderId: config.driveRootFolderId,
    name: "Event Packs",
    client: drive,
  });

  if (eventPacksParents.length > 1) {
    throw new Error(
      "Multiple Event Packs folders exist under the Vichita root. Resolve manually before updating.",
    );
  }

  const eventPacksParent = eventPacksParents[0];
  if (!eventPacksParent?.id) {
    throw new Error(
      "Event Packs folder is missing under the configured Vichita root.",
    );
  }

  const eventIdMatches = eventId?.trim()
    ? await listEventPackFoldersByAppProperty({
        parentFolderId: eventPacksParent.id,
        key: "vichitaEventId",
        value: eventId.trim(),
        client: drive,
      })
    : [];
  const threadMatches = threadKey
    ? await listEventPackFoldersByAppProperty({
        parentFolderId: eventPacksParent.id,
        key: "vichitaThreadKey",
        value: threadKey,
        client: drive,
      })
    : [];
  const nameMatches = eventName?.trim()
    ? (
        await listChildFolders({
          parentFolderId: eventPacksParent.id,
          client: drive,
        })
      ).filter((folder) =>
        eventPackFolderMatchesEventName({
          folderName: folder.name ?? "",
          eventName,
        }),
      )
    : [];

  const existingFolders = uniqueFolders([
    ...threadMatches,
    ...eventIdMatches,
    ...nameMatches,
  ]);

  if (existingFolders.length > 1) {
    const names = existingFolders
      .map(
        (folder) =>
          `${folder.name ?? "unnamed"} (${folder.webViewLink ?? folder.id ?? "no link"})`,
      )
      .join("; ");
    throw new Error(
      `Multiple existing event pack folders match this update request: ${names}. Provide the exact packFolderId or Event ID.`,
    );
  }

  if (existingFolders.length === 0) {
    throw new Error(
      "No existing event pack folder matched this update request. Provide the pack folder link, packFolderId, Event ID, or exact event name.",
    );
  }

  const existing = existingFolders[0];
  const matchedBy = threadMatches.some((folder) => folder.id === existing.id)
    ? "thread_key"
    : eventIdMatches.some((folder) => folder.id === existing.id)
      ? "event_id"
      : "event_name";

  return {
    eventPacksParentFolderId: eventPacksParent.id,
    matchedBy,
    threadKey,
    folder: folderOutput(existing),
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

  const sameNameFolders = (
    await listChildFolders({
      parentFolderId: eventPacksParent.id,
      client: drive,
    })
  ).filter((folder) =>
    eventPackFolderMatchesEventName({
      folderName: folder.name ?? "",
      eventName,
    }),
  );

  if (sameNameFolders.length > 0) {
    const names = sameNameFolders
      .map(
        (folder) =>
          `${folder.name ?? "unnamed"} (${folder.webViewLink ?? folder.id ?? "no link"})`,
      )
      .join("; ");
    throw new Error(
      `An event pack folder with the same event name already exists under Event Packs, but it did not match eventId=${eventId}${
        threadKey ? ` or threadKey=${threadKey}` : ""
      }: ${names}. Use the existing Event ID, pass packFolderId, or choose a distinct event name before generating.`,
    );
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

