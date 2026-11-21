import { afterEach, describe, expect, it, vi } from "vitest";
import { createMonitor } from "@hotel/monitoring";
import { createActionRunner } from "@hotel/monitoring/actions";
import type { ActionScope } from "@hotel/monitoring/actions";
// Keep browser DOM declarations out of the Node server typecheck.
const browserModulePath = new URL("../../../packages/monitoring/src/browser.ts", import.meta.url).pathname;
const { createDOMActions } = await import(browserModulePath);

vi.mock("react-native", () => ({ Platform: { OS: "web" } }));
vi.mock("expo-secure-store", () => ({}));
const monitors: ReturnType<typeof createMonitor>[] = [];
afterEach(async () => {
  await Promise.all(monitors.splice(0).map((monitor) => monitor.stop()));
  vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules();
});
function fixture() {
  const uploads: any[] = [];
  const monitor = createMonitor({ endpoint: "https://collector.example/api/ingest", token: "synthetic", platform: "web", persistSession: false,
    fetch: async (_url, init) => { uploads.push(JSON.parse(String(init?.body))); return Response.json({}); } });
  monitors.push(monitor);
  return { monitor, uploads, events: () => uploads.flatMap((upload) => upload.events) };
}

describe("complete action workflows", () => {
  it("shares the bootstrap singleton only when endpoint and environment match", async () => {
    const f = fixture(); await f.monitor.ready;
    vi.doUnmock("../../mobile/src/monitoring");
    vi.doMock("expo-constants", () => ({ default: { expoConfig: { version: "0.1.0" } } }));
    vi.doMock("expo-device", () => ({}));
    vi.doMock("expo-localization", () => ({}));
    vi.stubEnv("EXPO_PUBLIC_SIGNAL_ENDPOINT", "https://collector.example/api/ingest");
    vi.stubEnv("EXPO_PUBLIC_SIGNAL_ENVIRONMENT", "production");
    vi.stubEnv("EXPO_PUBLIC_SIGNAL_WRITE_KEY_PRODUCTION", "synthetic-production-key");
    vi.stubGlobal("__ospioSignalMonitor", f.monitor);
    vi.stubGlobal("__ospioSignalConfiguration", { endpoint: "https://collector.example/api/ingest", environment: "development" });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const modulePath = new URL("../../mobile/src/monitoring/index.ts", import.meta.url).pathname;
    vi.resetModules();
    expect((await import(modulePath)).monitor).toBeNull();
    vi.stubGlobal("__ospioSignalConfiguration", { endpoint: "https://collector.example/api/ingest", environment: "production" });
    vi.resetModules();
    expect((await import(modulePath)).monitor).toBe(f.monitor);
    warning.mockRestore();
  });
  it("preserves synchronous results, original promise identity and original errors, even with broken telemetry", async () => {
    const { monitor } = fixture(); await monitor.ready;
    const actions = createActionRunner(monitor);
    expect(actions.run("test.result", "test.run", () => 42)).toBe(42);
    const promise = Promise.resolve({ ok: true });
    expect(actions.run("test.promise", "test.run", () => promise)).toBe(promise);
    const original = new Error("PRIVATE_ERROR");
    expect(() => actions.run("test.throw", "test.run", () => { throw original; })).toThrow(original);
    const broken = createActionRunner({ getContext() { throw new Error("offline"); }, getRequestHeaders() { throw new Error("offline"); }, action() { throw new Error("offline"); }, error() { throw new Error("offline"); } } as unknown as typeof monitor);
    expect(broken.run("test.broken", "test.run", () => 24)).toBe(24);
    await expect(broken.run("test.reject", "test.run", () => Promise.reject(original))).rejects.toBe(original);
  });

  it("waits for an async child when a UI callback intentionally returns void", async () => {
    const f = fixture(); await f.monitor.ready;
    const actions = createActionRunner(f.monitor);
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const child = actions.handler("test.child", "test.child", async () => { await waiting; });
    actions.run("test.press", "test.press", () => { void child(); }, "manual");
    await f.monitor.flush();
    expect(f.events().some((event) => event.name === "test.press.completed")).toBe(false);
    release(); await waiting; await Promise.resolve(); await Promise.resolve();
    await f.monitor.flush();
    expect(f.events().filter((event) => event.name === "test.press.completed")).toHaveLength(1);
    expect(new Set(f.events().map((event) => event.actionId)).size).toBe(1);
  });

  it("keeps every request of overlapping async UI workflows on its original action and trace", async () => {
    const f = fixture(); await f.monitor.ready;
    vi.resetModules(); vi.doMock("../../mobile/src/monitoring", () => ({ monitor: f.monitor }));
    vi.stubEnv("EXPO_PUBLIC_API_URL", "https://api.example");
    const calls: Array<{ path: string; headers: Headers; body: unknown }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
      const path = new URL(input).pathname;
      calls.push({ path, headers: new Headers(init?.headers), body: init?.body });
      await new Promise((resolve) => setTimeout(resolve, path.includes("images") ? 5 : 1));
      if (path.endsWith("/session")) return Response.json({ data: { user: { id: "synthetic_operator" } } });
      if (path.endsWith("/images")) return Response.json({ data: { url: "https://api.example/synthetic.png" } });
      if (path.endsWith("/requests")) return Response.json({ data: { requests: [{ id: "PRIVATE_INQUIRY" }], nextCursor: null } });
      if (path.endsWith("/summaries")) return Response.json({ data: { inquiries: [] } });
      return Response.json({ data: { hotel: { name: "Synthetic", city: "Roma" } } });
    }));
    const apiModulePath = new URL("../../mobile/src/api/client.ts", import.meta.url).pathname;
    const actionModulePath = new URL("../../mobile/src/monitoring/actions.ts", import.meta.url).pathname;
    const { apiClient, scopedApiClient } = await import(apiModulePath);
    const { actions } = await import(actionModulePath);
    await apiClient.getSession(); calls.length = 0;
    const save = actions.handler("hotel.save", "HotelForm.save", async (scope: ActionScope, index: number) => {
      const api = scopedApiClient(scope);
      await api.uploadImage({ base64: `PRIVATE_IMAGE_${index}`, mimeType: "image/png" });
      await Promise.resolve();
      await api.updateHotel({ name: `PRIVATE_HOTEL_${index}`, city: "Roma", countryCode: "IT", locale: "it", email: "private@example.test", phone: "", description: "", website: "", logoUrl: "", photoUrls: [], termsText: "" });
      return index;
    });
    expect(await Promise.all([save(1), save(2)])).toEqual([1, 2]);
    const scopes = new Map<string, typeof calls>();
    for (const call of calls) { const id = call.headers.get("X-Signal-Action-Id")!; scopes.set(id, [...scopes.get(id) ?? [], call]); }
    expect(scopes.size).toBe(2);
    for (const group of scopes.values()) {
      expect(group.map((call) => call.path).sort()).toEqual(["/v1/hotel", "/v1/media/images"]);
      expect(new Set(group.map((call) => call.headers.get("X-Signal-Trace-Id"))).size).toBe(1);
      expect(new Set(group.map((call) => call.headers.get("X-Signal-Request-Id"))).size).toBe(2);
    }
    calls.length = 0;
    await apiClient.getClientHistory("PRIVATE_CLIENT");
    expect(calls).toHaveLength(2);
    expect(new Set(calls.map((call) => call.headers.get("X-Signal-Action-Id"))).size).toBe(1);
    await f.monitor.flush();
    for (const secret of ["PRIVATE_IMAGE", "PRIVATE_HOTEL", "private@example.test", "PRIVATE_CLIENT", "PRIVATE_INQUIRY"]) expect(JSON.stringify(f.uploads)).not.toContain(secret);
    expect(f.events().filter((event) => event.name === "hotel.save.completed")).toHaveLength(2);
  });

  it("records selection, date, checkbox, committed edit, gallery and validation actions without reading private values", async () => {
    const f = fixture(); await f.monitor.ready;
    const root = new EventTarget(); const signal = createDOMActions(f.monitor);
    signal.bind(root, "Widget");
    const emit = (type: string, target: object) => { const event = new Event(type, { cancelable: true }); Object.defineProperty(event, "target", { value: target }); root.dispatchEvent(event); expect(event.defaultPrevented).toBe(false); };
    for (const [tagName, type] of [["SELECT", "select-one"], ["INPUT", "date"], ["INPUT", "checkbox"], ["TEXTAREA", "textarea"]]) {
      emit("change", { tagName, type, get value() { throw new Error("Private value must never be read"); } });
    }
    emit("click", { closest: (selector: string) => selector === ".add-room" ? {} : null, get textContent() { throw new Error("Private text must never be read"); } });
    emit("invalid", {});
    await f.monitor.flush();
    for (const name of ["public.selection.change", "public.date.change", "public.checkbox.change", "public.field.commit", "inquiry.room.add", "public.form.validation_rejected"]) expect(f.events().some((event) => event.name === `${name}.started`)).toBe(true);
  });

  it("adds only opaque correlation carriers to normal offer POSTs and leaves submission behavior intact", async () => {
    const f = fixture(); await f.monitor.ready;
    const root = new EventTarget(); const inputs: Array<{ type: string; name: string; value: string }> = [];
    const form = { tagName: "FORM", querySelector: (selector: string) => inputs.find((input) => selector.includes(`"${input.name}"`)),
      ownerDocument: { createElement: () => ({ type: "", name: "", value: "" }) }, appendChild: (input: typeof inputs[number]) => inputs.push(input) };
    const signal = createDOMActions(f.monitor); signal.bind(root, "Offer");
    const event = new Event("submit", { cancelable: true }); Object.defineProperty(event, "target", { value: form }); root.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false); expect(inputs).toHaveLength(7);
    expect(inputs.every((input) => input.type === "hidden" && input.name.startsWith("_signal"))).toBe(true);
    expect(inputs.find((input) => input.name === "_signalActionId")?.value).toMatch(/^[a-f0-9-]{36}$/);
    signal.finish(form); await f.monitor.flush();
    expect(f.events().some((row) => row.name === "public.offer.accept.completed")).toBe(true);
  });
});
