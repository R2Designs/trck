import { PublicError } from './http.ts';

/**
 * The tenant boundary for object storage.
 *
 * Every key in this product is `organizations/{orgId}/…`, and the organisation
 * id in segment two is what the storage RLS policies parse. For the R2 adapter
 * there are no RLS policies — the signing function *is* the boundary — so this
 * check is the only thing standing between a manipulated path in a request
 * body and another operator's photographs.
 *
 * It is a separate, exported function precisely so it can be tested directly.
 */

const MAX_KEY_LENGTH = 512;

export function assertOwnedObjectKey(organizationId: string, path: string | undefined): string {
  if (!path || path.length === 0 || path.length > MAX_KEY_LENGTH) {
    throw new PublicError('INVALID_PATH', 400);
  }

  // Traversal, absolute paths, empty segments, backslashes and control
  // characters are all rejected before the tenant check, so a malformed key can
  // never reach the segment comparison in a form that might pass it.
  if (
    path.startsWith('/') ||
    path.includes('..') ||
    path.includes('//') ||
    path.includes('\\') ||
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u001f\u007f]/.test(path)
  ) {
    throw new PublicError('INVALID_PATH', 400);
  }

  const segments = path.split('/');
  if (segments[0] !== 'organizations' || segments.length < 3) {
    throw new PublicError('INVALID_PATH', 400);
  }
  if (segments[2] === undefined || segments[2].length === 0) {
    throw new PublicError('INVALID_PATH', 400);
  }

  // Same error for "wrong tenant" as the caller gets for "not permitted": a
  // signer must not double as an oracle for which organisation ids exist.
  if (segments[1] !== organizationId) throw new PublicError('FORBIDDEN', 403);

  return path;
}
