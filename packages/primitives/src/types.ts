export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export interface JsonArray extends ReadonlyArray<JsonValue> {}

/** Portable JSON: finite numbers and integers within ±(2^53-1). */
export type JsonValue = null | string | boolean | number | JsonArray | JsonObject;

export type SettledStatus = "succeeded" | "failed" | "missing" | "timed_out";

export interface SucceededSettledItem {
  id: string;
  status: "succeeded";
  value: JsonValue;
}

export interface UnsuccessfulSettledItem {
  id: string;
  status: Exclude<SettledStatus, "succeeded">;
  value?: never;
}

export type SettledItem = SucceededSettledItem | UnsuccessfulSettledItem;

export interface AllBarrierPolicy {
  kind: "all";
}

export interface MinimumBarrierPolicy {
  kind: "minimum";
  minimum: number;
}

export interface PercentageBarrierPolicy {
  kind: "percentage";
  /** Integer basis points in [1, 10000]. */
  basisPoints: number;
}

export type SettledBarrierPolicy =
  | AllBarrierPolicy
  | MinimumBarrierPolicy
  | PercentageBarrierPolicy;

export type SettledBarrierReasonCode =
  | "NO_ITEMS"
  | "ALL_SUCCEEDED"
  | "ALL_NOT_SUCCEEDED"
  | "MINIMUM_MET"
  | "MINIMUM_NOT_MET"
  | "MINIMUM_EXCEEDS_TOTAL"
  | "PERCENTAGE_MET"
  | "PERCENTAGE_NOT_MET";

export interface SettledBarrierResult {
  readonly satisfied: boolean;
  readonly reasonCode: SettledBarrierReasonCode;
  readonly total: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly missing: number;
  readonly timedOut: number;
  readonly acceptedIds: readonly string[];
  readonly failedIds: readonly string[];
  readonly missingIds: readonly string[];
  readonly timedOutIds: readonly string[];
}

export interface RouteSelectionRequest {
  readonly requestedRoutes: readonly string[];
  readonly confidenceBasisPoints?: number;
}

export interface RouteConfidencePolicy {
  readonly minimumBasisPoints: number;
  readonly escalationRoute: string;
}

interface RouteSelectionPolicyBase {
  readonly allowedRoutes: readonly string[];
  readonly defaultRoute?: string;
  readonly confidence?: RouteConfidencePolicy;
}

export interface SingleRouteSelectionPolicy extends RouteSelectionPolicyBase {
  readonly kind: "single";
  readonly maxMulticast?: never;
}

export interface MultiRouteSelectionPolicy extends RouteSelectionPolicyBase {
  readonly kind: "multi";
  readonly maxMulticast: number;
}

export type RouteSelectionPolicy = SingleRouteSelectionPolicy | MultiRouteSelectionPolicy;

export type RouteSelectionReasonCode =
  | "REQUESTED_ROUTES_SELECTED"
  | "DEFAULT_SELECTED_NO_REQUEST"
  | "DEFAULT_SELECTED_UNKNOWN_ROUTE"
  | "ESCALATION_SELECTED_LOW_CONFIDENCE"
  | "NO_REQUESTED_ROUTE"
  | "UNKNOWN_ROUTE"
  | "MULTIPLE_ROUTES_FOR_SINGLE"
  | "MULTICAST_LIMIT_EXCEEDED";

export interface RouteSelectionResult {
  readonly routed: boolean;
  readonly reasonCode: RouteSelectionReasonCode;
  readonly requestedRoutes: readonly string[];
  readonly selectedRoutes: readonly string[];
  readonly unknownRoutes: readonly string[];
  readonly confidenceBasisPoints: number | null;
  readonly usedDefault: boolean;
  readonly escalated: boolean;
}
