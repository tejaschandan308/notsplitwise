import {
  detectCurrency,
  isCurrencyCode,
  MAX_AMOUNT,
  roundAmount,
} from "@/lib/currency";
import { PARSE_SYSTEM_PROMPT } from "@/lib/parse-prompt";
import { mentionedInText, readPayerEvidence } from "@/lib/payer";
import type {
  Category,
  CurrencyCode,
  ParsedExpenseFields,
  ParseResponse,
} from "@/lib/types";

/** Calls the model with a system prompt and user message, returns its text. */
export type ModelCaller = (system: string, user: string) => Promise<string>;

export const LIMITS = {
  rawText: 600,
  members: 30,
  memberName: 40,
  note: 80,
  location: 60,
  maxAmount: MAX_AMOUNT,
} as const;

const allowedCategories = new Set<Category>([
  "food",
  "transport",
  "stay",
  "tickets",
  "personal",
  "other",
]);

const selfWords = new Set(["me", "i", "myself", "my", "mine"]);

export type ParseInput = {
  rawText: string;
  members: string[];
  tripCurrency: CurrencyCode;
};

/** Validates the request body. Returns null if it isn't usable. */
export function readParseInput(body: unknown): ParseInput | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }

  const record = body as Record<string, unknown>;
  const rawText =
    typeof record.rawText === "string" ? record.rawText.trim() : "";

  if (!rawText || rawText.length > LIMITS.rawText) {
    return null;
  }

  if (!Array.isArray(record.members)) {
    return null;
  }

  const members = record.members.filter(
    (member): member is string =>
      typeof member === "string" &&
      member.trim().length > 0 &&
      member.length <= LIMITS.memberName,
  );

  if (
    members.length === 0 ||
    members.length !== record.members.length ||
    members.length > LIMITS.members
  ) {
    return null;
  }

  return {
    rawText,
    members,
    tripCurrency: isCurrencyCode(record.tripCurrency)
      ? record.tripCurrency
      : "INR",
  };
}

export function parseJsonObject(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Fall through to the fenced / embedded forms.
  }

  const unfenced = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");

  try {
    return JSON.parse(unfenced);
  } catch {
    // Fall through.
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("no json object");
  }

  return JSON.parse(text.slice(firstBrace, lastBrace + 1));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function boundedString(value: unknown, max: number): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim().replace(/\s+/g, " ");

  return trimmed ? trimmed.slice(0, max) : null;
}

function matchMember(name: string, members: string[]): string | null {
  const key = name.trim().toLowerCase();

  if (selfWords.has(key)) {
    return members.includes("Me") ? "Me" : null;
  }

  return members.find((member) => member.toLowerCase() === key) ?? null;
}

function sanitizeAmount(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  if (value <= 0 || value > LIMITS.maxAmount) {
    return null;
  }

  const rounded = roundAmount(value);

  return rounded > 0 ? rounded : null;
}

function sanitizeCurrency(
  value: unknown,
  input: ParseInput,
): Pick<ParsedExpenseFields, "currency" | "currencyMention"> {
  // The app's own reading of the text always wins over the model's.
  const local = detectCurrency(input.rawText, input.tripCurrency);

  if (local.source === "capture") {
    return { currency: local.currency, currencyMention: local.mention };
  }

  const mention = boundedString(value, 20);

  // Ignore a mention the text doesn't contain: it would be invented.
  if (!mention || !mentionedInText(mention, input.rawText)) {
    return { currency: input.tripCurrency, currencyMention: null };
  }

  const fromMention = detectCurrency(mention, input.tripCurrency);

  return fromMention.source === "capture"
    ? { currency: fromMention.currency, currencyMention: mention }
    : { currency: null, currencyMention: mention };
}

function sanitizeNames(value: unknown, members: string[]): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const names: string[] = [];

  for (const item of value) {
    const name = boundedString(item, LIMITS.memberName);

    if (!name) continue;

    const key = name.toLowerCase();

    if (seen.has(key) || selfWords.has(key) || matchMember(name, members)) {
      continue;
    }

    seen.add(key);
    names.push(name);
  }

  return names;
}

/**
 * A payer is accepted only when the text itself says that person paid
 * ("Asha paid", "paid by Asha", "I paid"). A name that merely appears in the
 * capture, for example in the list of people sharing, is not enough.
 *
 * - No payment wording at all: no payer is taken from the model; the app's
 *   labelled "Me" default applies.
 * - Payment wording, but the model's payer is missing, flagged ambiguous,
 *   not the one the text names, or several people are named ("paid by Asha
 *   and Ben"): the payer is left unresolved for review instead of falling
 *   back to "Me".
 * - Repayment, negated or zero-payment wording ("Asha paid me back",
 *   "Asha paid nothing") also leaves it unresolved: the reader can't tell
 *   who paid for the expense from such sentences.
 */
