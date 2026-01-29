/**
 * Viola Missing Docs Linter
 *
 * Detects exported functions, types, and interfaces that lack JSDoc documentation.
 * Exported items are part of the public API and should be documented.
 *
 * @module
 */

import {
    BaseLinter,
    type CodebaseData,
    type LinterConfig,
    type LinterDataRequirements,
    type LinterMeta,
    type Violation,
} from "@hiisi/viola";

// =============================================================================
// Configuration
// =============================================================================

/**
 * Options for the missing-docs linter.
 */
interface MissingDocsOptions {
  /**
   * Require docs for exported functions.
   * @default true
   */
  requireFunctionDocs?: boolean;

  /**
   * Require docs for exported types/interfaces.
   * @default true
   */
  requireTypeDocs?: boolean;

  /**
   * Minimum function body length (lines) to require docs.
   * Small helper functions may not need docs.
   * @default 1
   */
  minFunctionLines?: number;

  /**
   * Patterns for function names to ignore (e.g., getters, setters).
   * @default []
   */
  ignoreFunctionPatterns?: RegExp[];

  /**
   * Patterns for type names to ignore.
   * @default []
   */
  ignoreTypePatterns?: RegExp[];

  /**
   * File patterns to exclude from checking.
   * @default [/\.test\.ts$/, /\.spec\.ts$/, /_test\.ts$/, /tests?\//]
   */
  ignoreFilePatterns?: RegExp[];

  /**
   * Whether to require @param tags for each parameter.
   * @default false
   */
  requireParamDocs?: boolean;

  /**
   * Whether to require @returns tag for non-void functions.
   * @default false
   */
  requireReturnsDocs?: boolean;
}

