//! Reads and writes a workspace folder as plain files.
//!
//! The frontend decides the layout and content; this module only reads managed files and
//! applies a full snapshot: writing changed files and removing stale managed files.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Component, Path, PathBuf};

/// Top-level entries this app owns inside a workspace folder.
const MANAGED: &[&str] = &[
  "tether.json",
  "collections",
  "environments",
  "designs",
  ".tether",
  ".gitignore",
];

fn check_rel(rel: &str) -> Result<PathBuf, String> {
  let p = Path::new(rel);
  let ok = !rel.is_empty()
    && p.components().all(|c| matches!(c, Component::Normal(_)))
    && p
      .components()
      .next()
      .and_then(|c| c.as_os_str().to_str())
      .is_some_and(|first| MANAGED.contains(&first));
  if ok {
    Ok(p.to_path_buf())
  } else {
    Err(format!(
      "Refusing to touch path outside the workspace layout: {rel}"
    ))
  }
}

/// Workspace data is JSON; API designs under `designs/` are OpenAPI documents (YAML or JSON).
fn is_managed_file(path: &Path) -> bool {
  let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
  ext == "json" || ext == "yaml" || ext == "yml"
}

fn collect(root: &Path, dir: &Path, out: &mut BTreeMap<String, String>) -> Result<(), String> {
  for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
    let path = entry.map_err(|e| e.to_string())?.path();
    if path.is_dir() {
      collect(root, &path, out)?;
    } else if is_managed_file(&path) {
      let rel = path
        .strip_prefix(root)
        .unwrap()
        .to_string_lossy()
        .replace('\\', "/");
      out.insert(
        rel,
        fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))?,
      );
    }
  }
  Ok(())
}

/// Returns every managed `.json` file as `relative path → contents`.
pub fn read(root: &Path) -> Result<BTreeMap<String, String>, String> {
  let mut out = BTreeMap::new();
  for name in MANAGED {
    let p = root.join(name);
    if p.is_dir() {
      collect(root, &p, &mut out)?;
    } else if p.is_file() && is_managed_file(&p) {
      out.insert(
        (*name).to_string(),
        fs::read_to_string(&p).map_err(|e| e.to_string())?,
      );
    }
  }
  Ok(out)
}

/// Makes the managed files match `files` exactly. Unchanged files are not rewritten, so
/// timestamps and Git status only change for real edits.
pub fn write(root: &Path, files: &BTreeMap<String, String>) -> Result<(), String> {
  for rel in files.keys() {
    check_rel(rel)?;
  }
  let existing = read(root)?;
  for (rel, contents) in files {
    if existing.get(rel) == Some(contents) {
      continue;
    }
    let path = root.join(rel);
    if let Some(parent) = path.parent() {
      fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    // Write to a temp file and rename, so a crash never leaves a half-written file.
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, contents).map_err(|e| format!("{}: {e}", path.display()))?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
  }
  for rel in existing.keys().filter(|k| !files.contains_key(*k)) {
    let path = root.join(check_rel(rel)?);
    fs::remove_file(&path).map_err(|e| e.to_string())?;
    // Tidy up directories left empty, but never above the managed top-level entry.
    let mut dir = path.parent();
    while let Some(d) = dir {
      if d == root || MANAGED.iter().any(|m| d == root.join(m)) || fs::remove_dir(d).is_err() {
        break;
      }
      dir = d.parent();
    }
  }
  Ok(())
}

#[tauri::command]
pub fn read_workspace(dir: String) -> Result<BTreeMap<String, String>, String> {
  read(Path::new(&dir))
}

#[tauri::command]
pub fn write_workspace(dir: String, files: BTreeMap<String, String>) -> Result<(), String> {
  let root = Path::new(&dir);
  if !root.is_dir() {
    return Err(format!("Workspace folder not found: {dir}"));
  }
  write(root, &files)?;
  ensure_gitignore(root)
}

