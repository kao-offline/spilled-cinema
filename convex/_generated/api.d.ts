/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as controlPlane from "../controlPlane.js";
import type * as http from "../http.js";
import type * as integrations from "../integrations.js";
import type * as migrations from "../migrations.js";
import type * as operators from "../operators.js";
import type * as phoneRemote from "../phoneRemote.js";
import type * as providerModules from "../providerModules.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  controlPlane: typeof controlPlane;
  http: typeof http;
  integrations: typeof integrations;
  migrations: typeof migrations;
  operators: typeof operators;
  phoneRemote: typeof phoneRemote;
  providerModules: typeof providerModules;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  migrations: import("@convex-dev/migrations/_generated/component.js").ComponentApi<"migrations">;
};
