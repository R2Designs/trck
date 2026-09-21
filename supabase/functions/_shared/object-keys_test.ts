import { equal, throws } from 'node:assert/strict';
import { assertOwnedObjectKey } from './object-keys.ts';
import { PublicError } from './http.ts';

const ORG = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const VALID = `organizations/${ORG}/buses/abc/trips/def/dashboard/img.jpg`;

function expectCode(code: string, path: string | undefined, org = ORG) {
  throws(
    () => assertOwnedObjectKey(org, path),
    (error: unknown) => error instanceof PublicError && error.code === code,
    `expected ${code} for ${String(path)}`,
  );
}

Deno.test('accepts a well-formed key inside the caller organisation', () => {
  equal(assertOwnedObjectKey(ORG, VALID), VALID);
  equal(
    assertOwnedObjectKey(ORG, `organizations/${ORG}/employees/e1/faces/f1.jpg`),
    `organizations/${ORG}/employees/e1/faces/f1.jpg`,
  );
});

Deno.test('refuses another organisation with the not-permitted code', () => {
  expectCode('FORBIDDEN', `organizations/${OTHER}/buses/abc/dashboard/img.jpg`);
});

Deno.test('refuses traversal, absolute and malformed keys', () => {
  expectCode('INVALID_PATH', `organizations/${ORG}/../${OTHER}/x.jpg`);
  expectCode('INVALID_PATH', `/organizations/${ORG}/x.jpg`);
  expectCode('INVALID_PATH', `organizations//${ORG}/x.jpg`);
  expectCode('INVALID_PATH', `organizations\\${ORG}\\x.jpg`);
  expectCode('INVALID_PATH', `organizations/${ORG}`);
  expectCode('INVALID_PATH', `uploads/${ORG}/x.jpg`);
  expectCode('INVALID_PATH', `organizations/${ORG}/`);
  expectCode('INVALID_PATH', `organizations/${ORG}/x\u0000.jpg`);
  expectCode('INVALID_PATH', undefined);
  expectCode('INVALID_PATH', '');
  expectCode('INVALID_PATH', `organizations/${ORG}/${'a'.repeat(600)}.jpg`);
});

Deno.test('a prefix that merely starts with the organisation id is refused', () => {
  // `${ORG}x` must not pass as `${ORG}` — this is a whole-segment comparison,
  // not a string prefix test.
  expectCode('FORBIDDEN', `organizations/${ORG}x/buses/abc/img.jpg`);
});
