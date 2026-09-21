/**
 * Error handling.
 *
 * The contract: every failure that can reach a user is converted into an
 * `AppError` carrying a *translation key*, never a sentence and never a
 * technical string. `PostgrestError`, `TypeError` and "500 Internal Server
 * Error" are logged; what the manager reads is
 * "Couldn't save attendance. Check your connection and try again."
 */

import { logger } from './logger';

export type ErrorKind =
  | 'NETWORK'
  | 'OFFLINE'
  | 'AUTH'
  | 'PERMISSION'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VALIDATION'
  | 'CAMERA'
  | 'RECOGNITION'
  | 'OCR'
  | 'STORAGE'
  | 'RATE_LIMIT'
  | 'SERVER'
  | 'UNKNOWN';

export interface AppErrorOptions {
  kind?: ErrorKind;
  /** i18n key under the `errors` namespace. */
  messageKey?: string;
  /** Interpolation values for that key. */
  messageParams?: Record<string, unknown>;
  /** Whether offering "Try again" makes sense for this failure. */
  retryable?: boolean;
  cause?: unknown;
  context?: Record<string, unknown>;
}

export class AppError extends Error {
  readonly kind: ErrorKind;
  readonly messageKey: string;
  readonly messageParams: Record<string, unknown>;
  readonly retryable: boolean;
  readonly context: Record<string, unknown>;

  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.kind = options.kind ?? 'UNKNOWN';
    this.messageKey = options.messageKey ?? 'errors.unknown';
    this.messageParams = options.messageParams ?? {};
    // Parenthesised deliberately: `??` mixed with `&&` unparenthesised is a
    // syntax error, and retrying a permission or validation failure would just
    // produce the same refusal a second time.
    this.retryable =
      options.retryable ?? (this.kind !== 'PERMISSION' && this.kind !== 'VALIDATION');
    this.context = options.context ?? {};
  }
}

/** Business errors raised by the RPC layer, mapped to what the manager sees. */
const RPC_ERROR_KEYS: Record<string, { key: string; kind: ErrorKind; retryable: boolean }> = {
  NOT_AUTHORISED: { key: 'errors.notAuthorised', kind: 'PERMISSION', retryable: false },
  EMPLOYEE_NOT_FOUND: { key: 'errors.employeeNotFound', kind: 'NOT_FOUND', retryable: false },
  EMPLOYEE_INACTIVE: { key: 'errors.employeeInactive', kind: 'VALIDATION', retryable: false },
  EMPLOYEE_DEPOT_MISMATCH: {
    key: 'errors.employeeDepotMismatch',
    kind: 'VALIDATION',
    retryable: false,
  },
  ATTENDANCE_ALREADY_RECORDED: {
    key: 'errors.attendanceAlreadyRecorded',
    kind: 'CONFLICT',
    retryable: false,
  },
  FACE_EVIDENCE_MISSING: { key: 'errors.faceEvidenceMissing', kind: 'VALIDATION', retryable: true },
  FACE_SCORE_BELOW_THRESHOLD: {
    key: 'errors.faceScoreBelowThreshold',
    kind: 'VALIDATION',
    retryable: true,
  },
  LIVENESS_NOT_PASSED: { key: 'errors.livenessNotPassed', kind: 'VALIDATION', retryable: true },
  OVERRIDE_REASON_REQUIRED: {
    key: 'errors.overrideReasonRequired',
    kind: 'VALIDATION',
    retryable: false,
  },
  BUS_NOT_FOUND: { key: 'errors.busNotFound', kind: 'NOT_FOUND', retryable: false },
  BUS_OUT_OF_SERVICE: { key: 'errors.busOutOfService', kind: 'VALIDATION', retryable: false },
  BUS_ALREADY_ON_TRIP: { key: 'errors.busAlreadyOnTrip', kind: 'CONFLICT', retryable: false },
  ROUTE_NOT_FOUND: { key: 'errors.routeNotFound', kind: 'NOT_FOUND', retryable: false },
  ROUTE_DEPOT_MISMATCH: { key: 'errors.routeDepotMismatch', kind: 'VALIDATION', retryable: false },
  ODOMETER_BELOW_LAST_KNOWN: {
    key: 'errors.odometerBelowLastKnown',
    kind: 'VALIDATION',
    retryable: false,
  },
  TRIP_NOT_FOUND: { key: 'errors.tripNotFound', kind: 'NOT_FOUND', retryable: false },
  TRIP_NOT_IN_PROGRESS: { key: 'errors.tripNotInProgress', kind: 'CONFLICT', retryable: false },
  END_READING_REQUIRED: { key: 'errors.endReadingRequired', kind: 'VALIDATION', retryable: false },
  END_ODOMETER_BELOW_START: {
    key: 'errors.endOdometerBelowStart',
    kind: 'VALIDATION',
    retryable: false,
  },
  REASON_REQUIRED: { key: 'errors.reasonRequired', kind: 'VALIDATION', retryable: false },
};

