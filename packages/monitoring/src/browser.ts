import { createMonitor, createMonitoringId, type MonitorOptions } from "./sdk/index";
import { createActionRunner, type ActionScope } from "./actions";
import { monitoringError, observe } from "./index";
import { traceRequest } from "./request";

type Monitor = ReturnType<typeof createMonitor>;
type Submission = { scope: ActionScope; settle: () => void };
const carriers = {
  "X-Signal-Session-Id": "_signalSessionId", "X-Signal-Context-Id": "_signalContextId", "X-Signal-View-Id": "_signalViewId",
  "X-Signal-Action-Id": "_signalActionId", "X-Signal-Request-Id": "_signalRequestId", "X-Signal-Trace-Id": "_signalTraceId", "X-Signal-Placement": "_signalPlacement",
} as const;

/** Delegates only developer-owned control categories. Never reads form values,
 * labels, URLs, input names, document text or event payloads for telemetry. */
export function createDOMActions(monitor: Monitor | null) {
  const runner = createActionRunner(monitor);
  const submissions = new WeakMap<HTMLFormElement, Submission>();
  const bindings = new WeakMap<EventTarget, () => void>();
  function begin(form: HTMLFormElement, name: string) {
    const previous = submissions.get(form);
    if (previous) return previous.scope;
    let submission!: Submission;
    runner.run(name, "public.form.submit", (scope) => new Promise<void>((settle) => { submission = { scope, settle }; }), "manual");
    submissions.set(form, submission);
    return submission.scope;
  }
  function finish(form: HTMLFormElement, error?: unknown) {
    const submission = submissions.get(form);
    if (!submission) return;
    if (error !== undefined) submission.scope.fail(error);
    submission.settle(); submissions.delete(form);
  }
  function headers(form: HTMLFormElement) {
    let result: Record<string, string> = {};
    observe(() => { result = monitor?.getRequestHeaders(begin(form, "public.inquiry.submit").correlation) ?? {}; });
    return result;
  }
  function bind(root: Document | HTMLElement | ShadowRoot, screen: "Offer" | "Widget" | "FormAdapter" | "DemoOffer" | "Bootstrap" | "Legal" | "OAuthResult", registerView = true) {
    if (bindings.has(root)) return bindings.get(root)!;
    if (registerView) observe(() => monitor?.screen(screen, { pageUrl: `/public/${screen}`, placement: "public.navigation" }));
    const click = (event: Event) => {
      const target = event.target as Element | null;
      if (!target?.closest) return;
      const rules = [
        [".photo-prev", "offer.photo.previous"], [".photo-next", "offer.photo.next"], [".photo-close,.photo-backdrop", "offer.photo.close"],
        [".room-hero,.room-thumb", "offer.photo.open"], ["nav a[lang]", "offer.language.change"], [".booking-link", "offer.website.open"],
        [".privacy-policy", "inquiry.privacy.open"], [".add-room", "inquiry.room.add"], [".remove-room", "inquiry.room.remove"],
        [".add-dates", "inquiry.dates.add"], [".remove-dates", "inquiry.dates.remove"],
        ["#ospio-retry", "app.startup.retry"],
      ];
      const match = rules.find(([selector]) => target.closest(selector!));
      if (match) runner.run(match[1]!, `public.${screen}`, () => {}, "manual");
      else if ((screen === "Bootstrap" ? target.closest("#ospio-legal-footer a") : ["Legal", "OAuthResult"].includes(screen) && target.closest("a"))) runner.run("public.link.open", `public.${screen}`, () => {}, "manual");
    };
    const change = (event: Event) => {
      const target = event.target as HTMLInputElement | null;
      if (!target || !["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName) || target.type === "hidden" || target.type === "password") return;
      const name = target.tagName === "SELECT" || target.type === "radio" ? "public.selection.change" : target.type === "checkbox" ? "public.checkbox.change" : target.type === "date" ? "public.date.change" : "public.field.commit";
      runner.run(name, `public.${screen}`, () => {}, "manual");
    };
    const invalid = () => runner.run("public.form.validation_rejected", `public.${screen}`, () => {}, "manual");
    const reset = () => runner.run("public.form.reset", `public.${screen}`, () => {}, "manual");
    const submit = (event: Event) => {
      const form = event.target as HTMLFormElement;
      if (form.tagName !== "FORM") return;
      const scope = begin(form, screen === "Offer" || screen === "DemoOffer" ? "public.offer.accept" : "public.inquiry.submit");
      if (screen === "Offer") {
        // A normal HTML POST cannot set request headers. Carry only validated
        // correlation UUIDs; authorization still comes exclusively from the app.
        observe(() => {
          const values: Record<string, string> = monitor?.getRequestHeaders({ ...scope.correlation, requestId: createMonitoringId() }) ?? {};
          for (const [header, name] of Object.entries(carriers)) {
            let input = form.querySelector<HTMLInputElement>(`input[name="${name}"]`);
            if (!input) { input = form.ownerDocument.createElement("input"); input.type = "hidden"; input.name = name; form.appendChild(input); }
            input.value = values[header] ?? "";
          }
          monitor?.info("public.offer.accept.dispatched", scope.correlation);
          void monitor?.flush().catch(() => {});
        });
      }
    };
    root.addEventListener("click", click, true); root.addEventListener("change", change, true);
    root.addEventListener("submit", submit, true); root.addEventListener("invalid", invalid, true); root.addEventListener("reset", reset, true);
    const cleanup = () => {
      root.removeEventListener("click", click, true); root.removeEventListener("change", change, true);
      root.removeEventListener("submit", submit, true); root.removeEventListener("invalid", invalid, true); root.removeEventListener("reset", reset, true);
      bindings.delete(root);
    };
    bindings.set(root, cleanup); return cleanup;
  }
  return {
    monitor, bind, begin, finish, headers,
    request(form: HTMLFormElement, input: string, init: RequestInit, route: string) {
      return traceRequest(monitor, route, init.method ?? "GET", location.origin, async (correlation, received) => {
        const response = await fetch(input, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), ...correlation } });
        received(response.status); return response;
      }, begin(form, "public.inquiry.submit"));
    },
  };
}

