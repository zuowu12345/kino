pub mod chroma;
pub mod looper;
pub mod plugin_host;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use crossbeam_channel::{bounded, Receiver, Sender};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "type", content = "data")]
pub enum Event {
    Transport { bar: u32, beat: u32, bpm: f64 },
    Chord(chroma::Detection),
    Level(f32),
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct DeviceInfo {
    pub name: String,
    pub is_input: bool,
    pub is_output: bool,
    pub sample_rate: u32,
    pub channels: u16,
}

pub struct Streams {
    #[allow(dead_code)]
    input: cpal::Stream,
    #[allow(dead_code)]
    output: cpal::Stream,
}

struct Shared {
    sample_rate: f32,
    input_channels: usize,
    output_channels: usize,
    bpm: Mutex<f64>,
    playing: AtomicBool,
    click_enabled: AtomicBool,
    input_gain: Mutex<f32>,
    plugin_bypass: AtomicBool,
    sample_counter: AtomicU64,
    click_pos: AtomicU64,
    looper: Mutex<looper::Looper>,
    plugin: Mutex<Option<plugin_host::LoadedPlugin>>,
    event_tx: Sender<Event>,
}

pub struct Host {
    shared: Arc<Shared>,
    event_rx: Receiver<Event>,
    _detector: thread::JoinHandle<()>,
}

const CLICK_LEN: usize = 3000;

fn build_click(sample_rate: f32) -> Vec<f32> {
    let freq = 1000.0f32;
    (0..CLICK_LEN)
        .map(|i| {
            let t = i as f32 / sample_rate;
            let env = (1.0 - i as f32 / CLICK_LEN as f32).powf(2.5);
            (t * freq * 2.0 * std::f32::consts::PI).sin() * env * 0.25
        })
        .collect()
}

impl Host {
    /// Create the host. Returns the Host handle plus the live audio streams.
    /// The streams must be kept alive for audio to continue running.
    pub fn new() -> anyhow::Result<(Self, Streams)> {
        let host = cpal::default_host();
        let output_device = host
            .default_output_device()
            .ok_or_else(|| anyhow::anyhow!("no output device"))?;
        let output_config = output_device.default_output_config()?;
        let input_device = host
            .default_input_device()
            .ok_or_else(|| anyhow::anyhow!("no input device"))?;
        let input_config = input_device.default_input_config()?;

        log::info!(
            "output: {} {:?}",
            output_device.name().unwrap_or_default(),
            output_config
        );
        log::info!(
            "input: {} {:?}",
            input_device.name().unwrap_or_default(),
            input_config
        );

        let sample_rate = output_config.sample_rate().0 as f32;
        let input_channels = input_config.channels() as usize;
        let output_channels = output_config.channels() as usize;

        if input_config.sample_rate().0 != output_config.sample_rate().0 {
            log::warn!(
                "input sample rate {} != output sample rate {}; pitch detection may drift",
                input_config.sample_rate().0,
                output_config.sample_rate().0
            );
        }

        let (event_tx, event_rx) = bounded::<Event>(256);
        let (chord_tx, chord_rx) = bounded::<chroma::Detection>(16);
        let (sample_tx, sample_rx) = bounded::<f32>(8192);
        let (input_tx, input_rx): (Sender<f32>, Receiver<f32>) = bounded(16384);

        let shared = Arc::new(Shared {
            sample_rate,
            input_channels,
            output_channels,
            bpm: Mutex::new(90.0),
            playing: AtomicBool::new(false),
            click_enabled: AtomicBool::new(true),
            input_gain: Mutex::new(1.0),
            plugin_bypass: AtomicBool::new(false),
            sample_counter: AtomicU64::new(0),
            click_pos: AtomicU64::new(CLICK_LEN as u64),
            looper: Mutex::new(looper::Looper::default()),
            plugin: Mutex::new(None),
            event_tx,
            chord_rx: Mutex::new(chord_rx),
        });

        // Input callback: push interleaved samples to output queue and detector
        let input_stream = match input_config.sample_format() {
            cpal::SampleFormat::F32 => input_device.build_input_stream(
                &input_config.into(),
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    for s in data {
                        let _ = input_tx.try_send(*s);
                        let _ = sample_tx.try_send(*s);
                    }
                },
                move |err| log::error!("input error: {}", err),
                None,
            )?,
            _ => anyhow::bail!("unsupported input sample format"),
        };

