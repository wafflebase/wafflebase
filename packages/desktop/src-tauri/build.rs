fn main() {
    // Declaring an app manifest makes every app command require a permission
    // (`allow-<command>`), granted only by `capabilities/local.json`. Remote
    // origins are refused app commands without a matching `remote` capability
    // anyway; this keeps the bundled pages to the commands they are listed for.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "get_server",
            "set_server",
            "login_status",
            "cancel_login",
            "take_handoff",
        ]),
    ))
    .expect("failed to run tauri-build");
}
