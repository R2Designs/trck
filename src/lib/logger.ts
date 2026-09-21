/**
 * Structured application logging.
 *
 * Two hard rules, both enforced here rather than by convention:
 *   1. **Nothing biometric is ever logged.** Embeddings, image blobs and raw
 *      OCR payloads are stripped before a record leaves this module.
 *   2. **Users never see a technical error.** Everything logged here is for
 *      engineers; the UI renders a translated message from `errors.ts`.
 *
 * In development the output is readable in the console. In production, records
 * are buffered and can be shipped by whatever sink the deployment configures —
 * there is no vendor SDK baked in.
 */

import { config } from '@/app/config';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogRecord {
  level: LogLevel;
  message: string;
  context: Record<string, unknown>;
  timestamp: string;
  appVersion: string;
  env: string;
}

export type LogSink = (record: LogRecord) => void;

/** Keys that must never appear in a log line, at any depth. */
const FORBIDDEN_KEYS = new Set([
  'embedding',
  'embeddings',
  'descriptor',
  'descriptors',
  'faceDescriptor',
  'imageData',
  'blob',
  'dataUrl',
  'base64',
  'password',
  'accessToken',
  'refreshToken',
  'access_token',
  'refresh_token',
  'apikey',
  'apiKey',
  'authorization',
  'ocrRawResponse',
  'ocr_raw_response',
]);

const MAX_STRING_LENGTH = 512;
const MAX_DEPTH = 4;

function redact(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (depth > MAX_DEPTH) return '[truncated]';

  if (typeof value === 'string') {
    // A data: URL is an image by another name.
    if (value.startsWith('data:')) return '[binary]';
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…` : value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') return value;

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack?.split('\n').slice(0, 6),
    };
  }

  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer || value instanceof Blob) {
    return '[binary]';
  }

  if (Array.isArray(value)) {
    // Long numeric arrays are almost always descriptors.
    if (value.length > 32 && value.every((v) => typeof v === 'number')) return '[vector]';
    return value.slice(0, 32).map((item) => redact(item, depth + 1));
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = FORBIDDEN_KEYS.has(key) ? '[redacted]' : redact(item, depth + 1);
    }
    return out;
  }

  return '[unserialisable]';
}

/**
 * Level gating.
 *
 * `VITE_LOG_LEVEL` is a real control, not decoration: a production build that
 * prints every queued write to the console is both noise and a slow leak of
 * operational detail into a shared device's console.
 */
const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const THRESHOLD =
  config.logLevel === 'silent' ? Number.POSITIVE_INFINITY : LEVEL_RANK[config.logLevel];

const sinks: LogSink[] = [];
const buffer: LogRecord[] = [];
const BUFFER_LIMIT = 200;

export function addLogSink(sink: LogSink): () => void {
  sinks.push(sink);
  return () => {
    const index = sinks.indexOf(sink);
    if (index >= 0) sinks.splice(index, 1);
  };
}

/** Last N records — surfaced on the internal status screen for field support. */
export function recentLogs(): readonly LogRecord[] {
  return buffer;
}

function emit(level: LogLevel, message: string, context: Record<string, unknown> = {}): void {
  const record: LogRecord = {
    level,
    message,
    context: redact(context) as Record<string, unknown>,
    timestamp: new Date().toISOString(),
    appVersion: config.appVersion,
    env: config.env,
  };

  // The ring buffer is kept regardless of level: the field-support screen needs
  // the last few records even from a build configured to print nothing.
  buffer.push(record);
  if (buffer.length > BUFFER_LIMIT) buffer.shift();

  if (LEVEL_RANK[level] >= THRESHOLD) {
    const line = `[trck] ${record.message}`;
    // Each level on its own channel, so a browser's console filter works and
    // an informational line is not dressed up as a warning.
    /* eslint-disable no-console -- this module is the one sanctioned console
       call site; the lint rule exists to push every other file through here. */
    if (level === 'error') console.error(line, record.context);
    else if (level === 'warn') console.warn(line, record.context);
    else if (level === 'info') console.info(line, record.context);
    else console.debug(line, record.context);
    /* eslint-enable no-console */
  }

  for (const sink of sinks) {
    try {
      sink(record);
    } catch {
      // A failing sink must never break the operation being logged.
    }
  }
}

export const logger = {
  debug: (message: string, context?: Record<string, unknown>) => emit('debug', message, context),
  info: (message: string, context?: Record<string, unknown>) => emit('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) => emit('warn', message, context),
  error: (message: string, context?: Record<string, unknown>) => emit('error', message, context),
};

/** Exposed for the logger's own unit tests. */
export const __testing = { redact };
