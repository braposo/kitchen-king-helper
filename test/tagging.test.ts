import { describe, expect, it } from "vitest";
import { JevError, type Answer, type Question } from "../src/lib/jev";
import { buildState, getRecipeTags, InputError, saveChefTags, tagRecipe } from "../src/lib/tagging";
import { recordingJev, seedRecipe } from "./helpers/fixtures";
import { testEnv } from "./helpers/d1";

/** Answers every yes/no question with `p`, and every choice with equal odds. */
const yesNoAt = (p: number) => (_s: string, qs: Question[]): Answer[] =>
  qs.map((q) =>
    q.kind === "yes_no"
      ? { kind: "yes_no" as const, probability: p }
      : { kind: "choose" as const, probabilities: q.options.map(() => 0.2) },
  );

describe("buildState", () => {
  it("includes the title, version, ingredients with prep notes and a truncated method", () => {
    const state = buildState(
      "Shakshuka",
      "Vegan",
      [
        { alternative_id: null, name: "eggs", prep_note: null },
        { alternative_id: 7, name: "tofu", prep_note: "crumbled" },
      ],
      "x".repeat(3000),
      7,
    );
    expect(state).toContain("Dish: Shakshuka");
    expect(state).toContain("Version: Vegan");
    expect(state).toContain("- tofu (crumbled)");
    expect(state).not.toContain("eggs");
    expect(state.length).toBeLessThan(2200);
  });
});

