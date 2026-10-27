use jammate_host::{looper, Event, Host};
use std::io::{self, Write};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

fn main() -> anyhow::Result<()> {
    env_logger::init();
    println!("JamMate Host CLI");
    println!("================\n");

    let (host, _streams) = Host::new()?;
    let host = Arc::new(host);
    println!("Audio streams open.");

    println!("\nAudio devices:");
    for d in Host::list_devices() {
        println!(
            "  {} {} {} Hz {}ch",
            if d.is_input { "[IN]" } else { "[OUT]" },
            d.name,
            d.sample_rate,
            d.channels
        );
    }

    println!("\nScanning for VST3/AU plugins...");
    match host.scan_plugins() {
        Ok(list) => {
            if list.is_empty() {
                println!("  no plugins found in default scan paths");
            } else {
                for (i, p) in list.iter().enumerate() {
                    println!("  {}: {} ({}) {}", i, p.name, p.vendor, p.path);
                }
            }
        }
        Err(e) => println!("  scan failed: {}", e),
    }

    host.start();
    println!("\nTransport started at 90 BPM.");
    println!(
        "Commands: bpm <value> | rec | stop | clear | gain <0-2> | click | plugins | load <path> | unload | quit"
    );

    // event printer
    let host2 = Arc::clone(&host);
    let _event_thread = thread::spawn(move || loop {
        while let Some(ev) = host2.try_event() {
            match ev {
                Event::Chord(d) => println!(
                    "  [chord] {} ({}), key: {} conf={:.2}",
                    d.chord, d.chord_quality, d.key, d.confidence
                ),
                Event::Transport { bar, beat, bpm } => {
                    print!("\r  [transport] bar {} beat {} @ {:.1} BPM", bar + 1, beat + 1, bpm);
                    let _ = io::stdout().flush();
                }
                Event::Level(l) => println!("  [level] {:.2}", l),
            }
        }
        thread::sleep(Duration::from_millis(50));
    });

    loop {
        print!("> ");
        io::stdout().flush()?;
        let mut line = String::new();
        io::stdin().read_line(&mut line)?;
        let parts: Vec<&str> = line.trim().split_whitespace().collect();
        if parts.is_empty() {
            continue;
        }
        match parts[0] {
            "bpm" => {
                if let Ok(v) = parts.get(1).unwrap_or(&"90").parse::<f64>() {
                    host.set_bpm(v);
                    println!("  bpm set to {}", v);
                }
            }
            "rec" => {
                host.looper_command(looper::Command::Record);
                println!("  looper arming at next bar");
            }
            "stop" => {
                host.looper_command(looper::Command::Stop);
                println!("  looper stop/rec finish");
            }
            "overdub" => {
                host.looper_command(looper::Command::Overdub);
                println!("  looper overdub");
            }
            "clear" => {
                host.looper_command(looper::Command::Clear);
                println!("  looper cleared");
            }
            "gain" => {
                if let Ok(v) = parts.get(1).unwrap_or(&"1").parse::<f32>() {
                    host.set_input_gain(v);
                }
            }
            "click" => {
                // toggle
                // not tracked; skip
                println!("  click toggle not exposed in CLI");
            }
            "plugins" => match host.scan_plugins() {
                Ok(list) => {
                    for (i, p) in list.iter().enumerate() {
                        println!("  {}: {} ({})", i, p.name, p.path);
                    }
                }
                Err(e) => println!("  scan failed: {}", e),
            },
            "load" => {
                if let Some(path) = parts.get(1) {
                    match host.load_plugin(path) {
                        Ok(d) => println!("  loaded {}", d.name),
                        Err(e) => println!("  load failed: {}", e),
                    }
                }
            }
            "unload" => {
                host.unload_plugin();
                println!("  plugin unloaded");
            }
            "bypass" => {
                let on = parts.get(1).map(|s| *s == "on").unwrap_or(true);
                host.set_plugin_bypass(on);
            }
            "quit" | "q" => break,
            _ => println!("unknown command"),
        }
    }

    Ok(())
}
