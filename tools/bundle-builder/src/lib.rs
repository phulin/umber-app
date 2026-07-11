use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use tempfile::tempdir;
use walkdir::WalkDir;

#[derive(Debug, Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct BundlePolicy {
    pub include_prefixes: Vec<String>,
    pub exclude_prefixes: Vec<String>,
    pub preferred_paths: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ManifestEntry {
    pub hash: String,
    pub size: u64,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub flags: Vec<String>,
}

#[derive(Debug, PartialEq, Eq)]
pub struct BuildResult {
    pub digest: String,
    pub manifest_path: PathBuf,
    pub object_count: usize,
    pub file_count: usize,
}

pub fn build_bundle_from_input(
    input: &Path,
    output: &Path,
    policy: &BundlePolicy,
) -> Result<BuildResult> {
    if input.is_dir() {
        return build_bundle(input, output, policy);
    }
    if !input.is_file() {
        bail!("bundle input does not exist: {}", input.display());
    }

    let listing = Command::new("tar")
        .arg("-tf")
        .arg(input)
        .output()
        .context("list snapshot tarball with system tar")?;
    if !listing.status.success() {
        bail!(
            "tarball listing failed: {}",
            String::from_utf8_lossy(&listing.stderr).trim()
        );
    }
    for entry in String::from_utf8(listing.stdout)
        .context("tar listing is not UTF-8")?
        .lines()
    {
        if Path::new(entry).components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        }) {
            bail!("tarball contains unsafe path: {entry}");
        }
    }

    let extracted = tempdir().context("create tarball extraction directory")?;
    let status = Command::new("tar")
        .arg("-xf")
        .arg(input)
        .arg("-C")
        .arg(extracted.path())
        .status()
        .context("extract snapshot tarball with system tar")?;
    if !status.success() {
        bail!("tarball extraction failed with status {status}");
    }
    let root = collapse_single_directory_root(extracted.path())?;
    build_bundle(&root, output, policy)
}

pub fn build_bundle(input: &Path, output: &Path, policy: &BundlePolicy) -> Result<BuildResult> {
    let selected = select_files(input, policy)?;
    let resolved = resolve_flat_names(input, selected, policy)?;
    let objects = output.join("files");
    fs::create_dir_all(&objects).context("create bundle object directory")?;
    let mut manifest = BTreeMap::<String, ManifestEntry>::new();
    let mut hashes = BTreeSet::new();

    for (name, relative_path) in resolved {
        let bytes = fs::read(input.join(&relative_path))
            .with_context(|| format!("read {}", relative_path.display()))?;
        let hash = sha256(&bytes);
        let object_path = objects.join(&hash);
        if !object_path.exists() {
            fs::write(&object_path, &bytes).with_context(|| format!("write object {hash}"))?;
        }
        hashes.insert(hash.clone());
        manifest.insert(
            name,
            ManifestEntry {
                hash,
                size: bytes.len() as u64,
                flags: flags_for(&relative_path),
            },
        );
    }

    let manifest_bytes = serde_json::to_vec(&manifest).context("serialize bundle manifest")?;
    let digest = sha256(&manifest_bytes);
    let manifest_path = output.join(format!("manifest-{digest}.json"));
    fs::write(&manifest_path, manifest_bytes).context("write bundle manifest")?;

    Ok(BuildResult {
        digest,
        manifest_path,
        object_count: hashes.len(),
        file_count: manifest.len(),
    })
}

pub fn load_policy(path: Option<&Path>) -> Result<BundlePolicy> {
    match path {
        Some(path) => serde_json::from_slice(&fs::read(path).context("read bundle policy")?)
            .context("parse bundle policy"),
        None => Ok(BundlePolicy::default()),
    }
}

fn select_files(input: &Path, policy: &BundlePolicy) -> Result<Vec<PathBuf>> {
    let mut files = Vec::new();
    for entry in WalkDir::new(input).follow_links(false) {
        let entry = entry.context("walk bundle input")?;
        if !entry.file_type().is_file() {
            continue;
        }
        let relative = entry
            .path()
            .strip_prefix(input)
            .context("strip bundle input prefix")?;
        let normalized = normalize(relative);
        let included = policy.include_prefixes.is_empty()
            || policy
                .include_prefixes
                .iter()
                .any(|prefix| normalized.starts_with(prefix));
        let excluded = policy
            .exclude_prefixes
            .iter()
            .any(|prefix| normalized.starts_with(prefix));
        if included && !excluded {
            files.push(relative.to_path_buf());
        }
    }
    files.sort_by_key(|path| normalize(path));
    Ok(files)
}

