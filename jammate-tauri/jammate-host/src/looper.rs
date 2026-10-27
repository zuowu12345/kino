#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
pub enum State {
    Idle,
    Arming,
    Recording,
    Playing,
    Overdubbing,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct Looper {
    pub state: State,
    pub buffer: Vec<f32>, // interleaved stereo
    pub length_frames: usize,
    pub pos: usize,
    pub bars: u32,
}

impl Default for Looper {
    fn default() -> Self {
        Self {
            state: State::Idle,
            buffer: Vec::new(),
            length_frames: 0,
            pos: 0,
            bars: 0,
        }
    }
}

impl Looper {
    pub fn command(&mut self, cmd: Command) {
        match cmd {
            Command::Record => {
                if self.state == State::Idle || self.state == State::Playing {
                    self.state = State::Arming;
                }
            }
            Command::Stop => {
                if self.state == State::Recording {
                    self.length_frames = self.pos;
                    self.pos = 0;
                    self.state = State::Playing;
                } else if self.state == State::Overdubbing {
                    self.state = State::Playing;
                }
            }
            Command::Overdub => {
                if self.state == State::Playing {
                    self.state = State::Overdubbing;
                }
            }
            Command::Clear => {
                self.buffer.clear();
                self.length_frames = 0;
                self.pos = 0;
                self.bars = 0;
                self.state = State::Idle;
            }
        }
    }

    pub fn on_bar_boundary(&mut self) {
        if self.state == State::Arming {
            self.buffer.clear();
            self.pos = 0;
            self.bars = 0;
            self.state = State::Recording;
        }
    }

    pub fn process(&mut self, input: [f32; 2], output: &mut [f32; 2]) {
        match self.state {
            State::Idle | State::Arming => {}
            State::Recording => {
                self.buffer.push(input[0]);
                self.buffer.push(input[1]);
                self.pos += 2;
            }
            State::Playing => {
                if self.length_frames > 0 {
                    output[0] += self.buffer[self.pos];
                    output[1] += self.buffer[self.pos + 1];
                    self.pos += 2;
                    if self.pos >= self.length_frames {
                        self.pos = 0;
                    }
                }
            }
            State::Overdubbing => {
                if self.length_frames > 0 {
                    output[0] += self.buffer[self.pos];
                    output[1] += self.buffer[self.pos + 1];
                    self.buffer[self.pos] += input[0];
                    self.buffer[self.pos + 1] += input[1];
                    self.pos += 2;
                    if self.pos >= self.length_frames {
                        self.pos = 0;
                    }
                }
            }
        }
    }
}

pub enum Command {
    Record,
    Stop,
    Overdub,
    Clear,
}
