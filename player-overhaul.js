(() => {
  if (window.__YUME_PLAYER_OVERHAUL_V1) return;
  window.__YUME_PLAYER_OVERHAUL_V1 = true;

  const $ = s => document.querySelector(s);
  const fmt = value => {
    const s = Math.max(0, Number(value) || 0);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
    return h ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}` : `${m}:${String(sec).padStart(2,'0')}`;
  };

  function installStyles() {
    if ($('#yumePlayerOverhaulStyles')) return;
    const style = document.createElement('style');
    style.id = 'yumePlayerOverhaulStyles';
    style.textContent = `
      .yume-player{
        border-radius:26px!important;
        border:1px solid rgba(255,255,255,.13)!important;
        background:radial-gradient(circle at 50% 38%,#151525 0,#08090f 56%,#030408 100%)!important;
        box-shadow:0 28px 90px rgba(0,0,0,.52),0 0 0 1px rgba(255,255,255,.025) inset,0 0 55px color-mix(in srgb,var(--accent) 10%,transparent)!important;
      }
      .yume-player:before{content:"";position:absolute;inset:0;z-index:3;pointer-events:none;border-radius:inherit;box-shadow:inset 0 1px 0 rgba(255,255,255,.08),inset 0 -80px 100px rgba(0,0,0,.18)}
      .player-vignette{z-index:2!important;background:linear-gradient(180deg,rgba(3,4,8,.5) 0,transparent 23%,transparent 55%,rgba(3,4,8,.88) 100%)!important}
      .player-topline{z-index:8!important;padding:18px 20px!important}
      .player-topline>div:first-child{padding:8px 11px;border-radius:999px;background:rgba(7,8,13,.48);border:1px solid rgba(255,255,255,.10);backdrop-filter:blur(18px);box-shadow:0 10px 30px rgba(0,0,0,.18)}
      .player-brand-dot{width:8px!important;height:8px!important;box-shadow:0 0 0 4px color-mix(in srgb,var(--accent) 14%,transparent),0 0 20px var(--accent)!important}
      .player-badges span{border-radius:999px!important;padding:8px 11px!important;background:rgba(7,8,13,.55)!important;border-color:rgba(255,255,255,.11)!important;backdrop-filter:blur(18px)!important}
      .center-play{z-index:8!important;width:88px!important;height:88px!important;border:1px solid rgba(255,255,255,.27)!important;background:linear-gradient(135deg,#ff255f 0%,var(--accent) 46%,#8b4dff 100%)!important;box-shadow:0 18px 50px color-mix(in srgb,var(--accent) 38%,transparent),0 0 0 10px rgba(255,255,255,.04)!important;font-size:29px!important;backdrop-filter:blur(10px);transition:transform .18s ease,filter .18s ease,opacity .2s ease!important}
      .center-play:hover{transform:translate(-50%,-50%) scale(1.08)!important;filter:brightness(1.08)}
      .player-controls{z-index:9!important;left:14px!important;right:14px!important;bottom:14px!important;padding:10px 12px 11px!important;border-radius:18px!important;background:linear-gradient(145deg,rgba(13,14,21,.78),rgba(6,7,11,.70))!important;border:1px solid rgba(255,255,255,.11)!important;backdrop-filter:blur(24px) saturate(1.25)!important;box-shadow:0 18px 55px rgba(0,0,0,.38)!important}
      .progress,.yume-x-progress{appearance:none;-webkit-appearance:none;height:5px!important;border-radius:999px!important;background:linear-gradient(90deg,var(--accent) 0 var(--yume-progress,0%),rgba(255,255,255,.22) var(--yume-progress,0%) 100%)!important;outline:none!important;margin:0 0 10px!important;cursor:pointer}
      .progress::-webkit-slider-thumb,.yume-x-progress::-webkit-slider-thumb{appearance:none;-webkit-appearance:none;width:15px;height:15px;border-radius:50%;background:#fff;border:3px solid var(--accent);box-shadow:0 0 0 4px color-mix(in srgb,var(--accent) 18%,transparent),0 4px 10px rgba(0,0,0,.3)}
      .progress::-moz-range-thumb,.yume-x-progress::-moz-range-thumb{width:12px;height:12px;border-radius:50%;background:#fff;border:3px solid var(--accent)}
      .control-btn,.yume-x-btn{border:1px solid rgba(255,255,255,.09)!important;background:rgba(255,255,255,.065)!important;color:#fff!important;border-radius:11px!important;min-width:38px!important;height:38px!important;padding:0 10px!important;font-weight:850!important;box-shadow:none!important;transition:.16s ease!important}
      .control-btn:hover,.yume-x-btn:hover{background:rgba(255,255,255,.13)!important;border-color:rgba(255,255,255,.16)!important;transform:translateY(-1px)}
      .primary-control,.yume-x-btn.is-primary{background:linear-gradient(135deg,#ff285d,var(--accent))!important;border-color:transparent!important;box-shadow:0 8px 24px color-mix(in srgb,var(--accent) 30%,transparent)!important}
      .time-label,.yume-x-time{font-variant-numeric:tabular-nums;font-size:12px;color:#eef0f6;white-space:nowrap;letter-spacing:.01em}
      .volume,.yume-x-volume{appearance:none;-webkit-appearance:none;width:76px;height:4px;border-radius:999px;background:rgba(255,255,255,.22);accent-color:var(--accent)}
      .player-select,.yume-x-speed{height:38px!important;border:1px solid rgba(255,255,255,.10)!important;border-radius:11px!important;background:rgba(255,255,255,.065)!important;color:#fff!important;padding:0 10px!important}
      .yume-player:hover .player-controls{border-color:rgba(255,255,255,.16)!important}
      .yume-player.external-active .player-poster-layer,.yume-player.external-active .player-vignette{opacity:0!important}

      .yume-x-video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#020307;z-index:5;border-radius:inherit}
      .yume-x-layer{position:absolute;inset:0;z-index:12;pointer-events:none;transition:opacity .2s ease}
      .yume-x-layer.is-hidden{opacity:0}
      .yume-x-top{position:absolute;left:18px;right:18px;top:16px;display:flex;justify-content:space-between;gap:10px;align-items:center;color:#fff;pointer-events:none}
      .yume-x-brand,.yume-x-provider{display:flex;align-items:center;gap:8px;padding:8px 11px;border-radius:999px;background:rgba(7,8,13,.55);border:1px solid rgba(255,255,255,.11);backdrop-filter:blur(18px);font-size:11px;font-weight:900;letter-spacing:.07em}
      .yume-x-brand i{width:8px;height:8px;border-radius:50%;background:var(--accent);box-shadow:0 0 18px var(--accent)}
      .yume-x-provider{letter-spacing:0;text-transform:none;color:#f2f3f7}
      .yume-x-center{pointer-events:auto;position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:88px;height:88px;border-radius:50%;border:1px solid rgba(255,255,255,.27);background:linear-gradient(135deg,#ff255f,var(--accent) 48%,#8b4dff);color:#fff;font-size:29px;cursor:pointer;box-shadow:0 18px 50px color-mix(in srgb,var(--accent) 38%,transparent),0 0 0 10px rgba(255,255,255,.04);transition:.18s ease}
      .yume-x-center:hover{transform:translate(-50%,-50%) scale(1.08);filter:brightness(1.08)}
      .yume-x-center.is-playing{opacity:0;pointer-events:none}
      .yume-x-dock{pointer-events:auto;position:absolute;left:14px;right:14px;bottom:14px;padding:10px 12px 11px;border-radius:18px;background:linear-gradient(145deg,rgba(13,14,21,.82),rgba(6,7,11,.74));border:1px solid rgba(255,255,255,.11);backdrop-filter:blur(24px) saturate(1.25);box-shadow:0 18px 55px rgba(0,0,0,.42)}
      .yume-x-progress{width:100%}
      .yume-x-row{display:flex;align-items:center;gap:8px}
      .yume-x-spacer{flex:1}
      .yume-x-volume{width:78px}
      .yume-x-speed{min-width:68px;outline:none}
      .yume-x-live{font-size:10px;color:#9ca3b2;border:1px solid rgba(255,255,255,.10);border-radius:999px;padding:5px 8px;background:rgba(255,255,255,.045)}
      .yume-x-buffer{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:none;z-index:2;width:46px;height:46px;border-radius:50%;border:3px solid rgba(255,255,255,.16);border-top-color:var(--accent);animation:yumeSpin .75s linear infinite}
      .yume-x-buffer.show{display:block}
      @keyframes yumeSpin{to{transform:translate(-50%,-50%) rotate(360deg)}}

      @media(max-width:720px){
        .player-controls{left:7px!important;right:7px!important;bottom:7px!important;padding:8px!important;border-radius:14px!important}
        .control-btn,.yume-x-btn{min-width:34px!important;height:34px!important;padding:0 8px!important}
        .center-play,.yume-x-center{width:68px!important;height:68px!important;font-size:24px!important}
        .player-topline{padding:11px!important}.player-topline>div:first-child{padding:6px 9px}
        .player-badges span{padding:6px 8px!important;font-size:10px}
        .time-label,.yume-x-time{font-size:10px}.volume,.yume-x-volume{display:none}
        .player-select,.yume-x-speed{height:34px!important;max-width:72px!important;padding:0 7px!important}
        .yume-x-dock{left:7px;right:7px;bottom:7px;padding:8px;border-radius:14px}
        .yume-x-top{left:10px;right:10px;top:10px}.yume-x-brand,.yume-x-provider{padding:6px 8px;font-size:9px}
        .yume-x-live{display:none}
      }
    `;
    document.head.appendChild(style);
  }

  function setProgressStyle(input, value) {
    const pct = Math.max(0, Math.min(100, Number(value) || 0));
    input?.style.setProperty('--yume-progress', `${pct}%`);
  }

  function polishNativeProgress() {
    const progress = $('#progress');
    const video = $('#yumeVideo');
    if (!progress || !video) return;
    const sync = () => {
      const duration = Number(video.duration || 0);
      setProgressStyle(progress, duration ? (Number(video.currentTime || 0) / duration) * 100 : 0);
    };
    ['timeupdate','loadedmetadata','durationchange','seeking'].forEach(e => video.addEventListener(e, sync));
    progress.addEventListener('input', () => setProgressStyle(progress, Number(progress.value || 0) / 10));
    sync();
  }

  function teardownExternalUI() {
    $('#yumeXLayer')?.remove();
    $('#yumePlayer')?.classList.remove('external-active');
  }

  function mountExternalUI(video) {
    if (!video || video.dataset.yumeOverhauled === '1') return;
    video.dataset.yumeOverhauled = '1';
    video.controls = false;
    video.removeAttribute('controls');
    video.classList.add('yume-x-video');
    video.style.zIndex = '5';

    const player = $('#yumePlayer');
    if (!player) return;
    teardownExternalUI();
    player.classList.add('external-active');

    const provider = window.YUME_ACTIVE_PROVIDER || {};
    const episode = $('#currentEpisodeBadge')?.textContent?.trim() || 'Серия';
    const providerName = provider.name || provider.source || $('#currentQualityBadge')?.textContent?.trim() || 'Источник';
    const shell = document.createElement('div');
    shell.id = 'yumeXLayer';
    shell.className = 'yume-x-layer';
    shell.innerHTML = `
      <div class="yume-x-top">
        <div class="yume-x-brand"><i></i><span>YUME PLAYER</span></div>
        <div class="yume-x-provider"><span>${episode}</span><span>·</span><b>${providerName}</b></div>
      </div>
      <div class="yume-x-buffer"></div>
      <button class="yume-x-center" type="button" aria-label="Воспроизвести">▶</button>
      <div class="yume-x-dock">
        <input class="yume-x-progress" type="range" min="0" max="1000" value="0" aria-label="Прогресс">
        <div class="yume-x-row">
          <button class="yume-x-btn is-primary yume-x-play" type="button" aria-label="Пауза">▶</button>
          <button class="yume-x-btn yume-x-back" type="button" aria-label="Назад 10 секунд">↶10</button>
          <button class="yume-x-btn yume-x-forward" type="button" aria-label="Вперёд 10 секунд">10↷</button>
          <span class="yume-x-time">0:00 / 0:00</span>
          <span class="yume-x-live">${providerName}</span>
          <span class="yume-x-spacer"></span>
          <button class="yume-x-btn yume-x-mute" type="button" aria-label="Звук">🔊</button>
          <input class="yume-x-volume" type="range" min="0" max="1" step="0.05" value="1" aria-label="Громкость">
          <select class="yume-x-speed" aria-label="Скорость"><option value="0.75">0.75×</option><option value="1" selected>1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select>
          <button class="yume-x-btn yume-x-full" type="button" aria-label="Полный экран">⛶</button>
        </div>
      </div>`;
    player.appendChild(shell);

    const progress = shell.querySelector('.yume-x-progress');
    const play = shell.querySelector('.yume-x-play');
    const center = shell.querySelector('.yume-x-center');
    const time = shell.querySelector('.yume-x-time');
    const mute = shell.querySelector('.yume-x-mute');
    const volume = shell.querySelector('.yume-x-volume');
    const speed = shell.querySelector('.yume-x-speed');
    const buffer = shell.querySelector('.yume-x-buffer');
    let hideTimer = 0;

    const sync = () => {
      const duration = Number(video.duration || 0);
      const current = Number(video.currentTime || 0);
      progress.value = duration ? Math.round((current / duration) * 1000) : 0;
      setProgressStyle(progress, duration ? (current / duration) * 100 : 0);
      time.textContent = `${fmt(current)} / ${fmt(duration)}`;
      const playing = !video.paused && !video.ended;
      play.textContent = playing ? '❚❚' : '▶';
      center.textContent = playing ? '❚❚' : '▶';
      center.classList.toggle('is-playing', playing);
      mute.textContent = video.muted || video.volume === 0 ? '🔇' : '🔊';
      volume.value = String(video.volume);
    };

    const toggle = () => video.paused ? video.play().catch(() => {}) : video.pause();
    const reveal = () => {
      shell.classList.remove('is-hidden');
      clearTimeout(hideTimer);
      if (!video.paused) hideTimer = setTimeout(() => shell.classList.add('is-hidden'), 2600);
    };

    play.addEventListener('click', toggle);
    center.addEventListener('click', toggle);
    video.addEventListener('click', toggle);
    shell.querySelector('.yume-x-back').addEventListener('click', () => { video.currentTime = Math.max(0, Number(video.currentTime || 0) - 10); });
    shell.querySelector('.yume-x-forward').addEventListener('click', () => { video.currentTime = Math.min(Number(video.duration || Infinity), Number(video.currentTime || 0) + 10); });
    progress.addEventListener('input', () => {
      const duration = Number(video.duration || 0);
      if (duration) video.currentTime = Number(progress.value || 0) / 1000 * duration;
      setProgressStyle(progress, Number(progress.value || 0) / 10);
    });
    mute.addEventListener('click', () => { video.muted = !video.muted; sync(); });
    volume.addEventListener('input', () => { video.volume = Number(volume.value); video.muted = video.volume === 0; sync(); });
    speed.addEventListener('change', () => { video.playbackRate = Number(speed.value || 1); });
    shell.querySelector('.yume-x-full').addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen?.(); else player.requestFullscreen?.();
    });

    ['play','pause','timeupdate','loadedmetadata','durationchange','volumechange','ratechange','ended'].forEach(e => video.addEventListener(e, () => { sync(); reveal(); }));
    video.addEventListener('waiting', () => buffer.classList.add('show'));
    video.addEventListener('playing', () => buffer.classList.remove('show'));
    video.addEventListener('canplay', () => buffer.classList.remove('show'));
    player.addEventListener('mousemove', reveal);
    player.addEventListener('touchstart', reveal, { passive:true });
    player.addEventListener('dblclick', () => { if (document.fullscreenElement) document.exitFullscreen?.(); else player.requestFullscreen?.(); });

    const keyHandler = e => {
      if (!document.body.contains(video)) return;
      if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) return;
      if (e.code === 'Space') { e.preventDefault(); toggle(); }
      else if (e.key === 'ArrowLeft') video.currentTime = Math.max(0, video.currentTime - 10);
      else if (e.key === 'ArrowRight') video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 10);
      else if (e.key.toLowerCase() === 'f') { if (document.fullscreenElement) document.exitFullscreen?.(); else player.requestFullscreen?.(); }
    };
    document.addEventListener('keydown', keyHandler);

    const cleanupObserver = new MutationObserver(() => {
      if (!document.body.contains(video)) {
        document.removeEventListener('keydown', keyHandler);
        cleanupObserver.disconnect();
        teardownExternalUI();
      }
    });
    cleanupObserver.observe(player, { childList:true });
    sync();
    reveal();
  }

  function watchForExternalVideo() {
    const player = $('#yumePlayer');
    if (!player) return;
    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.id === 'yumeExternalVideo') mountExternalUI(node);
          node.querySelectorAll?.('#yumeExternalVideo').forEach(mountExternalUI);
        }
      }
      if (!$('#yumeExternalVideo')) teardownExternalUI();
    });
    observer.observe(player, { childList:true, subtree:true });
    const existing = $('#yumeExternalVideo');
    if (existing) mountExternalUI(existing);
  }

  async function boot() {
    installStyles();
    for (let i = 0; i < 100 && !$('#yumePlayer'); i++) await new Promise(r => setTimeout(r, 80));
    if (!$('#yumePlayer')) return;
    polishNativeProgress();
    watchForExternalVideo();
  }

  boot();
})();