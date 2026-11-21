import { privateEvent, redactText } from './privacy';
export const SDK_VERSION = '0.3.0';
/** Dependency-free structured telemetry for React Native, web and Node. */
export type Level = 'debug' | 'info' | 'warning' | 'error' | 'critical';
export type EventKind = 'log' | 'action' | 'error' | 'navigation' | 'network' | 'session' | 'crash';
export type Context = {
  userId?: string; userName?: string; companyId?: string; companyName?: string;
  sessionId?: string; sessionNumber?: number; anonymousId?: string; contextId?: string;
  screen?: string; pageUrl?: string; viewId?: string; country?: string;
  deviceType?: string; deviceModel?: string; osName?: string; osVersion?: string;
  appVersion?: string; buildVersion?: string; browser?: string; browserVersion?: string; locale?: string; timezone?: string;
  requestId?: string; actionId?: string; traceId?: string;
  authState?: 'authenticated' | 'anonymous' | 'unknown'; sessionKind?: 'user' | 'request' | 'process';
};
export type HttpDetails = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS' | 'CONNECT' | 'TRACE';
  requestName: string; route?: string; url?: string; origin?: string; direction?: 'incoming' | 'outgoing';
  statusCode?: number; durationMs?: number; caller?: string;
};
export type EventOptions = Context & {
  trigger?: 'manual' | 'automatic'; message?: string; attributes?: Record<string, unknown>;
  placement?: string; service?: string; serviceVersion?: string; source?: 'client' | 'server' | 'worker' | 'sdk'; http?: HttpDetails;
  /** Backend authentication takes precedence over client-reported identity, including an empty result. */
  identityOverride?: boolean;
};
export type NetworkOptions = EventOptions & { url: string; method: string; statusCode?: number; durationMs: number; requestName?: string; route?: string };
export type MonitorEvent = Context & {
  id: string; timestamp: string; name: string; level: Level; kind: EventKind;
  platform: 'ios' | 'android' | 'web' | 'server'; trigger: 'manual' | 'automatic'; sequence: number;
  message: string; attributes: Record<string, unknown>; placement?: string; service?: string; serviceVersion?: string;
  source?: 'client' | 'server' | 'worker' | 'sdk'; http?: HttpDetails;
  sdkVersion?: string; emitterId?: string; privacyMode?: 'strict' | 'structured'; identityOverride?: boolean;
  error?: { name: string; message: string; stack?: string | undefined };
};
export type QueueStorage = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<unknown> };
export type MonitorOptions = {
  endpoint: string; token: string; platform: MonitorEvent['platform']; batchSize?: number; flushIntervalMs?: number;
  maxQueueSize?: number; maxRetries?: number; maxQueueAgeMs?: number; maxEventBytes?: number;
  idFactory?: () => string; fetch?: typeof globalThis.fetch; storage?: QueueStorage; storageKey?: string;
  context?: Context; service?: string; serviceVersion?: string; sessionStorage?: QueueStorage; persistSession?: boolean;
  sessionTimeoutMs?: number; maxSessionMs?: number; propagateTo?: string[];
  onDiagnostic?: (info: { reason: string; count?: number }) => void;
  captureBrowserErrors?: boolean; captureBrowserActions?: boolean; strictPrivacy?: boolean;
};
type Registration = Record<string, any> & { id: string; timestamp: string; sessionId: string };
type Pending = { event: MonitorEvent; attempts: number; queuedAt: number };
const rank: Record<Level, number> = { debug: 0, info: 1, warning: 2, error: 3, critical: 4 };
const contextKeys = ['sessionId','sessionNumber','anonymousId','userId','userName','companyId','companyName','country','deviceType','deviceModel','osName','osVersion','appVersion','buildVersion','browser','browserVersion','locale','timezone','authState','sessionKind'] as const;
function id() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const n = Math.floor(Math.random() * 16); return (c === 'x' ? n : n & 3 | 8).toString(16); });
}
export const createMonitoringId = id;
function sanitize(value: unknown, seen = new WeakSet<object>(), depth = 0): unknown {
  if (depth > 7) return '[depth limit]';
  if (value && typeof value === 'object') {
    if (seen.has(value)) return '[circular]'; seen.add(value);
    if (Array.isArray(value)) return value.slice(0, 100).map(v => sanitize(v, seen, depth + 1));
    return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, v]) => [key, /password|passwd|secret|token|authorization|cookie|credit.?card|api.?key/i.test(key) ? '[REDACTED]' : sanitize(v, seen, depth + 1)]));
  }
  if (typeof value === 'string') return redactText(value.slice(0, 16000));
  return ['bigint','symbol','function'].includes(typeof value) ? String(value) : value;
}
const byteLength = (s: string) => typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(s).length : encodeURIComponent(s).replace(/%[A-F\d]{2}/g, 'x').length;
export function safeUrl(value: string) {
  try { const url = new URL(value); return ['http:','https:'].includes(url.protocol) ? `${url.origin}${url.pathname}` : ''; }
  catch { return value.startsWith('/') ? (value.split(/[?#]/)[0] || '') : ''; }
}
function requestUrl(value:string,route?:string) {
  if(!route)return safeUrl(value);
  try { return `${new URL(value).origin}${safeUrl(route)}`; }catch{return safeUrl(route);}
}
const symbolic = (value: string) => value.replace(/[^a-zA-Z0-9._:-]/g, '_').slice(0, 100) || 'unmatched';
export function httpEventName(phase: 'request' | 'response' | 'error', method: string, requestName: string) {
  return `api.${phase}.${method.toUpperCase()}_${symbolic(requestName)}`.slice(0, 120);
}
function browserContext(): Context {
  const nav = (globalThis as any).navigator;
  if (!nav) return {};
  const ua: string = nav.userAgent || '';
  if (!ua || /^Node\.js\//.test(ua)) return {};
  const browser = [/\b(Edg|EdgiOS|EdgA)\/([\d.]+)/, /\b(Firefox|FxiOS)\/([\d.]+)/, /\b(Chrome|CriOS)\/([\d.]+)/, /\b(Version)\/([\d.]+)/].map(pattern => ua.match(pattern)).find(Boolean);
  const os = ua.match(/(Windows NT|Android|CPU (?:iPhone )?OS|Mac OS X) ([\d_.]+)/);
  let timezone = ''; try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { /* Optional API. */ }
  return { deviceType: /iPad|Tablet/i.test(ua) ? 'tablet' : /Mobi|iPhone|Android/i.test(ua) ? 'phone' : 'desktop',
    browser: browser ? ({ Edg: 'Edge', EdgiOS: 'Edge', EdgA: 'Edge', FxiOS: 'Firefox', CriOS: 'Chrome', Version: 'Safari' }[browser[1]!] || browser[1] || '') : '', browserVersion: browser?.[2] || '',
    osName: os ? /CPU/.test(os[1]!) ? 'iOS' : os[1] === 'Windows NT' ? 'Windows' : os[1] === 'Mac OS X' ? 'macOS' : os[1] || '' : /Linux/.test(ua) ? 'Linux' : '', osVersion: os?.[2]?.replace(/_/g, '.') || '', locale: nav.language || '', timezone };
}
export function createMonitor(options: MonitorOptions) {
  const batchSize = Math.max(1, Math.min(100, options.batchSize ?? 25));
  const maxQueue = Math.max(batchSize, options.maxQueueSize ?? 500);
  const maxAge = options.maxQueueAgeMs ?? 86400000;
  const makeId = options.idFactory || id;
  const emitterId = makeId();
  const transport = options.fetch || globalThis.fetch;
  if (!transport) throw new Error('Signal requires a fetch implementation');
  const browser = globalThis as any;
  const storageKey = options.storageKey || `signal-queue:${options.endpoint}:${options.token.slice(-12)}`;
  const sessionKey = `${storageKey}:session`;
  const diagnostic = (reason: string, count?: number) => { try { options.onDiagnostic?.({ reason, ...(count === undefined ? {} : { count }) }); } catch { /* Preserve host behavior. */ } };
  const freshSession = (): Context => { const sessionId = makeId(); return options.platform === 'server'
    ? { sessionId, anonymousId: '', sessionNumber: 0, sessionKind: 'process', authState: 'unknown' }
    : { sessionId, anonymousId: sessionId, sessionNumber: 1, viewId: makeId(), sessionKind: 'user', authState: 'unknown' }; };
  let context: Context = { ...(options.platform === 'web' ? browserContext() : {}), ...freshSession(), ...options.context };
  let manualPage = options.context?.pageUrl !== undefined;
  let sessionStarted = Date.now(); let lastActivity = sessionStarted; let lastSaved = 0;
  let sequence = 0; let stopped = false; let booted = false; let current: Promise<void> | null = null;
  let queue: Pending[] = []; let deferred: {send:()=>void;level:Level}[] = [];
  const contexts = new Map<string, Registration>(); const views = new Map<string, Registration>();
  const fingerprints = new Map<string, string>(); const acknowledged = new Set<string>(); const acknowledgedViews = new Set<string>();
  const sessionSequences = new Map<string,number>(); const sessionViews = new Map<string,string>();
  let backoffUntil = 0; let failures = 0; let saving = Promise.resolve();
  const trimCaches = () => {
    const keep = new Set(queue.map(p => p.event.contextId)); const keepViews = new Set(queue.map(p => p.event.viewId));
    for (const [key, value] of contexts) if (!keep.has(key) && value.sessionId !== context.sessionId) { contexts.delete(key); acknowledged.delete(key); }
    for (const [key, value] of views) if (!keepViews.has(key) && value.sessionId !== context.sessionId) { views.delete(key); acknowledgedViews.delete(key); }
    // Long sessions cannot grow the metadata cache without bound.
    if (contexts.size > maxQueue * 2) for (const key of contexts.keys()) { if (!keep.has(key)) { contexts.delete(key); acknowledged.delete(key); } if (contexts.size <= maxQueue) break; }
    if (views.size > maxQueue * 2) for (const key of views.keys()) { if (!keepViews.has(key) && key !== context.viewId) { views.delete(key); acknowledgedViews.delete(key); } if (views.size <= maxQueue) break; }
    for (const [fingerprint, key] of fingerprints) if (!contexts.has(key)) fingerprints.delete(fingerprint);
  };
  const persist = () => {
    if (options.storage) {
      const required = new Set(queue.map(p => p.event.contextId)); const requiredViews = new Set(queue.map(p => p.event.viewId));
      const snapshot = JSON.stringify({ version: 2, events: queue, contexts: [...contexts.values()].filter(c => required.has(c.id)), views: [...views.values()].filter(v => requiredViews.has(v.id)) });
      saving = saving.then(async () => { await options.storage!.setItem(storageKey, snapshot); }).catch(() => diagnostic('Could not persist the offline queue'));
    }
    return saving;
  };
  const saveSession = (force = false) => {
    if (!force && Date.now() - lastSaved < 15000) return;
    lastSaved = Date.now();
    const snapshot = JSON.stringify({ sessionId: context.sessionId, anonymousId: context.anonymousId, sessionNumber: context.sessionNumber, startedAt: sessionStarted, lastActivity, sequence });
    if (options.sessionStorage) saving = saving.then(async () => { await options.sessionStorage!.setItem(sessionKey, snapshot); }).catch(() => diagnostic('Could not persist the session'));
    else if (options.platform === 'web' && options.persistSession !== false) { try { browser.sessionStorage?.setItem(sessionKey, snapshot); } catch { diagnostic('Browser session persistence unavailable'); } }
  };
  const restoreSession = (raw: string | null) => {
    if (!raw || options.context?.sessionId) return;
    const previous = JSON.parse(raw); const now = Date.now();
    if (typeof previous.sessionId === 'string' && previous.sessionId.length <= 128 && typeof previous.lastActivity === 'number' && typeof previous.startedAt === 'number' && now - previous.lastActivity < (options.sessionTimeoutMs ?? 900000) && now - previous.startedAt < (options.maxSessionMs ?? 14400000)) {
      context = { ...context, sessionId: previous.sessionId, anonymousId: previous.anonymousId || previous.sessionId, sessionNumber: Number(previous.sessionNumber) || 1 };
      sessionStarted = previous.startedAt; lastActivity = previous.lastActivity; sequence = Number(previous.sequence) || 0;
    }
  };
  if (!options.sessionStorage && options.platform === 'web' && options.persistSession !== false) { try { restoreSession(browser.sessionStorage?.getItem(sessionKey) || null); } catch { diagnostic('Could not restore browser session'); } }
  const bound = () => {
    const before = queue.length; const now = Date.now();
    queue = queue.filter(p => now - p.queuedAt < maxAge && p.attempts <= (options.maxRetries ?? 8));
    if (before !== queue.length) diagnostic('Expired or exhausted events removed from queue', before - queue.length);
    while (queue.length > maxQueue) { const index = queue.findIndex(p => rank[p.event.level] < 3); queue.splice(index < 0 ? 0 : index, 1); diagnostic('Offline queue full; event dropped', 1); }
    trimCaches();
  };
  const ready = Promise.all([
    options.storage ? options.storage.getItem(storageKey).then(raw => {
      if (!raw) return;
      const stored = JSON.parse(raw); const old = Array.isArray(stored) ? stored : stored.events;
      if (!Array.isArray(old)) throw new Error('Invalid queue');
      for (const registration of stored.contexts || []) { const safe = options.strictPrivacy ? privateEvent({ ...registration, name: 'session.context' }) : registration; contexts.set(registration.id, Object.fromEntries(Object.keys(registration).map(k => [k, safe[k]])) as Registration); }
      for (const registration of stored.views || []) views.set(registration.id, options.strictPrivacy ? { ...registration, pageUrl: '', screen: privateEvent({ ...registration, name: 'screen.viewed' }).screen } : registration);
      queue = old.filter(p => p?.event?.id && typeof p.queuedAt === 'number' && typeof p.attempts === 'number').map(p => ({ ...p, event: options.strictPrivacy ? privateEvent(p.event) : p.event })); bound();
    }).catch(() => diagnostic('Could not restore the offline queue')) : Promise.resolve(),
    options.sessionStorage ? options.sessionStorage.getItem(sessionKey).then(restoreSession).catch(() => diagnostic('Could not restore session')) : Promise.resolve(),
  ]).then(() => { booted = true; const work = deferred; deferred = []; work.forEach(item => item.send()); });
  const active = () => {
    const now = Date.now();
    if (now - lastActivity >= (options.sessionTimeoutMs ?? 900000) || now - sessionStarted >= (options.maxSessionMs ?? 14400000)) {
      context = { ...context, ...freshSession(), authState: context.userId ? 'authenticated' : context.authState || 'unknown', sessionNumber: options.platform === 'server' ? 0 : (context.sessionNumber || 0) + 1 }; sequence = 0; sessionStarted = now;
    }
    lastActivity = now;
  };
  const snapshot = (merged: Context, timestamp: string, registerView = true) => {
    const values: Record<string, any> = { platform: options.platform };
    const lengths: Record<string, number> = { userName:160,companyName:160,deviceType:60,deviceModel:100,osName:60,osVersion:80,appVersion:60,buildVersion:60,browser:60,browserVersion:60,locale:40,timezone:80 };
    for (const key of contextKeys) if (merged[key] !== undefined) values[key] = typeof merged[key] === 'string' ? (merged[key] as string).slice(0, lengths[key] || 128) : merged[key];
    values.authState = values.userId ? 'authenticated' : values.authState || 'unknown';
    for(const key of Object.keys(values))if(typeof values[key]==='string' && !['sessionId','anonymousId','userId','companyId'].includes(key))values[key]=redactText(values[key]);
    values.country = /^[A-Z]{2}$/.test(String(values.country || '').toUpperCase()) ? String(values.country).toUpperCase() : '';
    for(const key of ['userId','companyId'])if(values[key] && !/^[a-zA-Z0-9._:-]{1,128}$/.test(values[key]))values[key]='';
    for(const key of ['userName','companyName'])if(values[key])values[key]=redactText(values[key]);
    if (options.strictPrivacy) { const safe:Record<string,any> = privateEvent({ ...values, name:'session.context' }); for (const key of Object.keys(values)) values[key] = safe[key]; }
    const fingerprint = JSON.stringify(values); let contextId = merged.contextId;
    if (!contextId) {
      contextId = fingerprints.get(fingerprint);
      if (!contextId || !contexts.has(contextId)) { contextId = makeId(); fingerprints.set(fingerprint, contextId); contexts.set(contextId, { ...values, id: contextId, timestamp, sessionId: values.sessionId }); }
    }
    const hasView = options.platform !== 'server' || merged.viewId || merged.screen || merged.pageUrl;
    const viewId = hasView ? merged.viewId || makeId() : undefined;
    if (viewId && registerView && !views.has(viewId)) views.set(viewId, { id:viewId, timestamp, sessionId: merged.sessionId!, screen: options.strictPrivacy ? privateEvent({ screen:merged.screen || '', name:'screen.viewed' }).screen : (merged.screen || '').slice(0,120), pageUrl: options.strictPrivacy ? '' : safeUrl(merged.pageUrl || '').slice(0,2048) });
    return { contextId, ...(viewId ? { viewId } : {}) };
  };
  async function flush(): Promise<void> {
    if (current) return current;
    current = (async () => {
      await ready; bound(); if (Date.now() < backoffUntil) return;
      while (queue.length || [...contexts.keys()].some(key=>!acknowledged.has(key)) || [...views.keys()].some(key=>!acknowledgedViews.has(key))) {
        let batch = queue.slice(0, batchSize);
        const envelope = () => {
          const registrations = [...new Set(batch.length ? batch.map(p => p.event.contextId) : [...contexts.keys()])].flatMap(key => key && !acknowledged.has(key) && contexts.has(key) ? [contexts.get(key)!] : []).slice(0,100);
          const viewRegistrations = [...new Set(batch.length ? batch.map(p => p.event.viewId) : [...views.keys()])].flatMap(key => key && !acknowledgedViews.has(key) && views.has(key) ? [views.get(key)!] : []).slice(0,100);
          return {registrations,viewRegistrations,body:JSON.stringify({events:batch.map(p=>p.event),...(registrations.length ? {contexts:registrations} : {}),...(viewRegistrations.length ? {views:viewRegistrations} : {})})};
        };
        let payload=envelope();
        while(batch.length>1 && byteLength(payload.body)>1900000){batch=batch.slice(0,Math.ceil(batch.length/2));payload=envelope();}
        const {registrations,viewRegistrations,body}=payload;
        const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 15000);
        try {
          const response = await transport(options.endpoint, { method:'POST', headers:{ 'Content-Type':'application/json','X-Signal-Key':options.token },
            body, signal:controller.signal });
          if (!response.ok) {
            const permanent = response.status >= 400 && response.status < 500 && ![408,429].includes(response.status);
            if (permanent) { const ids = new Set(batch.map(p => p.event.id)); queue = queue.filter(p => !ids.has(p.event.id));registrations.forEach(c=>contexts.delete(c.id));viewRegistrations.forEach(v=>views.delete(v.id)); diagnostic(`Upload rejected (${response.status}); batch dropped`,batch.length); await persist(); if ([401,403].includes(response.status)) return; continue; }
            const retryAfter = Number(response.headers.get('Retry-After')); if (Number.isFinite(retryAfter) && retryAfter > 0) backoffUntil = Date.now() + retryAfter * 1000;
            throw new Error('Upload delayed');
          }
          const receipt = await response.json().catch(() => ({})) as Record<string,any>;
          if(receipt.filtered)diagnostic('Collector policy filtered events',receipt.filtered);
          if(receipt.expired)diagnostic('Collector discarded expired events',receipt.expired);
          if(receipt.privacyMode==='strict' && !options.strictPrivacy)diagnostic('Collector uses strict privacy; user, company and device context is withheld');
          for(const issue of receipt.diagnostics || [])if(typeof issue==='string')diagnostic(issue);
          if(Array.isArray(receipt.missingContexts) && receipt.missingContexts.length)diagnostic('Collector reported missing context registrations',receipt.missingContexts.length);
          if(Array.isArray(receipt.missingViews) && receipt.missingViews.length)diagnostic('Collector reported missing view registrations',receipt.missingViews.length);
          registrations.forEach(c => acknowledged.add(c.id)); viewRegistrations.forEach(v => acknowledgedViews.add(v.id));
          const missing = (receipt.missingContexts || []).filter((key:string) => acknowledged.has(key) && contexts.has(key));
          const missingViews = (receipt.missingViews || []).filter((key:string) => acknowledgedViews.has(key) && views.has(key));
          if (missing.length || missingViews.length) {
            missing.forEach((key:string) => acknowledged.delete(key)); missingViews.forEach((key:string) => acknowledgedViews.delete(key));
            // One repair attempt per batch; stable event IDs deduplicate the retry.
            if (!batch.some(p => p.attempts > 0)) { batch.forEach(p => p.attempts++); continue; }
          }
          const ids = new Set(batch.map(p => p.event.id)); queue = queue.filter(p => !ids.has(p.event.id)); failures = 0; backoffUntil = 0; trimCaches(); await persist();
        } catch {
          batch.forEach(p => p.attempts++); failures++; backoffUntil = Math.max(backoffUntil,Date.now()+Math.min(60000,1000*2**Math.min(failures,6))+Math.random()*1000);
          diagnostic('Upload failed; events queued for retry',batch.length); bound(); await persist(); return;
        } finally { clearTimeout(timeout); }
      }
    })().finally(() => { current = null; });
    return current;
  }
  function emit(level:Level,kind:EventKind,name:string,eventOptions:EventOptions={},error?:Error) {
    const eventId = makeId(); const timestamp = new Date().toISOString();
    if(!/^[a-zA-Z][a-zA-Z0-9._:-]{0,119}$/.test(name.slice(0,120))){diagnostic('Invalid event name; use a stable symbolic developer-defined name',1);return eventId;}
    const wasReady=booted;
    if(wasReady)active();
    if(options.platform==='web' && browser.location && !manualPage) {
      const page=`${browser.location.origin}${browser.location.pathname}`;
      if(context.pageUrl!==page)context={...context,pageUrl:page,viewId:makeId()};
    }
    const captured:Context={...context};
    // Capture identity at call time, including empty fields before a later login.
    for(const key of contextKeys)if(!(key in captured))(captured as any)[key]=undefined;
    const send = () => {
      if (stopped) { diagnostic('Monitor is stopped; event ignored',1); return; }
      if(!wasReady)active();
      const { attributes, trigger, message, placement, service, serviceVersion, source, http, identityOverride, ...eventContext } = eventOptions;
      const merged = { ...captured,...(!wasReady ? {sessionId:context.sessionId,anonymousId:context.anonymousId,sessionNumber:context.sessionNumber} : {}),...eventContext };
      if(options.platform !== 'server' && merged.sessionId!==context.sessionId && !eventContext.viewId) {
        if(!sessionViews.has(merged.sessionId!))sessionViews.set(merged.sessionId!,makeId());
        merged.viewId=sessionViews.get(merged.sessionId!)!;
        if(sessionViews.size>maxQueue*2)sessionViews.delete(sessionViews.keys().next().value!);
      }
      if ((eventContext.screen !== undefined && eventContext.screen !== context.screen || eventContext.pageUrl !== undefined && eventContext.pageUrl !== context.pageUrl) && !eventContext.viewId) merged.viewId = makeId();
      const external = !!eventContext.contextId;
      const refs = snapshot(merged,timestamp,!external && !(options.platform === 'server' && eventContext.viewId && !eventContext.screen && !eventContext.pageUrl));
      const eventSequence=merged.sessionId===context.sessionId ? ++sequence : (sessionSequences.get(merged.sessionId!) || 0)+1;
      if(merged.sessionId!==context.sessionId)sessionSequences.set(merged.sessionId!,eventSequence);
      if(sessionSequences.size>maxQueue*2)sessionSequences.delete(sessionSequences.keys().next().value!);
      const event:MonitorEvent = { id:eventId,timestamp,name:name.slice(0,120),level,kind,platform:options.platform,trigger:trigger || 'automatic',sequence:eventSequence,
        sdkVersion:SDK_VERSION,emitterId,privacyMode:options.strictPrivacy ? 'strict' : 'structured',
        ...(merged.sessionKind ? {sessionKind:merged.sessionKind} : {}),
        sessionId:merged.sessionId!, ...refs, message:redactText((message || error?.message || '').slice(0,2048)),attributes:sanitize(attributes || {}) as Record<string,unknown>,
        ...(identityOverride ? {identityOverride:true,userId:eventContext.userId || '',userName:redactText(eventContext.userName || ''),companyId:eventContext.companyId || '',companyName:redactText(eventContext.companyName || ''),authState:eventContext.userId ? 'authenticated' : eventContext.authState || 'unknown'} : {}),
        ...(merged.requestId ? { requestId:merged.requestId } : {}), ...(merged.actionId ? { actionId:merged.actionId } : {}), ...(merged.traceId ? { traceId:merged.traceId } : {}),
        ...(placement ? { placement:placement.slice(0,200) } : {}), ...(service || options.service ? { service:(service || options.service || '').slice(0,100) } : {}),
        ...(serviceVersion || options.serviceVersion ? {serviceVersion:(serviceVersion || options.serviceVersion || '').slice(0,60)} : {}),
        source:source || (options.platform === 'server' ? 'server' : 'client'),
        ...(http ? { http:{ ...http,requestName:symbolic(http.requestName),url:safeUrl(http.url || ''),origin:(() => { try { return new URL(http.origin || '').origin; } catch { return ''; } })() } } : {}),
        ...(error ? { error:{ name:error.name.slice(0,120),message:redactText(error.message.slice(0,2048)),stack:error.stack ? redactText(error.stack.slice(0,16000)) : undefined } } : {}) };
      const safe = options.strictPrivacy ? privateEvent(event) : event;
      if (JSON.stringify(safe.attributes).length > 16000 || byteLength(JSON.stringify(safe)) > (options.maxEventBytes ?? 24000)) { diagnostic('Event too large; add fewer attributes or a shorter stack',1); return; }
      queue.push({ event:safe,attempts:0,queuedAt:Date.now() }); bound(); saveSession(); void ready.then(persist); if (queue.length >= batchSize) void flush();
    };
    if (!booted) {
      deferred.push({send,level});
      while(deferred.length>maxQueue){const index=deferred.findIndex(item=>rank[item.level]<3);deferred.splice(index<0 ? 0 : index,1);diagnostic('Offline queue full before initialization; event dropped',1);}
    } else send();
    return eventId;
  }
  const captureContext = (extra:EventOptions={}): EventOptions => {
    active(); const merged = { ...context,...extra };
    return { ...merged,...snapshot(merged,new Date().toISOString(),!extra.contextId) };
  };
  const getRequestHeaders = (extra:EventOptions={}) => {
    const merged = captureContext(extra);
    return { 'X-Signal-Session-Id':merged.sessionId!, 'X-Signal-Context-Id':merged.contextId!, ...(merged.viewId ? {'X-Signal-View-Id':merged.viewId} : {}),
      ...(merged.actionId ? { 'X-Signal-Action-Id':merged.actionId } : {}), ...(merged.requestId ? { 'X-Signal-Request-Id':merged.requestId } : {}), ...(merged.traceId ? { 'X-Signal-Trace-Id':merged.traceId } : {}),
      ...(extra.placement ? { 'X-Signal-Placement':extra.placement.slice(0,200) } : {}) };
  };
  const interval = setInterval(() => { void flush(); },Math.max(1000,options.flushIntervalMs ?? 5000));
  (interval as unknown as { unref?:()=>void }).unref?.();
  const browserError = (event:any) => emit('error','error','error.javascript.unhandled',{ placement: safeUrl(event.filename || '').slice(0,170) + (event.lineno ? `:${event.lineno}` : '') },event.error instanceof Error ? event.error : new Error(event.message || 'Unknown browser error'));
  const browserRejection = (event:any) => emit('error','error','error.promise.unhandled',{},event.reason instanceof Error ? event.reason : new Error(String(event.reason)));
  const browserClick = (event:any) => { const element = event.target?.closest?.('[data-signal-action]'); const name = element?.getAttribute('data-signal-action'); if (name) emit('info','action',name,{ trigger:'manual',placement:element.getAttribute('data-signal-placement') || '',actionId:makeId() }); };
  const captureErrors = options.captureBrowserErrors && options.platform === 'web' && typeof browser.addEventListener === 'function';
  const captureActions = options.captureBrowserActions && options.platform === 'web' && typeof browser.addEventListener === 'function';
  if (captureErrors) { browser.addEventListener('error',browserError); browser.addEventListener('unhandledrejection',browserRejection); }
  if (captureActions) browser.addEventListener('click',browserClick,true);
  return {
    ready,flush,getRequestHeaders,captureContext,
    getContext: () => ({ ...context }),
    setContext(next:Context) { const {contextId:_old,...previous}=context;context = { ...previous,...next };if(next.userId!==undefined)context.authState=next.userId ? 'authenticated' : next.authState || 'unknown';if(next.pageUrl!==undefined)manualPage=!!next.pageUrl; },
    identify(userId:string,user:Pick<Context,'userName'|'companyId'|'companyName'>={}) { const {contextId:_old,...previous}=context;context = { ...previous,...user,userId,authState:userId ? 'authenticated' : 'unknown' }; },
    startSession(sessionNumber=(context.sessionNumber || 0)+1) { const {contextId:_cx,requestId:_r,actionId:_a,traceId:_t,...previous}=context;context = { ...previous,...freshSession(),sessionNumber }; sequence=0;sessionStarted=Date.now();lastActivity=sessionStarted;saveSession(true);return context.sessionId!; },
    resetUser() { const { userId:_u,userName:_n,companyId:_c,companyName:_cn,requestId:_r,actionId:_a,traceId:_t,contextId:_cx,screen:_s,pageUrl:_p,viewId:_v,...device }=context; context={ ...device,...freshSession(),sessionNumber:options.platform === 'server' ? 0 : (context.sessionNumber || 0)+1,authState:'anonymous',...(options.context?.pageUrl === undefined ? {} : {pageUrl:options.context.pageUrl}) };sequence=0;sessionStarted=Date.now();lastActivity=sessionStarted;saveSession(true); },
    log:(name:string,opts?:EventOptions)=>emit('info','log',name,opts),
    session:(name:string,opts?:EventOptions)=>emit('info','session',name,opts),
    debug:(name:string,opts?:EventOptions)=>emit('debug','log',name,opts),
    info:(name:string,opts?:EventOptions)=>emit('info','log',name,opts),
    warn:(name:string,opts?:EventOptions)=>emit('warning','log',name,opts),
    error:(name:string,error:Error,opts?:EventOptions)=>emit('error','error',name,opts,error),
    critical:(name:string,error:Error,opts?:EventOptions)=>emit('critical','error',name,opts,error),
    crash:(name:string,error:Error,opts?:EventOptions)=>emit('critical','crash',name,opts,error),
    http:(phase:'request'|'response'|'error',http:HttpDetails,opts:EventOptions={})=>emit(phase==='error' || (http.statusCode || 0)>=500 ? 'error' : (http.statusCode || 0)>=400 ? 'warning' : 'info',phase==='error' ? 'error' : 'network',httpEventName(phase,http.method,http.requestName),{ ...opts,http }),
    action:(name:string,opts:EventOptions={})=>{ const actionId=opts.actionId || makeId();emit('info','action',name,{ ...opts,trigger:opts.trigger || 'manual',actionId });return actionId; },
    async trackAction<T>(name:string,work:(correlation:EventOptions & {actionId:string;traceId:string})=>Promise<T>,opts:EventOptions={}) {
      await ready;
      const actionId=opts.actionId || makeId();const traceId=opts.traceId || makeId();const captured=captureContext({...opts,actionId,traceId});
      emit('info','action',`${name}.started`,{ ...captured,trigger:'manual' });
      try { const result=await work({...captured,actionId,traceId});emit('info','action',`${name}.completed`,{ ...captured,trigger:'automatic' });return result; }
      catch(error) { emit('error','error',`${name}.failed`,captured,error instanceof Error ? error : new Error(String(error)));throw error; }
    },
    network(name:string,opts:NetworkOptions) {
      const { url,method,statusCode,durationMs,requestName,route,...rest }=opts;
      const http:HttpDetails={ method:method.toUpperCase() as HttpDetails['method'],requestName:requestName || name,route:route || '',url:requestUrl(url,route),direction:'outgoing',durationMs,...(statusCode === undefined ? {} : {statusCode}) };
      const phase=name.startsWith('api.request') ? 'request' : name.startsWith('api.error') ? 'error' : 'response';
      const operation=requestName || (route ? route.replace(/:([\w]+)/g,'by_$1').replace(/[^\w]+/g,'.').replace(/^\.|\.$/g,'') : '');
      if(operation)http.requestName=operation;
      return emit(statusCode && statusCode>=500 ? 'error' : statusCode && statusCode>=400 ? 'warning' : 'info','network',operation ? httpEventName(phase,method,operation) : name,{ ...rest,http });
    },
    async fetch(requestName:string,input:Parameters<typeof globalThis.fetch>[0],init:RequestInit={},meta:EventOptions & {route:string}) {
      await ready;
      const url=typeof input==='string' ? input : input instanceof URL ? input.toString() : input.url;
      const method=(init.method || (typeof input==='object' && 'method' in input ? input.method : 'GET')).toUpperCase() as HttpDetails['method'];
      const requestId=meta.requestId || makeId();const traceId=meta.traceId || makeId();const correlation=captureContext({ ...meta,requestId,traceId });
      const http:HttpDetails={method,requestName,route:meta.route,url:requestUrl(url,meta.route),direction:'outgoing',origin:browser.location?.origin || ''};
      emit('info','network',httpEventName('request',method,requestName),{ ...correlation,http });
      const headers=new Headers(init.headers || (typeof input==='object' && 'headers' in input ? input.headers : undefined));
      try {
        const origin=new URL(url,browser.location?.origin).origin;
        if (origin===browser.location?.origin || options.propagateTo?.includes(origin)) Object.entries(getRequestHeaders(correlation)).forEach(([key,value])=>headers.set(key,value));
      } catch { /* Keep the application's fetch semantics for invalid/relative URLs. */ }
      const started=Date.now();
      try { const response=await transport(input,{ ...init,headers });
        emit(response.status>=500 ? 'error' : response.status>=400 ? 'warning' : 'info','network',httpEventName('response',method,requestName),{ ...correlation,http:{ ...http,statusCode:response.status,durationMs:Date.now()-started } });return response;
      } catch(error) { emit('error','error',httpEventName('error',method,requestName),{ ...correlation,http:{ ...http,durationMs:Date.now()-started } },error instanceof Error ? error : new Error(String(error)));throw error; }
    },
    screen(name:string,opts:EventOptions={}) { if(opts.pageUrl!==undefined)manualPage=!!opts.pageUrl;context={ ...context,screen:name,viewId:makeId(),...(opts.pageUrl === undefined ? {} : {pageUrl:opts.pageUrl}) };return emit('info','navigation','screen.viewed',opts); },
    pendingCount:()=>queue.length+deferred.length,
    async stop() { await ready;stopped=true;clearInterval(interval);if(captureErrors){browser.removeEventListener('error',browserError);browser.removeEventListener('unhandledrejection',browserRejection);}if(captureActions)browser.removeEventListener('click',browserClick,true);saveSession(true);await flush();await persist(); },
  };
}

/** React Native JavaScript error bridge. Native process crashes require a native reporter. */
export function installReactNativeErrorHandler(
  monitor:Pick<ReturnType<typeof createMonitor>,'error'|'crash'>,
  errorUtils:{getGlobalHandler:()=>((error:Error,isFatal?:boolean)=>void)|undefined;setGlobalHandler:(handler:(error:Error,isFatal?:boolean)=>void)=>void},
) {
  const previous=errorUtils.getGlobalHandler();
  if(!previous)return()=>{};
  const handler=(error:Error,isFatal?:boolean)=>{
    try { if(isFatal)monitor.crash('crash.javascript.fatal',error,{placement:'app.globalErrorHandler'});else monitor.error('error.javascript.unhandled',error,{placement:'app.globalErrorHandler'}); }
    catch { /* Preserve the application's original error handling. */ }
    finally { previous(error,isFatal); }
  };
  errorUtils.setGlobalHandler(handler);
  return ()=>{if(errorUtils.getGlobalHandler()===handler && previous)errorUtils.setGlobalHandler(previous);};
}
