//! `tether --mcp`: a stdio MCP server for agent clients that forwards to the running app.
//!
//! MCP clients launch this as a command and speak newline-delimited JSON-RPC on stdin/stdout. Each
//! message is forwarded to the app's local server using the port and token published in `mcp.json`.

use serde_json::{Value, json};
use std::{sync::Arc, time::Duration};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

const NOT_RUNNING: &str = "Tether is not running, or Agent access is switched off. Open Tether, choose Agent access, and turn it on.";

fn error_line(id: &Value, message: &str) -> String {
  json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32000, "message": message } }).to_string()
}

struct Endpoint {
  port: u64,
  token: String,
}

fn read_endpoint() -> Option<Endpoint> {
  let text = std::fs::read_to_string(crate::mcp::config_path()).ok()?;
  let v: Value = serde_json::from_str(&text).ok()?;
  Some(Endpoint {
    port: v.get("port")?.as_u64()?,
    token: v.get("token")?.as_str()?.to_string(),
  })
}

/// Sends one message to the app. Returns the line to print, if any.
async fn forward(
  http: &reqwest::Client,
  line: &str,
  msg: &Value,
  client: Option<&str>,
) -> Option<String> {
  let id = msg.get("id").cloned();
  let fail = |message: &str| id.as_ref().map(|id| error_line(id, message));
  let Some(endpoint) = read_endpoint() else {
    return fail(NOT_RUNNING);
  };
  let mut req = http
    .post(format!("http://127.0.0.1:{}/mcp", endpoint.port))
    .bearer_auth(&endpoint.token)
    .header("content-type", "application/json")
    .body(line.to_string());
  if let Some(name) = client {
    req = req.header("x-tether-client", name);
  }
  match req.send().await {
    Err(_) => fail(NOT_RUNNING),
    Ok(res) if res.status() == 202 => None,
    Ok(res) if res.status() == 401 || res.status() == 403 => {
      fail("Tether rejected the connection. Turn Agent access off and on again.")
    }
    Ok(res) => match res.text().await {
      Ok(body) if !body.trim().is_empty() => Some(body.replace('\n', " ")),
      _ => fail("Tether returned an empty response"),
    },
  }
}

async fn bridge() {
  let (out_tx, mut out_rx) = tokio::sync::mpsc::unbounded_channel::<String>();
  let writer = tokio::spawn(async move {
    let mut out = tokio::io::stdout();
    while let Some(line) = out_rx.recv().await {
      if out.write_all(line.as_bytes()).await.is_err()
        || out.write_all(b"\n").await.is_err()
        || out.flush().await.is_err()
      {
        break;
      }
    }
  });

  let http = reqwest::Client::builder()
    .timeout(Duration::from_secs(200))
    .build()
    .expect("http client");
  let client_name: Arc<std::sync::Mutex<Option<String>>> = Arc::default();
  let mut tasks = tokio::task::JoinSet::new();
  let mut lines = BufReader::new(tokio::io::stdin()).lines();

  while let Ok(Some(line)) = lines.next_line().await {
    if line.trim().is_empty() {
      continue;
    }
    let Ok(msg) = serde_json::from_str::<Value>(&line) else {
      let _ = out_tx.send(json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32700, "message": "Parse error" } }).to_string());
      continue;
    };
    if msg.get("method").and_then(Value::as_str) == Some("initialize") {
      let name = msg
        .pointer("/params/clientInfo/name")
        .and_then(Value::as_str)
        .map(str::to_string);
      *client_name.lock().unwrap() = name;
    }
    let (http, tx, name) = (http.clone(), out_tx.clone(), client_name.clone());
    tasks.spawn(async move {
      let client = name.lock().unwrap().clone();
      if let Some(reply) = forward(&http, &line, &msg, client.as_deref()).await {
        let _ = tx.send(reply);
      }
    });
  }
  // stdin closed: let in-flight calls finish before exiting.
  while tasks.join_next().await.is_some() {}
  drop(out_tx);
  let _ = writer.await;
}

pub fn run() {
  tokio::runtime::Builder::new_current_thread()
    .enable_all()
    .build()
    .expect("runtime")
    .block_on(bridge());
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn error_lines_are_valid_json_rpc() {
    let line = error_line(&json!(7), "boom");
    let v: Value = serde_json::from_str(&line).unwrap();
    assert_eq!(v["id"], 7);
    assert_eq!(v["error"]["message"], "boom");
    assert!(!line.contains('\n'));
  }

  #[tokio::test]
  async fn unreachable_app_returns_an_error_for_requests_and_silence_for_notifications() {
    let http = reqwest::Client::new();
    // No mcp.json for this HOME, so the bridge can't find the app.
    let prev = std::env::var_os("HOME");
    unsafe { std::env::set_var("HOME", std::env::temp_dir().join("tether-no-home")) };
    let req = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" });
    let out = forward(&http, &req.to_string(), &req, None).await.unwrap();
    assert!(out.contains("Agent access is switched off"));
    let note = json!({ "jsonrpc": "2.0", "method": "notifications/initialized" });
    assert!(
      forward(&http, &note.to_string(), &note, None)
        .await
        .is_none()
    );
    if let Some(p) = prev {
      unsafe { std::env::set_var("HOME", p) };
    }
  }
}
