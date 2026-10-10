import type { Expense } from "@/lib/types";

/**
 * Deterministic reading of who paid, used to check a payer suggested by the
 * AI against the capture text.
 *
 * It only recognises a few explicit shapes ("Asha paid", "paid by Asha",
 * "I paid", "on Asha's card", "my treat"). That is enough to refuse a payer
 * the text never states, or one that contradicts it. It does not understand
 * the sentence: an unusual phrasing simply leaves the payer for review.
 */

const WORD = "\\p{L}\\p{N}";
const NOT_BEFORE = `(?<![${WORD}'’])`;
const NOT_AFTER = `(?![${WORD}])`;

/** Words that say money changed hands. */
const PAY_VERBS =
  "paid|pays|pay|paying|covered|covers|cover|covering|treated|bought|buys|fronted|fronts|settled|footed";
/** Verbs that read naturally as "<verb> by <name>". */
const PAY_BY_VERBS = "paid|covered|treated|bought|fronted|settled|footed";
/** Small words allowed between a name and the verb: "Asha already paid". */
const FILLER = "(?:(?:had|has|have|just|already|also|then)\\s+)?";
/** Joins that make a payment clause name several people. */
const LIST_JOIN = "\\s*(?:&|\\+|/|\\band\\b|\\bor\\b)\\s*";
const LIST_ITEM = `[${WORD}'’]+`;

const SELF = "(?:i|me|myself)";

const paymentWording = new RegExp(
  `${NOT_BEFORE}(?:${PAY_VERBS})${NOT_AFTER}|${NOT_BEFORE}(?:my|${LIST_ITEM}(?:'s|’s))\\s+(?:card|treat|tab)${NOT_AFTER}`,
  "iu",
);

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A name as a whole word or phrase: "Ana" never matches "banana". */
function phrasePattern(text: string): string {
  const trimmed = text.trim();
  const body = escapeRegExp(trimmed).replace(/\s+/g, "\\s+");
  const start = new RegExp(`^[${WORD}]`, "u").test(trimmed) ? NOT_BEFORE : "";
  const end = new RegExp(`[${WORD}]$`, "u").test(trimmed) ? NOT_AFTER : "";

  return `${start}${body}${end}`;
}

/** True when `mention` occurs in the text as a whole word or phrase. */
export function mentionedInText(mention: string, rawText: string): boolean {
  if (!mention.trim()) {
    return false;
  }

  return new RegExp(phrasePattern(mention), "iu").test(rawText);
}

/**
 * The text talks about paying at all ("paid", "covered", "my card",
 * "I owe Asha", "paid me back" ...).
 */
export function mentionsPayment(rawText: string): boolean {
  const text = rawText.normalize("NFKC");

  return paymentWording.test(text) || hasDoubtfulPaymentWording(text);
}

type Relation = "single" | "group" | null;

function relationFor(text: string, name: string): Relation {
  const isSelf = name.toLowerCase() === "me";
  const who = isSelf ? `${NOT_BEFORE}${SELF}${NOT_AFTER}` : phrasePattern(name);
  const verb = `\\s+${FILLER}(?:${PAY_VERBS})${NOT_AFTER}`;

  const byVerb = `${NOT_BEFORE}(?:${PAY_BY_VERBS})(?:\\s+for)?\\s+by\\s+`;

  // "Asha and Ben paid", "me or Asha paid", "paid by Asha and Ben",
  // "paid by Ben or Asha": several people, or a choice, in one clause.
  const group = [
    `(?:${LIST_ITEM}${LIST_JOIN})+${who}${verb}`,
    `${who}(?:${LIST_JOIN}${LIST_ITEM})+${verb}`,
    `${byVerb}${who}${LIST_JOIN}${LIST_ITEM}`,
    `${byVerb}(?:${LIST_ITEM}${LIST_JOIN})+${who}`,
  ];

  if (group.some((source) => new RegExp(source, "iu").test(text))) {
    return "group";
  }

  const possessive = isSelf
    ? `${NOT_BEFORE}my\\s+(?:card|treat|tab)${NOT_AFTER}`
    : `${who}(?:'s|’s)\\s+(?:card|treat|tab)${NOT_AFTER}`;
  const single = [`${who}${verb}`, `${byVerb}${who}`, possessive];

  return single.some((source) => new RegExp(source, "iu").test(text))
    ? "single"
    : null;
}

