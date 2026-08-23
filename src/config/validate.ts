//--------------------------------------------------------------------------------------------------
// Copyright (c) 2026                   orgrinrt                 ort@hiisi.digital
// SPDX-License-Identifier: MPL-2.0     https://mozilla.org/MPL/2.0        ort@hiisi.digital
//--------------------------------------------------------------------------------------------------

/**
 * Configuration Validation
 *
 * Validates per-linter configuration against JSON schemas provided by plugins.
 *
 * @module
 */

import type { JSONSchema, PluginsDiscoveryResult } from "../types/plugin.ts";
import type {
  ValidationError,
  ValidationResult,
} from "./types/validate.types.ts";

// Re-export types for convenience
export type {
  ValidationError,
  ValidationResult,
} from "./types/validate.types.ts";

// =============================================================================
// Schema Validation
// =============================================================================

/**
 * Validate a value against a JSON Schema.
 * This is a simplified validator supporting common schema features.
 */
function validateValue(
  value: unknown,
  schema: JSONSchema,
  path: string,
): ValidationError[] {
  const errors: ValidationError[] = [];

  // Handle oneOf/anyOf/allOf
  if (schema.oneOf) {
    const matches = schema.oneOf.filter(
      (s) => validateValue(value, s, path).length === 0,
    );
    if (matches.length !== 1) {
      errors.push({
        path,
        message: `Must match exactly one of ${schema.oneOf.length} schemas`,
        value,
      });
    }
    return errors;
  }

  if (schema.anyOf) {
    const matches = schema.anyOf.filter(
      (s) => validateValue(value, s, path).length === 0,
    );
    if (matches.length === 0) {
      errors.push({
        path,
        message: `Must match at least one of ${schema.anyOf.length} schemas`,
        value,
      });
    }
    return errors;
  }

  if (schema.allOf) {
    for (const subSchema of schema.allOf) {
      errors.push(...validateValue(value, subSchema, path));
    }
    return errors;
  }

  // Handle const
  if (schema.const !== undefined) {
    if (value !== schema.const) {
      errors.push({
        path,
        message: `Must be ${JSON.stringify(schema.const)}`,
        value,
      });
    }
    return errors;
  }

  // Handle enum
  if (schema.enum) {
    if (!schema.enum.includes(value)) {
      errors.push({
        path,
        message: `Must be one of: ${
          schema.enum.map((e) => JSON.stringify(e)).join(", ")
        }`,
        value,
      });
    }
    return errors;
  }

  // Type validation
  if (schema.type) {
    const actualType = getJsonType(value);

    if (schema.type === "integer") {
      if (actualType !== "number" || !Number.isInteger(value as number)) {
        errors.push({
          path,
          message: `Expected integer, got ${actualType}`,
          value,
        });
        return errors;
      }
    } else if (schema.type !== actualType) {
      errors.push({
        path,
        message: `Expected ${schema.type}, got ${actualType}`,
        value,
      });
      return errors;
    }
  }

  // Object validation
  if (
    schema.type === "object" && typeof value === "object" && value !== null &&
    !Array.isArray(value)
  ) {
    const obj = value as Record<string, unknown>;

    // Check required properties
    if (schema.required) {
      for (const prop of schema.required) {
        if (!(prop in obj)) {
          errors.push({
            path: path ? `${path}.${prop}` : prop,
            message: `Required property "${prop}" is missing`,
          });
        }
      }
    }

    // Validate properties
    if (schema.properties) {
      for (const [prop, propSchema] of Object.entries(schema.properties)) {
        if (prop in obj) {
          const propPath = path ? `${path}.${prop}` : prop;
          errors.push(...validateValue(obj[prop], propSchema, propPath));
        }
      }
    }

    // Check additional properties
    if (schema.additionalProperties === false && schema.properties) {
      const allowedProps = new Set(Object.keys(schema.properties));
      for (const prop of Object.keys(obj)) {
        if (!allowedProps.has(prop)) {
          errors.push({
            path: path ? `${path}.${prop}` : prop,
            message: `Unknown property "${prop}"`,
            value: obj[prop],
          });
        }
      }
    }
  }

  // Array validation
  if (schema.type === "array" && Array.isArray(value)) {
    // Min/max items
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push({
        path,
        message: `Array must have at least ${schema.minItems} items`,
        value,
      });
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push({
        path,
        message: `Array must have at most ${schema.maxItems} items`,
        value,
      });
    }

    // Validate items
    if (schema.items) {
      for (let i = 0; i < value.length; i++) {
        const itemPath = `${path}[${i}]`;
        errors.push(...validateValue(value[i], schema.items, itemPath));
      }
    }
  }

  // String validation
  if (schema.type === "string" && typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push({
        path,
        message: `String must be at least ${schema.minLength} characters`,
        value,
      });
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push({
        path,
        message: `String must be at most ${schema.maxLength} characters`,
        value,
      });
    }
    if (schema.pattern) {
      const regex = new RegExp(schema.pattern);
      if (!regex.test(value)) {
        errors.push({
          path,
          message: `String must match pattern: ${schema.pattern}`,
          value,
        });
      }
    }
  }

  // Number validation
  if (
    (schema.type === "number" || schema.type === "integer") &&
    typeof value === "number"
  ) {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push({
        path,
        message: `Number must be at least ${schema.minimum}`,
        value,
      });
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push({
        path,
        message: `Number must be at most ${schema.maximum}`,
        value,
      });
    }
  }

  return errors;
}

/**
 * Get the JSON Schema type of a value.
 */
function getJsonType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

// =============================================================================
// Config Validation
// =============================================================================

/**
 * Validate per-linter configuration against plugin-provided schemas.
 *
 * @param linterConfig - The merged linter configuration (linterId -> options)
 * @param discovery - Plugin discovery results containing schemas
 * @param registeredLinterIds - Set of registered linter IDs for unknown ID detection
 * @returns Validation result
 */
export function validateLinterConfig(
  linterConfig: Record<string, Record<string, unknown>>,
  discovery: PluginsDiscoveryResult | null,
  registeredLinterIds: Set<string>,
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: string[] = [];

  for (const [linterId, config] of Object.entries(linterConfig)) {
    // Check for unknown linter IDs
    if (!registeredLinterIds.has(linterId)) {
      warnings.push(
        `Unknown linter ID "${linterId}" in config. ` +
          `This may be a typo or the plugin providing this linter is not loaded.`,
      );
      continue;
    }

    // Look up schema for this linter
    const discoveredSchema = discovery?.allSchemas.get(linterId);

    if (!discoveredSchema) {
      // No schema available - pass through without validation
      continue;
    }

    // Validate against schema
    const schemaErrors = validateValue(
      config,
      discoveredSchema.schema,
      linterId,
    );
    errors.push(...schemaErrors);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Format validation errors for display.
 */
export function formatValidationErrors(result: ValidationResult): string {
  const lines: string[] = [];

  if (result.errors.length > 0) {
    lines.push("Configuration validation errors:");
    for (const err of result.errors) {
      lines.push(`  - ${err.path}: ${err.message}`);
    }
  }

  if (result.warnings.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("Configuration warnings:");
    for (const warn of result.warnings) {
      lines.push(`  - ${warn}`);
    }
  }

  return lines.join("\n");
}
