/**
 * Type Location Linter
 *
 * Enforces that all type/interface declarations are in proper locations:
 * - packages/types/ (shared types)
 * - Any types/ subdirectory
 * - Files named types.ts or *.types.ts
 *
 * Also enforces that logic in types packages uses special file naming:
 * - *.constants.ts, *.helpers.ts, *.factory.ts, etc.
 *
 * @module
 */

import {
    BaseLinter,
    type CodebaseData,
    type LinterConfig,
    type LinterDataRequirements,
    type LinterMeta,
    type Violation
} from "@hiisi/viola";

// =============================================================================
// Configuration
// =============================================================================

/**
 * Packages that are ONLY for types. These can have type definitions anywhere,
 * but MUST NOT have any logic EXCEPT in specially-named files.
 */
const TYPES_ONLY_PACKAGES = ["packages/types"];

/**
 * Files that are allowed to have type definitions even though they're not
 * in a types-only package.
 */
const ALLOWED_TYPE_FILES = [
  "packages/plugin-api/src/types.ts",
  "packages/plugin/src/types.ts",
];

/**
 * File name patterns that ALLOW logic in types-only packages.
 */
const LOGIC_ALLOWED_PATTERNS = [
  /\.ctor\.ts$/,
  /\.builder\.ts$/,
  /\.factory\.ts$/,
  /\.defaults\.ts$/,
  /\.helpers\.ts$/,
  /\.guards\.ts$/,
  /\.validators\.ts$/,
  /\.constants\.ts$/,
  /\.utils\.ts$/,
];

/**
 * Directory patterns that are considered "types locations".
 */
const TYPES_DIRECTORY_PATTERNS = [
  /\/types\//,
  /\/types$/,
];

/**
 * Patterns that indicate logic (functions, classes, runtime values).
 */
const _LOGIC_PATTERNS = [
  { pattern: /^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)/, type: "function" },
  { pattern: /^\s*(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::\s*[^=]+)?\s*=>/, type: "arrow" },
  { pattern: /^\s*(?:export\s+)?class\s+(\w+)/, type: "class" },
  { pattern: /^\s*(?:export\s+)?const\s+(\w+)\s*(?::\s*[^=]+)?\s*=\s*[\[{]/, type: "const-object" },
  { pattern: /^\s*(?:export\s+)?const\s+(\w+)\s*=\s*\w+\s*\(/, type: "const-call" },
];

/**
 * Patterns that are allowed in types files (not logic).
 */
const _ALLOWED_IN_TYPES = [
  /^\s*export\s+type\s/,
  /^\s*import\s/,
  /^\s*\/\//,
  /^\s*\/\*/,
  /^\s*\*/,
  /^\s*$/,
  /^\s*(?:export\s+)?interface\s/,
  /^\s*(?:export\s+)?type\s+\w+/,
  /^\s*export\s*\{/,
  /^\s*export\s+\*/,
  /^\s*[}\]];?\s*$/,
  /^\s*\w+\s*[?:]?\s*:/,
  /^\s*\[[^\]]+\]\s*:/,
  /^\s*</,
  /^\s*>/,
  /^\s*\|/,
  /^\s*&/,
  /^\s*["'`]/,
  /^\s*readonly\s/,
  /^\s*\{\s*$/,
];

// =============================================================================
// Type Location Linter
// =============================================================================

/**
 * Linter that enforces type location rules.
 */
export class TypeLocationLinter extends BaseLinter {
  readonly meta: LinterMeta = {
    id: "type-location",
    name: "Type Location",
    description:
      "Enforces that types are in types/ directories and logic is not in types packages",
    defaultSeverity: "error",
    docsUrl: "docs/PRINCIPLES.md",
  };

  readonly requirements: LinterDataRequirements = {
    types: true,
    files: true,
  };

  lint(data: CodebaseData, _config: LinterConfig): Violation[] {
    const violations: Violation[] = [];

    for (const file of data.files) {
      const inTypesPackage = this.isTypesOnlyPackage(file.path);
      const isAllowedTypeFile = this.isAllowedTypeFile(file.path);
      const isLogicAllowed = this.isLogicAllowedFile(file.path);

      if (inTypesPackage && !isLogicAllowed) {
        // Check for logic in types package
        violations.push(...this.checkLogicInTypesFile(file, data));
      } else if (!inTypesPackage && !isAllowedTypeFile) {
        // Check for types outside types package
        violations.push(...this.checkTypesOutsideTypesPackage(file));
      }
    }

    return violations;
  }

  /**
   * Check if a file is in a types-only package.
   */
  private isTypesOnlyPackage(filePath: string): boolean {
    return TYPES_ONLY_PACKAGES.some((pkg) => filePath.startsWith(pkg));
  }

  /**
   * Check if a file is allowed to have type definitions.
   */
  private isAllowedTypeFile(filePath: string): boolean {
    // Explicit allowlist
    if (ALLOWED_TYPE_FILES.some((allowed) => filePath === allowed)) {
      return true;
    }

    // In a types/ directory
    if (TYPES_DIRECTORY_PATTERNS.some((pattern) => pattern.test(filePath))) {
      return true;
    }

    // Named types.ts or *.types.ts
    const fileName = filePath.split("/").pop() || "";
    if (fileName === "types.ts" || fileName.endsWith(".types.ts")) {
      return true;
    }

    return false;
  }

  /**
   * Check if a file is allowed to have logic (in types package).
   */
  private isLogicAllowedFile(filePath: string): boolean {
    const fileName = filePath.split("/").pop() || "";
    return LOGIC_ALLOWED_PATTERNS.some((pattern) => pattern.test(fileName));
  }

  /**
   * Check for type declarations outside types package.
   */
  private checkTypesOutsideTypesPackage(
    file: { path: string; types: readonly { name: string; location: { line: number } }[] }
  ): Violation[] {
    const violations: Violation[] = [];

    for (const type of file.types) {
      violations.push(
        this.error(
          "type-outside-types",
          `Type/interface "${type.name}" declared outside types package. ` +
            `Move to packages/types/ or a local types/ directory.`,
          { file: file.path, line: type.location.line },
          {
            suggestion:
              "1. Move to packages/types/ (if shared)\n" +
              "2. Create a local types/ directory (if package-local)\n" +
              "3. Rename file to types.ts or *.types.ts",
          }
        )
      );
    }

    return violations;
  }

  /**
   * Check for logic in a types-only file.
   * This requires reading the actual file content to check line by line.
   */
  private checkLogicInTypesFile(
    file: { path: string; functions: readonly { name: string; location: { line: number } }[] },
    _data: CodebaseData
  ): Violation[] {
    const violations: Violation[] = [];

    // Functions in types files are definitely logic
    for (const func of file.functions) {
      violations.push(
        this.error(
          "logic-in-types",
          `Function "${func.name}" found in types package. ` +
            `Move to a specially-named file (*.helpers.ts, *.factory.ts, etc.)`,
          { file: file.path, line: func.location.line },
          {
            suggestion:
              "Move to one of:\n" +
              "  - *.helpers.ts (helper functions)\n" +
              "  - *.factory.ts (factory functions)\n" +
              "  - *.constants.ts (constants)\n" +
              "  - *.guards.ts (type guards)\n" +
              "  - *.validators.ts (validation)\n" +
              "  - *.defaults.ts (default values)",
          }
        )
      );
    }

    return violations;
  }
}

/**
 * Default instance for registration.
 */
export const typeLocationLinter: TypeLocationLinter = new TypeLocationLinter();
