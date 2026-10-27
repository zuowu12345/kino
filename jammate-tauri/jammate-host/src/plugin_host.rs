use rack::prelude::{PluginInfo, Scanner};
use rack::{PluginInstance, PluginScanner};
use serde::Serialize;

#[derive(Serialize, Clone, Debug)]
pub struct PluginDesc {
    pub name: String,
    pub vendor: String,
    pub path: String,
    pub kind: String,
}

impl From<&PluginInfo> for PluginDesc {
    fn from(info: &PluginInfo) -> Self {
        Self {
            name: info.name.clone(),
            vendor: info.manufacturer.clone(),
            path: info.path.to_string_lossy().to_string(),
            kind: format!("{:?}", info.plugin_type),
        }
    }
}

pub struct PluginHost {
    scanner: Scanner,
}

impl PluginHost {
    pub fn new() -> anyhow::Result<Self> {
        Ok(Self {
            scanner: Scanner::new()?,
        })
    }

    pub fn scan(&self) -> anyhow::Result<Vec<PluginDesc>> {
        let list = self.scanner.scan()?;
        Ok(list.iter().map(PluginDesc::from).collect())
    }

    pub fn load(&self, path: &str, sample_rate: f32, max_block: usize) -> anyhow::Result<LoadedPlugin> {
        let infos = self.scanner.scan()?;
        let info = infos
            .iter()
            .find(|p| p.path.to_string_lossy() == path)
            .ok_or_else(|| anyhow::anyhow!("plugin not found in scan"))?;
        let mut instance = self.scanner.load(info)?;
        instance.initialize(sample_rate as f64, max_block)?;
        let desc = PluginDesc::from(info);
        Ok(LoadedPlugin { desc, instance: Box::new(instance), max_block })
    }
}

pub struct LoadedPlugin {
    pub desc: PluginDesc,
    instance: Box<dyn rack::traits::PluginInstance>,
    max_block: usize,
}

// rack plugin instances are not necessarily Send; this skeleton assumes they are.
// If the compiler disagrees, wrap processing in a dedicated plugin thread.
unsafe impl Send for LoadedPlugin {}

impl LoadedPlugin {
    /// In-place interleaved stereo processing (input and output share the same buffer).
    pub fn process_interleaved_inplace(&mut self, buffer: &mut [f32]) -> anyhow::Result<()> {
        let frames = buffer.len() / 2;
        if frames == 0 {
            return Ok(());
        }
        if frames > self.max_block {
            anyhow::bail!("block size {} exceeds plugin max {}", frames, self.max_block);
        }
        let mut left_in = vec![0.0f32; frames];
        let mut right_in = vec![0.0f32; frames];
        let mut left_out = vec![0.0f32; frames];
        let mut right_out = vec![0.0f32; frames];
        for i in 0..frames {
            left_in[i] = buffer[i * 2];
            right_in[i] = buffer[i * 2 + 1];
        }
        self.instance
            .process(&[&left_in, &right_in], &mut [&mut left_out, &mut right_out], frames)?;
        for i in 0..frames {
            buffer[i * 2] = left_out[i];
            buffer[i * 2 + 1] = right_out[i];
        }
        Ok(())
    }

    pub fn process_interleaved(
        &mut self,
        input: &[f32],
        output: &mut [f32],
    ) -> anyhow::Result<()> {
        assert_eq!(input.len(), output.len());
        let frames = input.len() / 2;
        if frames == 0 {
            return Ok(());
        }
        if frames > self.max_block {
            anyhow::bail!("block size {} exceeds plugin max {}", frames, self.max_block);
        }
        let mut left_in = vec![0.0f32; frames];
        let mut right_in = vec![0.0f32; frames];
        let mut left_out = vec![0.0f32; frames];
        let mut right_out = vec![0.0f32; frames];
        for i in 0..frames {
            left_in[i] = input[i * 2];
            right_in[i] = input[i * 2 + 1];
        }
        self.instance
            .process(&[&left_in, &right_in], &mut [&mut left_out, &mut right_out], frames)?;
        for i in 0..frames {
            output[i * 2] = left_out[i];
            output[i * 2 + 1] = right_out[i];
        }
        Ok(())
    }
}
