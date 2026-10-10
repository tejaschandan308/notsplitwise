import { describe, expect, it, vi } from "vitest";
import { handleParseRequest } from "@/lib/parse-server";
import type { CurrencyCode, ParsedExpenseFields } from "@/lib/types";

const members = ["Me", "Asha", "Ben"];

/** Runs the real handler against a mocked model reply. */
async function parseWith(
  rawText: string,
  modelReply: Record<string, unknown> | string,
  tripCurrency: CurrencyCode = "INR",
): Promise<ParsedExpenseFields> {
  const reply =
    typeof modelReply === "string"
      ? modelReply
      : JSON.stringify({
          amount: null,
          currencyMention: null,
          category: null,
          note: "",
          location: null,
          included: members,
          unmatchedNames: [],
          paidBy: null,
          paidByAmbiguous: false,
          isPersonal: false,
          ...modelReply,
        });
  const result = await handleParseRequest(
    { rawText, members, tripCurrency },
    async () => reply,
  );

  if (!result.body.ok) {
    throw new Error(`expected ok, got ${result.body.error}`);
  }

  return result.body.data;
}

describe("payer", () => {
  it("defaults to nobody named when the note doesn't say who paid", async () => {
    const data = await parseWith("1200 dinner", { amount: 1200 });
    expect(data.paidBy).toBeNull();
    expect(data.payerMention).toBeNull();
  });

  it("accepts an explicit known payer without making them a participant", async () => {
    const data = await parseWith("Asha paid 1200 dinner for me and ben", {
      amount: 1200,
      paidBy: "asha",
      included: ["Me", "Ben"],
    });
    expect(data.paidBy).toBe("Asha");
    expect(data.included).toEqual(["Me", "Ben"]);
  });

  it("maps I/me to Me", async () => {
    const data = await parseWith("I paid 500 taxi", { amount: 500, paidBy: "I" });
    expect(data.paidBy).toBe("Me");
  });

  it("flags an unknown payer for review instead of adding a participant", async () => {
    const data = await parseWith("Dmitri paid 60 for me and asha", {
      amount: 60,
      paidBy: "Dmitri",
      included: ["Me", "Asha"],
      unmatchedNames: ["Dmitri"],
    });
    expect(data.paidBy).toBeNull();
    expect(data.payerMention).toBe("Dmitri");
    expect(data.unmatchedNames).toEqual([]);
    expect(data.included).toEqual(["Me", "Asha"]);
  });

  it("flags an ambiguous payer for review", async () => {
    const data = await parseWith("asha or ben paid 300 snacks", {
      amount: 300,
      paidBy: "asha or ben",
      paidByAmbiguous: true,
    });
    expect(data.paidBy).toBeNull();
    expect(data.payerMention).toBe("asha or ben");
  });

  it("ignores a payer the note never mentions", async () => {
    const data = await parseWith("300 snacks", { amount: 300, paidBy: "Ben" });
    expect(data.paidBy).toBeNull();
    expect(data.payerMention).toBeNull();
  });

  it("only accepts a strict boolean for ambiguity and personal flags", async () => {
    const data = await parseWith("Asha paid 300 snacks", {
      amount: 300,
      paidBy: "Asha",
      paidByAmbiguous: "true",
      isPersonal: "true",
    });
    expect(data.paidBy).toBe("Asha");
    expect(data.isPersonal).toBe(false);
  });
});

describe("currency", () => {
  it("keeps an explicit USD on an INR trip", async () => {
    const data = await parseWith("38 usd uber to hotel", {
      amount: 38,
      currencyMention: "usd",
    });
    expect(data.currency).toBe("USD");
    expect(data.amount).toBe(38);
  });

  it("uses the text even if the model misses the currency", async () => {
    const data = await parseWith("€42 tapas", { amount: 42 });
    expect(data.currency).toBe("EUR");
  });

  it("treats a bare $ as ambiguous outside a USD trip", async () => {
    const data = await parseWith("$40 taxi", { amount: 40, currencyMention: "$" });
    expect(data.currency).toBeNull();
    expect(data.currencyMention).toBe("$");
  });

  it("treats a bare $ as USD on a USD trip", async () => {
    const data = await parseWith("$40 taxi", { amount: 40 }, "USD");
    expect(data.currency).toBe("USD");
  });

  it("uses the trip currency when nothing is mentioned", async () => {
    const data = await parseWith("40 taxi", { amount: 40 }, "AED");
    expect(data.currency).toBe("AED");
    expect(data.currencyMention).toBeNull();
  });

  it("ignores a currency the model invented", async () => {
    const data = await parseWith("40 taxi", {
      amount: 40,
      currencyMention: "usd",
    });
    expect(data.currency).toBe("INR");
  });
});

describe("amount", () => {
  it.each([
    ["missing", null],
    ["zero", 0],
    ["negative", -250],
    ["string", "250"],
    ["too large", 1e12],
  ])("rejects a %s amount", async (_label, amount) => {
    const data = await parseWith("lunch", { amount });
    expect(data.amount).toBeNull();
  });

  it("rejects a non-finite amount from raw model JSON", async () => {
    const data = await parseWith(
      "lunch",
      '{"amount": 1e999, "included": [], "note": "lunch"}',
    );
    expect(data.amount).toBeNull();
  });

  it("rounds to cents", async () => {
    const data = await parseWith("lunch 12.345", { amount: 12.345 });
    expect(data.amount).toBe(12.35);
  });
});

describe("names", () => {
  it("keeps unknown names for review and never invents members", async () => {
    const data = await parseWith("600 museum me asha dmitri", {
      amount: 600,
      included: ["Me", "Asha", "Zed"],
      unmatchedNames: ["Dmitri", "asha", "me"],
    });
    expect(data.included).toEqual(["Me", "Asha"]);
    expect(data.unmatchedNames).toEqual(["Dmitri"]);
  });
});

describe("request handling", () => {
  it("rejects invalid or oversized input", async () => {
    const callModel = vi.fn();
    for (const body of [
      null,
      { rawText: "", members },
      { rawText: "x".repeat(601), members },
      { rawText: "ok", members: [] },
      { rawText: "ok", members: ["Me", 42] },
    ]) {
      const result = await handleParseRequest(body, callModel);
      expect(result.status).toBe(400);
      expect(result.body).toEqual({ ok: false, error: "invalid_input" });
    }
    expect(callModel).not.toHaveBeenCalled();
  });

  it("reports a missing key without calling anything", async () => {
    const result = await handleParseRequest({ rawText: "40 taxi", members }, null);
    expect(result.body).toEqual({ ok: false, error: "ai_not_configured" });
  });

  it("keeps provider error details server-side", async () => {
    const log = vi.fn();
    const result = await handleParseRequest(
      { rawText: "40 taxi", members },
      async () => {
        throw new Error("401 invalid x-api-key sk-secret");
      },
      log,
    );
    expect(result.body).toEqual({ ok: false, error: "ai_unavailable" });
    expect(JSON.stringify(result.body)).not.toContain("sk-secret");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("401"));
  });

  it("reports unreadable model output", async () => {
    const result = await handleParseRequest(
      { rawText: "40 taxi", members },
      async () => "Sorry, I can't help with that.",
    );
    expect(result.body).toEqual({ ok: false, error: "unreadable" });
  });
});
