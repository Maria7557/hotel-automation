import { z } from 'zod';
export const uiEventNames = ['ui.screen.viewed','ui.render.failed','ui.browser.failed','ui.unhandled.failed'] as const;
export const uiScreenNames = ['Unknown','SignIn','Requests','Clients','Client','Reservation','Settings','Support','Inventory','Profile','Messages','Connections','SiteIntegration','Notifications','InquiryForm','OfferSettings'] as const;
export const uiDiagnosticEventSchema = z.object({ name: z.enum(uiEventNames), screen: z.enum(uiScreenNames) }).strict();
export const uiDiagnosticsSchema = z.object({ events: z.array(uiDiagnosticEventSchema).min(1).max(5) }).strict();
export type UiDiagnosticEvent = z.infer<typeof uiDiagnosticEventSchema>;
export type UiScreenName = typeof uiScreenNames[number];