type Runtime = ReturnType<typeof createDOMActions>;
declare global { interface Window {
  OspioSignal?: Runtime; __ospioSignalMonitor?: Monitor;
  __ospioSignalConfiguration?: { endpoint: string; environment: string };
  __ospioSignalBrowserErrorsInstalled?: boolean;
  __ospioSignalSessionReported?: boolean;
} }

export function install(config: { endpoint: string; token: string; release: string; environment: string } | null) {
  if (!config || typeof window === "undefined") return null;
  try {
    const existing = window.__ospioSignalMonitor;
    const prior = window.__ospioSignalConfiguration;
    if (existing && (prior?.endpoint !== config.endpoint || prior.environment !== config.environment)) return null;
    if (window.OspioSignal) return window.OspioSignal;
    const screen = document.currentScript?.getAttribute("data-signal-screen");
    const monitor = existing ?? createMonitor({ endpoint: config.endpoint, token: config.token, platform: "web", service: screen === "Bootstrap" ? "ospio-web" : "ospio-public-web", serviceVersion: config.release,
      context: { buildVersion: config.release, pageUrl: "/public", authState: screen === "Bootstrap" ? "unknown" : "anonymous" }, strictPrivacy: false, maxRetries: 5, maxQueueAgeMs: 3_600_000,
      onDiagnostic: ({ reason, count }) => console.warn("Signal public monitoring:", reason, count ?? 0),
      fetch: (input, init) => fetch(input, { ...init, keepalive: true }),
    } satisfies MonitorOptions);
    window.__ospioSignalMonitor = monitor;
    window.__ospioSignalConfiguration = { endpoint: config.endpoint, environment: config.environment };
    window.OspioSignal = createDOMActions(monitor);
    const flush = () => { void monitor.flush().catch(() => {}); };
    window.addEventListener("pagehide", flush);
    if (!window.__ospioSignalBrowserErrorsInstalled) {
      window.addEventListener("error", (event) => observe(() => monitor.error("error.javascript.unhandled", monitoringError(event.error), { placement: "public.browser" })));
      window.addEventListener("unhandledrejection", (event) => observe(() => monitor.error("error.promise.unhandled", monitoringError(event.reason), { placement: "public.browser" })));
      window.__ospioSignalBrowserErrorsInstalled = true;
    }
    if (screen === "Offer" || screen === "Legal" || screen === "OAuthResult" || screen === "Bootstrap") window.OspioSignal.bind(document, screen, !(existing && screen === "Bootstrap"));
    if (!existing) {
      observe(() => monitor.session("session.started", { placement: "public.bootstrap" }));
      window.__ospioSignalSessionReported = true;
    }
    return window.OspioSignal;
  } catch { return null; }
}
