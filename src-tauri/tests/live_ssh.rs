//! End-to-end check of the SSH engine against a real OpenSSH server.
//!
//! Skipped unless CQP_TEST_SSH_HOST etc. are set. Point it at a throwaway
//! sshd with a fake `cqp` (CI) or at the university login (manual test):
//!
//!   CQP_TEST_SSH_HOST=127.0.0.1 CQP_TEST_SSH_PORT=2222 CQP_TEST_SSH_USER=me \
//!   CQP_TEST_SSH_PASSWORD=… cargo test --test live_ssh -- --nocapture

use hapax_lib::{corpora, parse, query, ssh, workflow};
use serde_json::json;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tokio_util::sync::CancellationToken;

fn env(k: &str) -> Option<String> {
    std::env::var(k).ok().filter(|v| !v.is_empty())
}

#[tokio::test]
async fn ssh_end_to_end() {
    let (Some(host), Some(user)) = (env("CQP_TEST_SSH_HOST"), env("CQP_TEST_SSH_USER")) else {
        eprintln!("CQP_TEST_SSH_* not set — skipping live SSH test");
        return;
    };
    let port: u16 = env("CQP_TEST_SSH_PORT").and_then(|p| p.parse().ok()).unwrap_or(22);
    let password = env("CQP_TEST_SSH_PASSWORD");

    // Isolated HOME so the test writes its own known_hosts.
    let home = tempfile::tempdir().unwrap();
    std::env::set_var("HOME", home.path());

    let prompts = Arc::new(AtomicUsize::new(0));
    let p2 = prompts.clone();
    let decider: ssh::TrustDecider = Arc::new(move |prompt| {
        eprintln!("host key prompt: {} {} {}", prompt.host, prompt.key_type, prompt.fingerprint);
        p2.fetch_add(1, Ordering::SeqCst);
        Box::pin(async { true })
    });
    let params = ssh::ConnectParams { host: host.clone(), user: user.clone(), port, password: password.clone() };

    // 1st connect: unknown key -> prompt -> learned.
    let s = ssh::SshSession::connect(params.clone(), decider.clone()).await.expect("connect");
    assert_eq!(prompts.load(Ordering::SeqCst), 1);
    let token = CancellationToken::new();

    let health = parse::decode_health(&s.run_worker(&query::health_payload(), &token).await.unwrap()).unwrap();
    eprintln!("health: {health:?}");

    let req = query::SearchRequest {
        query: query::QuerySpec {
            corpus: "BROWN-LEGACY".into(), field: "word".into(), value: "jury".into(), ignore_case: true,
            ..Default::default()
        },
        offset: 0, limit: 5, context: 4, sort: String::new(),
    };
    let payload = query::search_payload(&req, false).unwrap();
    let page = parse::decode_search(&s.run_worker(&payload, &token).await.unwrap(), &payload).unwrap();
    eprintln!("search total={} rows={}", page.total, page.results.len());
    assert!(page.total > 0 && !page.results.is_empty());

    // Sorted page (sort runs on the server before tabulate).
    let mut sorted = req.clone();
    sorted.sort = "right".into();
    let payload = query::search_payload(&sorted, false).unwrap();
    let page = parse::decode_search(&s.run_worker(&payload, &token).await.unwrap(), &payload).unwrap();
    assert!(!page.results.is_empty());

    // Distribution across a structural attribute, with per-value sizes.
    let dreq = query::DistributionRequest { query: req.query.clone(), attribute: "file_id".into() };
    let payload = query::distribution_payload(&dreq).unwrap();
    let dist = parse::decode_distribution(&s.run_worker(&payload, &token).await.unwrap()).unwrap();
    eprintln!("distribution: total={} rows={:?}", dist.total, dist.rows.iter().map(|r| (&r.value, r.hits, r.tokens, r.per_million)).collect::<Vec<_>>());
    assert_eq!(dist.rows.iter().map(|r| r.hits).sum::<u64>(), dist.counted);
    assert!(dist.rows.iter().any(|r| r.tokens > 0 && r.per_million > 0.0));

    let plan = json!({"corpus":"BROWN-LEGACY","steps":[
        {"kind":"search","query":{"field":"word","value":"jury","ignore_case":true}},
        {"kind":"refine","source":1,"field":"pos","value":"NN","mode":"keep","anchor":"match"},
        {"kind":"search","query":{"field":"word","value":"court","ignore_case":true}},
        {"kind":"combine","left":2,"right":3,"method":"union"}]});
    for mode in ["results", "group", "sample"] {
        let wr = workflow::WorkflowRequest {
            plan: plan.clone(), mode: mode.into(), offset: 0, limit: 5, context: 4, seed: Some(7),
            group_field: Some("pos".into()), group_position: Some("first".into()),
        };
        let payload = workflow::workflow_payload(&wr).unwrap();
        let out = parse::decode_workflow(&s.run_worker(&payload, &token).await.unwrap(), &payload).unwrap();
        eprintln!("workflow {mode}: total={} steps={:?}", out.total, out.step_counts.iter().map(|c| c.matches).collect::<Vec<_>>());
    }

    // Corpus discovery: registry listing merged into the live inventory.
    let known: Vec<String> = corpora::bundled().keys().map(|k| k.to_lowercase()).collect();
    let reply = parse::worker_json(&s.run_worker(&json!({"op":"registry","known":known}), &token).await.unwrap()).unwrap();
    let d = corpora::merge_registry(&serde_json::Value::Object(reply));
    eprintln!("discovery: added={:?} missing={:?} changed={:?}", d.added, d.missing, d.changed);
    assert!(d.corpora.values().any(|c| c.available));

    // Validation errors surface as Remote errors, not panics.
    let bad = json!({"op":"bogus"});
    let err = parse::worker_json(&s.run_worker(&bad, &token).await.unwrap()).unwrap_err();
    eprintln!("expected remote error: {err}");

    // Cancellation closes the channel and returns Cancelled.
    let cancel = CancellationToken::new();
    cancel.cancel();
    let r = s.run_worker(&query::health_payload(), &cancel).await;
    assert!(matches!(r, Err(hapax_lib::error::AppError::Cancelled)), "{r:?}");
    s.close().await;

    // 2nd connect: key now known -> no prompt.
    let s2 = ssh::SshSession::connect(params.clone(), decider.clone()).await.expect("reconnect");
    assert_eq!(prompts.load(Ordering::SeqCst), 1);
    s2.close().await;

    // Wrong password -> Auth error.
    if password.is_some() {
        let mut bad = params.clone();
        bad.password = Some("definitely-wrong".into());
        let e = ssh::SshSession::connect(bad, decider.clone()).await.err().expect("must fail");
        eprintln!("expected auth error: {e}");
        assert_eq!(e.kind(), "auth");
    }

    // Tampered known_hosts -> changed-key refusal, prompt NOT shown.
    let kh = home.path().join(".ssh/known_hosts");
    let text = std::fs::read_to_string(&kh).unwrap();
    let forged = "AAAAC3NzaC1lZDI1NTE5AAAAICLAGw5XMP/WfgYV1muu+d5k+9ljugk2Wv8bdzZPyE3n";
    // Keep the host field, swap in a different ed25519 key of the same algorithm.
    let line = text.lines().find(|l| !l.trim().is_empty()).unwrap();
    let host_field = line.split_whitespace().next().unwrap();
    std::fs::write(&kh, format!("{host_field} ssh-ed25519 {forged}\n")).unwrap();
    let e = ssh::SshSession::connect(params, decider).await.err().expect("must refuse changed key");
    eprintln!("expected host-key error: {e}");
    assert_eq!(e.kind(), "host_key");
    assert_eq!(prompts.load(Ordering::SeqCst), 1);
}