/// Local-only state (history, active environment) lives in `.tether/`; keep it out of Git.
fn ensure_gitignore(root: &Path) -> Result<(), String> {
  let path = root.join(".gitignore");
  let current = fs::read_to_string(&path).unwrap_or_default();
  if current
    .lines()
    .any(|l| l.trim() == ".tether/" || l.trim() == ".tether")
  {
    return Ok(());
  }
  let sep = if current.is_empty() || current.ends_with('\n') {
    ""
  } else {
    "\n"
  };
  fs::write(
    &path,
    format!("{current}{sep}# Tether local state (history, selected environment)\n.tether/\n"),
  )
  .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
  use super::*;

  fn tmp() -> PathBuf {
    let d = std::env::temp_dir().join(format!(
      "tether-ws-{}-{:?}",
      std::process::id(),
      std::thread::current().id()
    ));
    let _ = fs::remove_dir_all(&d);
    fs::create_dir_all(&d).unwrap();
    d
  }

  fn map(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
    pairs
      .iter()
      .map(|(k, v)| (k.to_string(), v.to_string()))
      .collect()
  }

  #[test]
  fn writes_reads_and_prunes_stale_files() {
    let root = tmp();
    fs::write(root.join("README.md"), "mine").unwrap();
    let a = map(&[
      ("tether.json", "{}"),
      ("collections/api/collection.json", "c"),
      ("collections/api/login.json", "r"),
    ]);
    write(&root, &a).unwrap();
    assert_eq!(read(&root).unwrap(), a);

    let b = map(&[
      ("tether.json", "{}"),
      ("collections/auth/collection.json", "c"),
    ]);
    write(&root, &b).unwrap();
    assert_eq!(read(&root).unwrap(), b);
    assert!(!root.join("collections/api").exists(), "empty dir removed");
    assert!(root.join("collections").exists(), "managed root kept");
    assert_eq!(
      fs::read_to_string(root.join("README.md")).unwrap(),
      "mine",
      "unmanaged files untouched"
    );
    fs::remove_dir_all(root).unwrap();
  }

  #[test]
  fn round_trips_api_designs_as_yaml() {
    let root = tmp();
    let a = map(&[
      ("tether.json", "{}"),
      ("designs/pets.yaml", "openapi: 3.0.3\n"),
      ("designs/old.yml", "x: 1\n"),
    ]);
    write(&root, &a).unwrap();
    assert_eq!(read(&root).unwrap(), a);
    assert!(check_rel("designs/pets.yaml").is_ok());
    let b = map(&[
      ("tether.json", "{}"),
      ("designs/pets.yaml", "openapi: 3.1.0\n"),
    ]);
    write(&root, &b).unwrap();
    assert_eq!(
      read(&root).unwrap(),
      b,
      "stale design removed, edit applied"
    );
    fs::remove_dir_all(root).unwrap();
  }

  #[test]
  fn skips_unchanged_files() {
    let root = tmp();
    let a = map(&[("tether.json", "{}")]);
    write(&root, &a).unwrap();
    let before = fs::metadata(root.join("tether.json"))
      .unwrap()
      .modified()
      .unwrap();
    std::thread::sleep(std::time::Duration::from_millis(20));
    write(&root, &a).unwrap();
    assert_eq!(
      fs::metadata(root.join("tether.json"))
        .unwrap()
        .modified()
        .unwrap(),
      before
    );
    fs::remove_dir_all(root).unwrap();
  }

  #[test]
  fn adds_tether_dir_to_gitignore_once() {
    let root = tmp();
    fs::write(root.join(".gitignore"), "node_modules").unwrap();
    ensure_gitignore(&root).unwrap();
    ensure_gitignore(&root).unwrap();
    let g = fs::read_to_string(root.join(".gitignore")).unwrap();
    assert!(g.starts_with("node_modules\n# Tether"));
    assert_eq!(g.matches(".tether/").count(), 1);
    fs::remove_dir_all(root).unwrap();
  }

  #[test]
  fn rejects_paths_outside_the_layout() {
    for bad in [
      "../x.json",
      "/etc/x.json",
      "src/main.json",
      "collections/../../x.json",
      "",
    ] {
      assert!(check_rel(bad).is_err(), "{bad}");
    }
    assert!(check_rel("collections/a/b.json").is_ok());
  }
}
