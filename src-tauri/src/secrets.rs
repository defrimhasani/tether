//! Per-environment secrets stored in the OS credential store (macOS Keychain, Windows
//! Credential Manager, or the Secret Service on Linux).
//!
//! Each environment's secrets are kept as one JSON-encoded generic password entry
//! (service `dev.tether.app`, account `env:<id>`), so they never touch workspace files.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const SERVICE: &str = "dev.tether.app";

/// Windows Credential Manager caps a credential at 2560 bytes, so larger values continue in
/// `env:<id>#1`, `env:<id>#2`, … Elsewhere a single entry holds everything.
const CHUNK: usize = if cfg!(windows) { 2560 } else { usize::MAX };

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Secret {
  pub key: String,
  pub value: String,
  pub enabled: bool,
}

fn entry(env_id: &str, part: usize) -> Result<keyring::Entry, String> {
  let account = match part {
    0 => format!("env:{env_id}"),
    n => format!("env:{env_id}#{n}"),
  };
  keyring::Entry::new(SERVICE, &account).map_err(|e| e.to_string())
}

/// Reads parts until one is missing or shorter than a full chunk.
fn read_parts(
  chunk: usize,
  mut get: impl FnMut(usize) -> Result<Option<Vec<u8>>, String>,
) -> Result<Vec<u8>, String> {
  let mut bytes = Vec::new();
  for part in 0.. {
    match get(part)? {
      Some(b) => {
        let full = b.len() >= chunk;
        bytes.extend(b);
        if !full {
          break;
        }
      }
      None => break,
    }
  }
  Ok(bytes)
}

/// Writes `bytes` as parts, then removes parts left over from a longer previous value.
fn write_parts(
  bytes: &[u8],
  chunk: usize,
  mut set: impl FnMut(usize, &[u8]) -> Result<(), String>,
  mut delete: impl FnMut(usize) -> Result<bool, String>,
) -> Result<(), String> {
  let mut written = 0;
  for (part, b) in bytes.chunks(chunk).enumerate() {
    set(part, b)?;
    written = part + 1;
  }
  if chunk < usize::MAX || written == 0 {
    for part in written.. {
      if !delete(part)? {
        break;
      }
    }
  }
  Ok(())
}

fn get_part(env_id: &str, part: usize) -> Result<Option<Vec<u8>>, String> {
  match entry(env_id, part)?.get_secret() {
    Ok(b) => Ok(Some(b)),
    Err(keyring::Error::NoEntry) => Ok(None),
    Err(e) => Err(e.to_string()),
  }
}

fn delete_part(env_id: &str, part: usize) -> Result<bool, String> {
  match entry(env_id, part)?.delete_credential() {
    Ok(()) => Ok(true),
    Err(keyring::Error::NoEntry) => Ok(false),
    Err(e) => Err(e.to_string()),
  }
}

pub fn load(env_id: &str) -> Result<Vec<Secret>, String> {
  let bytes = read_parts(CHUNK, |part| get_part(env_id, part))?;
  if bytes.is_empty() {
    return Ok(vec![]);
  }
  serde_json::from_slice(&bytes).map_err(|e| format!("Corrupt keychain entry for {env_id}: {e}"))
}

pub fn save(env_id: &str, secrets: &[Secret]) -> Result<(), String> {
  let json = if secrets.is_empty() {
    String::new()
  } else {
    serde_json::to_string(secrets).map_err(|e| e.to_string())?
  };
  write_parts(
    json.as_bytes(),
    CHUNK,
    |part, b| {
      entry(env_id, part)?
        .set_secret(b)
        .map_err(|e| e.to_string())
    },
    |part| delete_part(env_id, part),
  )
}

#[tauri::command]
pub fn load_secrets(env_ids: Vec<String>) -> Result<HashMap<String, Vec<Secret>>, String> {
  env_ids
    .into_iter()
    .map(|id| load(&id).map(|s| (id, s)))
    .collect()
}

#[tauri::command]
pub fn save_secrets(env_id: String, secrets: Vec<Secret>) -> Result<(), String> {
  save(&env_id, &secrets)
}

#[tauri::command]
pub fn delete_secrets(env_id: String) -> Result<(), String> {
  save(&env_id, &[])
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::cell::RefCell;

  fn round_trip(store: &RefCell<HashMap<usize, Vec<u8>>>, chunk: usize, value: &[u8]) -> Vec<u8> {
    write_parts(
      value,
      chunk,
      |p, b| {
        store.borrow_mut().insert(p, b.to_vec());
        Ok(())
      },
      |p| Ok(store.borrow_mut().remove(&p).is_some()),
    )
    .unwrap();
    read_parts(chunk, |p| Ok(store.borrow().get(&p).cloned())).unwrap()
  }

  #[test]
  fn splits_long_values_and_clears_leftover_parts() {
    let store = RefCell::new(HashMap::new());
    let long: Vec<u8> = (0..25).collect();
    assert_eq!(round_trip(&store, 10, &long), long);
    assert_eq!(store.borrow().len(), 3);

    // Exact multiple of the chunk size: reading stops at the missing part.
    let even: Vec<u8> = (0..20).collect();
    assert_eq!(round_trip(&store, 10, &even), even);
    assert_eq!(store.borrow().len(), 2);

    assert_eq!(round_trip(&store, 10, b"short"), b"short");
    assert_eq!(store.borrow().len(), 1);

    assert_eq!(round_trip(&store, 10, b""), b"");
    assert!(store.borrow().is_empty());
  }

  #[test]
  fn unchunked_store_uses_one_entry() {
    let store = RefCell::new(HashMap::new());
    let deletes = RefCell::new(0);
    write_parts(
      b"value",
      usize::MAX,
      |p, b| {
        store.borrow_mut().insert(p, b.to_vec());
        Ok(())
      },
      |_| {
        *deletes.borrow_mut() += 1;
        Ok(false)
      },
    )
    .unwrap();
    assert_eq!(store.borrow().len(), 1);
    assert_eq!(*deletes.borrow(), 0, "no extra keychain lookups");
  }

  /// Touches the real credential store, so it only runs on demand: `cargo test -- --ignored`.
  #[test]
  #[ignore]
  fn round_trips_through_keychain() {
    let id = format!("test-{}", std::process::id());
    let s = vec![Secret {
      key: "api_key".into(),
      value: "s3cret".into(),
      enabled: true,
    }];
    save(&id, &s).unwrap();
    assert_eq!(load(&id).unwrap(), s);
    let long = vec![Secret {
      key: "jwt".into(),
      value: "x".repeat(6000),
      enabled: true,
    }];
    save(&id, &long).unwrap();
    assert_eq!(load(&id).unwrap(), long);
    save(&id, &[]).unwrap();
    assert_eq!(load(&id).unwrap(), vec![]);
  }
}
