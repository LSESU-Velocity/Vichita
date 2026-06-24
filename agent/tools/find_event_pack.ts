import { defineTool } from "eve/tools";
import { z } from "zod";

import { createDriveClient } from "../lib/googleWorkspace/client.js";
import { findEventPackFolderForUpdate } from "../lib/googleWorkspace/drive.js";

const Input = z
  .object({
    eventId: z
      .string()
      .optional()
      .describe("Existing Event ID, if known."),
    eventName: z
      .string()
      .optional()
      .describe("Visible event/pack name used to find exactly one existing pack."),
    packFolderId: z.string().optional(),
    packFolderLink: z.string().url().optional(),
    sourceSlackChannelId: z.string().optional(),
    sourceSlackThreadTs: z.string().optional(),
  })
  .refine(
    (input) =>
      Boolean(
        input.eventId?.trim() ||
          input.eventName?.trim() ||
          input.packFolderId?.trim() ||
          input.packFolderLink?.trim() ||
          (input.sourceSlackChannelId?.trim() && input.sourceSlackThreadTs?.trim()),
      ),
    "Provide an Event ID, event name, pack folder link/ID, or Slack thread context.",
  );

function packFolderIdFromLink(link: string | undefined) {
  if (!link) return undefined;
  const foldersMatch = /\/folders\/([a-zA-Z0-9_-]+)/.exec(link);
  if (foldersMatch) return foldersMatch[1];
  const idMatch = /[?&]id=([a-zA-Z0-9_-]+)/.exec(link);
  return idMatch?.[1];
}

function parsePackVersion(value: string | undefined) {
  const version = Number(value);
  return Number.isInteger(version) && version > 0 ? version : undefined;
}

export default defineTool({
  description:
    "Read-only Google Drive lookup for an existing Vichita event pack. Use before regenerating or updating a same-version pack in place when the user gives a visible event name, folder link, Event ID, or Slack thread context. Does not create, edit, rename, or update Drive files. If it finds one pack, reuse the returned eventId, packFolderId, and packVersion in generate_event_pack or update_event_pack_fields instead of minting a new Event ID from a changed date.",
  inputSchema: Input,
  async execute(input) {
    const drive = createDriveClient();
    const packFolderId =
      input.packFolderId ?? packFolderIdFromLink(input.packFolderLink);
    const lookup = await findEventPackFolderForUpdate({
      eventId: input.eventId,
      eventName: input.eventName,
      packFolderId,
      sourceSlackChannelId: input.sourceSlackChannelId,
      sourceSlackThreadTs: input.sourceSlackThreadTs,
      client: drive,
    });

    const eventId = lookup.folder.appProperties?.vichitaEventId;
    const packVersion =
      parsePackVersion(lookup.folder.appProperties?.vichitaPackVersion) ?? 1;
    const warnings: string[] = [];

    if (!eventId) {
      warnings.push(
        "The matched folder does not expose vichitaEventId metadata. Provide the existing Event ID explicitly before writing.",
      );
    }

    return {
      matchedBy: lookup.matchedBy,
      threadKey: lookup.threadKey,
      eventPacksParentFolderId: lookup.eventPacksParentFolderId,
      eventId,
      packVersion,
      folder: lookup.folder,
      generateEventPackIdentity: eventId
        ? {
            eventId,
            packFolderId: lookup.folder.id,
            packVersion,
            updateExistingDrafts: true,
          }
        : undefined,
      warnings,
    };
  },
  toModelOutput(output) {
    return {
      type: "json",
      value: {
        matchedBy: output.matchedBy,
        eventId: output.eventId,
        packVersion: output.packVersion,
        packFolderId: output.folder.id,
        packFolderLink: output.folder.webViewLink,
        folderName: output.folder.name,
        threadKey: output.threadKey,
        generateEventPackIdentity: output.generateEventPackIdentity,
        warnings: output.warnings,
      },
    };
  },
});
