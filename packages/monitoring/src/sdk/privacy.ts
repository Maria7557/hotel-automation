/** Scrub common secrets in free text as a second layer; integrations still use allowlisted attributes. */
export function redactText(value:string) {
  return value.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,'[REDACTED_EMAIL]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,'Bearer [REDACTED]')
    .replace(/\b(password|passwd|secret|token|authorization|api[_-]?key)\s*[:=]\s*["']?[^\s,;"'&]+/gi,'$1=[REDACTED]');
}
/** Minimal telemetry: deliberately excludes free text, customer identity and URL paths.
 * Event/screen names must be developer-defined constants, never user input.
 */
export function privateEvent<T extends Record<string, any>>(event: T): T {
  const identifier = (value: unknown) => typeof value === 'string' && /^[a-zA-Z][a-zA-Z._:-]{0,79}$/.test(value) ? value : '';
  const attributes: Record<string, number | boolean> = {};
  for (const key of ['durationMs', 'statusCode', 'count', 'itemCount', 'retryCount', 'success']) {
    const value = event.attributes?.[key];
    if ((typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean') attributes[key] = value;
  }
  const errorName = ['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'TimeoutError', 'AbortError'].includes(event.error?.name) ? event.error.name : 'Error';
  const opaque = (value:unknown) => typeof value === 'string' && (/^[0-9a-f-]{36}$/i.test(value) || /^[0-9a-f]{32}$/i.test(value)) ? value : '';
  const label = (value:unknown) => typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9._:/-]{0,199}$/.test(value) ? value : '';
  const origin = (value:unknown) => { try { const url=new URL(String(value));return ['https:','http:'].includes(url.protocol) ? url.origin : ''; } catch { return ''; } };
  return { ...event, name: identifier(event.name) || 'application.event',
    privacyMode:'strict', ...('authState' in event ? {authState:'unknown'} : {}),
    ...('anonymousId' in event ? {anonymousId:opaque(event.anonymousId)} : {}),
    ...('emitterId' in event ? {emitterId:opaque(event.emitterId)} : {}),
    ...('sdkVersion' in event ? {sdkVersion:/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(event.sdkVersion || '') ? event.sdkVersion : ''} : {}),
    ...('buildVersion' in event ? {buildVersion:/^\d+(?:\.\d+){0,3}$/.test(event.buildVersion || '') ? event.buildVersion : ''} : {}),
    ...('capture' in event ? {capture:undefined} : {}),
    message: '', userId: '', ...('userName' in event ? {userName:''} : {}), companyId: '', companyName: '', requestId: opaque(event.requestId), traceId: opaque(event.traceId), actionId: opaque(event.actionId),
    sessionId: /^[0-9a-f-]{36}$/i.test(event.sessionId || '') ? event.sessionId : '',
    viewId: /^[0-9a-f-]{36}$/i.test(event.viewId || '') ? event.viewId : '',
    appVersion: /^\d+(\.\d+){1,3}$/.test(event.appVersion || '') ? event.appVersion : '',
    deviceType: ['phone', 'tablet', 'desktop'].includes(event.deviceType) ? event.deviceType : '',
    pageUrl: '', screen: identifier(event.screen), deviceModel: '', osVersion: '',
    ...Object.fromEntries(['osName','browser','browserVersion','locale','timezone'].filter(key=>key in event).map(key=>[key,''])),
    placement:label(event.placement),service:label(event.service),
    ...(event.http ? { http:{ method:event.http.method,requestName:identifier(event.http.requestName) || 'unmatched',
      route:typeof event.http.route==='string' && /^\/[a-zA-Z0-9_:/.-]{0,299}$/.test(event.http.route) && !/[0-9a-f]{8}-|\d{6,}/i.test(event.http.route) ? event.http.route : '',
      url:'',origin:origin(event.http.origin),...(event.http.direction ? {direction:event.http.direction} : {}),caller:label(event.http.caller),
      ...(Number.isFinite(event.http.statusCode) ? {statusCode:event.http.statusCode} : {}),...(Number.isFinite(event.http.durationMs) ? {durationMs:event.http.durationMs} : {}) } } : {}),
    attributes, ...(event.error ? { error: { name: errorName, message: '' } } : {}),
  };
}