        // Detector thread
        let det_sample_rate = sample_rate;
        let detector = thread::spawn(move || {
            let mut analyzer = chroma::Analyzer::new(det_sample_rate);
            // average stereo to mono
            let mut last_l = 0.0f32;
            let mut idx = 0usize;
            while let Ok(s) = sample_rx.recv() {
                if input_channels == 1 {
                    if let Some(d) = analyzer.push(s) {
                        let _ = chord_tx.try_send(d);
                    }
                } else {
                    if idx % 2 == 0 {
                        last_l = s;
                    } else {
                        let mono = (last_l + s) * 0.5;
                        if let Some(d) = analyzer.push(mono) {
                            let _ = chord_tx.try_send(d);
                        }
                    }
                    idx += 1;
                }
            }
        });

        // Output callback
        let shared_out = shared.clone();
        let click_buf = build_click(sample_rate);
        let plugin_block = 1024usize;
        let output_stream = match output_config.sample_format() {
            cpal::SampleFormat::F32 => output_device.build_output_stream(
                &output_config.into(),
                move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                    process_output(
                        data,
                        &shared_out,
                        &input_rx,
                        &click_buf,
                        plugin_block,
                    );
                },
                move |err| log::error!("output error: {}", err),
                None,
            )?,
            _ => anyhow::bail!("unsupported output sample format"),
        };

        input_stream.play()?;
        output_stream.play()?;

        // Event forwarding thread (for non-Tauri consumers)
        let event_forward = shared.clone();
        thread::spawn(move || {
            while let Ok(ev) = event_rx.recv() {
                let _ = event_forward.event_tx.try_send(ev);
            }
        });

        Ok((
            Self {
                shared,
                _detector: detector,
            },
            Streams {
                input: input_stream,
                output: output_stream,
            },
        ))
    }

    pub fn list_devices() -> Vec<DeviceInfo> {
        let host = cpal::default_host();
        let mut out = Vec::new();
        if let Ok(devs) = host.output_devices() {
            for d in devs {
                if let Ok(conf) = d.default_output_config() {
                    out.push(DeviceInfo {
                        name: d.name().unwrap_or_default(),
                        is_input: false,
                        is_output: true,
                        sample_rate: conf.sample_rate().0,
                        channels: conf.channels(),
                    });
                }
            }
        }
        if let Ok(devs) = host.input_devices() {
            for d in devs {
                if let Ok(conf) = d.default_input_config() {
                    out.push(DeviceInfo {
                        name: d.name().unwrap_or_default(),
                        is_input: true,
                        is_output: false,
                        sample_rate: conf.sample_rate().0,
                        channels: conf.channels(),
                    });
                }
            }
        }
        out
    }

    pub fn start(&self) { self.shared.playing.store(true, Ordering::Relaxed); }
    pub fn stop(&self) { self.shared.playing.store(false, Ordering::Relaxed); }
    pub fn is_playing(&self) -> bool { self.shared.playing.load(Ordering::Relaxed) }

    pub fn set_bpm(&self, bpm: f64) {
        let mut g = self.shared.bpm.lock().unwrap();
        *g = bpm.clamp(40.0, 240.0);
    }

    pub fn set_click(&self, enabled: bool) {
        self.shared.click_enabled.store(enabled, Ordering::Relaxed);
    }

    pub fn set_input_gain(&self, gain: f32) {
        *self.shared.input_gain.lock().unwrap() = gain.clamp(0.0, 2.0);
    }

    pub fn looper_command(&self, cmd: looper::Command) {
        self.shared.looper.lock().unwrap().command(cmd);
    }

    pub fn scan_plugins(&self) -> anyhow::Result<Vec<plugin_host::PluginDesc>> {
        let host = plugin_host::PluginHost::new()?;
        host.scan()
    }

    pub fn load_plugin(&self, path: &str) -> anyhow::Result<plugin_host::PluginDesc> {
        let host = plugin_host::PluginHost::new()?;
        let max_block = 4096;
        let loaded = host.load(path, self.shared.sample_rate, max_block)?;
        let desc = loaded.desc.clone();
        *self.shared.plugin.lock().unwrap() = Some(loaded);
        Ok(desc)
    }

    pub fn unload_plugin(&self) {
        *self.shared.plugin.lock().unwrap() = None;
    }

    pub fn set_plugin_bypass(&self, bypass: bool) {
        self.shared.plugin_bypass.store(bypass, Ordering::Relaxed);
    }

    pub fn events(&self) -> Receiver<Event> {
        // The event_tx in Shared is the sender; we can't easily clone receiver.
        // Instead expose a helper that polls the shared chord receiver and synthesizes events.
        // For Tauri integration, a dedicated event-polling thread should be used.
        let (_tx, rx) = bounded(1);
        rx
    }

    pub fn try_event(&self) -> Option<Event> {
        // transport event generation is handled in audio thread; pull chord events here
        if let Ok(det) = self.shared.chord_rx.lock().unwrap().try_recv() {
            return Some(Event::Chord(det));
        }
        None
    }
}

