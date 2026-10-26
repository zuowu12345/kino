/* 界面逻辑 */
(function () {
  const E = window.AudioEngine;
  const F = new window.FollowEngine();
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const ui = {
    selectedBar: 0,
    activeBar: -1,
    activeBeat: 0,
    followOn: false,
    autoTempo: true,
    autoLevel: true,
    tapTimes: [],
    toastTimer: null
  };

  const STORE_KEY = 'jammate-v1';
  let saveTimer = null;

  /* ---------- 持久化 ---------- */
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify({
          styleId: E.state.styleId,
          keyPc: E.state.keyPc,
          bpm: E.state.bpm,
          metro: E.state.metro,
          countIn: E.state.countIn,
          autoTempo: ui.autoTempo,
          autoLevel: ui.autoLevel,
          sens: +($('#sens').value || 6)
        }));
      } catch (e) { /* ignore */ }
    }, 300);
  }

  function restore() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { saved = null; }
    if (!saved) return;
    if (Theory.STYLES[saved.styleId]) E.setStyle(saved.styleId);
    if (typeof saved.keyPc === 'number') E.setKey(saved.keyPc);
    if (typeof saved.bpm === 'number') E.setBpm(saved.bpm);
    if (typeof saved.metro === 'boolean') E.state.metro = saved.metro;
    if (typeof saved.countIn === 'boolean') E.state.countIn = saved.countIn;
    if (typeof saved.autoTempo === 'boolean') ui.autoTempo = saved.autoTempo;
    if (typeof saved.autoLevel === 'boolean') ui.autoLevel = saved.autoLevel;
    if (saved.sens) $('#sens').value = saved.sens;
  }

  /* ---------- 渲染 ---------- */
  function renderStyles() {
    const wrap = $('#styleChips');
    wrap.innerHTML = '';
    Object.keys(Theory.STYLES).forEach((id) => {
      const st = Theory.STYLES[id];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip' + (id === E.state.styleId ? ' active' : '');
      btn.innerHTML = '<span class="chip-name">' + st.name + '</span><span class="chip-bpm">' + st.bpm + '</span>';
      btn.addEventListener('click', () => chooseStyle(id));
      wrap.appendChild(btn);
    });
    const active = wrap.querySelector('.chip.active');
    if (active && active.scrollIntoView) {
      active.scrollIntoView({ block: 'nearest', inline: 'center' });
    }
  }

  function renderChart() {
    const st = Theory.STYLES[E.state.styleId];
    const chart = $('#chart');
    const prevBar = ui.activeBar;
    const prevBeat = ui.activeBeat;
    chart.innerHTML = '';
    ui.activeBar = -1;
    st.prog.forEach((_, i) => {
      const chord = Theory.chordFor(E.state.styleId, E.state.keyPc, i);
      const bar = document.createElement('button');
      bar.type = 'button';
      bar.className = 'bar';
      bar.dataset.bar = i;
      bar.setAttribute('aria-label', '第 ' + (i + 1) + ' 小节 ' + chord.name);
      bar.innerHTML =
        '<span class="numeral">' + chord.numeral + '</span>' +
        '<span class="chord">' + chord.name + '</span>' +
        '<span class="beats"><i></i><i></i><i></i><i></i></span>';
      bar.addEventListener('click', () => selectBar(i));
      chart.appendChild(bar);
    });
    $('#progName').textContent = st.label;
    $('#styleMeta').textContent = st.desc;
    paintSelection();
    renderLoop();
    if (E.playing && prevBar >= 0 && prevBar < st.prog.length) {
      setActiveBar(prevBar);
      setBeat(prevBar, prevBeat);
    }
  }

  function renderTransport() {
    $('#bpmVal').textContent = E.state.bpm;
    $('#styleBpm').textContent = E.state.bpm + ' BPM · 4/4';
    $('#keyVal').textContent = Theory.keyLabel(E.state.keyPc);
    $('#modeVal').textContent = Theory.STYLES[E.state.styleId].mode;
    $('#metroBtn').classList.toggle('on', E.state.metro);
    $('#countInBtn').classList.toggle('on', E.state.countIn);
  }

  function renderLoop() {
    const loop = E.state.loop;
    const has = loop.a != null && loop.b != null && loop.b > loop.a;
    $$('#chart .bar').forEach((el) => {
      const i = +el.dataset.bar;
      el.classList.toggle('in-loop', has && loop.on && i >= loop.a && i <= loop.b);
      el.dataset.mark = loop.a === i ? 'A' : (loop.b === i ? 'B' : '');
    });
    $('#loopInfo').textContent = has
      ? '循环：第 ' + (loop.a + 1) + '–' + (loop.b + 1) + ' 小节' + (loop.on ? '' : '（已暂停）')
      : '循环：未设置（点小节 → 设 A / 设 B）';
    $('#loopBtn').classList.toggle('on', !!loop.on && has);
    $('#btnClearLoop').disabled = loop.a == null && loop.b == null;
  }

  function paintSelection() {
    $$('#chart .bar').forEach((el, i) => {
      el.classList.toggle('selected', i === ui.selectedBar);
    });
  }

  function setActiveBar(bar) {
    if (ui.activeBar === bar) return;
    ui.activeBar = bar;
    $$('#chart .bar').forEach((el, i) => {
      el.classList.toggle('active', i === bar);
      if (i !== bar) {
        el.querySelectorAll('.beats i').forEach((d) => d.classList.remove('on'));
      }
    });
  }

  function setBeat(bar, beat) {
    ui.activeBeat = beat;
    const el = $('#chart').children[bar];
    if (!el) return;
    el.querySelectorAll('.beats i').forEach((d, i) => d.classList.toggle('on', i === beat));
  }

  function clearPlayingMarks() {
    ui.activeBar = -1;
    $$('#chart .bar').forEach((el) => {
      el.classList.remove('active');
      el.querySelectorAll('.beats i').forEach((d) => d.classList.remove('on'));
    });
  }

  function updateDock(bar, beat) {
    const len = E.progLength();
    const chord = Theory.chordFor(E.state.styleId, E.state.keyPc, bar);
    $('#dockChord').textContent = chord.name;
    $('#dockPos').textContent = '第 ' + (bar + 1) + '/' + len + ' 小节 · 第 ' + (beat + 1) + ' 拍';
  }

  function renderFollow() {
    const btn = $('#followBtn');
    btn.classList.toggle('on', ui.followOn);
    btn.innerHTML = '<span class="dot"></span>' + (ui.followOn ? '关闭麦克风' : '开启麦克风');
    $('#autoTempo').checked = ui.autoTempo;
    $('#autoLevel').checked = ui.autoLevel;
    F.sensitivity = +($('#sens').value || 6);
    F.autoTempo = ui.autoTempo;
    if (!ui.followOn) {
      $('#detBpm').textContent = '—';
      $('#confBar').style.width = '0%';
      $('#levelBar').style.width = '0%';
      $('#lvlVal').textContent = '0%';
    }
  }

  /* ---------- 交互 ---------- */
  function chooseStyle(id) {
    const st = Theory.STYLES[id];
    E.setStyle(id);
    E.setBpm(st.bpm);
    E.state.loop = { a: null, b: null, on: false };
    ui.selectedBar = 0;
    clearPlayingMarks();
    if (E.playing) E.jumpToBar(0);
    $$('#styleChips .chip').forEach((el, i) => {
      el.classList.toggle('active', Object.keys(Theory.STYLES)[i] === id);
    });
    renderChart();
    renderTransport();
    if (E.playing) {
      setActiveBar(0);
      updateDock(0, 0);
    } else {
      updateDock(0, 0);
    }
    save();
    toast(st.name + '伴奏 · ' + st.label);
  }

  function setBpm(value, manual) {
    const bpm = E.setBpm(value);
    $('#bpmVal').textContent = bpm;
    $('#styleBpm').textContent = bpm + ' BPM · 4/4';
    if (manual && ui.followOn && ui.autoTempo) {
      ui.autoTempo = false;
      $('#autoTempo').checked = false;
      F.autoTempo = false;
    }
    save();
  }

  function tapTempo() {
    const now = performance.now();
    ui.tapTimes = ui.tapTimes.filter((t) => now - t < 2600);
    ui.tapTimes.push(now);
    $('#tapTempo').classList.add('hit');
    setTimeout(() => $('#tapTempo').classList.remove('hit'), 120);
    if (ui.tapTimes.length < 2) return;
    const gaps = [];
    for (let i = 1; i < ui.tapTimes.length; i++) gaps.push(ui.tapTimes[i] - ui.tapTimes[i - 1]);
    gaps.sort((a, b) => a - b);
    const median = gaps[Math.floor(gaps.length / 2)];
    if (median > 240) setBpm(60000 / median, true);
  }

  function selectBar(i) {
    ui.selectedBar = i;
    paintSelection();
    if (E.playing) {
      E.jumpToBar(i);
      setActiveBar(i);
      setBeat(i, 0);
      updateDock(i, 0);
    } else {
      updateDock(i, 0);
    }
  }

  function setLoopA() {
    const i = ui.selectedBar;
    E.state.loop.a = i;
    if (E.state.loop.b != null && E.state.loop.b <= i) {
      E.state.loop.b = Math.min(i + 1, E.progLength() - 1);
    }
    const has = E.state.loop.b != null && E.state.loop.b > E.state.loop.a;
    E.state.loop.on = has;
    renderLoop();
    toast(has ? '循环：第 ' + (E.state.loop.a + 1) + '–' + (E.state.loop.b + 1) + ' 小节' : '已设 A 段，再选一个小节设 B');
  }

  function setLoopB() {
    const i = ui.selectedBar;
    let a = E.state.loop.a;
    if (a == null) a = 0;
    if (i <= a) {
      toast('B 需要设在 A 之后的小节');
      return;
    }
    E.state.loop.a = a;
    E.state.loop.b = i;
    E.state.loop.on = true;
    renderLoop();
    toast('循环：第 ' + (a + 1) + '–' + (i + 1) + ' 小节');
  }

  function clearLoop() {
    E.state.loop = { a: null, b: null, on: false };
    renderLoop();
    toast('已清除循环');
  }

  function toggleLoop() {
    const loop = E.state.loop;
    const has = loop.a != null && loop.b != null && loop.b > loop.a;
    if (!has) { toast('先点小节，再设 A / 设 B'); return; }
    loop.on = !loop.on;
    renderLoop();
    toast(loop.on ? '循环开启' : '循环关闭，继续往后走');
  }

  function updatePlayingUI(playing) {
    $('#playBtn').classList.toggle('playing', playing);
    $('#iconPlay').classList.toggle('hidden', playing);
    $('#iconPause').classList.toggle('hidden', !playing);
    $('#playBtn').setAttribute('aria-label', playing ? '停止' : '播放');
  }

  async function togglePlay() {
    if (!E.playing) {
      try {
        await E.play();
      } catch (err) {
        toast('音频启动失败：' + (err.message || ''));
        return;
      }
      updatePlayingUI(true);
      ui.activeBar = -1;
      $('#dockChord').textContent = '预备';
      $('#dockPos').textContent = (E.state.countIn ? '预备拍 · 1 小节后进入' : '开始') + ' · ' + E.state.bpm + ' BPM';
    } else {
      E.stop();
      updatePlayingUI(false);
      clearPlayingMarks();
      updateDock(ui.selectedBar, 0);
    }
  }

  function applyEvent(ev) {
    if (ev.bar === -1) {
      $('#dockChord').textContent = '预备';
      $('#dockPos').textContent = '预备拍 · 第 ' + (Math.floor(ev.step / 4) + 1) + '/4 拍';
      return;
    }
    setActiveBar(ev.bar);
    if (ev.step % 4 === 0) {
      const beat = ev.step / 4;
      setBeat(ev.bar, beat);
      updateDock(ev.bar, beat);
    }
  }

  /* ---------- 跟随演奏 ---------- */
  async function toggleFollow() {
    if (!ui.followOn) {
      try {
        E.init();
        if (E.ctx.state === 'suspended') await E.ctx.resume();
        F.sensitivity = +($('#sens').value || 6);
        F.autoTempo = ui.autoTempo;
        await F.start(E.ctx);
        ui.followOn = true;
        renderFollow();
        toast('麦克风已开启 · 弹几个音试试');
      } catch (err) {
        toast('麦克风无法开启：' + (err.message || '请检查权限'));
      }
    } else {
      F.stop();
      ui.followOn = false;
      E.setIntensity(0.8);
      renderFollow();
      toast('已关闭跟随，伴奏保持完整层次');
    }
  }

  function setupFollow() {
    F.onTempo = (target, conf) => {
      if (!ui.autoTempo) return;
      const cur = E.state.bpm;
      const next = cur + (target - cur) * (0.16 + 0.4 * conf);
      setBpm(next, false);
    };
    F.onLevel = (lvl) => {
      if (!ui.autoLevel) return;
      E.setIntensity(0.4 + lvl * 0.6);
    };
    F.onStatus = (status) => {
      if (status === 'idle') {
        $('#detBpm').textContent = '—';
        $('#confBar').style.width = '0%';
      }
    };
  }

  function updateFollowMeters() {
    const live = F.active;
    $('#detBpm').textContent = live && F.bpm && F.confidence > 0.2 ? Math.round(F.bpm) : '—';
    $('#confBar').style.width = (live ? Math.round(F.confidence * 100) : 0) + '%';
    const lvl = live ? Math.round(F.level * 100) : 0;
    $('#levelBar').style.width = lvl + '%';
    $('#lvlVal').textContent = lvl + '%';
    const sounding = live && (performance.now() / 1000 - F.lastOnsetAt) < 0.35;
    $('#followBtn').classList.toggle('live', !!sounding);
  }

  /* ---------- 杂项 ---------- */
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(ui.toastTimer);
    ui.toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  function shiftKey(delta) {
    const active = ui.activeBar;
    E.setKey(E.state.keyPc + delta);
    renderChart();
    renderTransport();
    if (E.playing && active >= 0) updateDock(active, ui.activeBeat);
    else updateDock(ui.selectedBar, 0);
    save();
  }

  function openHelp() { $('#helpBackdrop').hidden = false; }
  function closeHelp() { $('#helpBackdrop').hidden = true; }

  function bind() {
    $('#btnHelp').addEventListener('click', openHelp);
    $('#helpClose').addEventListener('click', closeHelp);
    $('#helpBackdrop').addEventListener('click', (e) => {
      if (e.target === $('#helpBackdrop')) closeHelp();
    });

    $('#bpmDown').addEventListener('click', () => setBpm(E.state.bpm - 2, true));
    $('#bpmUp').addEventListener('click', () => setBpm(E.state.bpm + 2, true));
    $('#tapTempo').addEventListener('click', tapTempo);

    $('#keyDown').addEventListener('click', () => shiftKey(-1));
    $('#keyUp').addEventListener('click', () => shiftKey(1));

    $('#metroBtn').addEventListener('click', () => {
      E.state.metro = !E.state.metro;
      renderTransport();
      save();
    });
    $('#countInBtn').addEventListener('click', () => {
      E.state.countIn = !E.state.countIn;
      renderTransport();
      save();
    });

    $('#btnSetA').addEventListener('click', setLoopA);
    $('#btnSetB').addEventListener('click', setLoopB);
    $('#btnClearLoop').addEventListener('click', clearLoop);
    $('#loopBtn').addEventListener('click', toggleLoop);
    $('#playBtn').addEventListener('click', togglePlay);

    $('#followBtn').addEventListener('click', toggleFollow);
    $('#autoTempo').addEventListener('change', (e) => {
      ui.autoTempo = e.target.checked;
      F.autoTempo = ui.autoTempo;
      save();
    });
    $('#autoLevel').addEventListener('change', (e) => {
      ui.autoLevel = e.target.checked;
      if (!ui.autoLevel) E.setIntensity(0.8);
      save();
    });
    $('#sens').addEventListener('input', (e) => {
      F.sensitivity = +e.target.value;
      save();
    });

    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setBpm(E.state.bpm + 2, true); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setBpm(E.state.bpm - 2, true); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); shiftKey(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); shiftKey(-1); }
      else if (e.key === 'l' || e.key === 'L') { toggleLoop(); }
      else if (e.key === 't' || e.key === 'T') { tapTempo(); }
    });
  }

  let lastMeter = 0;
  function frame(ts) {
    requestAnimationFrame(frame);
    if (E.playing) E.drain(applyEvent);
    if (ui.followOn && ts - lastMeter > 90) {
      lastMeter = ts;
      updateFollowMeters();
    }
  }

  function init() {
    restore();
    renderStyles();
    renderChart();
    renderTransport();
    renderLoop();
    renderFollow();
    updateDock(ui.selectedBar, 0);
    setupFollow();
    bind();
    requestAnimationFrame(frame);
  }

  init();
})();
