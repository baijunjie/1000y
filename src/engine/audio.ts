/** 全程序合成的音效、环境声与五声音阶配乐，不依赖任何音频文件。 */
export class Audio {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private ambBus!: GainNode;
  private reverb!: ConvolverNode;
  private noiseBuf!: AudioBuffer;
  private mood = 'town';
  private night = 0;
  private nextBeat = 0;
  private beat = 0;
  private degree = 2;
  private windGain!: GainNode;
  private waterGain!: GainNode;
  private chirpT = 0;
  volume = 0.6;

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain(); this.master.gain.value = this.volume; this.master.connect(ctx.destination);
    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = 0.9; this.sfxBus.connect(this.master);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = 0.5; this.musicBus.connect(this.master);
    this.ambBus = ctx.createGain(); this.ambBus.gain.value = 0.5; this.ambBus.connect(this.master);
    // 混响：衰减噪声脉冲
    const len = ctx.sampleRate * 2.6, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    this.reverb = ctx.createConvolver(); this.reverb.buffer = ir;
    const rg = ctx.createGain(); rg.gain.value = 0.34; this.reverb.connect(rg); rg.connect(this.master);
    this.musicBus.connect(this.reverb);
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    // 风声与水声（常驻）
    const loop = (freq: number, q: number) => {
      const s = ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      s.connect(f); f.connect(g); g.connect(this.ambBus); s.start();
      return { g, f };
    };
    const wind = loop(420, 0.5); this.windGain = wind.g;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.09; const lg = ctx.createGain(); lg.gain.value = 180; lfo.connect(lg); lg.connect(wind.f.frequency); lfo.start();
    this.waterGain = loop(1500, 0.7).g;
    this.nextBeat = ctx.currentTime + 0.6;
  }

  setVolume(v: number) { this.volume = v; if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }

  private noise(dur: number, freq: number, q: number, vol: number, type: BiquadFilterType = 'bandpass', sweepTo?: number, delay = 0) {
    const ctx = this.ctx!; const t = ctx.currentTime + delay;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loopStart = Math.random(); s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.02, dur * 0.3)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.sfxBus); s.start(t, Math.random()); s.stop(t + dur + 0.02);
  }
  private tone(freq: number, dur: number, vol: number, type: OscillatorType = 'sine', bus?: AudioNode, slideTo?: number, delay = 0, attack = 0.005) {
    const ctx = this.ctx!; const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(bus ?? this.sfxBus); o.start(t); o.stop(t + dur + 0.02);
  }
  /** 拨弦：两个略失谐的三角波 + 泛音 */
  private pluck(freq: number, vol: number, dur = 2.2, delay = 0) {
    this.tone(freq, dur, vol, 'triangle', this.musicBus, undefined, delay, 0.004);
    this.tone(freq * 1.004, dur * 0.8, vol * 0.5, 'triangle', this.musicBus, undefined, delay, 0.004);
    this.tone(freq * 2, dur * 0.35, vol * 0.3, 'sine', this.musicBus, undefined, delay, 0.003);
    this.tone(freq * 3.01, dur * 0.16, vol * 0.14, 'sine', this.musicBus, undefined, delay, 0.002);
  }
  /** 箫：带颤音的柔和长音 */
  private flute(freq: number, dur: number, vol: number, delay = 0) {
    const ctx = this.ctx!; const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
    const v = ctx.createOscillator(); v.frequency.value = 5.2; const vg = ctx.createGain(); vg.gain.setValueAtTime(0, t); vg.gain.linearRampToValueAtTime(freq * 0.012, t + dur * 0.6);
    v.connect(vg); vg.connect(o.frequency);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.18); g.gain.setValueAtTime(vol, t + dur * 0.7); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.musicBus); o.start(t); v.start(t); o.stop(t + dur + 0.05); v.stop(t + dur + 0.05);
    const n = ctx.createBufferSource(); n.buffer = this.noiseBuf; n.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq * 2; f.Q.value = 3;
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0.0001, t); ng.gain.linearRampToValueAtTime(vol * 0.12, t + 0.1); ng.gain.linearRampToValueAtTime(0.0001, t + dur);
    n.connect(f); f.connect(ng); ng.connect(this.musicBus); n.start(t); n.stop(t + dur + 0.05);
  }

  sfx(name: string, vol = 0.6) {
    if (!this.ctx || this.volume <= 0) return;
    const v = vol;
    switch (name) {
      case 'swing': this.noise(0.16, 900, 1.2, v * 0.5, 'bandpass', 3200); break;
      case 'punch': this.noise(0.1, 500, 1, v * 0.5, 'bandpass', 1400); break;
      case 'bow': this.tone(320, 0.16, v * 0.35, 'triangle', undefined, 150); this.noise(0.2, 2400, 2, v * 0.3, 'bandpass', 5200, 0.02); break;
      case 'miss': this.noise(0.12, 2000, 0.8, v * 0.3, 'highpass'); break;
      case 'hit': this.tone(150, 0.12, v * 0.8, 'sine', undefined, 60); this.noise(0.09, 1400, 0.8, v * 0.6, 'lowpass'); break;
      case 'crit': this.tone(130, 0.18, v, 'sine', undefined, 46); this.noise(0.14, 2600, 0.8, v * 0.7, 'lowpass'); this.tone(1900, 0.3, v * 0.2, 'triangle', undefined, 1500); break;
      case 'hurt': this.tone(190, 0.16, v * 0.7, 'sawtooth', undefined, 90); this.noise(0.1, 700, 1, v * 0.5, 'lowpass'); break;
      case 'die': this.tone(170, 0.5, v * 0.6, 'sawtooth', undefined, 50); this.noise(0.3, 400, 0.7, v * 0.4, 'lowpass'); break;
      case 'step': this.noise(0.05, 300 + Math.random() * 200, 0.9, v * 0.3, 'lowpass'); break;
      case 'pick': this.tone(880, 0.12, v * 0.3, 'triangle'); this.tone(1320, 0.18, v * 0.3, 'triangle', undefined, undefined, 0.07); break;
      case 'coin': this.tone(1568, 0.1, v * 0.3, 'square'); this.tone(2093, 0.18, v * 0.25, 'square', undefined, undefined, 0.06); break;
      case 'ui': this.tone(660, 0.07, v * 0.25, 'triangle'); break;
      case 'drink': this.tone(420, 0.1, v * 0.3, 'sine', undefined, 640); this.tone(520, 0.1, v * 0.3, 'sine', undefined, 760, 0.1); break;
      case 'skill': this.noise(0.4, 500, 0.8, v * 0.6, 'bandpass', 4200); this.tone(587, 0.5, v * 0.3, 'triangle', undefined, 1175); break;
      case 'quest': [587, 740, 880].forEach((f, i) => this.tone(f, 0.5, v * 0.3, 'triangle', undefined, undefined, i * 0.11)); break;
      case 'levelup': [587, 660, 740, 880, 1175].forEach((f, i) => this.tone(f, 0.6, v * 0.28, 'triangle', undefined, undefined, i * 0.07)); break;
    }
  }

  /** 每帧调用：根据区域氛围与昼夜推进配乐和环境声 */
  update(dt: number, mood: string, night: number, nearWater: number, fighting: boolean) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    this.mood = fighting ? 'danger' : mood; this.night = night;
    const now = ctx.currentTime;
    this.windGain.gain.setTargetAtTime(0.05 + (mood === 'town' ? 0 : 0.05) + night * 0.03, now, 0.5);
    this.waterGain.gain.setTargetAtTime(nearWater * 0.16, now, 0.4);
    // 鸟鸣 / 虫鸣
    this.chirpT -= dt;
    if (this.chirpT <= 0) {
      if (night > 0.6) {
        this.chirpT = 0.5 + Math.random() * 1.6;
        const f = 4200 + Math.random() * 600;
        for (let i = 0; i < 3; i++) this.tone(f, 0.04, 0.035, 'sine', this.ambBus, undefined, i * 0.07);
      } else {
        this.chirpT = 2 + Math.random() * 6;
        const f = 2200 + Math.random() * 1600, n = 2 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i++) this.tone(f * (1 + i * 0.06), 0.09, 0.05, 'sine', this.ambBus, f * 1.35, i * 0.13);
      }
    }
    // 配乐：五声音阶上的随机游走
    while (this.nextBeat < now + 0.25) {
      const m = this.mood;
      const base = m === 'danger' ? 146.83 : 196.0;                       // D3 / G3
      const scale = m === 'danger' ? [0, 3, 5, 7, 10] : [0, 2, 4, 7, 9];   // 羽调 / 宫调
      const step = m === 'danger' ? 0.3 : m === 'town' ? 0.5 : 0.62;
      const density = m === 'danger' ? 0.72 : m === 'town' ? 0.5 : 0.36;
      const at = this.nextBeat - now;
      const note = (deg: number, oct = 0) => base * Math.pow(2, (scale[((deg % 5) + 5) % 5] + 12 * (Math.floor(deg / 5) + oct)) / 12);
      if (Math.random() < density || this.beat % 8 === 0) {
        this.degree = Math.max(0, Math.min(11, this.degree + [-2, -1, -1, 1, 1, 2, 0][Math.floor(Math.random() * 7)]));
        this.pluck(note(this.degree, 1), m === 'danger' ? 0.11 : 0.09, 2.4, at);
        if (Math.random() < 0.22) this.pluck(note(this.degree + 2, 1), 0.06, 2, at + step * 0.5);
      }
      if (this.beat % 8 === 0) this.pluck(note(0, -1), 0.12, 3.2, at);
      if (this.beat % 8 === 4 && Math.random() < 0.6) this.pluck(note(3, -1), 0.08, 3, at);
      if (this.beat % 16 === 6 && m !== 'danger' && Math.random() < 0.75) {
        const d0 = 5 + Math.floor(Math.random() * 4);
        this.flute(note(d0, 1), step * 3.2, 0.05, at);
        this.flute(note(d0 + (Math.random() < 0.5 ? 1 : -1), 1), step * 4, 0.045, at + step * 3.4);
      }
      if (m === 'danger' && this.beat % 4 === 0) { const t = at; this.tone(72, 0.22, 0.2, 'sine', this.musicBus, 44, t); }
      this.beat++;
      this.nextBeat += step;
    }
  }
}
