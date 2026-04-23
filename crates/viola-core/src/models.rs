use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// =============================================================================
// Location Types
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SourceLocation {
    pub file: String,
    pub line: u32,
    pub column: Option<u32>,
    pub end_line: Option<u32>,
    pub end_column: Option<u32>,
}

// =============================================================================
// Function Types
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FunctionParam {
    pub name: String,
    pub r#type: Option<String>,
    pub optional: bool,
    pub rest: bool,
    pub default_value: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FunctionKind {
    Function,
    Method,
    Arrow,
    Constructor,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FunctionInfo {
    pub name: String,
    pub location: SourceLocation,
    pub params: Vec<FunctionParam>,
    pub return_type: Option<String>,
    pub is_async: bool,
    pub is_generator: bool,
    pub is_exported: bool,
    pub is_default_export: bool,
    pub body: String,
    pub normalized_body: String,
    pub body_hash: String,
    pub js_doc: Option<String>,
    pub kind: FunctionKind,
    pub parent: Option<String>,
}

// =============================================================================
// Type/Interface Types
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TypeField {
    pub name: String,
    pub r#type: String,
    pub optional: bool,
    pub readonly: bool,
    pub js_doc: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TypeKind {
    Type,
    Interface,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TypeInfo {
    pub name: String,
    pub location: SourceLocation,
    pub kind: TypeKind,
    pub is_exported: bool,
    pub is_default_export: bool,
    pub fields: Vec<TypeField>,
    pub type_params: Option<Vec<String>>,
    pub extends: Option<Vec<String>>,
    pub body: String,
    pub normalized_body: String,
    pub body_hash: String,
    pub js_doc: Option<String>,
}

// =============================================================================
// String Literal Types
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum QuoteStyle {
    Single,
    Double,
    Backtick,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StringLiteral {
    pub value: String,
    pub location: SourceLocation,
    pub quote_style: QuoteStyle,
    pub is_template: bool,
    pub context: Option<String>,
}

// =============================================================================
// Schema Types
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaInfo {
    pub file: String,
    pub name: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub root_type: Option<String>,
    pub properties: Vec<String>,
    pub required: Vec<String>,
}

// =============================================================================
// Export/Import Types
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ExportKind {
    Function,
    Type,
    Interface,
    Class,
    Const,
    Let,
    Var,
    Enum,
    Namespace,
    #[serde(rename = "re-export")]
    ReExport,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExportInfo {
    pub name: String,
    pub local_name: Option<String>,
    pub location: SourceLocation,
    pub kind: ExportKind,
    pub is_type_only: bool,
    pub from: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImportInfo {
    pub name: String,
    pub local_name: Option<String>,
    pub location: SourceLocation,
    pub from: String,
    pub is_type_only: bool,
    pub is_namespace: bool,
}

// =============================================================================
// File Types
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    pub path: String,
    pub extension: String,
    pub line_count: u32,
    pub content: Option<String>,
    pub functions: Vec<FunctionInfo>,
    pub types: Vec<TypeInfo>,
    pub strings: Vec<StringLiteral>,
    pub exports: Vec<ExportInfo>,
    pub imports: Vec<ImportInfo>,
}

// =============================================================================
// Codebase Types (NAM)
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CodebaseData {
    pub project_root: String,
    pub files: Vec<FileInfo>,
    pub schemas: Vec<SchemaInfo>,
    pub extracted_at: u64,

    pub all_functions: Vec<FunctionInfo>,
    pub all_types: Vec<TypeInfo>,
    pub all_strings: Vec<StringLiteral>,
    pub all_exports: Vec<ExportInfo>,
    pub all_imports: Vec<ImportInfo>,
}

// =============================================================================
// Issue Types
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    pub kind: String,
    pub location: SourceLocation,
    pub message: String,
    pub confidence: u8,
    pub suggestion: Option<String>,
    pub related_locations: Option<Vec<SourceLocation>>,
    pub context: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LinterResult {
    pub linter: String,
    pub issues: Vec<Issue>,
    pub duration_ms: u64,
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LintResults {
    pub results: Vec<LinterResult>,
    pub total_issues: u32,
    pub total_duration_ms: u64,
    pub has_errors: bool,
    pub files_scanned: u32,
}

// =============================================================================
// Configuration Types
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LinterConfig {
    pub enabled: bool,
    pub options: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ViolaConfig {
    pub project_root: String,
    pub include: Vec<String>,
    // Note: TS stores RegExp objects, we represent them as strings in the model
    pub exclude: Vec<String>,
    pub extensions: Vec<String>,
    pub linters: HashMap<String, LinterConfig>,
    pub plugins: Option<Vec<String>>,
    pub report_only: bool,
    pub verbose: bool,
}