fn collapse_single_directory_root(root: &Path) -> Result<PathBuf> {
    let mut current = root.to_path_buf();
    loop {
        let entries = fs::read_dir(&current)
            .with_context(|| format!("read extracted directory {}", current.display()))?
            .collect::<std::io::Result<Vec<_>>>()?;
        if entries.len() != 1 || !entries[0].file_type()?.is_dir() {
            return Ok(current);
        }
        current = entries[0].path();
    }
}

fn resolve_flat_names(
    input: &Path,
    files: Vec<PathBuf>,
    policy: &BundlePolicy,
) -> Result<BTreeMap<String, PathBuf>> {
    let mut candidates = BTreeMap::<String, Vec<PathBuf>>::new();
    for path in files {
        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .context("bundle path contains non-UTF-8 file name")?
            .to_owned();
        candidates.entry(name).or_default().push(path);
    }

    let mut resolved = BTreeMap::new();
    for (name, paths) in candidates {
        if paths.len() == 1 {
            resolved.insert(name, paths[0].clone());
            continue;
        }
        let Some(preferred) = policy.preferred_paths.get(&name) else {
            let choices = paths.iter().map(|path| normalize(path)).collect::<Vec<_>>();
            bail!("flat-name conflict for {name}: {}", choices.join(", "));
        };
        let preferred_path = PathBuf::from(preferred);
        if !paths.contains(&preferred_path) || !input.join(&preferred_path).is_file() {
            bail!("preferred path for {name} is not a selected input file: {preferred}");
        }
        resolved.insert(name, preferred_path);
    }
    Ok(resolved)
}

fn flags_for(path: &Path) -> Vec<String> {
    match path.extension().and_then(|extension| extension.to_str()) {
        Some("otf" | "ttf" | "woff" | "woff2") => vec!["font".to_owned()],
        _ => Vec::new(),
    }
}

fn normalize(path: &Path) -> String {
    path.components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

fn sha256(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn builds_reproducibly_and_deduplicates_objects() -> Result<()> {
        let input = tempdir()?;
        fs::create_dir_all(input.path().join("tex/latex/base"))?;
        fs::create_dir_all(input.path().join("fonts"))?;
        fs::write(input.path().join("tex/latex/base/article.cls"), b"same")?;
        fs::write(input.path().join("fonts/default.woff2"), b"same")?;
        let first = tempdir()?;
        let second = tempdir()?;

        let first_result = build_bundle(input.path(), first.path(), &BundlePolicy::default())?;
        let second_result = build_bundle(input.path(), second.path(), &BundlePolicy::default())?;

        assert_eq!(first_result.digest, second_result.digest);
        assert_eq!(first_result.file_count, 2);
        assert_eq!(first_result.object_count, 1);
        assert_eq!(
            fs::read(first_result.manifest_path)?,
            fs::read(second_result.manifest_path)?
        );
        Ok(())
    }

    #[test]
    fn requires_an_explicit_flat_name_conflict_choice() -> Result<()> {
        let input = tempdir()?;
        fs::create_dir_all(input.path().join("one"))?;
        fs::create_dir_all(input.path().join("two"))?;
        fs::write(input.path().join("one/shared.sty"), b"one")?;
        fs::write(input.path().join("two/shared.sty"), b"two")?;
        let output = tempdir()?;

        let error = build_bundle(input.path(), output.path(), &BundlePolicy::default())
            .expect_err("conflict must fail");
        assert!(error.to_string().contains("flat-name conflict"));

        let mut policy = BundlePolicy::default();
        policy
            .preferred_paths
            .insert("shared.sty".to_owned(), "two/shared.sty".to_owned());
        let result = build_bundle(input.path(), output.path(), &policy)?;
        assert_eq!(result.file_count, 1);
        Ok(())
    }

    #[test]
    fn tarball_and_directory_inputs_produce_identical_bundles() -> Result<()> {
        let input = tempdir()?;
        fs::create_dir_all(input.path().join("snapshot/tex"))?;
        fs::write(input.path().join("snapshot/tex/plain.tex"), b"plain")?;
        let archive = input.path().join("snapshot.tar");
        let status = Command::new("tar")
            .arg("-cf")
            .arg(&archive)
            .arg("-C")
            .arg(input.path())
            .arg("snapshot")
            .status()?;
        assert!(status.success());
        let directory_output = tempdir()?;
        let archive_output = tempdir()?;

        let directory = build_bundle_from_input(
            &input.path().join("snapshot"),
            directory_output.path(),
            &BundlePolicy::default(),
        )?;
        let archived =
            build_bundle_from_input(&archive, archive_output.path(), &BundlePolicy::default())?;

        assert_eq!(directory.digest, archived.digest);
        assert_eq!(
            fs::read(directory.manifest_path)?,
            fs::read(archived.manifest_path)?
        );
        Ok(())
    }
}
