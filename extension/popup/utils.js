// WebPilot popup — utils
(function (WP) {
  'use strict';
  WP.sendMsg = function(msg) {
    if (!chrome.runtime?.id) {
      return Promise.resolve(null);
    }
    try {
      return chrome.runtime.sendMessage(msg).catch((err) => {
        console.error('sendMessage error:', err);
        return null;
      });
    } catch (_) {
      return Promise.resolve(null);
    }
  };

  /** Fire-and-forget send — swallows context-invalidated errors. */
  WP.sendMsgSafe = function(msg) {
    if (!chrome.runtime?.id) {
      return;
    }
    try {
      chrome.runtime.sendMessage(msg).catch(() => {});
    } catch (_) {}
  };

  WP.esc = function(str) {
    const d = document.createElement('div');
    d.textContent = str ?? '';
    return d.innerHTML;
  };

  /**
   * Return a compact, human-readable representation of a CSS selector for the
   * step identity chip shown inline in the workflow editor.
   */
  WP.shortSelector = function(sel) {
    if (!sel) {
      return '';
    }
    // [aria-label="..."] → show the label text
    const ariaM = sel.match(/\[aria-label=["']([^"']+)["']\]/);
    if (ariaM) {
      return `aria: "${ariaM[1].slice(0, 35)}"`;
    }
    // #id → short, use as-is
    if (/^#[\w-]+$/.test(sel)) {
      return sel;
    }
    // [name=...] → compact form
    const nameM = sel.match(/\[name=["']?([^"'\]]+)["']?\]/);
    if (nameM) {
      return `[name=${nameM[1].slice(0, 30)}]`;
    }
    // [data-testid=...]
    const testM = sel.match(/\[data-testid=["']?([^"'\]]+)["']?\]/);
    if (testM) {
      return `[testid=${testM[1].slice(0, 30)}]`;
    }
    // last segment of a descendant path
    const last = sel.split('>').pop().trim();
    return last.length <= 42 ? last : last.slice(0, 39) + '…';
  };

  WP.setStatus = function(el, text, cls) {
    el.textContent = text;
    el.className = `status-msg${cls ? ' ' + cls : ''}`;
  };

  WP.showStatus = function(el, text, success) {
    WP.setStatus(el, text, success ? 'success' : 'error');
    setTimeout(() => {
      el.className = 'status-msg hidden';
    }, 3000);
  };
})(window.WebPilotPopup);
