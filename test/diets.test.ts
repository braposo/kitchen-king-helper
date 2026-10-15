import { describe, expect, it } from "vitest";
import { assignVersions, dietCounts, findDiets, guestAlternatives, parseGuestList, versionDiets } from "../src/lib/diets";

describe("findDiets", () => {
  it("reads common ways of writing each diet", () => {
    expect(findDiets("Vegan").diets).toEqual(["vegan"]);
    expect(findDiets("plant-based").diets).toEqual(["vegan"]);
    expect(findDiets("veggie").diets).toEqual(["vegetarian"]);
    expect(findDiets("coeliac").diets).toEqual(["gluten_free"]);
    expect(findDiets("GF/DF").diets).toEqual(["gluten_free", "dairy_free"]);
    expect(findDiets("lactose intolerant").diets).toEqual(["dairy_free"]);
    expect(findDiets("nut allergy").diets).toEqual(["nut_free"]);
    expect(findDiets("allergic to peanuts").diets).toEqual(["nut_free"]);
  });

  it("keeps the rest as a note", () => {
    expect(findDiets("vegan, no mushrooms")).toEqual({ diets: ["vegan"], rest: "no mushrooms" });
    expect(findDiets("gluten free and hates coriander")).toEqual({ diets: ["gluten_free"], rest: "hates coriander" });
    expect(findDiets("no mushrooms")).toEqual({ diets: [], rest: "no mushrooms" });
  });

  it("does not read words inside other words", () => {
    expect(findDiets("Vegas").diets).toEqual([]);
    expect(findDiets("Donut").diets).toEqual([]);
  });
});

describe("parseGuestList", () => {
  it("reads names with their needs in several shapes", () => {
    const { guests, skipped } = parseGuestList(
      [
        "Name\tDiet",
        "Tom - vegan",
        "Sam: gluten free, dairy free",
        "Jo (coeliac)",
        "Mark\tVegetarian\tno mushrooms",
        "- Luis – nut allergy",
        "1. Pete: no onions",
        "Ana vegan",
        "",
      ].join("\n"),
    );
    expect(skipped).toEqual([]);
    expect(guests).toEqual([
      { name: "Tom", count: 1, diets: ["vegan"], note: null },
      { name: "Sam", count: 1, diets: ["gluten_free", "dairy_free"], note: null },
      { name: "Jo", count: 1, diets: ["gluten_free"], note: null },
      { name: "Mark", count: 1, diets: ["vegetarian"], note: "no mushrooms" },
      { name: "Luis", count: 1, diets: ["nut_free"], note: null },
      { name: "Pete", count: 1, diets: [], note: "no onions" },
      { name: "Ana", count: 1, diets: ["vegan"], note: null },
    ]);
  });

  it("reads counts with no names", () => {
    const { guests } = parseGuestList("3 vegan\n2x GF\ndairy free x2\nVegetarian: 4\nvegan");
    expect(guests).toEqual([
      { name: null, count: 3, diets: ["vegan"], note: null },
      { name: null, count: 2, diets: ["gluten_free"], note: null },
      { name: null, count: 2, diets: ["dairy_free"], note: null },
      { name: null, count: 4, diets: ["vegetarian"], note: null },
      { name: null, count: 1, diets: ["vegan"], note: null },
    ]);
  });

  it("reads a diet followed by a list of names", () => {
    const { guests } = parseGuestList("Vegan: Tom, Sam and Jo");
    expect(guests.map((g) => [g.name, g.diets])).toEqual([
      ["Tom", ["vegan"]],
      ["Sam", ["vegan"]],
      ["Jo", ["vegan"]],
    ]);
  });

  it("skips lines with nothing to keep", () => {
    const { guests, skipped } = parseGuestList("Bernardo\nTom - vegan\n3 people");
    expect(guests).toHaveLength(1);
    expect(skipped).toEqual(["Bernardo", "3 people"]);
  });
});

describe("dietCounts", () => {
  it("adds up people per diet", () => {
    const counts = dietCounts([
      { name: null, count: 3, diets: ["vegan"], note: null },
      { name: "Sam", count: 1, diets: ["vegan", "gluten_free"], note: null },
      { name: "Pete", count: 1, diets: [], note: "no onions" },
    ]);
    expect(counts.map((c) => [c.label, c.count])).toEqual([["Vegan", 4], ["Gluten-free", 1]]);
  });
});

describe("versions", () => {
  const alternatives = [
    { id: 10, recipe_id: 1, label: "Vegan" },
    { id: 11, recipe_id: 1, label: "Gluten free" },
    { id: 12, recipe_id: 2, label: "Vegan" },
  ];

  it("reads diets from tags, falling back to the label", () => {
    const tags = [
      { recipe_id: 1, alternative_id: null, tag: "contains_nuts", value: 0 },
      { recipe_id: 1, alternative_id: 11, tag: "gluten_free", value: 0 }, // a tag beats the label
      { recipe_id: 1, alternative_id: 11, tag: "dairy_free", value: 1 },
    ];
    const v = versionDiets(1, alternatives, tags);
    expect(v.map((x) => [x.alternative_id, [...x.diets].sort()])).toEqual([
      [null, ["nut_free"]],
      [10, ["dairy_free", "vegan", "vegetarian"]],
      [11, ["dairy_free"]],
    ]);
  });

  it("gives each guest the main version when it suits, else the closest alternative", () => {
    const versions = [
      { alternative_id: null, diets: new Set(["vegetarian"] as const) },
      { alternative_id: 10, diets: new Set(["vegan", "vegetarian", "dairy_free", "gluten_free"] as const) },
      { alternative_id: 11, diets: new Set(["gluten_free"] as const) },
    ];
    const result = assignVersions(
      [
        { name: null, count: 2, diets: ["vegetarian"], note: null },
        { name: null, count: 3, diets: ["vegan"], note: null },
        { name: "Jo", count: 1, diets: ["gluten_free"], note: null },
        { name: "Sam", count: 1, diets: ["gluten_free", "dairy_free"], note: null },
        { name: "Luis", count: 1, diets: ["nut_free"], note: null },
        { name: "Pete", count: 1, diets: [], note: "no onions" },
      ],
      versions as any,
    );
    expect([...result.servings]).toEqual([[10, 4], [11, 1]]);
    expect(result.unmatched.map((g) => g.name)).toEqual(["Luis"]);
  });

  it("only fills dishes that follow the list", () => {
    const guests = [{ name: null, count: 2, diets: ["vegan" as const], note: null }];
    const dishes = [
      { id: 1, recipe_id: 1, versions_from_guests: 1 },
      { id: 2, recipe_id: 2, versions_from_guests: 0 },
      { id: 3, recipe_id: 3, versions_from_guests: 1 },
    ];
    const { rows, unmatched } = guestAlternatives(guests, dishes, alternatives, []);
    expect(rows).toEqual([{ meal_dish_id: 1, alternative_id: 10, servings: 2 }]);
    expect([...unmatched.keys()]).toEqual([3]);
  });
});
