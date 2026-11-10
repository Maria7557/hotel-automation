import { manualRequestSourceSchema, type ManualRequestSource } from "@hotel/contracts";

export const requestSourceLabels: Record<ManualRequestSource, string> = {
  phone: "Phone call",
  walk_in: "Walk-in",
  website: "Website form",
  email: "Email",
  whatsapp: "WhatsApp",
  other: "Other",
};

export const requestSourceOptions = manualRequestSourceSchema.options.map((value) => ({ value, label: requestSourceLabels[value] }));