const DEFAULT_OPTIONS: Required<MissingDocsOptions> = {
  requireFunctionDocs: true,
  requireTypeDocs: true,
  minFunctionLines: 1,
  ignoreFunctionPatterns: [],
  ignoreTypePatterns: [],
  ignoreFilePatterns: [/\.test\.ts$/, /\.spec\.ts$/, /_test\.ts$/, /tests?\//],
  requireParamDocs: false,
  requireReturnsDocs: false,
};

// =============================================================================
// Linter Implementation
// =============================================================================

/**
 * Missing Docs Linter
 *
 * Finds exported items (functions, types, interfaces) that lack JSDoc documentation.
 * Good documentation is essential for maintainability and developer experience.
 */
export class MissingDocsLinter extends BaseLinter {
  readonly meta: LinterMeta = {
    id: "missing-docs",
    name: "Missing Documentation",
    description: "Detects exported items without JSDoc documentation",
    defaultSeverity: "warning",
  };

  readonly requirements: LinterDataRequirements = {
    functions: true,
    types: true,
    files: true,
  };

  lint(data: CodebaseData, config: LinterConfig): Violation[] {
    const violations: Violation[] = [];
    const opts = this.getOptions(config);

    for (const file of data.files) {
      // Skip ignored files
      if (this.shouldIgnoreFile(file.path, opts)) {
        continue;
      }

      // Check functions
      if (opts.requireFunctionDocs) {
        for (const func of file.functions) {
          // Only check exported functions
          if (!func.isExported) continue;

          // Skip ignored function names
          if (this.shouldIgnoreFunction(func.name, opts)) continue;

          // Skip small functions if configured
          const lineCount = this.countLines(func.body);
          if (lineCount < opts.minFunctionLines) continue;

          // Check for JSDoc
          if (!func.jsDoc || func.jsDoc.trim() === "") {
            violations.push(
              this.warning(
                "missing-function-docs",
                `Exported function "${func.name}" lacks JSDoc documentation.`,
                func.location,
                {
                  suggestion:
                    "Add a JSDoc comment describing what this function does, its parameters, and return value.",
                  context: {
                    functionName: func.name,
                    paramCount: func.params.length,
                    hasReturn: func.returnType && func.returnType !== "void",
                  },
                }
              )
            );
          } else {
            // Check for incomplete docs if required
            const docIssues = this.checkDocCompleteness(func, opts);
            for (const issue of docIssues) {
              violations.push(
                this.info(
                  issue.code,
                  issue.message,
                  func.location,
                  { suggestion: issue.suggestion }
                )
              );
            }
          }
        }
      }

      // Check types
      if (opts.requireTypeDocs) {
        for (const type of file.types) {
          // Only check exported types
          if (!type.isExported) continue;

          // Skip ignored type names
          if (this.shouldIgnoreType(type.name, opts)) continue;

          // Check for JSDoc
          if (!type.jsDoc || type.jsDoc.trim() === "") {
            violations.push(
              this.warning(
                "missing-type-docs",
                `Exported ${type.kind} "${type.name}" lacks JSDoc documentation.`,
                type.location,
                {
                  suggestion:
                    `Add a JSDoc comment describing what this ${type.kind} represents.`,
                  context: {
                    typeName: type.name,
                    kind: type.kind,
                    fieldCount: type.fields.length,
                  },
                }
              )
            );
          }
        }
      }
    }

    return violations;
  }

  /**
   * Get options with defaults applied.
   */
  private getOptions(config: LinterConfig): Required<MissingDocsOptions> {
    const userOpts = (config.options ?? {}) as MissingDocsOptions;
    return {
      ...DEFAULT_OPTIONS,
      ...userOpts,
      // Merge arrays rather than replace
      ignoreFunctionPatterns: [
        ...DEFAULT_OPTIONS.ignoreFunctionPatterns,
        ...(userOpts.ignoreFunctionPatterns ?? []),
      ],
      ignoreTypePatterns: [
        ...DEFAULT_OPTIONS.ignoreTypePatterns,
        ...(userOpts.ignoreTypePatterns ?? []),
      ],
      ignoreFilePatterns: [
        ...DEFAULT_OPTIONS.ignoreFilePatterns,
        ...(userOpts.ignoreFilePatterns ?? []),
      ],
    };
  }

  /**
   * Check if a file should be ignored.
   */
  private shouldIgnoreFile(
    path: string,
    opts: Required<MissingDocsOptions>
  ): boolean {
    return opts.ignoreFilePatterns.some((pattern) => pattern.test(path));
  }

  /**
   * Check if a function should be ignored.
   */
  private shouldIgnoreFunction(
    name: string,
    opts: Required<MissingDocsOptions>
  ): boolean {
    if (!name) return true; // Anonymous functions
    return opts.ignoreFunctionPatterns.some((pattern) => pattern.test(name));
  }

  /**
   * Check if a type should be ignored.
   */
  private shouldIgnoreType(
    name: string,
    opts: Required<MissingDocsOptions>
  ): boolean {
    return opts.ignoreTypePatterns.some((pattern) => pattern.test(name));
  }

  /**
   * Count lines in a code block.
   */
  private countLines(code: string): number {
    return code.split("\n").length;
  }

  /**
   * Check if JSDoc is complete (has @param for all params, @returns if needed).
   */
  private checkDocCompleteness(
    func: { 
      name: string; 
      jsDoc?: string; 
      params: readonly { name: string }[];
      returnType?: string;
    },
    opts: Required<MissingDocsOptions>
  ): Array<{ code: string; message: string; suggestion: string }> {
    const issues: Array<{ code: string; message: string; suggestion: string }> = [];
    const jsDoc = func.jsDoc ?? "";

    // Check @param tags
    if (opts.requireParamDocs && func.params.length > 0) {
      for (const param of func.params) {
        const paramPattern = new RegExp(`@param\\s+(?:\\{[^}]+\\}\\s+)?${param.name}\\b`);
        if (!paramPattern.test(jsDoc)) {
          issues.push({
            code: "missing-param-doc",
            message: `Function "${func.name}" is missing @param documentation for "${param.name}".`,
            suggestion: `Add @param ${param.name} - description`,
          });
        }
      }
    }

    // Check @returns tag
    if (opts.requireReturnsDocs) {
      const hasReturn = func.returnType && 
                       func.returnType !== "void" && 
                       func.returnType !== "Promise<void>";
      const hasReturnsTag = /@returns?\b/.test(jsDoc);
      
      if (hasReturn && !hasReturnsTag) {
        issues.push({
          code: "missing-returns-doc",
          message: `Function "${func.name}" is missing @returns documentation.`,
          suggestion: "Add @returns description of the return value",
        });
      }
    }

    return issues;
  }
}