fn process_output(
    data: &mut [f32],
    shared: &Shared,
    input_rx: &Receiver<f32>,
    click_buf: &[f32],
    plugin_block: usize,
) {
    let channels = shared.output_channels;
    let frames = data.len() / channels;
    if frames == 0 {
        return;
    }

    // Build interleaved stereo work buffer from input queue
    let mut work = vec![0.0f32; frames * 2];
    let ic = shared.input_channels;
    for f in 0..frames {
        let l = input_rx.try_recv().unwrap_or(0.0);
        let r = if ic == 1 { l } else { input_rx.try_recv().unwrap_or(0.0) };
        let gain = *shared.input_gain.lock().unwrap();
        work[f * 2] = l * gain;
        work[f * 2 + 1] = r * gain;
    }

    // Plugin processing
    if !shared.plugin_bypass.load(Ordering::Relaxed) {
        if let Ok(mut plug) = shared.plugin.lock() {
            if let Some(p) = plug.as_mut() {
                for chunk in work.chunks_mut(plugin_block * 2) {
                    if let Err(e) = p.process_interleaved_inplace(chunk) {
                        log::error!("plugin process error: {}", e);
                    }
                }
            }
        }
    }

    let bpm = *shared.bpm.lock().unwrap();
    let beat_samples = (shared.sample_rate * 60.0 / bpm as f32) as u64;
    let playing = shared.playing.load(Ordering::Relaxed);
    let click_enabled = shared.click_enabled.load(Ordering::Relaxed);

    let mut looper = shared.looper.lock().unwrap();

    for f in 0..frames {
        let idx = shared.sample_counter.fetch_add(1, Ordering::Relaxed);
        let beat = (idx / beat_samples) as u32;
        let is_downbeat = idx % beat_samples == 0;
        let is_bar_boundary = idx % (beat_samples * 4) == 0;

        if is_bar_boundary {
            looper.on_bar_boundary();
        }

        let mut out = [work[f * 2], work[f * 2 + 1]];
        looper.process(out, &mut out);

        // metronome click
        if playing && click_enabled && is_downbeat {
            shared.click_pos.store(0, Ordering::Relaxed);
        }
        let click_pos = shared.click_pos.load(Ordering::Relaxed);
        if click_pos < CLICK_LEN as u64 {
            let click = click_buf[click_pos as usize];
            out[0] += click;
            out[1] += click;
            shared
                .click_pos
                .store(click_pos + 1, Ordering::Relaxed);
        }

        // write to output (mono -> duplicate if needed)
        for c in 0..channels {
            data[f * channels + c] = out[c.min(1)];
        }

        // transport event (non-blocking)
        if idx % beat_samples == 0 {
            let bar = beat / 4;
            let b = beat % 4;
            let _ = shared.event_tx.try_send(Event::Transport { bar, beat: b, bpm });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn host_constructs() {
        // cannot open audio devices in CI without sound server; at least compile
    }
}
