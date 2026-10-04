fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "check_desktop", "storage_workspace", "select_data_root", "create_todo", "complete_todo", "pick_data_root", "open_data_root", "list_projects", "save_project", "project_request",
            "news_snapshot", "news_materials", "save_news_source", "news_source_request", "preview_news_source", "collect_news", "retry_news_run", "open_news_url", "cancel_news_capture", "news_editorial_snapshot", "save_news_preferences", "news_preference_request", "organize_news", "retry_news_editorial", "cancel_news_editorial", "analyze_news_event", "news_edition_text", "export_news_edition",
            "pi_snapshot", "pi_connect", "pi_disconnect", "pi_send", "pi_stop", "pi_sessions", "pi_new_session", "pi_switch_session", "pi_name_session", "pi_select_model", "pi_save_model",
            "model_ranking_workspace", "model_ranking_update", "model_ranking_attempt", "model_ranking_open_source",
        ]),
    )).expect("build app command permissions");
}
