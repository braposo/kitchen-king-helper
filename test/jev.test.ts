import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildRequest,
  createHttpJev,
  createJev,
  JevError,
  mockCategory,
  mockJev,
  parseResponse,
  type Question,
} from "../src/lib/jev";

const questions: Question[] = [
  { kind: "choose", prompt: "Which meal?", options: ["brunch", "dinner", "any"] },
  { kind: "yes_no", prompt: "Vegan?" },
];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("buildRequest", () => {
  it("maps choose and yes/no questions to Jev's wire types", () => {
    expect(buildRequest("Shakshuka", questions)).toEqual({
      state: "Shakshuka",
      model: "jev-latest",
      questions: {
        q0: { type: "choice", instructions: "Which meal?", criteria: { brunch: null, dinner: null, any: null } },
        q1: { type: "noul", instructions: "Vegan?" },
      },
    });
  });

  it("keeps repeated options apart", () => {
    const body = buildRequest("x", [{ kind: "choose", prompt: "Which?", options: ["Dal", "Dal"] }]);
    expect(body.questions.q0).toMatchObject({ criteria: { Dal: null, "Dal (2)": null } });
  });

  it("does not send the mock key", () => {
    const body = buildRequest("x", [{ kind: "yes_no", prompt: "Vegan?", key: "vegan" }]);
    expect(JSON.stringify(body)).not.toContain("vegan\"");
  });
});

describe("parseResponse", () => {
  it("reads choice probabilities and yes/no probabilities in order", () => {
    const answers = parseResponse(
      {
        model: "jev-1.13.0",
        answers: {
          q0: { type: "choice", choice: "dinner", confidence: 0.7, probabilities: { dinner: 0.7, brunch: 0.2, any: 0.1 } },
          q1: { type: "noul", noul: 0.91 },
        },
      },
      questions,
    );
    expect(answers).toEqual([
      { kind: "choose", probabilities: [0.2, 0.7, 0.1] },
      { kind: "yes_no", probability: 0.91 },
    ]);
  });

  it("rejects missing answers", () => {
    expect(() => parseResponse({}, questions)).toThrow(JevError);
  });

  it("rejects a different number of answers", () => {
    expect(() => parseResponse({ answers: { q0: { noul: 0.5 } } }, questions)).toThrow(JevError);
  });

  it("rejects probabilities that do not match the options", () => {
    expect(() =>
      parseResponse({ answers: { q0: { probabilities: { brunch: 0.5, dinner: 0.5 } }, q1: { noul: 0.5 } } }, questions),
    ).toThrow(JevError);
  });

  it("rejects probabilities outside 0 to 1", () => {
    expect(() =>
      parseResponse({ answers: { q0: { probabilities: { brunch: 0.5, dinner: 0.5, any: 1.5 } }, q1: { noul: 0.5 } } }, questions),
    ).toThrow(JevError);
    expect(() =>
      parseResponse({ answers: { q0: { probabilities: { brunch: 0.5, dinner: 0.4, any: 0.1 } }, q1: { noul: "yes" } } }, questions),
    ).toThrow(JevError);
  });
});

describe("HTTP client", () => {
  afterEach(() => vi.restoreAllMocks());

  it("posts to Jev with the key and returns ranked options", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ answers: { q0: { probabilities: { brunch: 0.1, dinner: 0.8, any: 0.1 } } } }));
    const jev = createHttpJev("secret-key", fetchImpl as unknown as typeof fetch);

    const ranked = await jev.choose("Shakshuka", "Which meal?", ["brunch", "dinner", "any"]);

    expect(ranked).toEqual([
      { option: "dinner", probability: 0.8 },
      { option: "brunch", probability: 0.1 },
      { option: "any", probability: 0.1 },
    ]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer secret-key");
    expect(JSON.parse(init.body as string)).toEqual({
      state: "Shakshuka",
      model: "jev-latest",
      questions: { q0: { type: "choice", instructions: "Which meal?", criteria: { brunch: null, dinner: null, any: null } } },
    });
  });

  it("answers yes/no questions in a single batched call", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ answers: { q0: { probabilities: { brunch: 0.1, dinner: 0.8, any: 0.1 } }, q1: { noul: 0.3 } } }));
    const jev = createHttpJev("k", fetchImpl as unknown as typeof fetch);
    const answers = await jev.ask("Shakshuka", questions);
    expect(answers[1]).toEqual({ kind: "yes_no", probability: 0.3 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("throws JevError on an HTTP error", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 503 }));
    const jev = createHttpJev("k", fetchImpl as unknown as typeof fetch);
    await expect(jev.yesNo("x", "Vegan?")).rejects.toThrow(/HTTP 503/);
    await expect(jev.yesNo("x", "Vegan?")).rejects.toBeInstanceOf(JevError);
  });

  it("throws JevError when the network fails", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const jev = createHttpJev("k", fetchImpl as unknown as typeof fetch);
    await expect(jev.yesNo("x", "Vegan?")).rejects.toBeInstanceOf(JevError);
  });

  it("throws JevError when the reply is not JSON", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html>", { status: 200 }));
    const jev = createHttpJev("k", fetchImpl as unknown as typeof fetch);
    await expect(jev.yesNo("x", "Vegan?")).rejects.toThrow(/not JSON/);
  });

  it("gives up after the timeout, even if fetch ignores the abort signal", async () => {
    const fetchImpl = vi.fn(() => new Promise<Response>(() => {}));
    const jev = createHttpJev("k", fetchImpl as unknown as typeof fetch, 20);
    await expect(jev.yesNo("x", "Vegan?")).rejects.toThrow(/did not answer within/);
  });

  it("aborts the request when the timeout passes", async () => {
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn((_url: string, init: RequestInit) => {
      signal = init.signal as AbortSignal;
      return new Promise<Response>((_, reject) => {
        signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    });
    const jev = createHttpJev("k", fetchImpl as unknown as typeof fetch, 20);
    await expect(jev.yesNo("x", "Vegan?")).rejects.toBeInstanceOf(JevError);
    expect(signal?.aborted).toBe(true);
  });
});