function sanitizePayer(
  record: Record<string, unknown>,
  input: ParseInput,
): Pick<ParsedExpenseFields, "paidBy" | "payerMention" | "payerUnresolved"> {
  const written = boundedString(record.paidBy, LIMITS.memberName);
  const member = written ? matchMember(written, input.members) : null;
  const isSelfWord = written ? selfWords.has(written.toLowerCase()) : false;
  const unknownName = written && !member && !isSelfWord ? written : null;
  const evidence = readPayerEvidence(
    input.rawText,
    unknownName ? [...input.members, unknownName] : input.members,
  );
  const unresolved = { paidBy: null, payerMention: null, payerUnresolved: true };

  if (!evidence.mentionsPayment) {
    return { paidBy: null, payerMention: null, payerUnresolved: false };
  }

  if (record.paidByAmbiguous === true) {
    return {
      ...unresolved,
      payerMention:
        written && mentionedInText(written, input.rawText) ? written : null,
    };
  }

  if (
    !written ||
    evidence.group ||
    evidence.doubtful ||
    evidence.payers.length !== 1
  ) {
    return unresolved;
  }

  const [stated] = evidence.payers;

  if (member) {
    return stated === member
      ? { paidBy: member, payerMention: null, payerUnresolved: false }
      : unresolved;
  }

  // Someone not on the trip, explicitly named as the payer.
  return unknownName && stated === unknownName
    ? { ...unresolved, payerMention: unknownName }
    : unresolved;
}

/** Turns untrusted model output into fields the app can store. */
export function sanitizeParsed(
  parsed: unknown,
  input: ParseInput,
): ParsedExpenseFields {
  const record = asRecord(parsed);
  const { members } = input;
  const isPersonal = record.isPersonal === true;
  const included = Array.isArray(record.included)
    ? members.filter((member) =>
        (record.included as unknown[]).some(
          (item) =>
            typeof item === "string" &&
            matchMember(item, members) === member,
        ),
      )
    : [];
  const category =
    typeof record.category === "string" &&
    allowedCategories.has(record.category as Category)
      ? (record.category as Category)
      : null;
  const payer = sanitizePayer(record, input);
  const unmatchedNames = sanitizeNames(record.unmatchedNames, members).filter(
    // A payer is not silently made a participant.
    (name) => name.toLowerCase() !== payer.payerMention?.toLowerCase(),
  );

  return {
    amount: sanitizeAmount(record.amount),
    ...sanitizeCurrency(record.currencyMention, input),
    category,
    note: boundedString(record.note, LIMITS.note) ?? "",
    location: boundedString(record.location, LIMITS.location),
    included:
      isPersonal && members.includes("Me")
        ? ["Me"]
        : included.length > 0
          ? included
          : [...members],
    unmatchedNames: isPersonal ? [] : unmatchedNames,
    ...payer,
    isPersonal,
  };
}

export type ParseHandlerResult = { status: number; body: ParseResponse };

/**
 * The /api/parse handler without framework or provider dependencies.
 * Detailed provider errors go to `log` (server only); the client gets a code.
 */
export async function handleParseRequest(
  body: unknown,
  callModel: ModelCaller | null,
  log: (message: string) => void = () => undefined,
): Promise<ParseHandlerResult> {
  const input = readParseInput(body);

  if (!input) {
    return { status: 400, body: { ok: false, error: "invalid_input" } };
  }

  if (!callModel) {
    return { status: 503, body: { ok: false, error: "ai_not_configured" } };
  }

  let text: string;

  try {
    text = await callModel(
      PARSE_SYSTEM_PROMPT,
      `Members: ${JSON.stringify(input.members)}\nNote: ${input.rawText}`,
    );
  } catch (error) {
    log(`parse provider error: ${error instanceof Error ? error.message : String(error)}`);
    return { status: 502, body: { ok: false, error: "ai_unavailable" } };
  }

  try {
    const parsed = parseJsonObject(text);

    return { status: 200, body: { ok: true, data: sanitizeParsed(parsed, input) } };
  } catch {
    log("parse provider returned no usable JSON");
    return { status: 422, body: { ok: false, error: "unreadable" } };
  }
}
