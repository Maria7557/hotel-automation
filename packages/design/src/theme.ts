import { colors, controls, motion, radii, spacing, typography } from "./tokens";

export const theme = {
  colors: {
    background: colors.neutral[50],
    surface: colors.neutral[0],
    surfaceMuted: colors.neutral[100],
    text: colors.neutral[950],
    textSecondary: colors.neutral[700],
    textMuted: colors.neutral[500],
    border: colors.neutral[200],
    borderStrong: colors.neutral[300],
    action: colors.brand.primary,
    actionPressed: colors.brand.primaryPressed,
    actionTint: colors.brand.primaryTint,
    onAction: colors.neutral[0],
    success: colors.status.success,
    successTint: colors.status.successTint,
    info: colors.status.info,
    infoTint: colors.status.infoTint,
    warning: colors.status.warning,
    warningTint: colors.status.warningTint,
    danger: colors.status.danger,
    dangerTint: colors.status.dangerTint,
  },
  spacing,
  radii,
  typography,
  controls,
  motion,
} as const;

export type HotelTheme = typeof theme;
