export const colors = {
  brand: {
    primary: "#1769FF",
    primaryPressed: "#0B55DA",
    primarySoft: "#3D7BFA",
    primaryTint: "#EDF3FC",
  },
  neutral: {
    0: "#FFFFFF",
    50: "#F8F9FB",
    100: "#F1F1F1",
    200: "#E5E5E5",
    300: "#C7C7C7",
    500: "#6F6F6F",
    700: "#4A4A4A",
    950: "#202020",
  },
  status: {
    success: "#217A55",
    successTint: "#E5F6EE",
    info: "#257DA2",
    infoTint: "#DCEFFA",
    warning: "#8A5A00",
    warningTint: "#FFF1D9",
    danger: "#A45255",
    dangerTint: "#FCE7E8",
  },
} as const;

export const spacing = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
} as const;

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
} as const;

export const typography = {
  // Poppins has no Cyrillic glyphs. The staff UI currently ships in Russian,
  // so it uses the brand-book's approved Inter fallback. Guest-facing Italian
  // offer pages keep Poppins as their primary family.
  h1: { fontSize: 28, lineHeight: 34, fontFamily: "Inter_700Bold" },
  h2: { fontSize: 22, lineHeight: 28, fontFamily: "Inter_700Bold" },
  h3: { fontSize: 20, lineHeight: 24, fontFamily: "Inter_600SemiBold" },
  h4: { fontSize: 18, lineHeight: 24, fontFamily: "Inter_600SemiBold" },
  body: { fontSize: 16, lineHeight: 24, fontFamily: "Inter_400Regular" },
  bodyMedium: { fontSize: 16, lineHeight: 24, fontFamily: "Inter_500Medium" },
  bodySmall: { fontSize: 14, lineHeight: 20, fontFamily: "Inter_400Regular" },
  bodySmallMedium: { fontSize: 14, lineHeight: 20, fontFamily: "Inter_500Medium" },
  button: { fontSize: 14, lineHeight: 20, fontFamily: "Inter_600SemiBold" },
  caption: { fontSize: 12, lineHeight: 16, fontFamily: "Inter_400Regular" },
  captionMedium: { fontSize: 12, lineHeight: 16, fontFamily: "Inter_500Medium" },
} as const;

export const controls = {
  minTarget: 44,
  buttonHeight: 54,
  inputHeight: 54,
  contentInset: 20,
} as const;

export const motion = {
  fast: 140,
  normal: 240,
} as const;
