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
  body: String,
  size: usize,
  duration_ms: u128,
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
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
  state: tauri::State<'_, InFlight>,
) -> Result<SendResponse, SendError> {
  let (method, url) = parse_target(&req.method, &req.url)?;
  let timeout_ms = req.timeout_ms.unwrap_or(30_000);

  let client = reqwest::Client::builder()
    .timeout(Duration::from_millis(timeout_ms))
    .user_agent("Tether/0.1")
    .build()
    .map_err(|e| SendError::Connection { message: e.to_string() })?;

  let mut builder = client.request(method, url);
  for (k, v) in req.headers.iter().filter(|(k, _)| !k.trim().is_empty()) {
    builder = builder.header(k.trim(), v);
  }
  if let Some(body) = req.body {
    builder = builder.body(body);
  }

  let token = CancellationToken::new();
  state.0.lock().unwrap().insert(req.id.clone(), token.clone());
  let started = Instant::now();

  let work = async {
    let res = builder.send().await?;
    let status = res.status();
    let headers = res
      .headers()
      .iter()
      .map(|(k, v)| (k.to_string(), String::from_utf8_lossy(v.as_bytes()).into_owned()))
      .collect();
    let bytes = res.bytes().await?;
    Ok::<_, reqwest::Error>(SendResponse {
      status: status.as_u16(),
      status_text: status.canonical_reason().unwrap_or("").to_string(),
      headers,
      size: bytes.len(),
      body: String::from_utf8_lossy(&bytes).into_owned(),
      duration_ms: started.elapsed().as_millis(),
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
  let method = reqwest::Method::from_bytes(method.to_uppercase().as_bytes())
    .map_err(|_| SendError::Invalid { message: format!("Unknown method “{method}”") })?;
  let url = reqwest::Url::parse(url).map_err(|e| SendError::Invalid { message: format!("Invalid URL: {e}") })?;
  if !matches!(url.scheme(), "http" | "https") {
    return Err(SendError::Invalid { message: format!("Unsupported scheme “{}”; use http or https", url.scheme()) });
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(InFlight::default())
    .invoke_handler(tauri::generate_handler![send_request, cancel_request])
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
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
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
    assert!(matches!(parse_target("GET", "not a url"), Err(SendError::Invalid { .. })));
    assert!(matches!(parse_target("GET", "file:///etc/hosts"), Err(SendError::Invalid { .. })));
    assert!(matches!(parse_target("BAD METHOD", "https://x.dev"), Err(SendError::Invalid { .. })));
  }

  #[test]
  fn root_cause_returns_innermost_error() {
    #[derive(Debug)]
    struct Outer(std::io::Error);
    impl std::fmt::Display for Outer {
      fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result { write!(f, "outer") }
    }
    impl std::error::Error for Outer {
      fn source(&self) -> Option<&(dyn std::error::Error + 'static)> { Some(&self.0) }
    }
    let e = Outer(std::io::Error::other("connection refused"));
    assert_eq!(root_cause(&e), "connection refused");
  }

  #[test]
  fn errors_serialize_with_kind_tag() {
    let json = serde_json::to_string(&SendError::Timeout { after_ms: 5 }).unwrap();
    assert_eq!(json, r#"{"kind":"timeout","afterMs":5}"#);
  }
}
