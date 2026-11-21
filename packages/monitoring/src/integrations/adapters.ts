import { createMonitor, createMonitoringId, type MonitorOptions, type Context, type EventOptions, type HttpDetails } from '../sdk';

export type ApiRequest = {
  method?: string; id?: string; headers?: Record<string, unknown>;
  routeOptions?: { url?: string | undefined; config?: { signal?: { requestName?: string; placement?: string } } };
};
export type ApiOptions = MonitorOptions & {
  /** Return only approved identity/device fields from your authenticated request, never a request body. */
  getContext?: (request: ApiRequest) => Context;
  /** Route names and placement are developer-defined constants. */
  resourceName?: (request: ApiRequest) => string;
  captureRequests?: boolean; captureResponses?: boolean;
  /** Use preHandler when authentication runs in onRequest/preValidation. Responses always re-read identity. */
  requestHook?: 'onRequest' | 'preHandler';
};
/** Fastify hooks, covering requests, responses and failures with safe route templates. */
export function attachApiMonitor(app: { addHook(name: any, hook: any): unknown }, options: ApiOptions) {
  const monitor = createMonitor({ ...options, platform: 'server' });
  const requests = new WeakMap<object, { sessionId: string; requestId: string; traceId: string; started: number }>();
  const opaque = (value: unknown) => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value) ? value : undefined;
  const header = (request: ApiRequest, name: string) => opaque(request.headers?.[name]);
  const details = (request: ApiRequest): EventOptions & { http: HttpDetails } => {
    let local = requests.get(request);
    if (!local) { const makeId=options.idFactory || createMonitoringId;local = { sessionId: makeId(), requestId: makeId(), traceId: makeId(), started: Date.now() }; requests.set(request, local); }
    const route = request.routeOptions?.url || '';
    let user: Context = {}; let resource = ''; let identityOverride = false;
    try { user = options.getContext?.(request) || {}; identityOverride = !!options.getContext; }
    catch { /* Instrumentation must not break a host request. */ }
    try { resource = options.resourceName?.(request) || ''; } catch { /* Optional naming hook. */ }
    const requestName = request.routeOptions?.config?.signal?.requestName || resource || route.replace(/:([\w]+)/g,'by_$1').replace(/[^\w]+/g,'.').replace(/^\.|\.$/g,'') || 'unmatched';
    const clientSessionId = header(request,'x-signal-session-id');
    const sessionId = clientSessionId || local.sessionId;
    const contextId = header(request,'x-signal-context-id');
    const viewId = header(request,'x-signal-view-id');
    let origin = ''; try { const value=request.headers?.origin; if(typeof value==='string') origin=new URL(value).origin; } catch { /* Optional origin. */ }
    const caller=request.headers?.['x-signal-placement'];
    return { ...user, sessionId, anonymousId: user.anonymousId || '', sessionKind:clientSessionId ? 'user' : 'request',
      ...(identityOverride ? {identityOverride:true,authState:user.userId ? 'authenticated' : user.authState || 'unknown'} : {}),
      requestId: header(request,'x-signal-request-id') || local.requestId,
      traceId: (()=>{const trace=request.headers?.['x-signal-trace-id'];if(typeof trace==='string' && /^[0-9a-f]{32}$/i.test(trace) && !/^0+$/.test(trace))return trace;const parent=request.headers?.traceparent;const match=typeof parent==='string' ? parent.match(/^00-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/i) : null;return header(request,'x-signal-trace-id') || (match && !/^0+$/.test(match[1]!) ? match[1]! : local!.traceId);})(),
      ...(contextId ? { contextId } : {}), ...(viewId ? { viewId } : {}),
      ...(header(request,'x-signal-action-id') ? { actionId:header(request,'x-signal-action-id')! } : {}),
      placement: request.routeOptions?.config?.signal?.placement || `api.${request.method || 'GET'}.${requestName}`.slice(0,200),
      http: { method:(request.method || 'GET').toUpperCase() as HttpDetails['method'], requestName, route, url: route, origin, direction:'incoming',
        caller: typeof caller==='string' && /^[a-zA-Z][a-zA-Z0-9._:/-]{0,199}$/.test(caller) ? caller : '' } };
  };
  if(options.requestHook==='preHandler')app.addHook('onRequest',async(request:ApiRequest)=>{try{details(request);}catch{/* Optional instrumentation. */}});
  app.addHook(options.requestHook || 'onRequest', async (request: ApiRequest) => {
    try { const { http,...context }=details(request); if(options.captureRequests!==false) monitor.http('request',http,context); }
    catch { /* Keep API outcomes independent from monitoring. */ }
  });
  app.addHook('onError', async (request:ApiRequest,_reply:unknown,error:Error) => {
    try { const { http,...context }=details(request); monitor.error(`api.error.${http.method}_${http.requestName}`, options.strictPrivacy ? new Error('') : error,{ ...context,http }); }
    catch { /* Keep the application's original error handler. */ }
  });
  app.addHook('onResponse', async (request:ApiRequest,reply:{statusCode:number;elapsedTime?:number}) => {
    try { if(options.captureResponses===false)return; const { http,...context }=details(request); const local=requests.get(request)!;
      monitor.http('response',{ ...http,statusCode:reply.statusCode,durationMs:Math.max(0,reply.elapsedTime ?? Date.now()-local.started) },context); }
    catch { /* Never wait for an upload in the host request. */ }
  });
  app.addHook('onClose',async()=>{await monitor.stop();});
  return Object.assign(monitor,{ requestContext:(request:ApiRequest)=>details(request) });
}
