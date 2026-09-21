/**
 * HTTP plumbing shared by every Edge Function.
 *
 * The rules encoded here, once, so no individual function can forget them:
 *
 *  • CORS is allow-listed, not `*`. These functions act with elevated
 *    privilege; an open CORS policy would let any page a signed-in manager
 *    visits drive them with that manager's session.
 *  • Errors returned to the browser are *codes*, never messages. The client
 *    translates them. A raw Postgres error string in a response body leaks
 *    schema detail and is unreadable in Tamil.
 *  • The real error is logged server-side with a correlation id that is also
 *    returned, so a support request can be traced without exposing anything.
 */

const DEFAULT_ORIGINS = ['http://localhost:5173', 'http://localhost:4173'];

function allowedOrigins(): string[] {
  const configured = Deno.env.get('ALLOWED_ORIGINS');
  if (!configured) return DEFAULT_ORIGINS;
  return configured
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('origin') ?? '';
  const allowed = allowedOrigins();
  const match = allowed.includes(origin) ? origin : (allowed[0] ?? '');

  return {
    'Access-Control-Allow-Origin': match,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export function preflight(request: Request): Response | null {
  if (request.method !== 'OPTIONS') return null;
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export function json(request: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), 'Content-Type': 'application/json' },
  });
}

/** An error the client is allowed to see, carrying a translation key. */
export class PublicError extends Error {
  constructor(
    readonly code: string,
    readonly status = 400,
    readonly details?: Record<string, unknown>,
  ) {
    super(code);
    this.name = 'PublicError';
  }
}

export function errorResponse(request: Request, error: unknown): Response {
  const correlationId = crypto.randomUUID();

  if (error instanceof PublicError) {
    console.error(JSON.stringify({ correlationId, code: error.code, details: error.details }));
    return json(
      request,
      { error: { code: error.code, correlationId, ...(error.details ?? {}) } },
      error.status,
    );
  }

  // Anything unexpected is logged in full and reported as a generic failure.
  console.error(
    JSON.stringify({
      correlationId,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }),
  );
  return json(request, { error: { code: 'INTERNAL', correlationId } }, 500);
}

export async function readJson<T>(request: Request): Promise<T> {
  if (request.method !== 'POST') throw new PublicError('METHOD_NOT_ALLOWED', 405);
  try {
    return (await request.json()) as T;
  } catch {
    throw new PublicError('INVALID_BODY', 400);
  }
}
