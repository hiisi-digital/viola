/**
 * Viola Schema Collision Linter
 *
 * Detects naming conflicts between JSON Schema names and TypeScript types/interfaces.
 * In a schema-first workflow, types should be generated from schemas - not manually
 * written alongside them with potentially conflicting names.
 *
 * @module
 */

import {
    BaseLinter,
    type CodebaseData,
    type LinterConfig,
    type LinterDataRequirements,
    type LinterMeta,
    type SchemaInfo,
    type SourceLocation,
    type TypeInfo,
    type Violation,
} from "@hiisi/viola";

// =============================================================================
// Configuration
// =============================================================================

/**
 * Options for the schema-collision linter.
 */
interface SchemaCollisionOptions {
  /**
   * Whether to check for exact name matches.
   * @default true
   */
  checkExactMatch?: boolean;

  /**
   * Whether to check for case-insensitive matches.
   * (e.g., "User" schema vs "user" type)
   * @default true
   */
  checkCaseInsensitive?: boolean;

  /**
   * Whether to check for common naming variants.
   * (e.g., "User" schema vs "UserType", "IUser", "UserInterface")
   * @default true
   */
  checkVariants?: boolean;

  /**
   * Patterns for schema names to ignore.
   * @default []
   */
  ignoreSchemaPatterns?: RegExp[];

  /**
   * Patterns for type names to ignore.
   * @default []
   */
  ignoreTypePatterns?: RegExp[];

  /**
   * File patterns where collisions are allowed.
   * (e.g., generated type files)
   * @default [/\.generated\.ts$/, /\.gen\.ts$/]
   */
  allowedFilePatterns?: RegExp[];

  /**
   * Common type suffixes/prefixes to check as variants.
   * @default ["Type", "Interface", "Schema", "Model", "DTO"]
   */
  variantSuffixes?: string[];

  /**
   * Common type prefixes to check as variants.
   * @default ["I", "T"]
   */
  variantPrefixes?: string[];
}

const DEFAULT_OPTIONS: Required<SchemaCollisionOptions> = {
  checkExactMatch: true,
  checkCaseInsensitive: true,
  checkVariants: true,
  ignoreSchemaPatterns: [],
  ignoreTypePatterns: [],
  allowedFilePatterns: [/\.generated\.ts$/, /\.gen\.ts$/, /codegen/],
  variantSuffixes: ["Type", "Interface", "Schema", "Model", "DTO", "Data"],
  variantPrefixes: ["I", "T"],
};

// =============================================================================
// Types
// =============================================================================

interface CollisionInfo {
  schema: SchemaInfo;
  type: TypeInfo;
  matchType: "exact" | "case-insensitive" | "variant";
  variantKind?: string;
}

// =============================================================================
// Linter Implementation
// =============================================================================

/**
 * Schema Collision Linter
 *
 * Finds naming conflicts between JSON Schemas and TypeScript types.
 * This helps enforce schema-first development where types should be
 * generated from schemas, not duplicated manually.
 */
export class SchemaCollisionLinter extends BaseLinter {
  readonly meta: LinterMeta = {
    id: "schema-collision",
    name: "Schema Name Collision",
    description: "Detects naming conflicts between schemas and types",
    defaultSeverity: "error",
  };

  readonly requirements: LinterDataRequirements = {
    types: true,
    schemas: true,
    files: true,
  };

