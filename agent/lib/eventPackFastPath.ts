// Inbound Slack routing hint for existing-pack corrections.
//
// The authoritative behaviour lives in agent/instructions.md and the
// update_event_pack_fields tool description. This module only produces an
// advisory hint that accelerates routing for obvious corrections so the model
// reaches the approval-gated tool without a long pre-approval tool chain (the
// chain that previously timed out the Vercel workflow before the approval card
// appeared).
//
// Design: high recall on real corrections, with an explicit bail on read/status
// intent so status questions are never steered toward a write tool. A missed
// match is harmless: it simply falls back to the always-on instructions.

// Pure read/status requests. These must never be pushed toward a write tool.
const READ_INTENT =
  /\b(update|updates)\s+(me|us|on)\b|\b(any|got any|the latest)\s+updates?\b|\b(what'?s|whats|how'?s|hows)\b[^?.!]*\b(status|going|looking|progress|update)\b|\bstatus\s+(update|check)\b|\bcatch (me|us) up\b/;

// Wording that signals a correction even without an explicit "update" verb
// (e.g. "the venue is now 4.01", "now happening", "move build night to ...").
const CORRECTION_LIKE =
  /\b(changed?|correction|correct|moved?|reschedule[d]?|instead|swap(?:ped)?|switch(?:ed)?|relocat(?:e|ed|ing))\b|\bnow\s+(happening|taking place|scheduled|at|in|on)\b|\b(new|different|updated)\s+(date|time|venue|location|room|building|capacity|attendance|headcount)\b|\b(date|time|venue|location|room|building|capacity|attendance|headcount)\s+(is|are|will be|should be|has|have|now|changed)\b|\b(mov(?:e|ing)|push(?:ing)?|bring(?:ing)? forward|bump(?:ing)?)\b[^.?!]*\b(to|forward|back|earlier|later)\b/;

// Imperative edit verbs.
const UPDATE_LIKE =
  /\b(update|change|patch|correct|amend|edit|fix|revise|adjust|set|move|reschedule|relocate)\b/;

// Names of the artefacts this tool patches. Intentionally broad: a plain
// "files"/"docs" reference counts, not just "relevant files".
const EXPLICIT_PACK_TARGET =
  /\b(pack|risk[- ]?assessment|form[- ]?field|deadline plan|tracker|files?|docs?|documents?|sheets?|spreadsheets?)\b/;

// Event-pack field nouns that imply the message is about an event.
const EVENT_FIELD_SIGNAL =
  /\b(date|time|venue|location|room|building|capacity|attendance|headcount|organiser|organizer|first[- ]?aid|food|catering|refreshments|alcohol|sponsor|ticketing|tickets?|budget|cost|speaker|chair)\b/;

// A concrete date/day reference ("march 2nd", "2027-03-01", "friday").
const DATE_SIGNAL =
  /\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|jun(e)?|jul(y)?|aug(ust)?|sep(t|tember)?|oct(ober)?|nov(ember)?|dec(ember)?)\b|\b(mon|tues?|wed(nes)?|thur?s?|fri|sat(ur)?|sun)(day)?\b|\b\d{1,2}(st|nd|rd|th)\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[\/.-]\d{1,2}([\/.-]\d{2,4})?\b/;

// Creating a new pack/event is not a correction to an existing one. The verb
// must sit within a few words of "pack"/"event" so it does not match an update
// clause elsewhere in the sentence (e.g. "make the venue bigger, update the
// pack" must NOT bail).
const CREATE_INTENT =
  /\b(?:create|make|generate|draft|set[ -]?up)(?:\s+\w+){0,3}\s+(?:pack|event)s?\b/;

// Personal-scheduling subjects that are not event packs. These bail only when
// the message does not also name a pack or the word "event".
const NON_EVENT_SUBJECT =
  /\b(meeting|1:1|one[- ]?on[- ]?one|stand[- ]?up|sync|catch[- ]?up|appointment|appt|availability|my calendar)\b/;

// Event-level planning status (confirmed/cancelled/etc.) is not a field this
// tool patches. Matched narrowly: "event status" / "status of the event" only,
// so that the SUPPORTED "ticketing status" and "academic chair status"
// corrections are not caught.
const UNSUPPORTED_EVENT_STATUS =
  /\b(event'?s?\s+status|status\s+of\s+(?:the\s+|this\s+|that\s+)?event)\b/;

/**
 * True when a Slack message looks like a correction to an existing event pack.
 * Pure and side-effect free so it can be unit tested in isolation.
 */
export function matchesEventPackUpdateFastPath(message: string): boolean {
  const normalized = message.toLowerCase();

  // Status reads and new-pack/new-event creation are not existing-pack corrections.
  if (READ_INTENT.test(normalized)) return false;
  if (CREATE_INTENT.test(normalized)) return false;

  const correctionLike = CORRECTION_LIKE.test(normalized);
  const updateLike = UPDATE_LIKE.test(normalized) || correctionLike;
  if (!updateLike) return false;

  // Some signal that the edit concerns an existing event pack.
  const explicitPackTarget = EXPLICIT_PACK_TARGET.test(normalized);
  const eventAnchored = explicitPackTarget || /\bevent\b/.test(normalized);
  const aboutAnEventPack =
    eventAnchored ||
    EVENT_FIELD_SIGNAL.test(normalized) ||
    DATE_SIGNAL.test(normalized);
  if (!aboutAnEventPack) return false;

  // A bare date/scheduling mention about a personal subject (e.g. "move my
  // meeting to friday") is not an event-pack correction unless it explicitly
  // names a pack or the word "event".
  if (NON_EVENT_SUBJECT.test(normalized) && !eventAnchored) return false;

  // An event-status change with no other supported signal is not patchable by
  // update_event_pack_fields (no status field). Supported status fields
  // (ticketing / academic chair) carry their own EVENT_FIELD_SIGNAL and are
  // unaffected.
  if (
    UNSUPPORTED_EVENT_STATUS.test(normalized) &&
    !EVENT_FIELD_SIGNAL.test(normalized) &&
    !DATE_SIGNAL.test(normalized) &&
    !explicitPackTarget
  ) {
    return false;
  }

  return true;
}

/**
 * Advisory routing hint, delivered to the model as a context entry. Framed
 * explicitly as an automated classifier note (not the user's words) so the
 * model treats it as advice it can ignore, never as a user instruction to
 * write. Returns `undefined` when the message is not a likely correction.
 */
export function eventPackUpdateFastPathContext(
  message: string,
): string | undefined {
  if (!matchesEventPackUpdateFastPath(message)) return undefined;

  return [
    "<automated_routing_hint>",
    "This is an automated classifier hint, not a message from the user.",
    "This Slack message looks like a correction to an existing event pack.",
    "If it is, use the existing-pack fast path: send one short proposal (at most 3 bullets or 60 words), then call update_event_pack_fields once and let the approval card collect consent.",
    "Patch only the fields the user actually changed. Find the existing pack via eventName, Event ID, pack link, or Slack thread context. Leave packVersion unset to patch the existing version (set it only if the tool reports that several versions exist); do not create a new version unless the user asks.",
    "For a multi-day or rescheduled-range event, pass both changes.proposedDate (first day) and changes.proposedEndDate (last day).",
    "If the date move shifts deadlines, offer to recompute them; update_event_pack_fields does not recompute deadlines on its own.",
    "Do not call classify_event, collect_missing_event_fields, compute_deadlines, prepare_event_identity, or generate_event_pack first unless the user explicitly asked for that work.",
    "If the user only wants status or did not request a change, ignore this hint and respond normally.",
    "</automated_routing_hint>",
  ].join("\n");
}
