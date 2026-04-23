use crate::models::ViolaConfig;
use anyhow::{Context, Result};
use std::fs;
use std::path::Path;

/// Loads the Viola configuration from a file.
///
/// Supports both `.toml` and `.json` formats, defaulting to TOML.
pub fn load_config<P: AsRef<Path>>(path: P) -> Result<ViolaConfig> {
    let path = path.as_ref();
    let content = fs::read_to_string(path)
        .with_context(|| format!("Failed to read config file at {:?}", path))?;

    let extension = path.extension().and_then(|e| e.to_str()).unwrap_or("toml");

    let config: ViolaConfig = match extension {
        "json" => {
            serde_json::from_str(&content).with_context(|| "Failed to parse config as JSON")?
        }
        _ => toml::from_str(&content).with_context(|| "Failed to parse config as TOML")?,
    };

    Ok(config)
}

/// Attempts to find and load a default configuration file in the current directory.
///
/// Checks for `viola.toml` first, then `viola.json`.
pub fn load_default_config() -> Result<ViolaConfig> {
    let toml_path = Path::new("viola.toml");
    if toml_path.exists() {
        return load_config(toml_path);
    }

    let json_path = Path::new("viola.json");
    if json_path.exists() {
        return load_config(json_path);
    }

    anyhow::bail!("No viola.toml or viola.json found in the current directory. Please specify a config file or create one.");
}
