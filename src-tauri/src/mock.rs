//! Local mock server for API designs.
//!
//! The frontend turns an OpenAPI design into a list of routes (method, path pattern, status,
//! headers, body); this module serves them on 127.0.0.1. Browsers may call it from any origin so a
//! front end can be built before the real API exists. Every request is reported to the UI.

use axum::{
  Router,
  body::Body,
  extract::State,
  http::{HeaderName, HeaderValue, Method, Request, StatusCode},
  response::Response,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{sync::Arc, sync::Mutex, time::Duration};
use tauri::{AppHandle, Emitter, State as TauriState};
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MockRoute {
  pub method: String,
  pub pattern: String,
  pub status: u16,
  #[serde(default)]
  pub headers: Vec<(String, String)>,
  #[serde(default)]
  pub body: String,
  #[serde(default)]
  pub delay_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
struct Hit {
  method: String,
  path: String,
  status: u16,
  matched: Option<String>,
}

struct Running {
  cancel: CancellationToken,
  port: u16,
}

#[derive(Default)]
pub struct MockState(Mutex<Option<Running>>);

fn segments(path: &str) -> Vec<&str> {
  path.split('/').filter(|s| !s.is_empty()).collect()
}

/// How many fixed (non-`{param}`) segments a pattern has; more means more specific.
fn specificity(pattern: &str) -> usize {
  segments(pattern)
    .iter()
    .filter(|s| !(s.starts_with('{') && s.ends_with('}')))
    .count()
}

fn pattern_matches(pattern: &str, path: &str) -> bool {
  let (p, a) = (segments(pattern), segments(path));
  p.len() == a.len()
    && p
      .iter()
      .zip(&a)
      .all(|(p, a)| (p.starts_with('{') && p.ends_with('}')) || p == a)
}

/// The most specific route for this method and path. HEAD falls back to GET.
fn find_route<'a>(routes: &'a [MockRoute], method: &str, path: &str) -> Option<&'a MockRoute> {
  let wanted = if method == "HEAD" { "GET" } else { method };
  routes
    .iter()
    .filter(|r| r.method.eq_ignore_ascii_case(wanted) && pattern_matches(&r.pattern, path))
    .max_by_key(|r| specificity(&r.pattern))
}

fn cors(mut res: Response) -> Response {
  let h = res.headers_mut();
  for (k, v) in [
    ("access-control-allow-origin", "*"),
    (
      "access-control-allow-methods",
      "GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS",
    ),
    ("access-control-allow-headers", "*"),
    ("access-control-expose-headers", "*"),
  ] {
    h.insert(HeaderName::from_static(k), HeaderValue::from_static(v));
  }
  res
}

struct Server {
  routes: Vec<MockRoute>,
  app: Option<AppHandle>,
}

async fn handle(State(srv): State<Arc<Server>>, req: Request<Body>) -> Response {
  let method = req.method().clone();
  let path = req.uri().path().to_string();
  let full = req
    .uri()
    .path_and_query()
    .map(|p| p.to_string())
    .unwrap_or_default();
  drop(req);
  let report = |status: u16, matched: Option<String>| {
    if let Some(app) = &srv.app {
      let _ = app.emit(
        "mock-hit",
        Hit {
          method: method.to_string(),
          path: full.clone(),
          status,
          matched,
        },
      );
    }
  };

  if method == Method::OPTIONS {
    report(204, None);
    return cors(Response::builder().status(204).body(Body::empty()).unwrap());
  }

  match find_route(&srv.routes, method.as_str(), &path) {
    Some(route) => {
      if route.delay_ms > 0 {
        tokio::time::sleep(Duration::from_millis(route.delay_ms.min(10_000))).await;
      }
      let status = StatusCode::from_u16(route.status).unwrap_or(StatusCode::OK);
      let mut b = Response::builder().status(status);
      for (k, v) in &route.headers {
        if let (Ok(k), Ok(v)) = (
          HeaderName::try_from(k.as_str()),
          HeaderValue::try_from(v.as_str()),
        ) {
          b = b.header(k, v);
        }
      }
      let body = if method == Method::HEAD || status == StatusCode::NO_CONTENT {
        Body::empty()
      } else {
        Body::from(route.body.clone())
      };
      report(route.status, Some(route.pattern.clone()));
      cors(b.body(body).unwrap())
    }
    None => {
      let available: Vec<String> = srv
        .routes
        .iter()
        .map(|r| format!("{} {}", r.method.to_uppercase(), r.pattern))
        .collect();
      report(404, None);
      cors(
        Response::builder()
          .status(404)
          .header("content-type", "application/json")
          .body(Body::from(
            json!({ "error": "No mock route matches this request", "method": method.as_str(), "path": path, "available": available }).to_string(),
          ))
          .unwrap(),
      )
    }
  }
}

fn router(srv: Arc<Server>) -> Router {
  Router::new().fallback(handle).with_state(srv)
}