  lint(data: CodebaseData, config: LinterConfig): Violation[] {
    const violations: Violation[] = [];
    const opts = this.getOptions(config);

    // If no schemas, nothing to check
    if (data.schemas.length === 0) {
      return violations;
    }

    // Build lookup maps for schemas
    const schemasByName = new Map<string, SchemaInfo>();
    const schemasByLowerName = new Map<string, SchemaInfo>();
    const schemaVariants = new Map<string, SchemaInfo>();

    for (const schema of data.schemas) {
      // Skip ignored schemas
      if (this.shouldIgnoreSchema(schema.name, opts)) {
        continue;
      }

      schemasByName.set(schema.name, schema);
      schemasByLowerName.set(schema.name.toLowerCase(), schema);

      // Generate variant names this schema could match
      if (opts.checkVariants) {
        for (const variant of this.generateVariants(schema.name, opts)) {
          schemaVariants.set(variant.toLowerCase(), schema);
        }
      }
    }

    // Check each type for collisions
    for (const file of data.files) {
      // Skip files where collisions are allowed (generated files)
      if (this.isAllowedFile(file.path, opts)) {
        continue;
      }

      for (const type of file.types) {
        // Skip ignored types
        if (this.shouldIgnoreType(type.name, opts)) {
          continue;
        }

        const collisions = this.findCollisions(
          type,
          schemasByName,
          schemasByLowerName,
          schemaVariants,
          opts
        );

        for (const collision of collisions) {
          violations.push(this.collisionToViolation(collision, config));
        }
      }
    }

    return violations;
  }

  /**
   * Get options with defaults applied.
   */
  private getOptions(config: LinterConfig): Required<SchemaCollisionOptions> {
    const userOpts = (config.options ?? {}) as SchemaCollisionOptions;
    return {
      ...DEFAULT_OPTIONS,
      ...userOpts,
      ignoreSchemaPatterns: [
        ...DEFAULT_OPTIONS.ignoreSchemaPatterns,
        ...(userOpts.ignoreSchemaPatterns ?? []),
      ],
      ignoreTypePatterns: [
        ...DEFAULT_OPTIONS.ignoreTypePatterns,
        ...(userOpts.ignoreTypePatterns ?? []),
      ],
      allowedFilePatterns: [
        ...DEFAULT_OPTIONS.allowedFilePatterns,
        ...(userOpts.allowedFilePatterns ?? []),
      ],
      variantSuffixes: userOpts.variantSuffixes ?? DEFAULT_OPTIONS.variantSuffixes,
      variantPrefixes: userOpts.variantPrefixes ?? DEFAULT_OPTIONS.variantPrefixes,
    };
  }

  /**
   * Check if a schema should be ignored.
   */
  private shouldIgnoreSchema(
    name: string,
    opts: Required<SchemaCollisionOptions>
  ): boolean {
    return opts.ignoreSchemaPatterns.some((p) => p.test(name));
  }

  /**
   * Check if a type should be ignored.
   */
  private shouldIgnoreType(
    name: string,
    opts: Required<SchemaCollisionOptions>
  ): boolean {
    return opts.ignoreTypePatterns.some((p) => p.test(name));
  }

  /**
   * Check if a file is in the allowed list (e.g., generated files).
   */
  private isAllowedFile(
    path: string,
    opts: Required<SchemaCollisionOptions>
  ): boolean {
    return opts.allowedFilePatterns.some((p) => p.test(path));
  }

  /**
   * Generate variant names for a schema name.
   */
  private generateVariants(
    name: string,
    opts: Required<SchemaCollisionOptions>
  ): string[] {
    const variants: string[] = [name];

    // Add suffix variants: User -> UserType, UserInterface, etc.
    for (const suffix of opts.variantSuffixes) {
      variants.push(`${name}${suffix}`);
    }

    // Add prefix variants: User -> IUser, TUser
    for (const prefix of opts.variantPrefixes) {
      variants.push(`${prefix}${name}`);
    }

    // Add stripped variants: UserSchema -> User (if name ends with variant)
    for (const suffix of opts.variantSuffixes) {
      if (name.endsWith(suffix) && name.length > suffix.length) {
        variants.push(name.slice(0, -suffix.length));
      }
    }

    return variants;
  }

