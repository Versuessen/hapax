//! Hapax — Tauri 2 backend: SSH engine, query compiler and IPC bridge.
//!
//! Module map (Python origin in brackets):
//! - `corpora`   verified corpus inventory            [corpora.json, cqp_core.CORPORA]
//! - `query`     structured query validation/CQP     [cqp_core.build_query & co.]
//! - `workflow`  multi-step plans, explanations       [workflow_core.py]
//! - `parse`     worker output parsing                [cqp_core.parse_* / decode_*]
//! - `guide`     annotation codebook, guided recipes  [linguistics_guide.py, learning_ui.py]
//! - `ssh`       russh transport + host-key trust     [cqp_core.SSHConnection]
//! - `storage`   preferences.json + OS vault          [cqp_core.load/save_prefs, keyring]
//! - `export`    CSV/TSV/JSON, provenance, notebooks  [cqp_explorer.py, evidence_ui.py]
//! - `engine`    state, busy flag, cancel, cache      [cqp_explorer._submit/_cached_run]
//! - `commands`  the #[tauri::command] surface

pub mod commands;
pub mod console;
pub mod corpora;
pub mod engine;
pub mod error;
pub mod export;
pub mod guide;
pub mod parse;
pub mod query;
pub mod ssh;
pub mod storage;
pub mod terminal;
pub mod workflow;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(engine::AppState::default())
        .setup(|app| {
            app.state::<engine::AppState>().console.attach(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // inventory & preferences
            commands::get_app_info,
            commands::get_corpus,
            commands::get_preferences,
            commands::save_preferences,
            commands::save_search,
            commands::delete_saved_search,
            // SSH lifecycle
            commands::ssh_connect,
            commands::ssh_disconnect,
            commands::ssh_status,
            commands::answer_host_key,
            commands::cancel_request,
            commands::has_saved_password,
            commands::forget_password,
            // local query helpers
            commands::preview_query,
            commands::interpret_search,
            commands::compile_workflow_plan,
            commands::explain_workflow_result,
            // remote CQP operations
            commands::run_health,
            commands::run_search,
            commands::run_frequencies,
            commands::run_collocates,
            commands::run_lexicon,
            commands::run_metadata,
            commands::run_distribution,
            commands::discover_corpora,
            commands::run_syntax,
            commands::run_compare,
            commands::run_workflow,
            // learning / codebook
            commands::explain_annotation,
            commands::explain_field,
            commands::get_glossary,
            commands::get_guided_questions,
            commands::build_guided_recipe,
            // local files
            commands::export_table,
            commands::export_concordance_page,
            commands::export_search_all,
            commands::export_workflow_all,
            commands::export_workflow_view,
            commands::export_comparison,
            commands::export_syntax,
            commands::workflow_save,
            commands::workflow_load,
            commands::evidence_add,
            commands::evidence_save,
            commands::evidence_open,
            commands::evidence_export,
            // request console
            commands::get_console_log,
            commands::clear_console_log,
            commands::export_console_log,
            commands::terminal_commands,
            commands::terminal_from_payload,
            commands::save_text,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Hapax");

    app.run(|handle, event| {
        // Close the SSH session cleanly at exit (v3: "the SSH channel … closes at exit").
        if let tauri::RunEvent::Exit = event {
            let state = handle.state::<engine::AppState>();
            tauri::async_runtime::block_on(async {
                state.cancel_current();
                if let Some(s) = state.set_session(None).await {
                    s.close().await;
                }
            });
        }
    });
}
