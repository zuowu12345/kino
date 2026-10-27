use rustfft::{num_complex::Complex, Fft, FftPlanner};
use std::sync::Arc;

const FRAME_SIZE: usize = 4096;
const HOP_SIZE: usize = 1024;

#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct Detection {
    pub chord: String,
    pub chord_quality: String,
    pub root_pc: i32,
    pub confidence: f32,
    pub key: String,
    pub key_confidence: f32,
}

pub struct Analyzer {
    sample_rate: f32,
    fft: Arc<dyn Fft<f32>>,
    window: Vec<f32>,
    buf: Vec<f32>,
    hop_acc: usize,
    smooth: [f32; 12],
    pub last: Option<Detection>,
}

fn note_name(pc: i32) -> &'static str {
    const NAMES: [&str; 12] = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    NAMES[((pc % 12) + 12) as usize % 12]
}

impl Analyzer {
    pub fn new(sample_rate: f32) -> Self {
        let mut planner = FftPlanner::new();
        let fft = planner.plan_fft_forward(FRAME_SIZE);
        let window: Vec<f32> = (0..FRAME_SIZE)
            .map(|i| {
                let x = i as f32 / (FRAME_SIZE - 1) as f32;
                (std::f32::consts::PI * x).sin().powi(2)
            })
            .collect();
        Self {
            sample_rate,
            fft,
            window,
            buf: Vec::with_capacity(FRAME_SIZE),
            hop_acc: 0,
            smooth: [0.0; 12],
            last: None,
        }
    }

    pub fn push(&mut self, sample: f32) -> Option<Detection> {
        self.buf.push(sample);
        self.hop_acc += 1;
        if self.buf.len() >= FRAME_SIZE && self.hop_acc >= HOP_SIZE {
            self.hop_acc = 0;
            return self.analyze();
        }
        None
    }

    fn analyze(&mut self) -> Option<Detection> {
        let mut complex: Vec<Complex<f32>> = self
            .buf
            .iter()
            .zip(self.window.iter())
            .map(|(s, w)| Complex::new(s * w, 0.0))
            .collect();
        self.fft.process(&mut complex);
        let mut chroma = [0.0f32; 12];
        let bin_freq = self.sample_rate / FRAME_SIZE as f32;
        for (i, c) in complex.iter().enumerate().take(FRAME_SIZE / 2) {
            let freq = i as f32 * bin_freq;
            if freq < 50.0 || freq > 5000.0 {
                continue;
            }
            let midi = 69.0 + 12.0 * (freq / 440.0).log2();
            let pc = midi.round() as i32 % 12;
            let pc = ((pc % 12) + 12) % 12;
            let mag = c.norm();
            chroma[pc as usize] += mag;
        }
        // log compress + smooth
        for i in 0..12 {
            chroma[i] = (chroma[i] + 1e-6).ln();
            self.smooth[i] = self.smooth[i] * 0.7 + chroma[i] * 0.3;
        }
        self.buf.drain(0..HOP_SIZE);

        let det = self.detect(self.smooth);
        self.last = Some(det.clone());
        Some(det)
    }

    fn detect(&self, chroma: [f32; 12]) -> Detection {
        // chord templates: maj, min, 7, maj7, min7, dim
        let templates: [(&str, [f32; 12]); 6] = [
            ("maj",  [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0]),
            ("min",  [1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0]),
            ("7",    [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0]),
            ("maj7", [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]),
            ("min7", [1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0]),
            ("dim",  [1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0]),
        ];

        let mut best_score = -1.0f32;
        let mut best_root = 0;
        let mut best_quality = "maj";
        for root in 0..12 {
            for (qname, tmpl) in &templates {
                let shifted: Vec<f32> = (0..12)
                    .map(|i| chroma[(i + root) % 12] * tmpl[i])
                    .collect();
                let score = shifted.iter().sum::<f32>();
                if score > best_score {
                    best_score = score;
                    best_root = root;
                    best_quality = qname;
                }
            }
        }

        // key profiles (Krumhansl simplified)
        let major = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
        let minor = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
        let mut best_key_score = -1.0f32;
        let mut best_key = (0, true); // pc, major?
        for tonic in 0..12 {
            let s_maj: f32 = (0..12).map(|i| chroma[(i + tonic) % 12] * major[i]).sum();
            if s_maj > best_key_score { best_key_score = s_maj; best_key = (tonic, true); }
            let s_min: f32 = (0..12).map(|i| chroma[(i + tonic) % 12] * minor[i]).sum();
            if s_min > best_key_score { best_key_score = s_min; best_key = (tonic, false); }
        }
        let key_name = format!("{}{}", note_name(best_key.0 as i32), if best_key.1 { " major" } else { " minor" });

        let chord = format!("{}{}", note_name(best_root as i32), best_quality);
        Detection {
            chord,
            chord_quality: best_quality.to_string(),
            root_pc: best_root as i32,
            confidence: (best_score / 8.0).clamp(0.0, 1.0),
            key: key_name,
            key_confidence: (best_key_score / 25.0).clamp(0.0, 1.0),
        }
    }
}
