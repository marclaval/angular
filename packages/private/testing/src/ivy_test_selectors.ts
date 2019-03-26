/**
 * @license
 * Copyright Google Inc. All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {bazelDefineCompileValue} from './bazel_define_compile_value';

/**
 * A function to conditionally include a test or a block of tests only when tests run against Ivy.
 *
 * The modification of the behavior must be well justified, not affect common usage patterns, and
 * documented as a breaking change.
 *
 * ```
 * ivyEnabled && describe(...);
 * ```
 *
 * or
 *
 * ```
 * ivyEnabled && it(...);
 * ```
 */
export const ivyEnabled = 'aot' === (bazelDefineCompileValue as string);

/**
 * A function to conditionally skip the execution of tests that are not relevant when
 * running against Ivy.
 *
 * Any tests disabled using this switch should not be user-facing breaking changes.
 *
 * ```
 * obsoleteInIvy('some reason').describe(...);
 * ```
 *
 * or
 *
 * ```
 * obsoleteInIvy('some reason').it(...);
 * ```
 */
export function obsoleteInIvy(reason: string): JasmineMethods {
  return ivyEnabled ? IGNORE : PASSTHROUGH;
}

/**
 * A function to conditionally skip the execution of tests that are not relevant when
 * not running against Ivy.
 *
 * ```
 * onlyInIvy('some reason').describe(...);
 * ```
 *
 * or
 *
 * ```
 * onlyInIvy('some reason').it(...);
 * ```
 */
export function onlyInIvy(reason: string): JasmineMethods {
  return ivyEnabled ? PASSTHROUGH : IGNORE;
}

/**
 * A function to conditionally skip the execution of tests that have intentionally
 * been broken when running against Ivy.
 *
 * The modification of the behavior must be well justified, not affect common usage patterns, and
 * documented as a breaking change.
 *
 * ```
 * modifiedInIvy('some reason').describe(...);
 * ```
 *
 * or
 *
 * ```
 * modifiedInIvy('some reason').it(...);
 * ```
 */
export function modifiedInIvy(reason: string): JasmineMethods {
  return ivyEnabled ? IGNORE : PASSTHROUGH;
}

export interface JasmineMethods {
  it: typeof it;
  fit: typeof fit;
  describe: typeof describe;
  fdescribe: typeof fdescribe;
  isEnabled: boolean;
}

const PASSTHROUGH: JasmineMethods = {
  it: it,
  fit: fit,
  describe: describe,
  fdescribe: fdescribe,
  isEnabled: true,
};

function noop() {}

const IGNORE: JasmineMethods = {
  it: noop,
  fit: noop,
  describe: noop,
  fdescribe: noop,
  isEnabled: false,
};
