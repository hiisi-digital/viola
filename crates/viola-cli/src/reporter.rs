use colored::*;
use std::fmt::Write;
use viola_core::models::LintResults;

/// Formats the raw lint results into a human-readable console string.
pub fn format_raw_results(results: &LintResults) -> String {
    let mut output = String::new();

    if results.total_issues == 0 {
        writeln!(&mut output, "{}", "All clear.".green()).unwrap();
        writeln!(&mut output).unwrap();
        return output;
    }

    writeln!(&mut output, "Found {} issue(s)", results.total_issues).unwrap();
    writeln!(&mut output).unwrap();

    for result in &results.results {
        if result.issues.is_empty() {
            continue;
        }

        writeln!(&mut output, "{}", "-".repeat(80)).unwrap();
        writeln!(
            &mut output,
            "{} ({} issues)",
            result.linter.bold(),
            result.issues.len()
        )
        .unwrap();
        writeln!(&mut output, "{}", "-".repeat(80)).unwrap();
        writeln!(&mut output).unwrap();

        for issue in &result.issues {
            writeln!(
                &mut output,
                "[{}] {}:{}",
                issue.kind.yellow(),
                issue.location.file,
                issue.location.line
            )
            .unwrap();
            writeln!(&mut output, "    {}", issue.message).unwrap();
            writeln!(&mut output, "    (confidence: {}%)", issue.confidence).unwrap();

            if let Some(suggestion) = &issue.suggestion {
                writeln!(&mut output).unwrap();
                for line in suggestion.lines() {
                    writeln!(&mut output, "    {}", line).unwrap();
                }
            }

            if let Some(related_locations) = &issue.related_locations {
                if !related_locations.is_empty() {
                    writeln!(&mut output).unwrap();
                    writeln!(&mut output, "    Related:").unwrap();

                    let display_count = std::cmp::min(3, related_locations.len());
                    for loc in &related_locations[0..display_count] {
                        writeln!(&mut output, "      - {}:{}", loc.file, loc.line).unwrap();
                    }

                    if related_locations.len() > 3 {
                        writeln!(
                            &mut output,
                            "      ... and {} more",
                            related_locations.len() - 3
                        )
                        .unwrap();
                    }
                }
            }

            writeln!(&mut output).unwrap();
        }
    }

    writeln!(&mut output, "{}", "=".repeat(80)).unwrap();

    if results.has_errors {
        writeln!(
            &mut output,
            "{}",
            "Some linters failed to run.".red().bold()
        )
        .unwrap();
    } else if results.total_issues > 0 {
        writeln!(
            &mut output,
            "{}",
            "Issues found. Review and address as needed.".yellow()
        )
        .unwrap();
    }

    writeln!(&mut output, "{}", "=".repeat(80)).unwrap();
    writeln!(&mut output).unwrap();

    output
}

/// Prints the formatted results directly to the console.
pub fn print_results(results: &LintResults) {
    print!("{}", format_raw_results(results));
}
