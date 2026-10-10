import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { handleParseRequest, type ModelCaller } from "@/lib/parse-server";

export const runtime = "nodejs";

const DEFAULT_MODEL = "claude-sonnet-4-6";

function createModelCaller(): ModelCaller | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return null;
  }

  const anthropic = new Anthropic({ apiKey });
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;

  return async (system, user) => {
    const message = await anthropic.messages.create({
      model,
      max_tokens: 512,
      temperature: 0,
      system,
      messages: [{ role: "user", content: user }],
    });

    return message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
  };
}

export async function POST(request: Request) {
  let body: unknown = null;

  try {
    body = await request.json();
  } catch {
    // Handled as invalid input below.
  }

  const result = await handleParseRequest(body, createModelCaller(), (message) =>
    console.error(`[api/parse] ${message}`),
  );

  return NextResponse.json(result.body, { status: result.status });
}
