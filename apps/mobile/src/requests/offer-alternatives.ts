type Choice = { roomId: string; planCode: string; mealPlan: string; checkIn: string; checkOut: string };
type Plan = Pick<Choice, "roomId" | "planCode"> & { mealPlan: "BB" | "HB" | "FB" };

export function offerChoiceKey(choice: Choice): string {
  return JSON.stringify([choice.roomId, choice.planCode, choice.mealPlan, choice.checkIn, choice.checkOut]);
}

export function hasDuplicateOfferChoices(choices: Choice[]): boolean {
  const complete = choices.filter(({ roomId, planCode, mealPlan }) => roomId && planCode && mealPlan);
  return new Set(complete.map(offerChoiceKey)).size !== complete.length;
}

export function nextOfferAlternative(
  data: { suggestions: Plan[]; plans: Plan[] },
  existing: Choice[],
  stay: Pick<Choice, "checkIn" | "checkOut">,
): Plan | undefined {
  const used = new Set(existing.map(offerChoiceKey));
  return [...data.suggestions, ...data.plans].find((plan) => !used.has(offerChoiceKey({ ...plan, ...stay })));
}