describe("tagRecipe", () => {
  it("returns null for an unknown recipe without calling Jev", async () => {
    const env = testEnv();
    const { jev, calls } = recordingJev();
    expect(await tagRecipe(env.DB, jev, 999)).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("sets the category from Jev and tags the main version and each alternative separately", async () => {
    const env = testEnv();
    const recipe = await seedRecipe(env, {
      title: "Lentil shakshuka",
      method: "Simmer the lentils.",
      lines: [{ name: "lentils" }, { name: "tomato" }],
      alternatives: [{ label: "Vegan", lines: [{ name: "lentils" }, { name: "tomato" }, { name: "coconut oil" }] }],
    });
    const { jev, calls } = recordingJev();

    const tags = await tagRecipe(env.DB, jev, recipe.id);

    expect(tags?.category).toBe("brunch"); // "shakshuka" is a brunch word
    expect(tags?.category_source).toBe("jev");
    expect(tags?.versions.map((v) => v.label)).toEqual(["Main version", "Vegan"]);
    expect(tags?.versions[1].alternative_id).toBe(recipe.alternativeIds[0]);
    // One category call, then one diet call per version.
    expect(calls).toHaveLength(3);
    expect(calls[1].questions).toHaveLength(5);
    expect(calls[2].state).toContain("Version: Vegan");
    expect(calls[2].state).toContain("- coconut oil");
    expect(tags?.versions[0].tags.map((t) => t.tag)).toEqual(["vegetarian", "vegan", "gluten_free", "dairy_free", "contains_nuts"]);
  });

  it("stores value as p >= 0.5 and confidence as the larger of p and 1 - p", async () => {
    const env = testEnv();
    const recipe = await seedRecipe(env, { title: "Dal", lines: [{ name: "lentils" }] });
    const { jev } = recordingJev(yesNoAt(0.3));

    const tags = await tagRecipe(env.DB, jev, recipe.id);

    const main = tags!.versions[0].tags;
    expect(main.every((t) => t.value === false)).toBe(true);
    expect(main.every((t) => t.confidence === 0.7)).toBe(true);
    expect(main.every((t) => t.source === "jev")).toBe(true);
  });

  it("flags jev tags below 0.9 as unsure and leaves confident ones alone", async () => {
    const env = testEnv();
    const recipe = await seedRecipe(env, { title: "Dal", lines: [{ name: "lentils" }] });

    const sure = await tagRecipe(env.DB, recordingJev(yesNoAt(0.97)).jev, recipe.id);
    expect(sure!.versions[0].tags.every((t) => t.unsure === false)).toBe(true);

    const unsure = await tagRecipe(env.DB, recordingJev(yesNoAt(0.6)).jev, recipe.id);
    expect(unsure!.versions[0].tags.every((t) => t.unsure === true)).toBe(true);
  });

  it("never overwrites chef tags and does not ask Jev about them", async () => {
    const env = testEnv();
    const recipe = await seedRecipe(env, { title: "Pork belly", lines: [{ name: "pork" }] });
    await saveChefTags(env.DB, recipe.id, { tags: [{ alternative_id: null, tag: "vegetarian", value: true }] });
    // Jev says it is not vegetarian; the chef's answer must win.
    const { jev, calls } = recordingJev(yesNoAt(0.05));

    const tags = await tagRecipe(env.DB, jev, recipe.id);

    const vegetarian = tags!.versions[0].tags.find((t) => t.tag === "vegetarian");
    expect(vegetarian).toEqual({ tag: "vegetarian", value: true, confidence: null, source: "chef", unsure: false });
    const diet = calls.find((c) => c.questions.some((q) => q.kind === "yes_no"));
    expect(diet?.questions.map((q) => q.key)).not.toContain("vegetarian");
  });

  it("keeps a chef category and does not ask Jev for one", async () => {
    const env = testEnv();
    const recipe = await seedRecipe(env, { title: "Eggs benedict", lines: [{ name: "eggs" }] });
    await saveChefTags(env.DB, recipe.id, { category: "dinner" });
    const { jev, calls } = recordingJev();

    const tags = await tagRecipe(env.DB, jev, recipe.id);

    expect(tags?.category).toBe("dinner");
    expect(tags?.category_source).toBe("chef");
    expect(calls.some((c) => c.questions.some((q) => q.kind === "choose"))).toBe(false);
  });

  it("writes nothing when Jev fails", async () => {
    const env = testEnv();
    const recipe = await seedRecipe(env, { title: "Dal", lines: [{ name: "lentils" }] });
    const { jev } = recordingJev(() => {
      throw new JevError("Jev returned HTTP 500");
    });

    await expect(tagRecipe(env.DB, jev, recipe.id)).rejects.toBeInstanceOf(JevError);
    const row = await env.DB.prepare("SELECT category, category_source FROM recipes WHERE id = ?").bind(recipe.id).first<{ category: string | null; category_source: string | null }>();
    expect(row).toEqual({ category: null, category_source: null });
    const tags = await env.DB.prepare("SELECT COUNT(*) AS n FROM recipe_diet_tags").first<{ n: number }>();
    expect(tags?.n).toBe(0);
  });

  it("replaces earlier jev tags when run again", async () => {
    const env = testEnv();
    const recipe = await seedRecipe(env, { title: "Dal", lines: [{ name: "lentils" }] });
    await tagRecipe(env.DB, recordingJev(yesNoAt(0.2)).jev, recipe.id);
    const again = await tagRecipe(env.DB, recordingJev(yesNoAt(0.8)).jev, recipe.id);
    expect(again!.versions[0].tags.every((t) => t.value === true)).toBe(true);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM recipe_diet_tags").first<{ n: number }>();
    expect(n?.n).toBe(5);
  });
});

describe("getRecipeTags", () => {
  it("returns null for an unknown recipe", async () => {
    expect(await getRecipeTags(testEnv().DB, 1)).toBeNull();
  });

  it("returns an empty set of versions and tags for an untagged recipe", async () => {
    const env = testEnv();
    const recipe = await seedRecipe(env, { title: "Dal", lines: [{ name: "lentils" }] });
    expect(await getRecipeTags(env.DB, recipe.id)).toEqual({
      category: null,
      category_source: null,
      versions: [{ alternative_id: null, label: "Main version", tags: [] }],
    });
  });
});

describe("saveChefTags", () => {
  it("returns null for an unknown recipe", async () => {
    expect(await saveChefTags(testEnv().DB, 42, { category: "snack" })).toBeNull();
  });

  it("stores chef tags with no confidence and sets the category as the chef", async () => {
    const env = testEnv();
    const recipe = await seedRecipe(env, { title: "Dal", lines: [{ name: "lentils" }] });
    const tags = await saveChefTags(env.DB, recipe.id, {
      category: "side",
      tags: [{ alternative_id: null, tag: "gluten_free", value: false }],
    });
    expect(tags?.category).toBe("side");
    expect(tags?.category_source).toBe("chef");
    expect(tags?.versions[0].tags).toEqual([
      { tag: "gluten_free", value: false, confidence: null, source: "chef", unsure: false },
    ]);
  });

  it("clears the chef category when given null", async () => {
    const env = testEnv();
    const recipe = await seedRecipe(env, { title: "Dal", category: "side", category_source: "chef", lines: [] });
    const tags = await saveChefTags(env.DB, recipe.id, { category: null });
    expect(tags?.category).toBeNull();
    expect(tags?.category_source).toBeNull();
  });

  it("rejects an alternative that belongs to another recipe", async () => {
    const env = testEnv();
    const a = await seedRecipe(env, { title: "A", alternatives: [{ label: "Vegan", lines: [] }] });
    const b = await seedRecipe(env, { title: "B" });
    await expect(
      saveChefTags(env.DB, b.id, { tags: [{ alternative_id: a.alternativeIds[0], tag: "vegan", value: true }] }),
    ).rejects.toBeInstanceOf(InputError);
  });

  it("keeps chef tags separate per version", async () => {
    const env = testEnv();
    const recipe = await seedRecipe(env, { title: "Dal", alternatives: [{ label: "Vegan", lines: [] }] });
    const tags = await saveChefTags(env.DB, recipe.id, {
      tags: [
        { alternative_id: null, tag: "vegan", value: false },
        { alternative_id: recipe.alternativeIds[0], tag: "vegan", value: true },
      ],
    });
    expect(tags?.versions[0].tags[0].value).toBe(false);
    expect(tags?.versions[1].tags[0].value).toBe(true);
  });
});
