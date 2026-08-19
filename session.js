(() => {
  const API = '/.netlify/functions/yume-api';
  const state = { user: null, ready: false };
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

  async function request(action, options = {}) {
    const response = await fetch(`${API}?action=${encodeURIComponent(action)}`, {
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
    let data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok) throw new Error(data.error || `Ошибка ${response.status}`);
    return data;
  }

  function applyAccent(user) {
    if (user?.accent && /^#[0-9a-fA-F]{6}$/.test(user.accent)) {
      document.documentElement.style.setProperty('--accent', user.accent);
    } else {
      document.documentElement.style.removeProperty('--accent');
    }
  }

  function ensureNavLinks() {
    const nav = document.querySelector('.topbar .nav');
    if (!nav) return;
    nav.querySelectorAll('a[href*="chat.html"]').forEach(link => link.remove());
    if (!nav.querySelector('a[href*="account.html"]')) {
      const account = document.createElement('a');
      account.href = './account.html';
      account.className = 'nav-link yume-extra-nav yume-account-link';
      account.textContent = 'Аккаунт';
      nav.appendChild(account);
    }
  }

  function renderAccountLink() {
    ensureNavLinks();
    const link = document.querySelector('.yume-account-link');
    if (!link) return;
    if (state.user) {
      link.innerHTML = `<span class="mini-avatar" style="--user-accent:${esc(state.user.accent || '#ff395f')}">${esc(state.user.avatar || '🌙')}</span><span>${esc(state.user.displayName || state.user.username)}</span>`;
    } else {
      link.textContent = 'Войти';
    }
  }

  async function loadMe() {
    try {
      const data = await request('me', { method: 'GET', headers: {} });
      state.user = data.user || null;
      applyAccent(state.user);
    } catch {
      state.user = null;
      applyAccent(null);
    } finally {
      state.ready = true;
      renderAccountLink();
      document.dispatchEvent(new CustomEvent('yume:session', { detail: { user: state.user } }));
    }
    return state.user;
  }

  function currentPoster() {
    const modal = document.querySelector('#modal');
    const modalPoster = document.querySelector('#modalPoster');
    if (modal && !modal.classList.contains('hidden') && modalPoster?.src) return modalPoster.src;
    return '';
  }

  async function recordWatch({ title, episode = '', poster = '', href = '' }) {
    if (!state.user || !title) return;
    try {
      await request('history', {
        method: 'POST',
        body: JSON.stringify({ title, episode, poster, href }),
      });
    } catch {}
  }

  document.addEventListener('click', event => {
    const episodeButton = event.target.closest('.episode-btn');
    if (episodeButton) {
      const title = document.querySelector('#playerTitle')?.textContent?.trim() || '';
      setTimeout(() => recordWatch({
        title,
        episode: episodeButton.textContent?.trim() || '',
        poster: currentPoster(),
        href: `./search.html?q=${encodeURIComponent(title)}`,
      }), 100);
      return;
    }

    const watchButton = event.target.closest('#heroWatch,#watchBtn');
    if (watchButton) {
      const poster = currentPoster();
      setTimeout(() => {
        const title = document.querySelector('#playerTitle')?.textContent?.trim()
          || document.querySelector('#modalTitle')?.textContent?.trim()
          || document.querySelector('#heroTitle')?.textContent?.trim()
          || '';
        recordWatch({
          title,
          episode: '',
          poster,
          href: `./search.html?q=${encodeURIComponent(title)}`,
        });
      }, 700);
    }
  }, true);

  window.YUME_ACCOUNT = {
    get user() { return state.user; },
    get ready() { return state.ready; },
    request,
    loadMe,
    recordWatch,
    setUser(user) {
      state.user = user || null;
      applyAccent(state.user);
      renderAccountLink();
      document.dispatchEvent(new CustomEvent('yume:session', { detail: { user: state.user } }));
    },
  };

  ensureNavLinks();
  loadMe();
})();
