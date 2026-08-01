/**
 * Section 11 portable limits. These are the hard v1alpha2 maxima; a deployment
 * may bind smaller bounds into policy but never larger ones.
 *
 * Section 3.3.1 requires these to be evaluated *before* target existence,
 * overlap, mutation, hashing, encryption, or any write, so a limit denial wins
 * over a missing-target denial and never produces a partial result.
 */
export interface PortableLimits {
  readonly maxPolicyUtf8Bytes: number;
  readonly maxProtectedValueUtf8Bytes: number;
  readonly maxTransformedUtf8Bytes: number;
  readonly maxValueDepth: number;
  readonly maxValueNodes: number;
  readonly maxContainers: number;
  readonly maxObjectMembers: number;
  readonly maxPointersPerRule: number;
  readonly maxPointerTokens: number;
  readonly maxPointerUtf8Bytes: number;
  readonly maxPointerTokenUtf8Bytes: number;
  readonly maxProtectedRefsPerRecord: number;
  readonly maxRefUtf8Bytes: number;
  readonly maxDiagnosticUtf8Bytes: number;
}

export const SECTION_11_LIMITS: PortableLimits = Object.freeze({
  maxPolicyUtf8Bytes: 65_536,
  maxProtectedValueUtf8Bytes: 67_108_864,
  maxTransformedUtf8Bytes: 67_108_864,
  maxValueDepth: 128,
  maxValueNodes: 1_000_000,
  maxContainers: 100_000,
  maxObjectMembers: 1_000_000,
  maxPointersPerRule: 1_024,
  maxPointerTokens: 128,
  maxPointerUtf8Bytes: 1_024,
  maxPointerTokenUtf8Bytes: 256,
  maxProtectedRefsPerRecord: 1_024,
  maxRefUtf8Bytes: 128,
  maxDiagnosticUtf8Bytes: 1_024,
});
