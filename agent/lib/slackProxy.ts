export const EVE_SLACK_INTERNAL_ROUTE = "/triggers/slack/eve";

type SlackInteractionPayload = {
  readonly type?: unknown;
};

export function isSlackViewSubmissionBody(
  contentType: string | null,
  body: string,
) {
  if (!contentType?.includes("application/x-www-form-urlencoded")) {
    return false;
  }

  const payload = new URLSearchParams(body).get("payload");
  if (!payload) return false;

  try {
    const parsed = JSON.parse(payload) as SlackInteractionPayload;
    return parsed.type === "view_submission";
  } catch {
    return false;
  }
}

export function slackInternalRouteUrl(requestUrl: string) {
  const url = new URL(requestUrl);
  url.pathname = EVE_SLACK_INTERNAL_ROUTE;
  url.search = "";
  return url;
}

export function buildSlackForwardHeaders(headers: Headers) {
  const forwarded = new Headers(headers);
  forwarded.delete("host");
  forwarded.delete("content-length");
  return forwarded;
}
