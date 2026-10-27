use jammate_host::{looper, plugin_host, DeviceInfo, Event, Host};
use std::sync::Arc;
use std::thread;
use tauri::{AppHandle, Emitter, Manager, State};

struct AppState {
    host: Arc<Host>,
    _streams: jammate_host::Streams,
}

#[tauri::command]
fn list_devices() -> Vec<DeviceInfo> {
    Host::list_devices()
}

#[tauri::command]
fn start(state: State<AppState>) {
    state.host.start();
}

#[tauri::command]
fn stop(state: State<AppState>) {
    state.host.stop();
}

#[tauri::command]
fn is_playing(state: State<AppState>) -> bool {
    state.host.is_playing()
}

#[tauri::command]
fn set_bpm(state: State<AppState>, bpm: f64) {
    state.host.set_bpm(bpm);
}

#[tauri::command]
fn set_click(state: State<AppState>, enabled: bool) {
    state.host.set_click(enabled);
}

#[tauri::command]
fn set_input_gain(state: State<AppState>, gain: f32) {
    state.host.set_input_gain(gain);
}

#[tauri::command]
fn looper_command(state: State<AppState>, cmd: String) -> Result<(), String> {
    let command = parse_looper_command(&cmd).ok_or_else(|| format!("unknown looper command: {cmd}"))?;
    state.host.looper_command(command);
    Ok(())
}

#[tauri::command]
fn scan_plugins(state: State<AppState>) -> Result<Vec<plugin_host::PluginDesc>, String> {
    state.host.scan_plugins().map_err(|e| e.to_string())
}

#[tauri::command]
fn load_plugin(state: State<AppState>, path: String) -> Result<plugin_host::PluginDesc, String> {
    state.host.load_plugin(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn unload_plugin(state: State<AppState>) {
    state.host.unload_plugin();
}

#[tauri::command]
fn set_plugin_bypass(state: State<AppState>, bypass: bool) {
    state.host.set_plugin_bypass(bypass);
}

fn parse_looper_command(cmd: &str) -> Option<looper::Command> {
    match cmd {
        "record" | "rec" => Some(looper::Command::Record),
        "stop" => Some(looper::Command::Stop),
        "overdub" => Some(looper::Command::Overdub),
        "clear" => Some(looper::Command::Clear),
        _ => None,
    }
}

fn create_state() -> anyhow::Result<AppState> {
    let (host, streams) = Host::new()?;
    Ok(AppState {
        host: Arc::new(host),
        _streams: streams,
    })
}

fn spawn_event_thread(app: AppHandle, host: Arc<Host>) {
    thread::spawn(move || {
        let rx = host.events();
        while let Ok(ev) = rx.recv() {
            let _ = app.emit("jammate://event", ev);
        }
    });
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(
            create_state().unwrap_or_else(|e| {
                eprintln!("failed to create audio host: {e}");
                std::process::exit(1);
            }),
        )
        .invoke_handler(tauri::generate_handler![
            list_devices,
            start,
            stop,
            is_playing,
            set_bpm,
            set_click,
            set_input_gain,
            looper_command,
            scan_plugins,
            load_plugin,
            unload_plugin,
            set_plugin_bypass,
        ])
        .setup(|app| {
            let state = app.state::<AppState>();
            spawn_event_thread(app.handle().clone(), state.host.clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
