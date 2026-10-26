/* 麦克风跟随：onset 检测 + 速度估计 + 力度跟踪 */
window.FollowEngine = class FollowEngine {
  constructor() {
    this.active = false;
    this.ctx = null;
    this.stream = null;
    this.src = null;
    this.analyser = null;
    this.level = 0;
    this.bpm = null;
    this.confidence = 0;
    this.sensitivity = 6;
    this.autoTempo = true;
    this.lastOnsetAt = 0;
    this.flash = 0;
    this._intervals = [];
    this._fluxHist = [];
    this._prev = null;
    this._raf = null;
    this._lastSent = 0;
    this._lastSentBpm = 0;
    this.onTempo = null;   // (bpm, confidence)
    this.onLevel = null;   // (0..1)
    this.onStatus = null;  // ('listening' | 'idle')
  }

  async start(ctx) {
    if (this.active) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('当前浏览器不支持麦克风');
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    });

    this.ctx = ctx;
    this.stream = stream;
    this.src = ctx.createMediaStreamSource(stream);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0;
    this.src.connect(this.analyser);

    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
    this.timeData = new Uint8Array(this.analyser.fftSize);
    this._prev = new Uint8Array(this.analyser.frequencyBinCount);
    this._intervals = [];
    this._fluxHist = [];
    this.lastOnsetAt = 0;
    this.level = 0;
    this.bpm = null;
    this.confidence = 0;
    this.active = true;
    if (this.onStatus) this.onStatus('listening');
    this._loop();
  }

  stop() {
    this.active = false;
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
    if (this.src) { try { this.src.disconnect(); } catch (e) { /* ignore */ } this.src = null; }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    this.analyser = null;
    this.level = 0;
    this.confidence = 0;
    this.bpm = null;
    if (this.onLevel) this.onLevel(0);
    if (this.onStatus) this.onStatus('idle');
  }

  _loop() {
    if (!this.active) return;
    this._raf = requestAnimationFrame(() => this._loop());
    if (!this.analyser) return;

    this.analyser.getByteTimeDomainData(this.timeData);
    this.analyser.getByteFrequencyData(this.freqData);

    // 音量（RMS）
    let sum = 0;
    for (let i = 0; i < this.timeData.length; i += 2) {
      const v = (this.timeData[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / (this.timeData.length / 2));
    const targetLevel = Math.max(0, Math.min(1, (rms - 0.012) / 0.11));
    this.level = this.level * 0.82 + targetLevel * 0.18;
    if (this.onLevel) this.onLevel(this.level);

    // 频谱通量（低频到 5kHz 左右的拨弦瞬态）
    const bins = Math.min(150, this.freqData.length);
    let flux = 0;
    for (let i = 1; i < bins; i++) {
      const diff = this.freqData[i] - this._prev[i];
      if (diff > 0) flux += diff;
    }
    flux /= bins;
    this._prev.set(this.freqData.subarray(0, bins));

    this._fluxHist.push(flux);
    if (this._fluxHist.length > 48) this._fluxHist.shift();
    const sorted = this._fluxHist.slice().sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length * 0.6)] || 0;
    const mult = 2.6 - (this.sensitivity - 1) * 0.15; // 灵敏度 1→2.6，10→1.25
    const threshold = Math.max(median * mult, 1.6);

    const now = performance.now() / 1000;
    const minGap = 0.11;
    const isOnset = flux > threshold && rms > 0.012 && (now - this.lastOnsetAt) > minGap;

    if (isOnset) {
      const dt = this.lastOnsetAt ? now - this.lastOnsetAt : 0;
      this.lastOnsetAt = now;
      this.flash = 1;

      if (dt > 0.16 && dt < 2.4) {
        let candidate = 60 / dt;
        // 吉他常弹八分/十六分音符，把过快的估算折回常见练习速度
        while (candidate > 150) candidate /= 2;
        while (candidate < 55) candidate *= 2;
        this._intervals.push(candidate);
        if (this._intervals.length > 9) this._intervals.shift();
        this._estimate();
      }
    }

    // 停止演奏后置信度衰减
    if (this.lastOnsetAt && now - this.lastOnsetAt > 2.2) {
      this.confidence *= 0.97;
    }
    this.flash *= 0.9;
  }

  _estimate() {
    if (this._intervals.length < 3) return;
    const arr = this._intervals.slice().sort((a, b) => a - b);
    const median = arr[Math.floor(arr.length / 2)];
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const variance = arr.reduce((a, b) => a + (b - mean) * (b - mean), 0) / arr.length;
    const sd = Math.sqrt(variance);

    this.bpm = median;
    this.confidence = Math.max(0, Math.min(1, 1 - (sd / Math.max(mean, 1)) * 2.2));

    if (!this.autoTempo || !this.onTempo) return;
    if (this.confidence < 0.32) return;

    const wall = performance.now();
    const drifted = Math.abs(median - this._lastSentBpm) > 0.45;
    if (drifted && wall - this._lastSent > 200) {
      this._lastSent = wall;
      this._lastSentBpm = median;
      this.onTempo(median, this.confidence);
    }
  }
};
