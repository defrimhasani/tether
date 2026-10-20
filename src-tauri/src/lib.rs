mod bridge;
mod mcp;
mod secrets;
mod workspace;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tokio_util::sync::CancellationToken;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendRequest {
  id: String,
  method: String,
  url: String,
  headers: Vec<(String, String)>,
  body: Option<String>,
  timeout_ms: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SendResponse {
  status: u16,
  status_text: String,
  headers: Vec<(String, String)>,
  /// Body bytes, base64-encoded so binary content survives the IPC boundary intact.
  body_base64: String,
  /// Set when only a prefix of the body is inline; the full body is in `body_file`.
  truncated: bool,
  body_file: Option<String>,
  size: usize,
  duration_ms: u128,
}

/// Bodies up to this size travel inline; larger ones are written to disk.
const INLINE_MAX: usize = 20 * 1024 * 1024;
/// How much of an oversized body is still sent inline for display.
const PREVIEW_MAX: usize = 1024 * 1024;

struct Packaged {
  base64: String,
  truncated: bool,
  file: Option<String>,
}

fn package_body(bytes: &[u8], spill_dir: Option<&std::path::Path>, id: &str) -> Packaged {
  use base64::Engine;
  let b64 = |b: &[u8]| base64::engine::general_purpose::STANDARD.encode(b);
  if bytes.len() <= INLINE_MAX {
    return Packaged {
      base64: b64(bytes),
      truncated: false,
      file: None,
    };
  }
  let file = spill_dir.and_then(|dir| {
    std::fs::create_dir_all(dir).ok()?;
    let safe: String = id
      .chars()
      .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
      .take(64)
      .collect();
    let path = dir.join(format!(
      "{}.bin",
      if safe.is_empty() { "response" } else { &safe }
    ));
    std::fs::write(&path, bytes).ok()?;
    Some(path.to_string_lossy().into_owned())
  });
  Packaged {
    base64: b64(&bytes[..PREVIEW_MAX]),
    truncated: true,
    file,
  }
}

#[derive(Debug, Serialize)]
#[serde(
  tag = "kind",
  rename_all = "camelCase",
  rename_all_fields = "camelCase"
)]
enum SendError {
  Cancelled,
  Timeout { after_ms: u64 },
  Connection { message: String },
  Invalid { message: String },
}

#[derive(Default)]
struct InFlight(Mutex<HashMap<String, CancellationToken>>);

#[tauri::command]
async fn send_request(
  req: SendRequest,
  app: tauri::AppHandle,
  state: tauri::State<'_, InFlight>,
) -> Result<SendResponse, SendError> {
  use tauri::Manager;
  let spill_dir = app.path().app_cache_dir().ok().map(|d| d.join("responses"));
  let (method, url) = parse_target(&req.method, &req.url)?;
  let timeout_ms = req.timeout_ms.unwrap_or(30_000);

  let client = reqwest::Client::builder()
    .timeout(Duration::from_millis(timeout_ms))
    .user_agent("Tether/0.1")
    .build()
    .map_err(|e| SendError::Connection {
      message: e.to_string(),
    })?;

  let mut builder = client.request(method, url);
  for (k, v) in req.headers.iter().filter(|(k, _)| !k.trim().is_empty()) {
    builder = builder.header(k.trim(), v);
  }
  if let Some(body) = req.body {
    builder = builder.body(body);
  }

  let token = CancellationToken::new();
  state
    .0
    .lock()
    .unwrap()
    .insert(req.id.clone(), token.clone());
  let started = Instant::now();

  let work = async {
    let res = builder.send().await?;
    let status = res.status();
    let headers = res
      .headers()
      .iter()
      .map(|(k, v)| {
        (
          k.to_string(),
          String::from_utf8_lossy(v.as_bytes()).into_owned(),
        )
      })
      .collect();
    let bytes = res.bytes().await?;
    let duration_ms = started.elapsed().as_millis();
    let body = package_body(&bytes, spill_dir.as_deref(), &req.id);
    Ok::<_, reqwest::Error>(SendResponse {
      status: status.as_u16(),
      status_text: status.canonical_reason().unwrap_or("").to_string(),
      headers,
      body_base64: body.base64,
      truncated: body.truncated,
      body_file: body.file,
      size: bytes.len(),
      duration_ms,
    })
  };

  let result = tokio::select! {
    _ = token.cancelled() => Err(SendError::Cancelled),
    r = work => r.map_err(|e| {
      if e.is_timeout() { SendError::Timeout { after_ms: timeout_ms } }
      else { SendError::Connection { message: root_cause(&e) } }
    }),
  };
  state.0.lock().unwrap().remove(&req.id);
  result
}