/** PostgreSQL SQLSTATE codes worth distinguishing for the user. */
const PG_CODE_KEYS: Record<string, { key: string; kind: ErrorKind; retryable: boolean }> = {
  '23505': { key: 'errors.duplicateRecord', kind: 'CONFLICT', retryable: false },
  '23503': { key: 'errors.relatedRecordMissing', kind: 'VALIDATION', retryable: false },
  '23514': { key: 'errors.invalidValue', kind: 'VALIDATION', retryable: false },
  '42501': { key: 'errors.notAuthorised', kind: 'PERMISSION', retryable: false },
  P0002: { key: 'errors.notFound', kind: 'NOT_FOUND', retryable: false },
};

interface PostgrestLikeError {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
  status?: number;
}

function isPostgrestLike(value: unknown): value is PostgrestLikeError {
  return typeof value === 'object' && value !== null && 'message' in value;
}

/**
 * Converts anything thrown anywhere in the app into an `AppError`.
 * Called by the query client, every mutation and the top-level boundary, so a
 * raw driver error can never reach a screen.
 */
export function toAppError(error: unknown, fallbackKey = 'errors.unknown'): AppError {
  if (error instanceof AppError) return error;

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return new AppError('Offline', {
      kind: 'OFFLINE',
      messageKey: 'errors.offline',
      retryable: true,
      cause: error,
    });
  }

  if (error instanceof DOMException) {
    const cameraKeys: Record<string, string> = {
      NotAllowedError: 'errors.cameraPermissionDenied',
      NotFoundError: 'errors.cameraNotFound',
      NotReadableError: 'errors.cameraInUse',
      OverconstrainedError: 'errors.cameraUnsupported',
      SecurityError: 'errors.cameraPermissionDenied',
      AbortError: 'errors.cameraAborted',
    };
    const key = cameraKeys[error.name];
    if (key) {
      return new AppError(error.message, {
        kind: 'CAMERA',
        messageKey: key,
        retryable: error.name !== 'NotFoundError',
        cause: error,
      });
    }
  }

  if (error instanceof TypeError && /fetch|network/i.test(error.message)) {
    return new AppError(error.message, {
      kind: 'NETWORK',
      messageKey: 'errors.network',
      retryable: true,
      cause: error,
    });
  }

  if (isPostgrestLike(error)) {
    const message = error.message ?? '';

    for (const [token, mapping] of Object.entries(RPC_ERROR_KEYS)) {
      if (message.startsWith(token)) {
        return new AppError(message, {
          kind: mapping.kind,
          messageKey: mapping.key,
          retryable: mapping.retryable,
          cause: error,
          context: { code: error.code, details: error.details },
        });
      }
    }

    if (error.code && PG_CODE_KEYS[error.code]) {
      const mapping = PG_CODE_KEYS[error.code];
      return new AppError(message, {
        kind: mapping!.kind,
        messageKey: mapping!.key,
        retryable: mapping!.retryable,
        cause: error,
        context: { code: error.code },
      });
    }

    if (error.status === 401 || error.status === 403) {
      return new AppError(message, {
        kind: 'AUTH',
        messageKey: 'errors.sessionExpired',
        retryable: false,
        cause: error,
      });
    }

    if (error.status === 429) {
      return new AppError(message, {
        kind: 'RATE_LIMIT',
        messageKey: 'errors.rateLimited',
        retryable: true,
        cause: error,
      });
    }

    if (error.status && error.status >= 500) {
      return new AppError(message, {
        kind: 'SERVER',
        messageKey: 'errors.server',
        retryable: true,
        cause: error,
      });
    }
  }

  const message = error instanceof Error ? error.message : String(error);
  return new AppError(message, { kind: 'UNKNOWN', messageKey: fallbackKey, cause: error });
}

/** Converts, logs the technical detail, and returns the user-safe error. */
export function handleError(
  error: unknown,
  operation: string,
  fallbackKey = 'errors.unknown',
): AppError {
  const appError = toAppError(error, fallbackKey);
  logger.error(`${operation} failed`, {
    kind: appError.kind,
    messageKey: appError.messageKey,
    technical: appError.message,
    ...appError.context,
  });
  return appError;
}
