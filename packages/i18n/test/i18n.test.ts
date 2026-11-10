import { describe, expect, it } from "vitest";
import { createTranslator, english, italian, formatLocale, money, resolveLanguage, translate } from "../src/index.js";

describe("English and Italian localization", () => {
  it("normalizes supported regional tags and applies explicit fallbacks", () => {
    expect(resolveLanguage(" IT_it ")).toBe("it");
    expect(resolveLanguage("en-US")).toBe("en");
    expect(resolveLanguage("fr-FR")).toBe("en");
    expect(resolveLanguage(undefined, "it")).toBe("it");
    expect(formatLocale("it")).toBe("it-IT");
  });
  it("keeps every catalog entry nonempty and its interpolation values intact", () => {
    const placeholders = (text: string) => [...text.matchAll(/{{\s*([^}]+)\s*}}/g)].map((match) => match[1]!.trim()).sort();
    expect(Object.keys(english).sort()).toEqual(Object.keys(italian).sort());
    for (const [source, translation] of Object.entries(italian)) {
      expect(translation.trim(), source).not.toBe("");
      expect(placeholders(translation), source).toEqual(placeholders(source));
    }
  });
  it("switches language, interpolates names, and handles singular, plural and zero counts", async () => {
    const instance = createTranslator("en");
    expect(instance.t("{{count}} child", { count: 2 })).toBe("2 children");
    await instance.changeLanguage("it");
    expect(instance.t("Settings")).toBe("Impostazioni");
    expect(instance.t("{{count}} night", { count: 1 })).toBe("1 notte");
    expect(instance.t("{{count}} night", { count: 2 })).toBe("2 notti");
    expect(instance.t("{{count}} child", { count: 0 })).toBe("0 bambini");
    expect(instance.t("Open client {{v0}}", { v0: "Anna" })).toBe("Apri il cliente Anna");
    await instance.changeLanguage("en");
    expect(instance.t("Settings")).toBe("Settings");
  });
  it("keeps concurrent server renders independent and safely preserves unknown content", async () => {
    const rendered = await Promise.all(Array.from({ length: 20 }, (_, index) => Promise.resolve(translate(index % 2 ? "it" : "en", "New request"))));
    expect(rendered.filter((text) => text === "Nuova richiesta")).toHaveLength(10);
    expect(translate("it", "Hotel Aurora")).toBe("Hotel Aurora");
    expect(money(123456, "EUR", "it")).toBe(new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(1234.56));
  });
});
