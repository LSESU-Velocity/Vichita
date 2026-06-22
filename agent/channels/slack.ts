import { connectSlackCredentials } from "@vercel/connect/eve";
import type { HttpRouteDefinition } from "eve/channels";
import {
  defaultSlackAuth,
  slackChannel,
  type SlackChannelState,
} from "eve/channels/slack";

import { eventPackUpdateFastPathContext } from "../lib/eventPackFastPath.js";
import { isSlackViewSubmissionBody } from "../lib/slackProxy.js";

const slack = slackChannel({
  route: "/triggers/slack",
  credentials: connectSlackCredentials(
    process.env.SLACK_CONNECTOR ?? "slack/vichita",
  ),
  // Mirrors the Eve default (typing indicator + workspace-scoped auth) and
  // adds the correction fast-path hint. Auth may be null; like the default, we
  // still dispatch (we do not drop the turn) so behaviour matches the
  // framework when an actor cannot be derived.
  async onAppMention(ctx, message) {
    await ctx.thread.startTyping("Thinking...");
    const auth = defaultSlackAuth(message, ctx);
    const fastPathContext = eventPackUpdateFastPathContext(message.markdown);
    return fastPathContext ? { auth, context: [fastPathContext] } : { auth };
  },
  async onDirectMessage(ctx, message) {
    await ctx.thread.startTyping("Thinking...");
    const auth = defaultSlackAuth(message, ctx);
    const fastPathContext = eventPackUpdateFastPathContext(message.markdown);
    return fastPathContext ? { auth, context: [fastPathContext] } : { auth };
  },
});

function replayRequestWithBody(req: Request, body: string) {
  return new Request(req.url, {
    method: req.method,
    headers: req.headers,
    body,
  });
}

const routes = slack.routes.map((route) => {
  if (
    route.transport === "websocket" ||
    route.method !== "POST" ||
    route.path !== "/triggers/slack"
  ) {
    return route;
  }

  const slackPostRoute = route as HttpRouteDefinition<SlackChannelState>;
  return {
    ...slackPostRoute,
    async handler(
      req: Request,
      args: Parameters<typeof slackPostRoute.handler>[1],
    ) {
      const contentType = req.headers.get("content-type");
      if (!contentType?.includes("application/x-www-form-urlencoded")) {
        return slackPostRoute.handler(req, args);
      }

      const body = await req.text();
      const response = await slackPostRoute.handler(
        replayRequestWithBody(req, body),
        args,
      );

      if (response.ok && isSlackViewSubmissionBody(contentType, body)) {
        // Eve 0.11.7 records the modal answer correctly but returns "ok";
        // Slack view submissions expect an empty 200 ACK.
        return new Response(null, {
          status: 200,
          headers: { "cache-control": "no-store" },
        });
      }

      return response;
    },
  } satisfies HttpRouteDefinition<SlackChannelState>;
});

export default {
  ...slack,
  routes,
} satisfies typeof slack;