async fn serve_on(listener: tokio::net::TcpListener, srv: Arc<Server>, cancel: CancellationToken) {
  let _ = axum::serve(listener, router(srv))
    .with_graceful_shutdown(cancel.cancelled_owned())
    .await;
}

fn stop_inner(state: &MockState) {
  if let Some(r) = state.0.lock().unwrap().take() {
    r.cancel.cancel();
  }
}

/// Starts (or replaces) the mock server. Port 0 picks a free one. Returns the port in use.
#[tauri::command]
pub async fn mock_start(
  app: AppHandle,
  state: TauriState<'_, MockState>,
  routes: Vec<MockRoute>,
  port: u16,
) -> Result<u16, String> {
  stop_inner(&state);
  // The previous listener closes asynchronously after cancel; give it a moment to release the port.
  let mut attempt = 0;
  let listener = loop {
    match tokio::net::TcpListener::bind(("127.0.0.1", port)).await {
      Ok(l) => break l,
      Err(e) if attempt < 10 && port != 0 && e.kind() == std::io::ErrorKind::AddrInUse => {
        attempt += 1;
        tokio::time::sleep(Duration::from_millis(60)).await;
      }
      Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => {
        return Err(format!("Port {port} is already in use. Pick another port."));
      }
      Err(e) => return Err(e.to_string()),
    }
  };
  let port = listener.local_addr().map_err(|e| e.to_string())?.port();
  let cancel = CancellationToken::new();
  tokio::spawn(serve_on(
    listener,
    Arc::new(Server {
      routes,
      app: Some(app),
    }),
    cancel.clone(),
  ));
  *state.0.lock().unwrap() = Some(Running { cancel, port });
  Ok(port)
}

#[tauri::command]
pub fn mock_stop(state: TauriState<'_, MockState>) {
  stop_inner(&state);
}

#[tauri::command]
pub fn mock_status(state: TauriState<'_, MockState>) -> Option<u16> {
  state.0.lock().unwrap().as_ref().map(|r| r.port)
}

pub fn shutdown(state: &MockState) {
  stop_inner(state);
}

#[cfg(test)]
mod tests {
  use super::*;

  fn route(method: &str, pattern: &str, status: u16, body: &str) -> MockRoute {
    MockRoute {
      method: method.into(),
      pattern: pattern.into(),
      status,
      headers: vec![("content-type".into(), "application/json".into())],
      body: body.into(),
      delay_ms: 0,
    }
  }

  #[test]
  fn matches_parameters_and_ignores_slashes() {
    assert!(pattern_matches("/pets/{id}", "/pets/42"));
    assert!(pattern_matches("/pets/{id}", "/pets/42/"));
    assert!(!pattern_matches("/pets/{id}", "/pets"));
    assert!(!pattern_matches("/pets/{id}", "/pets/42/toys"));
    assert!(pattern_matches("/", "/"));
  }

  #[test]
  fn prefers_the_most_specific_route_and_serves_head_from_get() {
    let routes = vec![
      route("GET", "/pets/{id}", 200, "any"),
      route("GET", "/pets/mine", 200, "mine"),
      route("POST", "/pets", 201, ""),
    ];
    assert_eq!(
      find_route(&routes, "GET", "/pets/mine").unwrap().body,
      "mine"
    );
    assert_eq!(find_route(&routes, "GET", "/pets/7").unwrap().body, "any");
    assert!(find_route(&routes, "HEAD", "/pets/7").is_some());
    assert!(find_route(&routes, "DELETE", "/pets/7").is_none());
  }

  #[tokio::test]
  async fn serves_routes_with_cors_and_reports_misses() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let cancel = CancellationToken::new();
    let routes = vec![
      route("GET", "/pets/{id}", 200, r#"{"id":1}"#),
      route("DELETE", "/pets/{id}", 204, "ignored"),
    ];
    tokio::spawn(serve_on(
      listener,
      Arc::new(Server { routes, app: None }),
      cancel.clone(),
    ));
    let http = reqwest::Client::new();
    let base = format!("http://127.0.0.1:{port}");

    let ok = http.get(format!("{base}/pets/9")).send().await.unwrap();
    assert_eq!(ok.status(), 200);
    assert_eq!(ok.headers()["access-control-allow-origin"], "*");
    assert_eq!(ok.headers()["content-type"], "application/json");
    assert_eq!(ok.text().await.unwrap(), r#"{"id":1}"#);

    let gone = http.delete(format!("{base}/pets/9")).send().await.unwrap();
    assert_eq!(gone.status(), 204);
    assert_eq!(gone.text().await.unwrap(), "");

    let pre = http
      .request(reqwest::Method::OPTIONS, format!("{base}/pets/9"))
      .send()
      .await
      .unwrap();
    assert_eq!(pre.status(), 204);
    assert!(pre.headers().contains_key("access-control-allow-methods"));

    let miss = http.get(format!("{base}/nope")).send().await.unwrap();
    assert_eq!(miss.status(), 404);
    let v: serde_json::Value = miss.json().await.unwrap();
    assert_eq!(v["available"][0], "GET /pets/{id}");
    cancel.cancel();
  }
}
