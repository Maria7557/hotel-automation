export type WidgetPreviewProps = {
  device: "desktop" | "mobile";
  apiOrigin: string | null;
  publicKey: string;
  css: string;
  language: "en" | "it";
  demo: boolean;
};

function attribute(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

export function widgetPreviewDocument(apiOrigin: string, publicKey: string, language: "en" | "it"): string {
  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body{margin:0;padding:0;background:transparent}</style></head><body><script src="${attribute(apiOrigin)}/embed.js" data-public-key="${attribute(publicKey)}" data-lang="${language}" data-preview="true" data-preview-css="" onerror="window.parent.postMessage({type:'ospio:preview-error'}, '*')"></script></body></html>`;
}
