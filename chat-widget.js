(() => {
  if (document.querySelector('#yumeChatWidget')) return;

  const apiUrl = '/.netlify/functions/yume-api';
  const state = { open: false, loading: false, timer: null, messages: [], user: window.YUME_ACCOUNT?.user || null };
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

  async function request(action, options = {}) {
    if (window.YUME_ACCOUNT?.request) return window.YUME_ACCOUNT.request(action, options);
    const response = await fetch(`${apiUrl}?action=${encodeURIComponent(action)}`, {
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
    let data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok) throw new Error(data.error || `Ошибка ${response.status}`);
    return data;
  }

  function shell() {
    const launcher = document.createElement('button');
    launcher.id = 'yumeChatLauncher';
    launcher.className = 'yume-chat-launcher';
    launcher.type = 'button';
    launcher.setAttribute('aria-label', 'Открыть общий чат');
    launcher.innerHTML = '<span>💬</span><span class="chat-dot"></span>';

    const widget = document.createElement('aside');
    widget.id = 'yumeChatWidget';
    widget.className = 'yume-chat-widget hidden';
    widget.setAttribute('aria-label', 'Общий чат Yume Tsuki');
    widget.innerHTML = `
      <div class="yume-chat-head">
        <div class="yume-chat-title"><span class="live"></span><span>ОБЩИЙ ЧАТ</span></div>
        <div class="yume-chat-head-actions">
          <button class="yume-chat-icon-btn" id="yumeChatRefresh" type="button" title="Обновить">↻</button>
          <button class="yume-chat-icon-btn" id="yumeChatClose" type="button" title="Свернуть">×</button>
        </div>
      </div>
      <div id="yumeChatMessages" class="yume-chat-messages"><div class="yume-chat-empty">Загружаем сообщения…</div></div>
      <div id="yumeChatFooter" class="yume-chat-footer"></div>`;

    document.body.append(widget, launcher);
    launcher.addEventListener('click', toggle);
    widget.querySelector('#yumeChatClose').addEventListener('click', close);
    widget.querySelector('#yumeChatRefresh').addEventListener('click', () => loadMessages(true));
    document.querySelectorAll('[data-yume-open-chat]').forEach(el => el.addEventListener('click', event => { event.preventDefault(); open(); }));
  }

  const launcher = () => document.querySelector('#yumeChatLauncher');
  const widget = () => document.querySelector('#yumeChatWidget');
  const messagesEl = () => document.querySelector('#yumeChatMessages');
  const footerEl = () => document.querySelector('#yumeChatFooter');

  function formatTime(ms) {
    const d = new Date(Number(ms) || Date.now());
    return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d).replace(',', '');
  }

  function renderMessages(keepScroll = false) {
    const box = messagesEl();
    if (!box) return;
    const wasNearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 90;
    if (!state.messages.length) {
      box.innerHTML = '<div class="yume-chat-empty">Сообщений пока нет.<br>Будь первым, кто напишет.</div>';
      return;
    }
    box.innerHTML = state.messages.map(message => {
      const user = message.user || {};
      const accent = /^#[0-9a-fA-F]{6}$/.test(user.accent || '') ? user.accent : '#ff7391';
      return `<article class="yume-chat-message" style="--msg-accent:${esc(accent)}">
        <div class="yume-chat-avatar">${esc(user.avatar || '🌙')}</div>
        <div>
          <div class="yume-chat-meta"><span class="yume-chat-name">${esc(user.displayName || user.username || 'Yume')}</span><span class="yume-chat-time">${esc(formatTime(message.createdAt))}</span></div>
          <div class="yume-chat-text">${esc(message.text)}</div>
        </div>
      </article>`;
    }).join('');
    if (!keepScroll || wasNearBottom) box.scrollTop = box.scrollHeight;
  }

  function renderFooter() {
    const footer = footerEl();
    if (!footer) return;
    if (!state.user) {
      footer.innerHTML = '<div class="yume-chat-login"><span>Читать можно всем. Чтобы писать — войди в аккаунт.</span><a href="./account.html">Войти</a></div>';
      return;
    }
    footer.innerHTML = `<form id="yumeChatForm" class="yume-chat-form">
      <textarea id="yumeChatInput" maxlength="500" rows="1" placeholder="Написать сообщение…"></textarea>
      <button id="yumeChatSend" class="yume-chat-send" type="submit" aria-label="Отправить">➤</button>
    </form><div id="yumeChatError" class="yume-chat-error"></div><div id="yumeChatCount" class="yume-chat-count">0 / 500</div>`;
    const form = footer.querySelector('#yumeChatForm');
    const input = footer.querySelector('#yumeChatInput');
    const count = footer.querySelector('#yumeChatCount');
    input.addEventListener('input', () => {
      count.textContent = `${input.value.length} / 500`;
      input.style.height = '42px';
      input.style.height = `${Math.min(110, input.scrollHeight)}px`;
    });
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        form.requestSubmit();
      }
    });
    form.addEventListener('submit', sendMessage);
  }

  async function loadMessages(force = false) {
    if (state.loading && !force) return;
    state.loading = true;
    try {
      const data = await request('chat', { method: 'GET', headers: {} });
      state.messages = Array.isArray(data.messages) ? data.messages : [];
      renderMessages(true);
    } catch (error) {
      if (messagesEl()) messagesEl().innerHTML = `<div class="yume-chat-empty">Не удалось загрузить чат.<br><small>${esc(error.message || '')}</small></div>`;
    } finally {
      state.loading = false;
    }
  }

  async function sendMessage(event) {
    event.preventDefault();
    const input = document.querySelector('#yumeChatInput');
    const send = document.querySelector('#yumeChatSend');
    const errorEl = document.querySelector('#yumeChatError');
    const text = input?.value?.trim() || '';
    if (!text) return;
    send.disabled = true;
    errorEl.textContent = '';
    try {
      const data = await request('chat', { method: 'POST', body: JSON.stringify({ text }) });
      if (data.message) state.messages.push(data.message);
      input.value = '';
      input.style.height = '42px';
      document.querySelector('#yumeChatCount').textContent = '0 / 500';
      renderMessages(false);
    } catch (error) {
      if (errorEl) errorEl.textContent = error.message || 'Не удалось отправить сообщение.';
    } finally {
      send.disabled = false;
      input?.focus();
    }
  }

  function startPolling() {
    clearInterval(state.timer);
    state.timer = setInterval(() => {
      if (state.open && document.visibilityState === 'visible') loadMessages();
    }, 5000);
  }

  function open() {
    state.open = true;
    widget()?.classList.remove('hidden');
    launcher()?.setAttribute('aria-label', 'Закрыть общий чат');
    loadMessages(true);
    startPolling();
    setTimeout(() => document.querySelector('#yumeChatInput')?.focus(), 120);
  }

  function close() {
    state.open = false;
    widget()?.classList.add('hidden');
    launcher()?.setAttribute('aria-label', 'Открыть общий чат');
    clearInterval(state.timer);
  }

  function toggle() { state.open ? close() : open(); }

  document.addEventListener('yume:session', event => {
    state.user = event.detail?.user || null;
    renderFooter();
  });

  window.YUME_CHAT = { open, close, toggle, refresh: () => loadMessages(true) };
  shell();
  renderFooter();
  loadMessages();
  if (location.hash === '#chat') setTimeout(open, 80);
})();