describe("createJev", () => {
  it("uses the live client when a key is set", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ answers: { q0: { noul: 0.95 } } }));
    const jev = createJev({ JEV_API_KEY: "k" }, fetchImpl as unknown as typeof fetch);
    expect(await jev.yesNo("x", "Vegan?")).toBe(0.95);
    expect(fetchImpl).toHaveBeenCalled();
  });

  it("uses the mock when no key is set", async () => {
    const fetchImpl = vi.fn();
    const jev = createJev({}, fetchImpl as unknown as typeof fetch);
    expect(jev).toBe(mockJev);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("mockJev", () => {
  const dish = (text: string) => `Dish: test\nVersion: Main version\nIngredients:\n${text}\nMethod:\nnone given`;

  it("picks a category from keywords, with dinner as the fallback", () => {
    expect(mockCategory(dish("- eggs\n- spinach"))).toBe("brunch");
    expect(mockCategory(dish("- oats\n- granola"))).toBe("brunch");
    expect(mockCategory(dish("- chocolate\n- brownie"))).toBe("snack");
    expect(mockCategory(dish("- rice\n- lime"))).toBe("side");
    expect(mockCategory(dish("- lamb shoulder\n- rosemary"))).toBe("dinner");
  });

  it("answers diet questions from keywords, with confidence between 0.55 and 0.85", async () => {
    const state = dish("- chicken thigh\n- butter\n- wheat flour\n- almonds");
    const yes = async (key: string) => {
      const [a] = await mockJev.ask(state, [{ kind: "yes_no", key, prompt: key }]);
      return a.kind === "yes_no" ? a.probability : NaN;
    };
    const confidence = (p: number) => Math.max(p, 1 - p);

    expect(await yes("vegetarian")).toBe(0.15);
    expect(await yes("vegan")).toBe(0.15);
    expect(await yes("gluten_free")).toBe(0.15);
    expect(await yes("dairy_free")).toBe(0.15);
    expect(await yes("contains_nuts")).toBe(0.85);

    for (const key of ["vegetarian", "vegan", "gluten_free", "dairy_free", "contains_nuts"]) {
      const p = await yes(key);
      expect(confidence(p)).toBeGreaterThanOrEqual(0.55);
      expect(confidence(p)).toBeLessThanOrEqual(0.85);
    }
  });

  it("calls a plain vegetable dish vegan and gluten-free", async () => {
    const state = dish("- carrot\n- lentils\n- cumin");
    const [veg, vegan, gf, df, nuts] = await mockJev.ask(state, [
      { kind: "yes_no", key: "vegetarian", prompt: "" },
      { kind: "yes_no", key: "vegan", prompt: "" },
      { kind: "yes_no", key: "gluten_free", prompt: "" },
      { kind: "yes_no", key: "dairy_free", prompt: "" },
      { kind: "yes_no", key: "contains_nuts", prompt: "" },
    ]);
    expect(veg).toEqual({ kind: "yes_no", probability: 0.85 });
    expect(vegan).toEqual({ kind: "yes_no", probability: 0.85 });
    expect(gf).toEqual({ kind: "yes_no", probability: 0.85 });
    expect(df).toEqual({ kind: "yes_no", probability: 0.85 });
    expect(nuts).toEqual({ kind: "yes_no", probability: 0.15 });
  });

  it("does not match nutmeg or coconut as nuts", async () => {
    const [nuts] = await mockJev.ask(dish("- nutmeg\n- coconut milk"), [{ kind: "yes_no", key: "contains_nuts", prompt: "" }]);
    expect(nuts).toEqual({ kind: "yes_no", probability: 0.15 });
  });

  it("keeps every choose probability between 0.55 and 0.85", async () => {
    const [a] = await mockJev.ask(dish("- eggs"), [
      { kind: "choose", key: "category", prompt: "", options: ["brunch", "snack", "dinner", "side", "any"] },
    ]);
    if (a.kind !== "choose") throw new Error("expected choose");
    for (const p of a.probabilities) {
      expect(p).toBeGreaterThanOrEqual(0.55);
      expect(p).toBeLessThanOrEqual(0.85);
    }
    expect(a.probabilities[0]).toBe(0.85);
  });

  it("ranks options by word overlap when no key is given", async () => {
    const ranked = await mockJev.choose("Dish: Lemon tart\nIngredients:\n- lemon", "Pick", ["Chocolate cake", "Lemon tart"]);
    expect(ranked[0].option).toBe("Lemon tart");
    expect(ranked[0].probability).toBeLessThanOrEqual(0.85);
  });

  it("is deterministic", async () => {
    const a = await mockJev.yesNo("Dish: x\n- egg", "Vegan?");
    const b = await mockJev.yesNo("Dish: x\n- egg", "Vegan?");
    expect(a).toBe(b);
  });
});
