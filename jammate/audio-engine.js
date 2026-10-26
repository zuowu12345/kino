/* 伴奏引擎：程序化生成鼓组、贝斯与和弦，自带调度器 */
window.AudioEngine = (function () {
  const STEP_PER_BAR = 16; // 4/4，每小节 16 个十六分音符

  // 每种风格的节奏型，位置以十六分音符为步（0–15）
  const GROOVES = {
    pop: {
      swing: 0,
      kick:  [[0, 1], [10, 0.85]],
      snare: [[4, 1], [12, 1]],
      hat:   [[0, 0.45], [2, 0.3], [4, 0.4], [6, 0.3], [8, 0.45], [10, 0.3], [12, 0.4], [14, 0.55]],
      openHat: [14],
      comp:  [[0, 0.9], [8, 0.62]],
      compStrum: 0.014, compDur: 0.62,
      bass:  [[0, 'R', 1], [6, '5', 0.85], [8, 'R', 0.9], [14, 'O', 0.7]]
    },
    rock: {
      swing: 0,
      kick:  [[0, 1], [6, 0.8], [8, 1], [14, 0.6]],
      snare: [[4, 1], [12, 1]],
      hat:   [[0, 0.5], [2, 0.35], [4, 0.5], [6, 0.35], [8, 0.5], [10, 0.35], [12, 0.5], [14, 0.35]],
      openHat: [],
      comp:  [[0, 0.85], [6, 0.5], [8, 0.8], [14, 0.45]],
      compStrum: 0.006, compDur: 0.26, power: true,
      bass:  [[0, 'R', 1], [2, 'R', 0.7], [4, 'R', 0.85], [6, 'R', 0.7],
              [8, 'R', 1], [10, 'R', 0.7], [12, 'R', 0.85], [14, '5', 0.7]]
    },
    blues: {
      swing: 0.16,
      kick:  [[0, 0.95], [8, 0.8]],
      snare: [[4, 0.9], [12, 0.9]],
      hat:   [[0, 0.4], [2, 0.3], [4, 0.4], [6, 0.3], [8, 0.4], [10, 0.3], [12, 0.4], [14, 0.3]],
      openHat: [],
      comp:  [[0, 0.8], [8, 0.72]],
      compStrum: 0.018, compDur: 0.45,
      bass:  [[0, 'R', 1], [4, '5', 0.8], [8, 'R', 0.9], [12, 'b7', 0.8]]
    },
    funk: {
      swing: 0.05,
      kick:  [[0, 0.95], [3, 0.7], [10, 0.85]],
      snare: [[4, 1], [12, 1], [7, 0.22], [15, 0.28]],
      hat:   [[0, 0.4], [1, 0.2], [2, 0.3], [3, 0.2], [4, 0.4], [5, 0.2], [6, 0.3], [7, 0.2],
              [8, 0.4], [9, 0.2], [10, 0.3], [11, 0.2], [12, 0.4], [13, 0.2], [14, 0.3], [15, 0.2]],
      openHat: [],
      comp:  [[0, 0.62], [3, 0.45], [6, 0.5], [10, 0.55], [13, 0.4]],
      compStrum: 0.005, compDur: 0.16,
      bass:  [[0, 'R', 1], [3, 'O', 0.75], [6, 'R', 0.8], [8, 'R', 0.9], [11, 'O', 0.7], [14, '5', 0.7]]
    },
    ballad: {
      swing: 0,
      kick:  [[0, 0.9], [8, 0.75]],
      snare: [[4, 0.55], [12, 0.55]],
      hat:   [[0, 0.3], [2, 0.2], [4, 0.3], [6, 0.2], [8, 0.3], [10, 0.2], [12, 0.3], [14, 0.2]],
      openHat: [],
      comp:  [[0, 0.7], [8, 0.58]],
      compStrum: 0.04, compDur: 1.8,
      bass:  [[0, 'R', 1], [8, '5', 0.7]]
    },
    jazz: {
      swing: 0.17,
      kick:  [[0, 0.35]],
      snare: [[4, 0.18], [12, 0.22]],
      hat:   [[0, 0.4], [2, 0.3], [4, 0.38], [6, 0.28], [8, 0.4], [10, 0.3], [12, 0.38], [14, 0.28]],
      openHat: [],
      comp:  [[0, 0.55], [6, 0.4], [12, 0.32]],
      compStrum: 0.022, compDur: 0.9,
      bass:  [[0, 'R', 0.9], [4, '3', 0.8], [8, '5', 0.85], [12, 'b7', 0.8]]
    }
  };

  const BASS_TOKENS = { R: 0, '2': 2, '3': 4, 'b3': 3, '5': 7, 'b5': 6, '6': 9, 'b7': 10, '7': 11, '9': 14, O: 12 };

  function midiToFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function mod(n, m) { return ((n % m) + m) % m; }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function rootMidiNear(pc, lo) { return lo + mod(pc - lo, 12); }

  class Engine {
    constructor() {
      this.ctx = null;
      this.playing = false;
      this._timer = null;
      this.nextTime = 0;
      this.step = 0;
      this.bar = 0;
      this.queue = [];
      this.state = {
        bpm: 92,
        keyPc: 0,
        styleId: 'pop',
        intensity: 0.8,
        metro: true,
        accent: true,
        countIn: true,
        loop: { a: null, b: null, on: false }
      };
    }

    init() {
      if (this.ctx) return this.ctx;
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = new AC();
      this.ctx = ctx;

      this.master = ctx.createGain();
      this.master.gain.value = 0.9;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 12;
      comp.ratio.value = 3.5;
      comp.attack.value = 0.004;
      comp.release.value = 0.18;
      this.master.connect(comp);
      comp.connect(ctx.destination);

      this.drumsBus = ctx.createGain(); this.drumsBus.gain.value = 0.95; this.drumsBus.connect(this.master);
      this.bassBus = ctx.createGain(); this.bassBus.gain.value = 0.9; this.bassBus.connect(this.master);
      this.keysBus = ctx.createGain(); this.keysBus.gain.value = 0.82; this.keysBus.connect(this.master);
      this.clickBus = ctx.createGain(); this.clickBus.gain.value = 0.65; this.clickBus.connect(this.master);

      const len = Math.floor(ctx.sampleRate * 2);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this._noise = buf;

      return ctx;
    }

    setBpm(v) {
      this.state.bpm = clamp(Math.round(v), 40, 220);
      return this.state.bpm;
    }

    setKey(pc) { this.state.keyPc = mod(Math.round(pc), 12); }

    setStyle(id) { this.state.styleId = id; }

    setIntensity(v) { this.state.intensity = clamp(v, 0, 1); }

    progLength() { return Theory.STYLES[this.state.styleId].prog.length; }

    barDuration() { return (60 / this.state.bpm) * 4; }

    groove() { return GROOVES[this.state.styleId] || GROOVES.pop; }

    async play() {
      this.init();
      if (this.ctx.state === 'suspended') await this.ctx.resume();

      this.playing = true;
      this.queue.length = 0;
      this.step = 0;
      // 循环开启时从 A 段起播
      const loop = this.state.loop;
      this.bar = loop.on && loop.a != null ? loop.a : 0;

      let t = this.ctx.currentTime + 0.12;
      if (this.state.countIn) {
        this.countIn(t);
        t += this.barDuration();
      }
      this.nextTime = t;

      if (this._timer) clearInterval(this._timer);
      this._timer = setInterval(() => this.tick(), 25);
      this.tick();
    }

    stop() {
      this.playing = false;
      if (this._timer) { clearInterval(this._timer); this._timer = null; }
      this.queue.length = 0;
      this.step = 0;
      this.bar = 0;
    }

    countIn(t) {
      const beat = 60 / this.state.bpm;
      for (let i = 0; i < 4; i++) {
        this.click(t + i * beat, i === 0, i === 0 ? 1 : 0.75);
        this.queue.push({ step: i * 4, bar: -1, time: t + i * beat, countIn: true });
      }
    }

    advanceBar() {
      const len = this.progLength();
      const loop = this.state.loop;
      let next = this.bar + 1;
      if (loop.on && loop.a != null && loop.b != null && loop.b > loop.a) {
        if (next > loop.b) next = loop.a;
      } else if (next >= len) {
        next = 0;
      }
      this.bar = next;
    }

    jumpToBar(i) {
      this.bar = mod(i, this.progLength());
      this.step = 0;
      if (this.ctx && this.playing) {
        this.nextTime = Math.max(this.nextTime, this.ctx.currentTime + 0.05);
      }
      this.queue.length = 0;
    }

    tick() {
      if (!this.playing || !this.ctx) return;
      const now = this.ctx.currentTime;
      if (this.nextTime < now - 0.4) this.nextTime = now + 0.05;

      let guard = 0;
      while (this.nextTime < now + 0.18 && guard++ < 64) {
        this.scheduleStep(this.step, this.bar, this.nextTime);
        this.nextTime += (60 / this.state.bpm) / 4;
        this.step += 1;
        if (this.step >= STEP_PER_BAR) {
          this.step = 0;
          this.advanceBar();
        }
      }
    }

    scheduleStep(step, bar, time) {
      const g = this.groove();
      const chord = Theory.chordFor(this.state.styleId, this.state.keyPc, bar);
      const stepDur = (60 / this.state.bpm) / 4;
      // Swing：把每拍后半拍往后推
      const t = time + (g.swing && step % 4 === 2 ? g.swing * stepDur * 2 : 0);
      const I = this.state.intensity;
      const dyn = 0.55 + 0.45 * I;

      if (I > 0.1) {
        for (const hit of g.kick) if (hit[0] === step) this.kick(t, hit[1] * dyn);
      }
      if (I > 0.38) {
        for (const hit of g.snare) if (hit[0] === step) this.snare(t, hit[1] * dyn * (I > 0.85 ? 1 : 0.88));
      }
      if (I > 0.26) {
        for (const hit of g.hat) if (hit[0] === step) this.hat(t, hit[1] * dyn, false);
      }
      if (g.openHat && I > 0.5) {
        for (const pos of g.openHat) if (pos === step) this.hat(t, 0.34 * dyn, true);
      }
      if (I > 0.45) {
        for (const hit of g.comp) if (hit[0] === step) this.comp(t, chord, hit[1] * dyn, g);
      }
      if (I > 0.16) {
        for (const hit of g.bass) {
          if (hit[0] === step) this.bass(t, chord, hit[1], hit[2] * dyn, stepDur * 2.4);
        }
      }
      if (this.state.metro && step % 4 === 0) {
        const down = step === 0;
        this.click(t, down && this.state.accent, down ? 0.95 : 0.55);
      }

      this.queue.push({ step: step, bar: bar, time: time });
    }

    /* ---------- 乐器 ---------- */

    kick(time, vel) {
      const ctx = this.ctx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(155, time);
      osc.frequency.exponentialRampToValueAtTime(46, time + 0.11);
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.linearRampToValueAtTime(0.95 * vel, time + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0008, time + 0.33);
      osc.connect(gain).connect(this.drumsBus);
      osc.start(time);
      osc.stop(time + 0.36);
    }

    snare(time, vel) {
      const ctx = this.ctx;
      const src = ctx.createBufferSource();
      src.buffer = this._noise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1900;
      bp.Q.value = 0.8;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.linearRampToValueAtTime(0.42 * vel, time + 0.003);
      gain.gain.exponentialRampToValueAtTime(0.0008, time + 0.2);
      src.connect(bp).connect(gain).connect(this.drumsBus);
      src.start(time, Math.random() * 1.2);
      src.stop(time + 0.23);

      const tone = ctx.createOscillator();
      const tg = ctx.createGain();
      tone.type = 'triangle';
      tone.frequency.setValueAtTime(196, time);
      tone.frequency.exponentialRampToValueAtTime(150, time + 0.06);
      tg.gain.setValueAtTime(0.0001, time);
      tg.gain.linearRampToValueAtTime(0.22 * vel, time + 0.003);
      tg.gain.exponentialRampToValueAtTime(0.0008, time + 0.12);
      tone.connect(tg).connect(this.drumsBus);
      tone.start(time);
      tone.stop(time + 0.14);
    }

    hat(time, vel, open) {
      const ctx = this.ctx;
      const src = ctx.createBufferSource();
      src.buffer = this._noise;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 7200;
      const gain = ctx.createGain();
      const dur = open ? 0.26 : 0.05;
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.linearRampToValueAtTime(0.17 * vel, time + 0.002);
      gain.gain.exponentialRampToValueAtTime(0.0006, time + dur);
      src.connect(hp).connect(gain).connect(this.drumsBus);
      src.start(time, Math.random() * 1.5);
      src.stop(time + dur + 0.02);
    }

    click(time, accent, vel) {
      const ctx = this.ctx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = accent ? 1600 : 1150;
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.linearRampToValueAtTime(0.2 * vel, time + 0.002);
      gain.gain.exponentialRampToValueAtTime(0.0006, time + 0.05);
      osc.connect(gain).connect(this.clickBus);
      osc.start(time);
      osc.stop(time + 0.06);
    }

    bass(time, chord, token, vel, dur) {
      let offset;
      if (token === '3') offset = chord.minor ? 3 : 4;
      else offset = BASS_TOKENS[token] != null ? BASS_TOKENS[token] : 0;

      const root = rootMidiNear(chord.rootPc, 36);
      const midi = root + offset;
      const ctx = this.ctx;
      const freq = midiToFreq(midi);

      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      const sub = ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.value = freq / 2;

      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 5;
      lp.frequency.setValueAtTime(260, time);
      lp.frequency.exponentialRampToValueAtTime(1250, time + 0.03);
      lp.frequency.exponentialRampToValueAtTime(280, time + dur);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.linearRampToValueAtTime(0.5 * vel, time + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0008, time + dur + 0.06);

      const subGain = ctx.createGain();
      subGain.gain.setValueAtTime(0.0001, time);
      subGain.gain.linearRampToValueAtTime(0.24 * vel, time + 0.014);
      subGain.gain.exponentialRampToValueAtTime(0.0008, time + dur + 0.06);

      osc.connect(lp).connect(gain).connect(this.bassBus);
      sub.connect(subGain).connect(this.bassBus);

      osc.start(time); sub.start(time);
      osc.stop(time + dur + 0.1); sub.stop(time + dur + 0.1);
    }

    comp(time, chord, vel, g) {
      const root = rootMidiNear(chord.rootPc, 52);
      let notes;
      if (g.power) {
        const low = rootMidiNear(chord.rootPc, 45);
        notes = [low, low + 7, low + 12];
      } else {
        notes = chord.tones.map((tone) => root + tone);
        notes = Array.from(new Set(notes)).sort((a, b) => a - b).slice(0, 5);
      }
      const strum = g.compStrum || 0.01;
      const dur = g.compDur || 0.6;
      notes.forEach((midi, i) => this.pluck(time + i * strum, midi, vel * 0.13, dur));
    }

    pluck(time, midi, vel, dur) {
      const ctx = this.ctx;
      const freq = midiToFreq(midi);
      const o1 = ctx.createOscillator();
      o1.type = 'triangle';
      o1.frequency.value = freq;
      const o2 = ctx.createOscillator();
      o2.type = 'sawtooth';
      o2.frequency.value = freq * 1.004;

      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 0.7;
      lp.frequency.setValueAtTime(2800, time);
      lp.frequency.exponentialRampToValueAtTime(900, time + dur * 0.7);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.linearRampToValueAtTime(vel, time + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0006, time + dur);

      const o2g = ctx.createGain();
      o2g.gain.value = 0.5;

      o1.connect(lp);
      o2.connect(o2g).connect(lp);
      lp.connect(gain).connect(this.keysBus);

      o1.start(time); o2.start(time);
      o1.stop(time + dur + 0.06); o2.stop(time + dur + 0.06);
    }

    /* ---------- 给 UI 用的节拍事件 ---------- */
    drain(cb) {
      if (!this.ctx) return;
      const now = this.ctx.currentTime + 0.045;
      while (this.queue.length && this.queue[0].time <= now) {
        cb(this.queue.shift());
      }
      if (this.queue.length > 400) this.queue.splice(0, this.queue.length - 200);
    }
  }

  return new Engine();
})();
