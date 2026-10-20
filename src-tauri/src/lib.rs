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

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
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
  let method = reqwest::Method::from_bytes(req.method.to_uppercase().as_bytes())
    .map_err(|_| SendError::Invalid { message: format!("Unknown method “{}”", req.method) })?;
  let url = reqwest::Url::parse(&req.url)
    .map_err(|e| SendError::Invalid { message: format!("Invalid URL: {e}") })?;
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