  /**
   * Find all collisions for a type.
   */
  private findCollisions(
    type: TypeInfo,
    schemasByName: Map<string, SchemaInfo>,
    schemasByLowerName: Map<string, SchemaInfo>,
    schemaVariants: Map<string, SchemaInfo>,
    opts: Required<SchemaCollisionOptions>
  ): CollisionInfo[] {
    const collisions: CollisionInfo[] = [];
    const typeName = type.name;
    const typeNameLower = typeName.toLowerCase();

    // Check exact match
    if (opts.checkExactMatch) {
      const exactMatch = schemasByName.get(typeName);
      if (exactMatch) {
        collisions.push({
          schema: exactMatch,
          type,
          matchType: "exact",
        });
        // If we have an exact match, don't report other matches for same schema
        return collisions;
      }
    }

    // Check case-insensitive match
    if (opts.checkCaseInsensitive) {
      const caseMatch = schemasByLowerName.get(typeNameLower);
      if (caseMatch && caseMatch.name !== typeName) {
        collisions.push({
          schema: caseMatch,
          type,
          matchType: "case-insensitive",
        });
        return collisions;
      }
    }

    // Check variant matches
    if (opts.checkVariants) {
      const variantMatch = schemaVariants.get(typeNameLower);
      if (variantMatch) {
        // Determine what kind of variant match this is
        let variantKind = "related name";
        for (const suffix of opts.variantSuffixes) {
          if (typeName.endsWith(suffix)) {
            variantKind = `"${suffix}" suffix`;
            break;
          }
        }
        for (const prefix of opts.variantPrefixes) {
          if (typeName.startsWith(prefix) && typeName.length > prefix.length) {
            const nextChar = typeName[prefix.length];
            // Check that next char is uppercase (e.g., IUser not Iuser)
            if (nextChar && nextChar === nextChar.toUpperCase()) {
              variantKind = `"${prefix}" prefix`;
              break;
            }
          }
        }

        collisions.push({
          schema: variantMatch,
          type,
          matchType: "variant",
          variantKind,
        });
      }
    }

    return collisions;
  }

  /**
   * Convert a collision to a violation.
   */
  private collisionToViolation(
    collision: CollisionInfo,
    config: LinterConfig
  ): Violation {
    const { schema, type, matchType, variantKind } = collision;

    const schemaLocation: SourceLocation = {
      file: schema.file,
      line: 1,
    };

    switch (matchType) {
      case "exact":
        return this.error(
          "exact-name-collision",
          `Type "${type.name}" has the same name as schema "${schema.name}". ` +
            `In a schema-first workflow, types should be generated from schemas, not manually defined.`,
          type.location,
          {
            relatedLocations: [schemaLocation],
            suggestion:
              `Either: (1) Use codegen to generate this type from the schema, ` +
              `(2) Rename the type to avoid confusion, or ` +
              `(3) Delete the manual type if the schema is the source of truth.`,
            context: {
              typeName: type.name,
              schemaName: schema.name,
              schemaFile: schema.file,
              typeFile: type.location.file,
            },
          }
        );

      case "case-insensitive":
        return this.warning(
          "case-insensitive-collision",
          `Type "${type.name}" differs from schema "${schema.name}" only by case. ` +
            `This could cause confusion.`,
          type.location,
          {
            relatedLocations: [schemaLocation],
            suggestion:
              `Consider using consistent naming: either use the schema name exactly ` +
              `(and generate the type) or choose a clearly different name.`,
            context: {
              typeName: type.name,
              schemaName: schema.name,
              schemaFile: schema.file,
            },
          }
        );

      case "variant":
        return this.createViolation(
          {
            code: "variant-name-collision",
            message:
              `Type "${type.name}" appears to be a variant of schema "${schema.name}" ` +
              `(${variantKind ?? "naming pattern"}). This may indicate duplicate definitions.`,
            location: type.location,
            relatedLocations: [schemaLocation],
            suggestion:
              `If this type represents the same data as the schema, consider: ` +
              `(1) Generating the type from the schema, or ` +
              `(2) Using the generated type directly instead of defining a variant.`,
            context: {
              typeName: type.name,
              schemaName: schema.name,
              schemaFile: schema.file,
              variantKind,
            },
          },
          config
        );
    }
  }
}
