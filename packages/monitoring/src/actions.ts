import { createMonitoringId, type createMonitor, type EventOptions } from "./sdk/index";
import { failureCode, isRejection, monitoringError, observe } from "./index";

export type ActionScope = {
  correlation: EventOptions;
  fail(error: unknown): void;
};
type Monitor = ReturnType<typeof createMonitor>;

/** An explicit authentication/tenant transition may rebind subsequent work in
 * this workflow. Already emitted snapshots and outstanding requests stay fixed. */
export function refreshActionContext(monitor: Monitor | null, scope?: ActionScope, allowSessionChange = false) {
  if (!monitor || !scope) return;
  observe(() => {
    if (!allowSessionChange && scope.correlation.sessionId && scope.correlation.sessionId !== monitor.getContext().sessionId) return;
    const { actionId, traceId, placement } = scope.correlation;
    scope.correlation = monitor.captureContext({ ...(actionId ? { actionId } : {}), ...(traceId ? { traceId } : {}), ...(placement ? { placement } : {}) });
  });
}

/** The stack exists only during synchronous invocation. Async work carries its
 * scope explicitly; overlapping promises never share mutable global context. */
export function createActionRunner(monitor: Monitor | null) {
  type RunningScope = ActionScope & { childStarted(): void; childFinished(): void };
  let invoking: RunningScope | undefined;
  function run<T>(name: string, placement: string, work: (scope: ActionScope) => T, trigger?: "manual" | "automatic"): T {
    const previous = invoking;
    let failed = false;
    let workFinished = false; let children = 0; let settled = false;
    previous?.childStarted();
    let correlation: EventOptions = previous?.correlation ?? {
      actionId: createMonitoringId(), traceId: createMonitoringId(), placement,
    };
    // Freeze identity, navigation and snapshot references for the entire async
    // workflow, including callbacks that finish after logout or account changes.
    observe(() => { correlation = monitor?.captureContext(correlation) ?? correlation; });
    const lifecycle = { ...correlation, placement };
    const started = Date.now();
    const complete = () => {
      if (!workFinished || children || settled) return;
      settled = true;
      if (!failed) observe(() => monitor?.action(`${name}.completed`, { ...lifecycle, trigger: "automatic", attributes: { durationMs: Date.now() - started } }));
      previous?.childFinished();
    };
    const scope: RunningScope = { correlation,
      childStarted() { children++; },
      childFinished() { children--; complete(); },
      fail: (error) => {
      if (failed) return;
      failed = true;
      observe(() => {
        const details = { ...lifecycle, attributes: { failureCode: failureCode(error), failedStep: placement, durationMs: Date.now() - started } };
        if (isRejection(error)) monitor?.warn(`${name}.rejected`, details);
        else monitor?.error(`${name}.failed`, monitoringError(error), details);
      });
      previous?.fail(error);
    } };
    const finish = () => { workFinished = true; complete(); };
    observe(() => monitor?.action(`${name}.started`, { ...lifecycle, trigger: trigger ?? (previous ? "manual" : "automatic") }));
    invoking = scope;
    try {
      const result = work(scope);
      // Observe settlement without replacing the value/promise returned to the app.
      if (monitor && result && typeof (result as unknown as PromiseLike<unknown>).then === "function") {
        void Promise.resolve(result).then(finish, (error) => { scope.fail(error); finish(); });
      } else finish();
      return result;
    } catch (error) { scope.fail(error); finish(); throw error; }
    finally { invoking = previous; }
  }
  return {
    run,
    handler<A extends unknown[], T>(name: string, placement: string, work: (scope: ActionScope, ...args: A) => T) {
      return (...args: A): T => run(name, placement, (scope) => work(scope, ...args));
    },
  };
}
