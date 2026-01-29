/**
 * Configuration module.
 *
 * @module
 */

export type {
  CheckerConfig,
  ConfigSource,
  ResolvedConfig,
  ScopedConfig,
  Severity,
  ViolaFileConfig,
} from "./types.ts";

export { getCheckersForFile, loadConfig } from "./loader.ts";
