import type { OfferSnapshot } from "./types.js";

type SupportedLanguage = "it" | "en";

export type Copy = ReturnType<typeof copyFor>;

export function languageFor(locale?: string): SupportedLanguage {
  return locale?.toLowerCase().startsWith("it") ? "it" : "en";
}

export function localeFor(locale?: string): string {
  return languageFor(locale) === "en" ? "en-GB" : "it-IT";
}

export function copyFor(locale?: string) {
  if (languageFor(locale) === "en") {
    return {
      greeting: (name: string) => `Hello ${name},`,
      emailIntro: "we have prepared your personalised stay proposal.",
      emailCta: "View your proposal",
      emailOutro: "We look forward to welcoming you.",
      whatsappIntro: "your personalised stay proposal is ready.",
      pageEyebrow: "Your stay proposal",
      testMode: "Test offer · No real booking will be created.",
      stay: "Stay",
      lengthOfStay: "Length of stay",
      nights: (count: number) => `${count} ${count === 1 ? "night" : "nights"}`,
      guests: "Guests",
      adults: (count: number) => `${count} ${count === 1 ? "adult" : "adults"}`,
      children: (count: number) => `${count} ${count === 1 ? "child" : "children"}`,
      perStay: "Total stay",
      roomOnly: "Room only",
      breakfast: "Breakfast included",
      upToGuests: (count: number) => `Up to ${count} ${count === 1 ? "guest" : "guests"}`,
      amenities: "Room amenities",
      photos: (count: number) => `${count} ${count === 1 ? "photo" : "photos"}`,
      openPhoto: (index: number, count: number) => `Open photo ${index} of ${count}`,
      closePhoto: "Close photo",
      previousPhoto: "Previous photo",
      nextPhoto: "Next photo",
      accept: "Accept proposal",
      select: "Select this option",
      active: "This proposal is available.",
      expired: "This proposal has expired. Contact the hotel for an updated offer.",
      accepted: "Proposal accepted. The hotel will now verify availability.",
      revoked: "This proposal is no longer available.",
      noOptions: "No options are available.",
      title: (hotel: string) => `Stay proposal — ${hotel}`,
    };
  }

  return {
    greeting: (name: string) => `Gentile ${name},`,
    emailIntro: "abbiamo preparato la sua proposta di soggiorno personalizzata.",
    emailCta: "Vedi la proposta",
    emailOutro: "Saremo lieti di accoglierla.",
    whatsappIntro: "la sua proposta di soggiorno personalizzata è pronta.",
    pageEyebrow: "La sua proposta di soggiorno",
    testMode: "Offerta di prova · Non verrà creata alcuna prenotazione reale.",
    stay: "Soggiorno",
    lengthOfStay: "Durata del soggiorno",
    nights: (count: number) => `${count} ${count === 1 ? "notte" : "notti"}`,
    guests: "Ospiti",
    adults: (count: number) => `${count} ${count === 1 ? "adulto" : "adulti"}`,
    children: (count: number) => `${count} ${count === 1 ? "bambino" : "bambini"}`,
    perStay: "Totale soggiorno",
    roomOnly: "Solo camera",
    breakfast: "Colazione inclusa",
    upToGuests: (count: number) => `Fino a ${count} ${count === 1 ? "ospite" : "ospiti"}`,
    amenities: "Servizi in camera",
    photos: (count: number) => `${count} ${count === 1 ? "foto" : "foto"}`,
    openPhoto: (index: number, count: number) => `Apri la foto ${index} di ${count}`,
    closePhoto: "Chiudi la foto",
    previousPhoto: "Foto precedente",
    nextPhoto: "Foto successiva",
    accept: "Accetta la proposta",
    select: "Seleziona questa opzione",
    active: "Questa proposta è disponibile.",
    expired: "Questa proposta è scaduta. Contatti l’hotel per riceverne una aggiornata.",
    accepted: "Proposta accettata. L’hotel verificherà ora la disponibilità.",
    revoked: "Questa proposta non è più disponibile.",
    noOptions: "Nessuna opzione disponibile.",
    title: (hotel: string) => `Proposta di soggiorno — ${hotel}`,
  };
}

export function formatMoney(cents: number, locale?: string): string {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error("Price must be non-negative integer cents");
  return new Intl.NumberFormat(localeFor(locale), {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);
}

export function formatDate(date: string, locale?: string): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(value.getTime()) || value.toISOString().slice(0, 10) !== date) {
    throw new Error(`Invalid calendar date: ${date}`);
  }
  return new Intl.DateTimeFormat(localeFor(locale), {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(value);
}

export function formatStay(snapshot: OfferSnapshot, locale?: string): string {
  return `${formatDate(snapshot.guestSnapshot.checkIn, locale)} – ${formatDate(snapshot.guestSnapshot.checkOut, locale)}`;
}

export function formatGuests(snapshot: OfferSnapshot, locale?: string): string {
  const copy = copyFor(locale);
  const children = snapshot.guestSnapshot.occupancy.childAges.length;
  return [
    copy.adults(snapshot.guestSnapshot.occupancy.adults),
    children > 0 ? copy.children(children) : null,
  ]
    .filter((value): value is string => value !== null)
    .join(", ");
}
