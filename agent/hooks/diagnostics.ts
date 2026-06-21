import { defineHook } from "eve/hooks";

function safeInfo(message: string, buildPayload: () => Record<string, unknown>) {
  try {
    console.info(message, buildPayload());
  } catch {
    // Hooks are diagnostic only; logging must never fail a user turn.
  }
}

function safeError(message: string, buildPayload: () => Record<string, unknown>) {
  try {
    console.error(message, buildPayload());
  } catch {
    // Hooks are diagnostic only; logging must never fail a user turn.
  }
}

export default defineHook({
  events: {
    "turn.started"(event, ctx) {
      safeInfo("[vichita] turn.started", () => ({
        sessionId: ctx.session.id,
        turnId: event.data.turnId,
        channel: ctx.channel.kind,
      }));
    },
    "step.started"(event, ctx) {
      safeInfo("[vichita] step.started", () => ({
        sessionId: ctx.session.id,
        turnId: event.data.turnId,
        stepIndex: event.data.stepIndex,
      }));
    },
    "step.completed"(event, ctx) {
      safeInfo("[vichita] step.completed", () => ({
        sessionId: ctx.session.id,
        turnId: event.data.turnId,
        stepIndex: event.data.stepIndex,
        finishReason: event.data.finishReason,
        inputTokens: event.data.usage?.inputTokens,
        outputTokens: event.data.usage?.outputTokens,
      }));
    },
    "actions.requested"(event, ctx) {
      safeInfo("[vichita] actions.requested", () => ({
        sessionId: ctx.session.id,
        turnId: event.data.turnId,
        stepIndex: event.data.stepIndex,
        actions: event.data.actions.map((action) =>
          action.kind === "tool-call"
            ? `${action.kind}:${action.toolName}`
            : action.kind,
        ),
      }));
    },
    "input.requested"(event, ctx) {
      safeInfo("[vichita] input.requested", () => ({
        sessionId: ctx.session.id,
        turnId: event.data.turnId,
        stepIndex: event.data.stepIndex,
        requestCount: event.data.requests.length,
      }));
    },
    "action.result"(event, ctx) {
      safeInfo("[vichita] action.result", () => {
        const result = event.data.result;
        return {
          sessionId: ctx.session.id,
          turnId: event.data.turnId,
          stepIndex: event.data.stepIndex,
          status: event.data.status,
          action:
            result.kind === "tool-result"
              ? `${result.kind}:${result.toolName}`
              : result.kind,
          isError: Boolean(result.isError),
          errorCode: event.data.error?.code,
          errorMessage: event.data.error?.message,
        };
      });
    },
    "step.failed"(event, ctx) {
      safeError("[vichita] step.failed", () => ({
        sessionId: ctx.session.id,
        turnId: event.data.turnId,
        stepIndex: event.data.stepIndex,
        code: event.data.code,
        message: event.data.message,
      }));
    },
    "turn.failed"(event, ctx) {
      safeError("[vichita] turn.failed", () => ({
        sessionId: ctx.session.id,
        turnId: event.data.turnId,
        code: event.data.code,
        message: event.data.message,
      }));
    },
    "turn.completed"(event, ctx) {
      safeInfo("[vichita] turn.completed", () => ({
        sessionId: ctx.session.id,
        turnId: event.data.turnId,
      }));
    },
  },
});