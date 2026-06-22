import { connectSlackCredentials } from "@vercel/connect/eve";
import { slackChannel } from "eve/channels/slack";

export default slackChannel({
  route: "/triggers/slack/eve",
  credentials: connectSlackCredentials(
    process.env.SLACK_CONNECTOR ?? "slack/vichita",
  ),
});
