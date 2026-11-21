/** Allowlist serializers: no URL/query/header/body/message values enter logs. */
const methods = new Set(['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS']);
const types = new Set(['Error','TypeError','RangeError','ReferenceError','SyntaxError','AbortError','TimeoutError','ValidationError','ZodError']);
const codes = new Set(['ECONNRESET','ECONNREFUSED','ETIMEDOUT','ENOTFOUND','EAI_AGAIN','ENOMEM','ENOSPC','EPIPE','23505','23503','23502','42P01','53300']);
const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' ? v as Record<string, unknown> : {};
export function safeRequest(value: unknown) {
  const v = object(value);
  return { method: typeof v.method === 'string' && methods.has(v.method) ? v.method : 'OTHER' };
}
export function safeResponse(value: unknown) {
  const v = object(value);
  return { statusCode: typeof v.statusCode === 'number' && Number.isInteger(v.statusCode) && v.statusCode >= 100 && v.statusCode <= 599 ? v.statusCode : 0 };
}
export function safeError(value: unknown) {
  const v = object(value), name = v.name ?? v.type;
  const result: { message: string; stack: string; type: string; code?: string; frames?: {source:string;line:number;column:number}[] } = { message: 'Application error', stack: '', type: typeof name === 'string' && types.has(name) ? name : 'Error' };
  if (typeof v.code === 'string' && codes.has(v.code)) result.code = v.code;
  if (typeof v.stack === 'string') {
    const frames = v.stack.split('\n').slice(1,30).flatMap(line => {
      const m = line.match(/\/apps\/server\/((?:src|dist)\/[A-Za-z0-9_.\/-]+\.(?:js|ts|mjs|cjs)):(\d{1,7}):(\d{1,7})/);
      return m && m[1] && !m[1].includes('..') ? [{source:m[1],line:Number(m[2]),column:Number(m[3])}] : [];
    }).slice(0,6);
    if (frames.length) result.frames = frames;
  }
  return result;
}

/** Drop arbitrary custom fields before Pino serialization. */
export function safeLogFields(value: unknown): Record<string, unknown> {
  if (value instanceof Error) return { err: value };
  const v = object(value), fields: Record<string, unknown> = {};
  for (const key of ['req', 'res', 'err']) if (v[key] !== undefined) fields[key] = v[key];
  if (typeof v.responseTime === 'number' && Number.isFinite(v.responseTime) && v.responseTime >= 0) fields.responseTime = v.responseTime;
  return fields;
}