const APOS = "['’]";

/**
 * Wording that changes what "paid" means: paying someone back, not paying,
 * or paying nothing. The reader can't tell who paid for the expense in these
 * sentences, so the payer is left for the person to choose.
 */
const doubtfulPatterns = [
  // "paid me back", "pay Asha back", "paid back"
  `${NOT_BEFORE}(?:${PAY_VERBS})(?:\\s+${LIST_ITEM})?\\s+back${NOT_AFTER}`,
  `${NOT_BEFORE}(?:repaid|repay|repays|repaying|reimbursed|reimburse|reimburses|refunded|refund|refunds|owes|owe|owed|owing)${NOT_AFTER}`,
  `${NOT_BEFORE}settled\\s+up${NOT_AFTER}`,
  // "didn't pay", "has not paid", "never covered", "not paid"
  `${NOT_BEFORE}(?:(?:did|does|do|has|have|had|was|is)n${APOS}?t|(?:did|does|do|has|have|had|was|is)\\s+not|never|not|no\\s+one|nobody)\\s+(?:(?:yet|even|already|really|actually)\\s+)?(?:${PAY_VERBS})${NOT_AFTER}`,
  // "paid nothing", "paid 0", "covered none of it"
  `${NOT_BEFORE}(?:${PAY_VERBS})\\s+(?:for\\s+)?(?:nothing|zero|none|0+(?:[.,]0+)?)${NOT_AFTER}`,
].map((source) => new RegExp(source, "iu"));

/** True when the payment wording can't be taken at face value. */
export function hasDoubtfulPaymentWording(rawText: string): boolean {
  const text = rawText.normalize("NFKC");

  return doubtfulPatterns.some((pattern) => pattern.test(text));
}

export type PayerEvidence = {
  /** The text uses payment wording at all. */
  mentionsPayment: boolean;
  /** Names (from `names`) the text states paid on their own. */
  payers: string[];
  /** A payment clause names several people, e.g. "Asha and Ben paid". */
  group: boolean;
  /** Repayment, negated or zero-payment wording ("paid me back"). */
  doubtful: boolean;
};

/**
 * Which of `names` the text explicitly says paid. "Me" is matched as I / me /
 * myself / my. Matching is case-insensitive and on whole words only.
 */
export function readPayerEvidence(
  rawText: string,
  names: string[],
): PayerEvidence {
  const text = rawText.normalize("NFKC");
  const payers: string[] = [];
  let group = false;

  if (!mentionsPayment(text)) {
    return { mentionsPayment: false, payers, group, doubtful: false };
  }

  for (const name of names) {
    if (!name.trim()) continue;

    const relation = relationFor(text, name);

    if (relation === "group") group = true;
    if (relation === "single") payers.push(name);
  }

  return {
    mentionsPayment: true,
    payers,
    group,
    doubtful: hasDoubtfulPaymentWording(text),
  };
}

/**
 * The payer a new or corrected capture starts with, before any AI result.
 * "Me" is the labelled default only when the text doesn't talk about paying;
 * otherwise the payer stays open until it is read or chosen.
 */
export function initialPayer(
  rawText: string,
  members: string[],
): Pick<Expense, "paidBy" | "paidBySource" | "payerMention"> {
  if (mentionsPayment(rawText)) {
    return { paidBy: null, paidBySource: "capture", payerMention: null };
  }

  return {
    paidBy: members.includes("Me") ? "Me" : null,
    paidBySource: "default",
    payerMention: null,
  };
}
