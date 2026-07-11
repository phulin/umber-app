use anyhow::{Context, Result, bail};
use std::env;
use std::path::Path;
use umber_bundle_builder::{build_bundle_from_input, load_policy};

fn main() -> Result<()> {
    let arguments = env::args().skip(1).collect::<Vec<_>>();
    if !(2..=3).contains(&arguments.len()) {
        bail!("usage: umber-bundle-builder <texmf-directory> <output-directory> [policy.json]");
    }
    let input = arguments.first().context("missing input directory")?;
    let output = arguments.get(1).context("missing output directory")?;
    let policy = load_policy(arguments.get(2).map(Path::new))?;
    let result = build_bundle_from_input(Path::new(input), Path::new(output), &policy)?;
    println!("digest={}", result.digest);
    println!("files={}", result.file_count);
    println!("objects={}", result.object_count);
    println!("manifest={}", result.manifest_path.display());
    Ok(())
}