fn parse_target(method: &str, url: &str) -> Result<(reqwest::Method, reqwest::Url), SendError> {
  let method = reqwest::Method::from_bytes(method.to_uppercase().as_bytes()).map_err(|_| {
    SendError::Invalid {
      message: format!("Unknown method “{method}”"),
    }
  })?;
  let url = reqwest::Url::parse(url).map_err(|e| SendError::Invalid {
    message: format!("Invalid URL: {e}"),
  })?;
  if !matches!(url.scheme(), "http" | "https") {
    return Err(SendError::Invalid {
      message: format!("Unsupported scheme “{}”; use http or https", url.scheme()),
    });
  }
  Ok((method, url))
}

fn root_cause(e: &dyn std::error::Error) -> String {
  let mut cur = e;
  while let Some(next) = cur.source() {
    cur = next;
  }
  cur.to_string()
}

#[tauri::command]
fn cancel_request(id: String, state: tauri::State<'_, InFlight>) {
  if let Some(t) = state.0.lock().unwrap().remove(&id) {
    t.cancel();
  }
}

/// Runs the stdio MCP bridge (`tether --mcp`) instead of the app.
pub fn run_mcp_bridge() {
  bridge::run();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_dialog::init())
    .manage(InFlight::default())
    .manage(mcp::McpState::default())
    .invoke_handler(tauri::generate_handler![
      send_request,
      cancel_request,
      secrets::load_secrets,
      secrets::save_secrets,
      secrets::delete_secrets,
      workspace::read_workspace,
      workspace::write_workspace,
      mcp::mcp_start,
      mcp::mcp_stop,
      mcp::mcp_status,
      mcp::mcp_respond,
      mcp::agent_autostart
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app, event| {
      if let tauri::RunEvent::Exit = event {
        use tauri::Manager;
        mcp::shutdown(&app.state::<mcp::McpState>());
      }
    });
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn parses_valid_targets() {
    let (m, u) = parse_target("post", "https://example.com/a?b=1").unwrap();
    assert_eq!(m, reqwest::Method::POST);
    assert_eq!(u.path(), "/a");
  }

  #[test]
  fn rejects_invalid_targets() {
    assert!(matches!(
      parse_target("GET", "not a url"),
      Err(SendError::Invalid { .. })
    ));
    assert!(matches!(
      parse_target("GET", "file:///etc/hosts"),
      Err(SendError::Invalid { .. })
    ));
    assert!(matches!(
      parse_target("BAD METHOD", "https://x.dev"),
      Err(SendError::Invalid { .. })
    ));
  }

  #[test]
  fn root_cause_returns_innermost_error() {
    #[derive(Debug)]
    struct Outer(std::io::Error);
    impl std::fmt::Display for Outer {
      fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        write!(f, "outer")
      }
    }
    impl std::error::Error for Outer {
      fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(&self.0)
      }
    }
    let e = Outer(std::io::Error::other("connection refused"));
    assert_eq!(root_cause(&e), "connection refused");
  }

  #[test]
  fn packages_small_bodies_inline_and_exact() {
    use base64::Engine;
    let png = [0x89, b'P', b'N', b'G', 0, 0xff, 0xfe];
    let p = package_body(&png, None, "x");
    assert!(!p.truncated && p.file.is_none());
    assert_eq!(
      base64::engine::general_purpose::STANDARD
        .decode(p.base64)
        .unwrap(),
      png
    );
  }

  #[test]
  fn spills_large_bodies_to_disk() {
    use base64::Engine;
    let dir = std::env::temp_dir().join(format!("tether-spill-{}", std::process::id()));
    let big = vec![7u8; INLINE_MAX + 10];
    let p = package_body(&big, Some(&dir), "../../big");
    assert!(p.truncated);
    assert_eq!(
      base64::engine::general_purpose::STANDARD
        .decode(p.base64)
        .unwrap()
        .len(),
      PREVIEW_MAX
    );
    let file = p.file.expect("spilled");
    assert!(
      std::path::Path::new(&file).starts_with(&dir),
      "id cannot escape the spill dir"
    );
    assert_eq!(std::fs::metadata(&file).unwrap().len() as usize, big.len());
    std::fs::remove_dir_all(dir).unwrap();
  }

  #[test]
  fn errors_serialize_with_kind_tag() {
    let json = serde_json::to_string(&SendError::Timeout { after_ms: 5 }).unwrap();
    assert_eq!(json, r#"{"kind":"timeout","afterMs":5}"#);
  }
}
