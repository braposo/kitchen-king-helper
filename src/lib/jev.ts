import type { Env } from "../env";

// Client for Jev, TypeSafe's classification model. Jev never writes text: we send
// it a piece of text (the "state") plus questions, and it answers with probabilities.
// Without a key the app uses mockJev, a keyword heuristic, so it stays useful offline.

export type ChooseQuestion = { kind: "choose"; prompt: string; options: string[]; key?: string };
export type YesNoQuestion = { kind: "yes_no"; prompt: string; key?: string };
/** `key` is only read by mockJev, to pick its heuristic. It is never sent to Jev. */
export type Question = ChooseQuestion | YesNoQuestion;

/** One answer per question, in the same order as the questions. */
export type Answer =
  | { kind: "choose"; probabilities: number[] }
  | { kind: "yes_no"; probability: number };

export type Ranked = { option: string; probability: number };

export interface Jev {
  /** Options sorted by probability, highest first. */
  choose(state: string, question: string, options: string[]): Promise<Ranked[]>;
  /** Probability that the answer is yes. */
  yesNo(state: string, question: string): Promise<number>;
  /** Several questions about one state in a single call. */
  ask(state: string, questions: Question[]): Promise<Answer[]>;
}

export class JevError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JevError";
  }
}

export const JEV_URL = "https://api.typesafe.ai/v1/systemone";
const TIMEOUT_MS = 10_000;

// UNVERIFIED: shape assumed, check against docs.typesafe.ai. Request and response
// JSON are built and read only in buildRequest and parseResponse.
export function buildRequest(state: string, questions: Question[]) {
  return {
    state,
    questions: questions.map((q) =>
      q.kind === "choose"
        ? { type: "choice", prompt: q.prompt, options: q.options }
        : { type: "yes_no", prompt: q.prompt },
    ),
  };
}

const isProbability = (x: unknown): x is number => typeof x === "number" && x >= 0 && x <= 1;

// UNVERIFIED: shape assumed, check against docs.typesafe.ai. Expects
// { answers: [{ probabilities: number[] } | { probability: number }] }.
export function parseResponse(json: unknown, questions: Question[]): Answer[] {
  const answers = (json as { answers?: unknown } | null)?.answers;
  if (!Array.isArray(answers) || answers.length !== questions.length) {
    throw new JevError("Jev answered a different number of questions than it was asked");
  }
  return questions.map((q, i) => {
    const a = answers[i] as { probabilities?: unknown; probability?: unknown } | null;
    if (q.kind === "choose") {
      const p = a?.probabilities;
      if (!Array.isArray(p) || p.length !== q.options.length || !p.every(isProbability)) {
        throw new JevError("Jev sent probabilities that do not match the options");
      }
      return { kind: "choose", probabilities: p as number[] };
    }
    const p = a?.probability;
    if (!isProbability(p)) throw new JevError("Jev sent a yes/no answer without a probability");
    return { kind: "yes_no", probability: p };
  });
}

/** Pairs options with an answer and sorts them, highest probability first. */
export function rank(options: string[], answer: Answer | undefined): Ranked[] {
  if (!answer || answer.kind !== "choose") throw new JevError("Jev did not answer the choice question");
  return options
    .map((option, i) => ({ option, probability: answer.probabilities[i] }))
    .sort((a, b) => b.probability - a.probability);
}

/** Builds choose() and yesNo() on top of ask(). */
export function jevFromAsk(ask: Jev["ask"]): Jev {
  return {
    ask,
    async choose(state, question, options) {
      const [answer] = await ask(state, [{ kind: "choose", prompt: question, options }]);
      return rank(options, answer);
    },
    async yesNo(state, question) {
      const [answer] = await ask(state, [{ kind: "yes_no", prompt: question }]);
      if (answer?.kind !== "yes_no") throw new JevError("Jev did not answer the yes/no question");
      return answer.probability;
    },
  };
}

