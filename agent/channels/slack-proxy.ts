import { defineChannel, POST } from "eve/channels";

import {
  buildSlackForwardHeaders,
  isSlackViewSubmissionBody,
  slackInternalRouteUrl,
} from "../lib/slackProxy.js";

async function forwardToEveSlack(req: Request, body: string) {
  return fetch(slackInternalRouteUrl(req.url), {
    method: "POST",
    headers: buildSlackForwardHeaders(req.headers),
    body,
  });
}

export default defineChannel({
  routes: [
    POST("/triggers/slack", async (req, { waitUntil }) => {
      const body = await req.text();
      const isViewSubmission = isSlackViewSubmissionBody(
        req.headers.get("content-type"),
        body,
      );

      if (isViewSubmission) {
        // Eve 0.11.7 forwards the answer correctly but returns "ok" to Slack modals;
        // Slack expects an empty 200 ACK for view submissions.
        waitUntil(
          forwardToEveSlack(req, body)
            .then(async (response) => {
              if (!response.ok) {
                console.error("[vichita] Slack modal forward failed", {
                  status: response.status,
                  body: await response.text().catch(() => ""),
                });
              }
            })
            .catch((error: unknown) => {
              console.error("[vichita] Slack modal forward errored", { error });
            }),
        );

        return new Response(null, {
          status: 200,
          headers: { "cache-control": "no-store" },
        });
      }

      return forwardToEveSlack(req, body);
    }),
  ],
});
