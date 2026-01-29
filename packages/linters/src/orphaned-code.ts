/**
 * Viola Orphaned Code Linter
 *
 * Detects exported symbols (functions, types, constants) that are never imported
 * anywhere in the codebase. These "orphaned" exports may be dead code that should
 * be removed, or they may be intentionally public API that needs documentation.
 *
 * This linter builds a full dependency graph of imports/exports to determine
 * which exports are actually used.
 *
 * @module
 */

import {
    BaseLinter,
    type CodebaseData,
    type ExportInfo,
    type ImportInfo,
    type LinterConfig,
    type LinterDataRequirements,
    type LinterMeta,
    type SourceLocation,
    type Violation,
} from "@hiisi/viola";

// =============================================================================
// Configuration
// =============================================================================

/**
 * Options for the orphaned-code linter.
 */
interface OrphanedCodeOptions {
  /**
   * Whether to check functions.
   * @default true
   */
  checkFunctions?: boolean;

  /**
   * Whether to check types/interfaces.
   * @default true
   */
  checkTypes?: boolean;

  /**
   * Whether to check other exports (constants, classes, etc.).
   * @default true
   */
  checkOther?: boolean;

  /**
   * File patterns that are considered entry points.
   * Exports from these files are never considered orphaned.
   * @default [/mod\.ts$/, /index\.ts$/, /main\.ts$/, /cli\.ts$/, /server\.ts$/]
   */
  entryPointPatterns?: RegExp[];

  /**
   * Patterns for export names to ignore.
   * @default []
   */
  ignoreExportPatterns?: RegExp[];

  /**
   * File patterns to exclude from checking.
   * @default [/\.test\.ts$/, /\.spec\.ts$/, /_test\.ts$/, /tests?\//]
   */
  ignoreFilePatterns?: RegExp[];

  /**
   * Whether to treat re-exports as usage.
   * If true, a symbol re-exported from another module counts as "used".
   * @default true
   */
  reexportCountsAsUsage?: boolean;

  /**
   * Packages/scopes that are considered external (not checked).
   * @default [/^@std\//, /^npm:/, /^jsr:/, /^https?:\/\//]
   */
  externalPatterns?: RegExp[];

  /**
   * Whether default exports should be checked.
   * Default exports from entry points are often intentional API.
   * @default false
   */
  checkDefaultExports?: boolean;

  /**
   * Minimum severity for orphaned exports.
   * "info" for soft warnings, "warning" for attention needed, "error" for failures.
   * @default "warning"
   */
  orphanedSeverity?: "error" | "warning" | "info";
}

