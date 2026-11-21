import { templateLanguages } from "@hotel/contracts";
import { getLanguage } from "./index";

export function templateLanguageOptions() {
  const names = new Intl.DisplayNames([getLanguage()], { type: "language" });
  return templateLanguages.map((value) => {
    const name = names.of(value) ?? value;
    return { value, label: name.charAt(0).toLocaleUpperCase(getLanguage()) + name.slice(1) };
  });
}
