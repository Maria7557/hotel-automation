# Owner questions from mobile UI feedback

These items change business rules or the offer workflow. Resolved items are marked below.

1. **What age still counts as a child?**
   The rate editor currently lets each rate define `Child age up to` (maximum 17). Confirm whether this is hotel-specific, globally fixed, or should use age bands.

2. **Should “Create & send offer” require a confirmation preview?**
   A new manual request can immediately start automatic offer preparation and delivery. A real pre-send preview would require the server to quote an unsaved request and define what happens when no valid rate is available. Confirm whether the desired flow is preview → confirm → create/send, or create draft → review → send.

3. **Is the rate “sample price” calculator part of the product?**
   Its presentation is now clearer, but keeping or removing the tool is a product decision. Confirm who uses it and whether it should calculate from existing rate periods only.

4. **Can an offer have no cancellation policy?**
   The field is currently optional and can be empty. Confirm whether the hotel default must be required, whether an explicit “non-refundable” choice is needed, and whether free text is acceptable.

5. **Resolved: manual email/WhatsApp sending**
   After opening the filled draft, the app asks `Sent?` with `Yes` / `Not yet`. Only `Yes` records the channel, user, language and time, marks the request as waiting for the guest, and cancels a still-scheduled automatic delivery through the same channel. Opening or abandoning the draft does not change status.

6. **When should automatic sending become “Not delivered”?**
   The current rule moves a request from `New` to `Not delivered` when automatic sending has not completed within 15 minutes. Confirm the timeout, whether queued requests should remain in `New`, and whether email and WhatsApp failures should be counted separately.

7. **Should WhatsApp support linking by phone-number code as well as QR?**
   The current WAHA integration supports a QR-code session flow. Adding link-by-code depends on the deployed WAHA version/configuration and changes the connection workflow, so it needs an owner/infrastructure decision.

8. **Google verification/privacy page**
   The supplied privacy URL is `https://ospio.online/privacy.html`. Confirm that this is the final production URL and that its published content, domain ownership and OAuth consent-screen data are ready for Google verification.
