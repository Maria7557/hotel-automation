/** Only constant templates leave this registry. Provider session names, query
 * strings, hostnames and authorization headers never become telemetry labels. */
export function describeProvider(provider: string, input: string | URL, method: string) {
  let path = "";
  try { path = new URL(input).pathname; } catch { /* Preserve transport semantics. */ }
  const rules: Record<string, Array<[RegExp, string, string]>> = {
    google: [
      [/^\/token$/, "oauth.token", "/token"],
      [/^\/gmail\/v1\/users\/me\/messages\/send$/, "mail.send", "/gmail/v1/users/me/messages/send"],
    ],
    microsoft: [
      [/^\/common\/oauth2\/v2\.0\/token$/, "oauth.token", "/common/oauth2/v2.0/token"],
      [/^\/v1\.0\/me\/sendMail$/, "mail.send", "/v1.0/me/sendMail"],
    ],
    expo: [[/^\/--\/api\/v2\/push\/send$/, "push.send", "/--/api/v2/push/send"]],
    waha: [
      [/^\/api\/sendText$/, "message.send", "/api/sendText"],
      [/^\/api\/contacts\/check-exists$/, "contact.check", "/api/contacts/check-exists"],
      [/^\/api\/sessions$/, method === "POST" ? "session.create" : "session.list", "/api/sessions"],
      ...["start", "restart", "stop", "logout"].map((action): [RegExp, string, string] => [new RegExp(`^/api/sessions/[^/]+/${action}$`), `session.${action}`, `/api/sessions/:session/${action}`]),
      [/^\/api\/sessions\/[^/]+$/, "session.status", "/api/sessions/:session"],
      [/^\/api\/[^/]+\/auth\/qr$/, "session.qr", "/api/:session/auth/qr"],
    ],
  };
  const match = rules[provider]?.find(([pattern]) => pattern.test(path));
  return { requestName: `provider.${provider}${match ? `.${match[1]}` : ""}`, route: match?.[2] ?? "" };
}
