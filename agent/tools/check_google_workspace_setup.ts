import { defineTool } from "eve/tools";
import { z } from "zod";

import { googleApiErrorSummary } from "../lib/googleWorkspace/client.js";
import {
  type ConfigValidation,
  validateVichitaConfig,
} from "../lib/googleWorkspace/config.js";
import { checkDriveRootFolderAccess } from "../lib/googleWorkspace/drive.js";
import { checkTrackerSpreadsheet } from "../lib/googleWorkspace/sheets.js";

const Input = z.object({
  includeDriveCheck: z.boolean().default(true),
  includeTrackerCheck: z.boolean().default(true),
});

type CheckGoogleWorkspaceSetupOutput = {
  ok: boolean;
  config: ConfigValidation;
  driveRootFolder: unknown;
  trackersSpreadsheet: unknown;
  skippedChecks?: string[];
};

export default defineTool({
  description:
    "Read-only Google Workspace setup check. Validates env/config, service-account credential shape, Drive root folder access, and Vichita Trackers spreadsheet tabs. Does not create or update anything.",
  inputSchema: Input,
  async execute(input): Promise<CheckGoogleWorkspaceSetupOutput> {
    const config = validateVichitaConfig();
    const result: CheckGoogleWorkspaceSetupOutput = {
      ok: false,
      config,
      driveRootFolder: null,
      trackersSpreadsheet: null,
    };

    if (!config.readyForGoogleWorkspace) {
      return {
        ...result,
        skippedChecks: [
          "Drive and Sheets checks skipped because required Google env/config is incomplete.",
        ],
      };
    }

    if (input.includeDriveCheck) {
      try {
        result.driveRootFolder = await checkDriveRootFolderAccess();
      } catch (error) {
        result.driveRootFolder = {
          ok: false,
          error: googleApiErrorSummary(error),
        };
      }
    }

    if (input.includeTrackerCheck) {
      try {
        result.trackersSpreadsheet = await checkTrackerSpreadsheet();
      } catch (error) {
        result.trackersSpreadsheet = {
          ok: false,
          error: googleApiErrorSummary(error),
        };
      }
    }

    const driveOk =
      !input.includeDriveCheck ||
      (result.driveRootFolder as { ok?: boolean } | null)?.ok === true;
    const sheetsOk =
      !input.includeTrackerCheck ||
      (result.trackersSpreadsheet as { ok?: boolean } | null)?.ok === true;

    result.ok = config.readyForGoogleWorkspace && driveOk && sheetsOk;
    return result;
  },
  toModelOutput(output) {
    const missingTabs =
      (output.trackersSpreadsheet as { missingTabs?: string[] } | null)
        ?.missingTabs ?? [];
    const tabsWithMissingHeaders =
      (output.trackersSpreadsheet as { tabsWithMissingHeaders?: string[] } | null)
        ?.tabsWithMissingHeaders ?? [];
    const tabsWithHeaderDifferences =
      (
        output.trackersSpreadsheet as {
          tabsWithHeaderDifferences?: string[];
        } | null
      )?.tabsWithHeaderDifferences ?? [];

    return {
      type: "json",
      value: {
        ok: output.ok,
        missingRequiredEnv: output.config.missingRequiredEnv,
        serviceAccountEmail: output.config.serviceAccountEmail,
        driveRootFolder: output.driveRootFolder,
        trackerSummary: {
          missingTabs,
          tabsWithMissingHeaders,
          tabsWithHeaderDifferences,
        },
      },
    };
  },
});