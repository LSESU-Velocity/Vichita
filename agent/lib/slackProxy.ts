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
