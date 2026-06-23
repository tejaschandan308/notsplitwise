import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { PARSE_SYSTEM_PROMPT } from "@/lib/parse-prompt";
import type {
  Category,
  Confidence,
  ParsedExpenseFields,
} from "@/lib/types";

export const runtime = "nodejs";

type ParseResponse = {
  ok: boolean;
  data: ParsedExpenseFields;
  error?: string;
};

const allowedCategories = new Set<Category>([
  "food",
  "transport",
  "stay",
  "tickets",
  "personal",
  "other",
]);

function buildFallback(rawText: string, members: string[]): ParsedExpenseFields {
  return {
    amount: null,
    category: null,
    note: rawText.trim(),
    location: null,
    included: [...members],
    splitType: "equal",
    isPersonal: false,
    confidence: "low",
  };
}

function jsonResponse(response: ParseResponse): NextResponse<ParseResponse> {
  return NextResponse.json(response, { status: 200 });
}

function parseJsonObject(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Try the common accidental markdown fence wrapper.
  }

  const unfenced = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");

  try {
    return JSON.parse(unfenced);
  } catch {
    // Try extracting the first JSON-looking object from surrounding text.
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("json parse failed");
  }

  return JSON.parse(text.slice(firstBrace, lastBrace + 1));
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function sanitizeParsed(
  parsed: unknown,
  members: string[],
  fallback: ParsedExpenseFields,
): ParsedExpenseFields {
  const record = asRecord(parsed);
  const amount = record.amount;
  const category = record.category;
  const confidence = record.confidence;
  const parsedIncluded = record.included;
  const included = Array.isArray(parsedIncluded)
    ? members.filter((member) => parsedIncluded.includes(member))
    : [];
  const isPersonal = Boolean(record.isPersonal);

  return {
    amount: typeof amount === "number" && Number.isFinite(amount) ? amount : null,
    category:
      typeof category === "string" && allowedCategories.has(category as Category)
        ? (category as Category)
        : null,
    note: typeof record.note === "string" ? record.note : fallback.note,
    location:
      typeof record.location === "string"
        ? record.location
        : record.location === null
          ? null
          : fallback.location,
    included:
      isPersonal && members.includes("Me")
        ? ["Me"]
        : included.length > 0
          ? included
          : [...members],
    splitType: "equal",
    isPersonal,
    confidence:
      confidence === "high" || confidence === "low"
        ? (confidence as Confidence)
        : "low",
  };
}

function extractTextBlocks(content: Anthropic.Messages.Message["content"]) {
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

export async function POST(request: Request) {
  let rawText = "";
  let members: string[] = [];

  try {
    const body = (await request.json()) as {
      rawText?: unknown;
      members?: unknown;
    };

    rawText = typeof body.rawText === "string" ? body.rawText : "";
    members = Array.isArray(body.members)
      ? body.members.filter((member): member is string => typeof member === "string")
      : [];

    const fallback = buildFallback(rawText, members);

    if (!rawText.trim() || members.length === 0) {
      return jsonResponse({
        ok: false,
        data: fallback,
        error: "invalid input",
      });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return jsonResponse({
        ok: false,
        data: fallback,
        error: "missing ANTHROPIC_API_KEY",
      });
    }

    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      temperature: 0,
      system: PARSE_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Members: ${JSON.stringify(members)}\nCapture: ${rawText}`,
        },
      ],
    });
    const text = extractTextBlocks(message.content);

    try {
      const parsed = parseJsonObject(text);

      return jsonResponse({
        ok: true,
        data: sanitizeParsed(parsed, members, fallback),
      });
    } catch {
      return jsonResponse({
        ok: false,
        data: fallback,
        error: "json parse failed",
      });
    }
  } catch (err) {
    return jsonResponse({
      ok: false,
      data: buildFallback(rawText, members),
      error: String(err),
    });
  }
}
