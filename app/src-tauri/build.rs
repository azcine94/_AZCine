fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "check_desktop", "storage_workspace", "select_data_root", "create_todo", "complete_todo", "pick_data_root", "open_data_root", "list_projects", "save_project", "project_request",
            "pi_snapshot", "pi_connect", "pi_disconnect", "pi_send", "pi_stop", "pi_sessions", "pi_new_session", "pi_switch_session", "pi_name_session", "pi_select_model", "pi_save_model",
            "model_ranking_workspace", "model_ranking_update", "model_ranking_attempt", "model_ranking_open_source",
        ]),
    )).expect("build app command permissions");
}
