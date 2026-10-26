/* 乐理：音名、和弦、风格与和弦进行 */
window.Theory = (function () {
  const SHARP = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  const FLAT = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
  // 这些调更常用降号记谱
  const FLAT_KEYS = new Set([1, 3, 5, 6, 8, 10]);

  const NUMERALS = ['I', '♭II', 'II', '♭III', 'III', 'IV', '♭V', 'V', '♭VI', 'VI', '♭VII', 'VII'];

  const QUALITIES = {
    maj:  { suffix: '',     tones: [0, 4, 7],        minor: false },
    min:  { suffix: 'm',    tones: [0, 3, 7],        minor: true  },
    '7':  { suffix: '7',    tones: [0, 4, 7, 10],    minor: false },
    maj7: { suffix: 'maj7', tones: [0, 4, 7, 11],    minor: false },
    min7: { suffix: 'm7',   tones: [0, 3, 7, 10],    minor: true  },
    m7b5: { suffix: 'm7♭5', tones: [0, 3, 6, 10],    minor: true  },
    dim:  { suffix: 'dim',  tones: [0, 3, 6],        minor: true  },
    sus4: { suffix: 'sus4', tones: [0, 5, 7],        minor: false },
    '6':  { suffix: '6',    tones: [0, 4, 7, 9],     minor: false },
    '9':  { suffix: '9',    tones: [0, 4, 7, 10, 14], minor: false },
    min9: { suffix: 'm9',   tones: [0, 3, 7, 10, 14], minor: true  }
  };

  // 12 小节蓝调：I7 / IV7 / V7
  const BLUES_12 = [
    [0, '7'], [0, '7'], [0, '7'], [0, '7'],
    [5, '7'], [5, '7'], [0, '7'], [0, '7'],
    [7, '7'], [5, '7'], [0, '7'], [7, '7']
  ];

  const STYLES = {
    pop: {
      name: '流行', bpm: 92, mode: '大调',
      prog: [[0, 'maj'], [7, 'maj'], [9, 'min'], [5, 'maj']],
      label: 'Ⅰ–Ⅴ–Ⅵm–Ⅳ',
      desc: '四个和弦的万能进行，适合练旋律、扫弦与副歌感觉。'
    },
    rock: {
      name: '摇滚', bpm: 116, mode: '大调',
      prog: [[0, 'maj'], [10, 'maj'], [5, 'maj'], [0, 'maj']],
      label: 'Ⅰ–♭Ⅶ–Ⅳ–Ⅰ',
      desc: '强拍底鼓配弱力和弦，适合练 riff、闷音与失真 solo。'
    },
    blues: {
      name: '蓝调', bpm: 96, mode: '大调',
      prog: BLUES_12,
      label: '12 小节蓝调',
      desc: '12 小节循环，练 shuffle 律动、boogie 低音与蓝调音阶即兴。'
    },
    funk: {
      name: '放克', bpm: 104, mode: '小调',
      prog: [[0, 'min7'], [0, 'min7'], [10, '7'], [0, 'min7']],
      label: 'ⅰm7 – ♭Ⅶ7',
      desc: '切分鼓点与短促和弦，练十六分音符的右手控制与律动。'
    },
    ballad: {
      name: '抒情', bpm: 72, mode: '大调',
      prog: [[9, 'min'], [5, 'maj'], [0, 'maj'], [7, 'maj']],
      label: 'Ⅵm–Ⅳ–Ⅰ–Ⅴ',
      desc: '慢速铺底，空间大，适合练推弦、长音与情绪控制。'
    },
    jazz: {
      name: '爵士', bpm: 132, mode: '大调',
      prog: [[2, 'min7'], [7, '7'], [0, 'maj7'], [0, 'maj7']],
      label: 'Ⅱm7–Ⅴ7–Ⅰmaj7',
      desc: 'Swing 律动与七和弦色彩，练 ⅱ–Ⅴ–Ⅰ 语汇与 Walking Bass。'
    }
  };

  function mod(n, m) { return ((n % m) + m) % m; }

  function noteName(pc, keyPc) {
    const preferFlat = FLAT_KEYS.has(mod(keyPc, 12));
    return (preferFlat ? FLAT : SHARP)[mod(pc, 12)];
  }

  function keyLabel(keyPc) { return noteName(keyPc, keyPc); }

  function chordFor(styleId, keyPc, barIndex) {
    const st = STYLES[styleId] || STYLES.pop;
    const entry = st.prog[mod(barIndex, st.prog.length)];
    const q = QUALITIES[entry[1]] || QUALITIES.maj;
    const rel = entry[0];
    let numeral = NUMERALS[rel] || '';
    if (q.minor) numeral = numeral.toLowerCase();

    return {
      name: noteName(keyPc + rel, keyPc) + q.suffix,
      numeral: numeral,
      rootPc: mod(keyPc + rel, 12),
      tones: q.tones,
      quality: entry[1],
      minor: q.minor,
      barInProg: mod(barIndex, st.prog.length)
    };
  }

  return { STYLES, QUALITIES, chordFor, noteName, keyLabel, mod };
})();
