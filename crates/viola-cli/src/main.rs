mod reporter;

use anyhow::{Context, Result};
use clap::Parser;
use colored::*;
use std::time::Instant;
use viola_core::PluginLoader;
use viola_core::config::load_default_config;
use viola_core::crawler::{Crawler, GrammarRegistry};
use viola_core::models::LintResults;

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    /// Verbose output
    #[arg(short, long)]
    verbose: bool,

    /// Path to config file (overrides default discovery)
    #[arg(short, long)]
    config: Option<String>,
}

fn main() -> Result<()> {
    let args = Args::parse();

    let start_time = Instant::now();

    // 1. Load Configuration
    let config = match args.config {
        Some(ref path) => {
            if args.verbose {
                println!("Loading config from: {}", path);
            }
            viola_core::config::load_config(path)
                .with_context(|| "Failed to load specified config file")?
        }
        None => {
            if args.verbose {
                println!("Discovering default config...");
            }
            load_default_config().with_context(|| "Failed to load default config")?
        }
    };

    if args.verbose {
        println!("Configuration loaded successfully.");
    }

    // 2. Load Plugins
    let mut plugin_loader = PluginLoader::new();
    for plugin_path in &config.plugins {
        if args.verbose {
            println!("Loading plugin: {}", plugin_path);
        }
        if let Err(e) = plugin_loader.load_plugin(plugin_path) {
            eprintln!(
                "{} Failed to load plugin {}: {}",
                "Warning:".yellow(),
                plugin_path,
                e
            );
        }
    }

    let loaded_plugins = plugin_loader.loaded_plugins();
    if args.verbose && !loaded_plugins.is_empty() {
        println!("Loaded {} plugin(s)", loaded_plugins.len());
    }

    // 3. Setup Grammar Registry
    let grammar_registry = GrammarRegistry::new();

    // 4. Crawl Codebase
    if args.verbose {
        println!("Crawling codebase...");
    }

    let crawler = Crawler::new(config, grammar_registry);
    let codebase_data = crawler
        .crawl()
        .with_context(|| "Failed to crawl codebase")?;

    if args.verbose {
        println!("Crawled {} files", codebase_data.files.len());
        println!(
            "Found {} functions",
            codebase_data
                .files
                .iter()
                .map(|f| f.functions.len())
                .sum::<usize>()
        );
        println!(
            "Found {} types",
            codebase_data
                .files
                .iter()
                .map(|f| f.types.len())
                .sum::<usize>()
        );
        println!(
            "Found {} strings",
            codebase_data
                .files
                .iter()
                .map(|f| f.strings.len())
                .sum::<usize>()
        );
        println!();
    }

    // 5. Execute Pipeline (Run Lints)
    if args.verbose {
        println!("Running plugins and lints...");
    }

    if let Err(e) = plugin_loader.run_pipeline() {
        eprintln!("{} Pipeline execution error: {}", "Error:".red(), e);
    }

    // Mock results for now until execution pipeline returns actual LintResults
    let results = LintResults {
        results: vec![],
        total_issues: 0,
        total_duration_ms: start_time.elapsed().as_millis() as u64,
        has_errors: false,
        files_scanned: codebase_data.files.len() as u32,
    };

    // 6. Report Results
    reporter::print_results(&results);

    if results.has_errors {
        std::process::exit(1);
    }

    Ok(())
}
