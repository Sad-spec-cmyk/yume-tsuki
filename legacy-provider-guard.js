(() => {
  const DEAD_HOSTS = new Set(['kodik.info']);

  function hostOf(value) {
    try { return new URL(String(value || ''), location.href).hostname.toLowerCase().replace(/^www\./, ''); }
    catch { return ''; }
  }

  function isDeadLegacyUrl(value) {
    const host = hostOf(value);
    if (!host) return false;
    return [...DEAD_HOSTS].some(dead => host === dead || host.endsWith(`.${dead}`));
  }

  function restoreYumePlayer() {
    const video = document.querySelector('#yumeVideo');
    const controls = document.querySelector('#playerControls');
    const center = document.querySelector('#centerPlay');
    const top = document.querySelector('#yumePlayer .player-topline');
    video?.classList.remove('provider-hidden');
    controls?.classList.remove('provider-hidden');
    center?.classList.remove('provider-hidden');
    top?.classList.remove('provider-hidden');
  }

  function removeDeadLegacyProvider() {
    const legacyFrame = document.querySelector('#yumeExternalPlayer');
    const legacyButton = document.querySelector('#providerCard .provider-choice[data-provider="external"]');
    const frameUrl = legacyFrame?.getAttribute('src') || legacyFrame?.src || '';
    const buttonLooksLikeKodik = /kodik/i.test(legacyButton?.textContent || '');

    if (legacyFrame && isDeadLegacyUrl(frameUrl)) {
      legacyFrame.removeAttribute('src');
      legacyFrame.remove();
      restoreYumePlayer();
    }

    if (legacyButton && (buttonLooksLikeKodik || isDeadLegacyUrl(frameUrl))) {
      legacyButton.remove();
      const native = document.querySelector('#providerCard .provider-choice[data-provider="aniliberty"]');
      native?.classList.add('active');
      const note = document.querySelector('#providerCard .provider-note');
      if (note) note.textContent = 'Дополнительные озвучки показываются только после проверки рабочего источника.';
    }
  }

  const observer = new MutationObserver(() => removeDeadLegacyProvider());
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });

  document.addEventListener('click', event => {
    const button = event.target.closest?.('#providerCard .provider-choice[data-provider="external"]');
    if (!button || !/kodik/i.test(button.textContent || '')) return;
    const frame = document.querySelector('#yumeExternalPlayer');
    const url = frame?.getAttribute('src') || frame?.src || '';
    if (!isDeadLegacyUrl(url)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    removeDeadLegacyProvider();
  }, true);

  removeDeadLegacyProvider();
})();