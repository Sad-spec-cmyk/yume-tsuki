(() => {
  const $ = s => document.querySelector(s);
  const state = { days: [], selected: 0, releases: [], exact: { today: [], tomorrow: [] } };
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const DAY_NAMES = ['Воскресенье','Понедельник','Вторник','Среда','Четверг','Пятница','Суббота'];
  const DOW_SHORT = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];

  function imageCandidates(raw) {
    const value = String(raw || '').trim();
    if (!value) return [];
    if (/^https?:\/\//i.test(value)) return [value];
    if (value.startsWith('//')) return [`https:${value}`];
    const path = value.startsWith('/') ? value : `/${value}`;
    const bases = window.YUME_CONFIG?.ANILIBERTY_IMAGE_BASES || ['https://static.wwnd.space','https://cdn.anilibria.top','https://aniliberty.top'];
    return [...new Set(bases.map(base => `${String(base).replace(/\/+$/,'')}${path}`))];
  }
  function posterOf(a) {
    const p = a?.poster;
    const raw = typeof p === 'string' ? p : p?.src || p?.preview || p?.optimized?.preview || p?.thumbnail || '';
    return imageCandidates(raw)[0] || '';
  }
  function titleOf(a) { return a?.name?.main || a?.names?.ru || a?.title || 'Без названия'; }
  function aliasOf(a) { return a?.alias || a?.release?.alias || ''; }
  function releaseOf(item) { return item?.release || item || {}; }

  async function api(path, query = {}) {
    const qs = new URLSearchParams();
    Object.entries(query).forEach(([k,v]) => {
      if (v !== undefined && v !== null && String(v) !== '') qs.set(k, String(v));
    });
    const suffix = qs.toString() ? `${path}?${qs}` : path;
    const r = await fetch(`/.netlify/functions/aniliberty?path=${encodeURIComponent(suffix)}`, { headers: { accept:'application/json' } });
    if (!r.ok) throw new Error(`API ${r.status}`);
    return r.json();
  }

  function buildDays() {
    const now = new Date();
    now.setHours(12,0,0,0);
    state.days = Array.from({ length: 7 }, (_, i) => {
      const date = new Date(now);
      date.setDate(now.getDate() + i);
      return {
        date,
        dayName: DAY_NAMES[date.getDay()],
        label: i === 0 ? 'Сегодня' : i === 1 ? 'Завтра' : DOW_SHORT[date.getDay()],
      };
    });
  }

  function exactItemsForDay(index) {
    if (index === 0) return state.exact.today || [];
    if (index === 1) return state.exact.tomorrow || [];
    return [];
  }

  function normalizeExact(list) {
    return (Array.isArray(list) ? list : []).map(item => {
      const release = releaseOf(item);
      return {
        release,
        nextEpisode: item.next_release_episode_number ?? release.next_release_episode_number ?? '',
        exact: true,
      };
    });
  }

  function matchesPublishDay(release, date) {
    const pd = release?.publish_day;
    if (!pd) return false;
    const day = date.getDay();
    const isoDay = day === 0 ? 7 : day;
    const english = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'][day];
    const russian = DAY_NAMES[day].toLowerCase();
    const values = [pd?.value, pd?.description, typeof pd === 'string' || typeof pd === 'number' ? pd : null].filter(v => v !== null && v !== undefined);
    return values.some(value => {
      const n = Number(value);
      if (Number.isFinite(n) && String(value).trim() !== '') return n === day || n === isoDay;
      const text = String(value).trim().toLowerCase();
      return text === russian || text === english.toLowerCase();
    });
  }

  function weeklyItems(day) {
    const map = new Map();
    for (const item of exactItemsForDay(state.selected)) {
      const key = aliasOf(item.release) || titleOf(item.release);
      map.set(key, item);
    }
    for (const release of state.releases) {
      if (!matchesPublishDay(release, day.date)) continue;
      const key = aliasOf(release) || titleOf(release);
      if (!map.has(key)) {
        const published = release?.published_release_episode;
        const current = Number(published?.ordinal || 0);
        const next = release?.next_release_episode_number || (current ? current + 1 : '');
        map.set(key, { release, nextEpisode: next, exact: false });
      }
    }
    return [...map.values()].sort((a,b) => titleOf(a.release).localeCompare(titleOf(b.release),'ru'));
  }

  function renderTabs() {
    const box = $('#dayTabs');
    box.innerHTML = state.days.map((day, i) => {
      const count = weeklyItems(day).length;
      const date = day.date.getDate();
      return `<button class="schedule-day ${i===state.selected?'active':''}" data-index="${i}" type="button">
        <span class="dow">${esc(day.label)}</span>
        <span class="date">${date}</span>
        ${count ? `<span class="count">${count}</span>` : ''}
      </button>`;
    }).join('');
    box.querySelectorAll('.schedule-day').forEach(btn => btn.addEventListener('click', () => {
      state.selected = Number(btn.dataset.index || 0);
      renderTabs();
      renderList();
    }));
  }

  function rowHref(release) {
    const alias = aliasOf(release);
    if (alias) return `/anime?alias=${encodeURIComponent(alias)}`;
    return `/anime?q=${encodeURIComponent(titleOf(release))}`;
  }

  function renderList() {
    const day = state.days[state.selected];
    const items = weeklyItems(day);
    const box = $('#scheduleList');
    if (!items.length) {
      box.innerHTML = `<div class="schedule-empty">На ${esc(day.dayName.toLowerCase())} релизов в расписании пока нет.</div>`;
      return;
    }
    box.innerHTML = items.map(({ release, nextEpisode, exact }) => {
      const p = posterOf(release);
      const published = release?.published_release_episode?.ordinal;
      const line = nextEpisode
        ? `Следующая: серия ${nextEpisode}${published ? ` · сейчас вышла ${published}` : ''}`
        : release?.notification || 'Новая серия ожидается в этот день';
      return `<a class="schedule-row" href="${esc(rowHref(release))}">
        <span class="schedule-poster">${p ? `<img src="${esc(p)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}</span>
        <span class="schedule-copy"><strong>${esc(titleOf(release))}</strong><span>${esc(line)}</span></span>
        <span class="schedule-episode"><strong>${nextEpisode ? `#${esc(nextEpisode)}` : '—'}</strong><span>${exact ? (state.selected===0?'сегодня':'завтра') : day.dayName.toLowerCase()}</span></span>
      </a>`;
    }).join('');
  }

  function updateClock() {
    const d = new Date();
    $('#scheduleClock').textContent = new Intl.DateTimeFormat('ru-RU', {
      weekday:'long', day:'2-digit', month:'long', hour:'2-digit', minute:'2-digit'
    }).format(d);
  }

  async function load() {
    $('#scheduleList').innerHTML = '<div class="schedule-loading">Загружаем расписание…</div>';
    try {
      const [nowData, catalogData] = await Promise.all([
        api('/anime/schedule/now').catch(() => ({})),
        api('/anime/catalog/releases', { limit: 50, 'f[production_statuses]':'IS_IN_PRODUCTION', 'f[sorting]':'FRESH_AT_DESC' }).catch(() => ({ data:[] })),
      ]);
      state.exact.today = normalizeExact(nowData?.today);
      state.exact.tomorrow = normalizeExact(nowData?.tomorrow);
      const list = Array.isArray(catalogData) ? catalogData : (catalogData?.data || catalogData?.items || []);
      const dedup = new Map();
      for (const release of list) {
        const key = aliasOf(release) || titleOf(release);
        if (key && !dedup.has(key)) dedup.set(key, release);
      }
      state.releases = [...dedup.values()];
      renderTabs();
      renderList();
    } catch (e) {
      $('#scheduleList').innerHTML = `<div class="schedule-empty">Не удалось загрузить расписание.<br><small>${esc(e.message || '')}</small></div>`;
    }
  }

  buildDays();
  updateClock();
  setInterval(updateClock, 30000);
  $('#scheduleRefresh')?.addEventListener('click', load);
  load();
})();