/** The real client. `timeoutMs` is exposed so tests need not wait ten seconds. */
export function createHttpJev(apiKey: string, fetchImpl: typeof fetch = fetch, timeoutMs = TIMEOUT_MS): Jev {
  const ask: Jev["ask"] = async (state, questions) => {
    if (questions.length === 0) return [];
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new JevError(`Jev did not answer within ${timeoutMs / 1000} seconds`));
      }, timeoutMs);
    });
    const run = async () => {
      const res = await fetchImpl(JEV_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify(buildRequest(state, questions)),
        signal: controller.signal,
      });
      if (!res.ok) throw new JevError(`Jev returned HTTP ${res.status}`);
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        throw new JevError("Jev sent a reply that is not JSON");
      }
      return parseResponse(json, questions);
    };
    try {
      return await Promise.race([run(), timeout]);
    } catch (err) {
      if (err instanceof JevError) throw err;
      throw new JevError(`Could not reach Jev: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      // The timer is always set by the time we get here (the Promise constructor runs synchronously).
      clearTimeout(timer as ReturnType<typeof setTimeout>);
    }
  };
  return jevFromAsk(ask);
}

// ---- Offline mock -------------------------------------------------------------
// Keyword heuristics. Every probability it returns is between 0.55 and 0.85, so
// mock tags always show as "check this" (confidence below 0.9).

const has = (text: string, words: string[]) =>
  new RegExp(`\\b(?:${words.join("|")})(?:s|es)?\\b`, "i").test(text);

const CATEGORY_WORDS = {
  brunch: ["eggs?", "pancakes?", "granola", "porridge", "toast", "shakshuka", "frittata"],
  snack: ["cakes?", "biscuits?", "cookies?", "flapjacks?", "brownies?", "dips?", "hummus", "fruit", "bars?", "scones?"],
  side: ["salads?", "breads?", "rice", "potato(?:es)?", "greens?", "slaw"],
};

/** The category the mock picks. Anything without a keyword is dinner. */
export function mockCategory(state: string): "brunch" | "snack" | "side" | "dinner" {
  if (has(state, CATEGORY_WORDS.brunch)) return "brunch";
  if (has(state, CATEGORY_WORDS.snack)) return "snack";
  if (has(state, CATEGORY_WORDS.side)) return "side";
  return "dinner";
}

const MEAT_FISH = ["chicken", "beef", "pork", "lamb", "bacon", "ham", "sausages?", "chorizo", "mince", "turkey", "duck", "steak", "fish", "salmon", "tuna", "cod", "anchov(?:y|ies)", "prawns?", "shrimp", "mackerel", "haddock"];
const DAIRY = ["milk", "butter", "cream", "cheese", "yoghurt", "yogurt"];
const EGG_HONEY = ["eggs?", "honey"];
const WHEAT = ["wheat", "flour", "pasta", "bread", "couscous", "barley", "soy sauce"];
const NUTS = ["almonds?", "walnuts?", "cashews?", "pecans?", "hazelnuts?", "peanuts?", "pistachios?", "pine nuts?", "nuts?", "macadamias?"];

/** Diet keys match the tag names in the database. `found` is the answer when the words appear. */
const MOCK_DIET: Record<string, { words: string[]; yesWhenFound: boolean }> = {
  vegetarian: { words: MEAT_FISH, yesWhenFound: false },
  vegan: { words: [...MEAT_FISH, ...DAIRY, ...EGG_HONEY], yesWhenFound: false },
  gluten_free: { words: WHEAT, yesWhenFound: false },
  dairy_free: { words: DAIRY, yesWhenFound: false },
  contains_nuts: { words: NUTS, yesWhenFound: true },
};

/** Share of the option's words that also appear in the state, mapped into the mock range. */
function overlap(option: string, state: string): number {
  const words = option.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  if (words.length === 0) return 0;
  const text = state.toLowerCase();
  return words.filter((w) => text.includes(w)).length / words.length;
}

// Rounded so 0.85 is exactly 0.85 and not 0.8500000000000001.
const mockProbability = (score: number) => Math.round((0.55 + 0.3 * score) * 100) / 100;

async function mockAsk(state: string, questions: Question[]): Promise<Answer[]> {
  return questions.map((q): Answer => {
    if (q.kind === "choose") {
      if (q.key === "category") {
        const pick = mockCategory(state);
        return { kind: "choose", probabilities: q.options.map((o) => mockProbability(o === pick ? 1 : 0)) };
      }
      return { kind: "choose", probabilities: q.options.map((o) => mockProbability(overlap(o, state))) };
    }
    const rule = q.key ? MOCK_DIET[q.key] : undefined;
    if (!rule) return { kind: "yes_no", probability: 0.5 };
    const found = has(state, rule.words);
    // Yes answers sit at 0.85 and no answers at 0.15, so the confidence is 0.85 either way.
    const yes = found === rule.yesWhenFound;
    return { kind: "yes_no", probability: yes ? 0.85 : 0.15 };
  });
}

export const mockJev: Jev = jevFromAsk(mockAsk);

/** The live client when JEV_API_KEY is set, otherwise the offline mock. */
export function createJev(env: Pick<Env, "JEV_API_KEY">, fetchImpl: typeof fetch = fetch): Jev {
  return env.JEV_API_KEY ? createHttpJev(env.JEV_API_KEY, fetchImpl) : mockJev;
}
