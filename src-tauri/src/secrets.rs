//! Per-environment secrets stored in the macOS Keychain.
//!
//! Each environment's secrets are kept as one JSON-encoded generic password entry
//! (service `dev.tether.app`, account `env:<id>`), so they never touch workspace files.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const SERVICE: &str = "dev.tether.app";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Secret {
  pub key: String,
  pub value: String,
  pub enabled: bool,
}

fn entry(env_id: &str) -> Result<keyring::Entry, String> {
  keyring::Entry::new(SERVICE, &format!("env:{env_id}")).map_err(|e| e.to_string())
}

pub fn load(env_id: &str) -> Result<Vec<Secret>, String> {
  match entry(env_id)?.get_password() {
    Ok(json) => {
      serde_json::from_str(&json).map_err(|e| format!("Corrupt keychain entry for {env_id}: {e}"))
    }
    Err(keyring::Error::NoEntry) => Ok(vec![]),
    Err(e) => Err(e.to_string()),
  }
}

pub fn save(env_id: &str, secrets: &[Secret]) -> Result<(), String> {
  let e = entry(env_id)?;
  if secrets.is_empty() {
    return match e.delete_credential() {
      Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
      Err(err) => Err(err.to_string()),
    };
  }
  let json = serde_json::to_string(secrets).map_err(|e| e.to_string())?;
  e.set_password(&json).map_err(|e| e.to_string())
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

  /// Touches the real login keychain, so it only runs on demand: `cargo test -- --ignored`.
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
    save(&id, &[]).unwrap();
    assert_eq!(load(&id).unwrap(), vec![]);
  }
}