const DEFAULT_OPTIONS: Required<OrphanedCodeOptions> = {
  checkFunctions: true,
  checkTypes: true,
  checkOther: true,
  entryPointPatterns: [
    /mod\.ts$/,
    /index\.ts$/,
    /main\.ts$/,
    /cli\.ts$/,
    /server\.ts$/,
    /app\.ts$/,
  ],
  ignoreExportPatterns: [],
  ignoreFilePatterns: [/\.test\.ts$/, /\.spec\.ts$/, /_test\.ts$/, /tests?\//],
  reexportCountsAsUsage: true,
  externalPatterns: [/^@std\//, /^npm:/, /^jsr:/, /^https?:\/\//, /^node:/],
  checkDefaultExports: false,
  orphanedSeverity: "warning",
};

// =============================================================================
// Types
// =============================================================================

/**
 * Normalized module path for comparison.
 */
type ModulePath = string;

/**
 * Information about an export with resolved module path.
 */
interface ResolvedExport {
  export: ExportInfo;
  modulePath: ModulePath;
}

/**
 * Information about an import with resolved module path.
 */
interface ResolvedImport {
  import: ImportInfo;
  importerPath: ModulePath;
  resolvedPath: ModulePath | null;
}

// =============================================================================
// Linter Implementation
// =============================================================================

/**
 * Orphaned Code Linter
 *
 * Builds a dependency graph from imports and exports to identify exports
 * that are never consumed. This helps find dead code and unused API surface.
 *
 * ## Algorithm
 *
 * 1. Collect all exports from all files
 * 2. Collect all imports from all files
 * 3. Resolve import paths to actual file paths
 * 4. Mark exports as "used" if they're imported somewhere
 * 5. Report exports that are never used (orphaned)
 *
 * ## Limitations
 *
 * - Cannot track dynamic imports (`import(expr)`)
 * - Cannot track require() calls
 * - Cannot track usage via globalThis or other dynamic access
 * - Re-exports to external consumers (npm publish) are not tracked
 */
export class OrphanedCodeLinter extends BaseLinter {
  readonly meta: LinterMeta = {
    id: "orphaned-code",
    name: "Orphaned Code",
    description: "Detects exported symbols that are never imported",
    defaultSeverity: "warning",
  };

  readonly requirements: LinterDataRequirements = {
    exports: true,
    imports: true,
    files: true,
  };

  lint(data: CodebaseData, config: LinterConfig): Violation[] {
    const violations: Violation[] = [];
    const opts = this.getOptions(config);

    // Build maps of exports and imports
    const allExports = this.collectExports(data, opts);
    const allImports = this.collectImports(data, opts);

    // Build a set of used export keys
    const usedExports = this.findUsedExports(allExports, allImports, data, opts);

    // Find orphaned exports
    for (const resolved of allExports) {
      const exportKey = this.exportKey(resolved);

      if (usedExports.has(exportKey)) {
        continue; // Export is used
      }

      // Check if this export should be reported
      if (!this.shouldReport(resolved, opts)) {
        continue;
      }

      violations.push(this.createOrphanedViolation(resolved, opts));
    }

    return violations;
  }

  /**
   * Get options with defaults applied.
   */
  private getOptions(config: LinterConfig): Required<OrphanedCodeOptions> {
    const userOpts = (config.options ?? {}) as OrphanedCodeOptions;
    return {
      ...DEFAULT_OPTIONS,
      ...userOpts,
      entryPointPatterns: [
        ...DEFAULT_OPTIONS.entryPointPatterns,
        ...(userOpts.entryPointPatterns ?? []),
      ],
      ignoreExportPatterns: [
        ...DEFAULT_OPTIONS.ignoreExportPatterns,
        ...(userOpts.ignoreExportPatterns ?? []),
      ],
      ignoreFilePatterns: [
        ...DEFAULT_OPTIONS.ignoreFilePatterns,
        ...(userOpts.ignoreFilePatterns ?? []),
      ],
      externalPatterns: [
        ...DEFAULT_OPTIONS.externalPatterns,
        ...(userOpts.externalPatterns ?? []),
      ],
    };
  }

  /**
   * Collect all exports from the codebase.
   */
  private collectExports(
    data: CodebaseData,
    opts: Required<OrphanedCodeOptions>
  ): ResolvedExport[] {
    const exports: ResolvedExport[] = [];

    for (const file of data.files) {
      // Skip ignored files
      if (opts.ignoreFilePatterns.some((p) => p.test(file.path))) {
        continue;
      }

      for (const exp of file.exports) {
        // Skip if export kind doesn't match our filters
        if (!this.shouldCheckExport(exp, opts)) {
          continue;
        }

        exports.push({
          export: exp,
          modulePath: this.normalizePath(file.path),
        });
      }
    }

    return exports;
  }

  /**
   * Collect all imports from the codebase.
   */
  private collectImports(
    data: CodebaseData,
    opts: Required<OrphanedCodeOptions>
  ): ResolvedImport[] {
    const imports: ResolvedImport[] = [];

    for (const file of data.files) {
      for (const imp of file.imports) {
        // Skip external imports
        if (this.isExternalImport(imp.from, opts)) {
          continue;
        }

        imports.push({
          import: imp,
          importerPath: this.normalizePath(file.path),
          resolvedPath: this.resolveImportPath(file.path, imp.from, data),
        });
      }
    }

    return imports;
  }

  /**
   * Find all exports that are used (imported somewhere).
   */
  private findUsedExports(
    allExports: ResolvedExport[],
    allImports: ResolvedImport[],
    data: CodebaseData,
    opts: Required<OrphanedCodeOptions>
  ): Set<string> {
    const used = new Set<string>();

    // Build a map from module path to its exports for fast lookup
    const exportsByModule = new Map<string, ResolvedExport[]>();
    for (const exp of allExports) {
      const list = exportsByModule.get(exp.modulePath) ?? [];
      list.push(exp);
      exportsByModule.set(exp.modulePath, list);
    }

    // For each import, mark the corresponding export as used
    for (const imp of allImports) {
      if (!imp.resolvedPath) continue;

      const moduleExports = exportsByModule.get(imp.resolvedPath);
      if (!moduleExports) continue;

      // Find matching export
      for (const exp of moduleExports) {
        if (this.importMatchesExport(imp.import, exp.export)) {
          used.add(this.exportKey(exp));
        }
      }

      // Namespace imports (import * as X) use all exports
      if (imp.import.isNamespace) {
        for (const exp of moduleExports) {
          used.add(this.exportKey(exp));
        }
      }
    }

    // If reexports count as usage, mark them
    if (opts.reexportCountsAsUsage) {
      for (const exp of allExports) {
        if (exp.export.kind === "re-export" && exp.export.from) {
          // This is a re-export - find the original and mark it used
          const fromPath = this.resolveImportPath(
            exp.modulePath,
            exp.export.from,
            data
          );
          if (fromPath) {
            const sourceExports = exportsByModule.get(fromPath);
            if (sourceExports) {
              for (const sourceExp of sourceExports) {
                const sourceName = exp.export.localName ?? exp.export.name;
                if (sourceExp.export.name === sourceName) {
                  used.add(this.exportKey(sourceExp));
                }
              }
            }
          }
        }
      }
    }

    return used;
  }

  /**
   * Check if an export should be checked based on kind.
   */
  private shouldCheckExport(
    exp: ExportInfo,
    opts: Required<OrphanedCodeOptions>
  ): boolean {
    // Skip default exports if not checking them
    if (exp.name === "default" && !opts.checkDefaultExports) {
      return false;
    }

    // Skip re-exports (they're just forwarding)
    if (exp.kind === "re-export") {
      return false;
    }

    // Check by kind
    switch (exp.kind) {
      case "function":
        return opts.checkFunctions;
      case "type":
      case "interface":
        return opts.checkTypes;
      default:
        return opts.checkOther;
    }
  }

  /**
   * Check if an export should be reported as orphaned.
   */
  private shouldReport(
    resolved: ResolvedExport,
    opts: Required<OrphanedCodeOptions>
  ): boolean {
    // Don't report exports from entry points
    if (opts.entryPointPatterns.some((p) => p.test(resolved.modulePath))) {
      return false;
    }

    // Don't report ignored export names
    if (opts.ignoreExportPatterns.some((p) => p.test(resolved.export.name))) {
      return false;
    }

    return true;
  }

  /**
   * Check if an import is from an external source.
   */
  private isExternalImport(
    from: string,
    opts: Required<OrphanedCodeOptions>
  ): boolean {
    return opts.externalPatterns.some((p) => p.test(from));
  }

  /**
   * Check if an import matches an export.
   */
  private importMatchesExport(imp: ImportInfo, exp: ExportInfo): boolean {
    // Default import matches default export
    if (imp.name === "default" && exp.name === "default") {
      return true;
    }

    // Named import matches named export
    // Import can use localName (import { foo as bar }) so we check the original name
    return imp.name === exp.name;
  }

  /**
   * Create a unique key for an export.
   */
  private exportKey(resolved: ResolvedExport): string {
    return `${resolved.modulePath}:${resolved.export.name}`;
  }

  /**
   * Normalize a file path for consistent comparison.
   */
  private normalizePath(path: string): string {
    return path
      .replace(/\\/g, "/")
      .replace(/^\.\//, "")
      .replace(/\/index\.ts$/, "")
      .replace(/\.tsx?$/, "");
  }

  /**
   * Resolve an import path relative to the importer.
   */
  private resolveImportPath(
    importerPath: string,
    importFrom: string,
    data: CodebaseData
  ): string | null {
    // Skip non-relative imports (these should be external)
    if (!importFrom.startsWith("./") && !importFrom.startsWith("../")) {
      // Check if it's a workspace import (might be mapped)
      // For now, try to find a matching file
      const normalized = this.normalizePath(importFrom);
      for (const file of data.files) {
        const filePath = this.normalizePath(file.path);
        if (filePath === normalized || filePath.endsWith(`/${normalized}`)) {
          return filePath;
        }
      }
      return null;
    }

    // Resolve relative path
    const importerDir = importerPath.replace(/\/[^/]+$/, "");
    const segments = importerDir.split("/");
    const importSegments = importFrom.split("/");

    for (const seg of importSegments) {
      if (seg === ".") {
        continue;
      } else if (seg === "..") {
        segments.pop();
      } else {
        segments.push(seg);
      }
    }

    const resolvedBase = segments.join("/");
    const normalized = this.normalizePath(resolvedBase);

    // Try to find the actual file
    for (const file of data.files) {
      const filePath = this.normalizePath(file.path);
      if (
        filePath === normalized ||
        filePath === `${normalized}/index` ||
        filePath === `${normalized}/mod`
      ) {
        return filePath;
      }
    }

    return normalized;
  }

  /**
   * Create a violation for an orphaned export.
   */
  private createOrphanedViolation(
    resolved: ResolvedExport,
    opts: Required<OrphanedCodeOptions>
  ): Violation {
    const { export: exp, modulePath } = resolved;
    const kind = exp.kind === "unknown" ? "export" : exp.kind;

    const location: SourceLocation = exp.location;

    const baseViolation = {
      code: "orphaned-export",
      message:
        `Exported ${kind} "${exp.name}" is never imported anywhere in the codebase. ` +
        `This may be dead code.`,
      location,
      suggestion:
        `Consider: (1) Remove the export if it's unused, ` +
        `(2) Remove the entire symbol if the code is dead, or ` +
        `(3) Add this file/export to entryPointPatterns if it's intentional public API.`,
      context: {
        exportName: exp.name,
        exportKind: kind,
        file: modulePath,
        isTypeOnly: exp.isTypeOnly,
      },
    };

    switch (opts.orphanedSeverity) {
      case "error":
        return this.error(
          baseViolation.code,
          baseViolation.message,
          baseViolation.location,
          {
            suggestion: baseViolation.suggestion,
            context: baseViolation.context,
          }
        );
      case "info":
        return this.info(
          baseViolation.code,
          baseViolation.message,
          baseViolation.location,
          {
            suggestion: baseViolation.suggestion,
            context: baseViolation.context,
          }
        );
      default:
        return this.warning(
          baseViolation.code,
          baseViolation.message,
          baseViolation.location,
          {
            suggestion: baseViolation.suggestion,
            context: baseViolation.context,
          }
        );
    }
  }
}
