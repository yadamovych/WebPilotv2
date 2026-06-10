// WebPilot content — overlay
(function (WP) {
  'use strict';
  if (window.__webpilotSkipModules) {
    return;
  }
    WP.mountOverlay = function(label = 'WebPilot · Recording') {
      if (WP.state.overlayRoot) {
        // Update label if already mounted
        const badge = document.getElementById('webpilot-badge');
        if (badge) {
          badge.querySelector('span:last-child').textContent = label;
        }
        return;
      }

      WP.injectStyles();

      WP.state.overlayRoot = document.createElement('div');
      WP.state.overlayRoot.id = 'webpilot-overlay';

      const badge = document.createElement('div');
      badge.id = 'webpilot-badge';
      badge.innerHTML =
        '<span class="wp-dot"></span><span>WebPilot · Recording</span>';

      WP.state.overlayRoot.appendChild(badge);
      document.documentElement.appendChild(WP.state.overlayRoot);
    }

    WP.unmountOverlay = function() {
      WP.state.overlayRoot?.remove();
      WP.state.overlayRoot = null;
      WP.clearHighlight();
    }

    WP.injectStyles = function() {
      if (document.getElementById('webpilot-styles')) {
        return;
      }
      const style = document.createElement('style');
      style.id = 'webpilot-styles';
      style.textContent = `
        #webpilot-overlay {
          position: fixed; inset: 0;
          z-index: 2147483646;
          pointer-events: none;
          border: 3px solid #dc2626;
          background: rgba(220,38,38,0.04);
        }
        #webpilot-badge {
          position: absolute; top: 8px; right: 8px;
          background: #dc2626; color: #fff;
          padding: 4px 12px; border-radius: 9999px;
          font: 600 12px/1.5 system-ui,sans-serif;
          display: flex; align-items: center; gap: 6px;
          pointer-events: none;
        }
        .wp-dot {
          width: 8px; height: 8px; border-radius: 50%;
          background: #fff; flex-shrink: 0;
          animation: wp-pulse 1s ease-in-out infinite;
        }
        @keyframes wp-pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
        .wp-hover {
          outline: 2px dashed #f59e0b !important;
          outline-offset: 2px !important;
        }
        .wp-recorded {
          outline: 2px solid #3b82f6 !important;
          outline-offset: 2px !important;
          background: rgba(59,130,246,.08) !important;
          animation: wp-flash .4s ease-out;
        }
        .wp-playback {
          outline: 2px solid #10b981 !important;
          outline-offset: 2px !important;
          background: rgba(16,185,129,.12) !important;
        }
        @keyframes wp-flash {
          0% { background: rgba(59,130,246,.35) !important; }
          100% { background: rgba(59,130,246,.08) !important; }
        }
        #webpilot-progress {
          position: fixed; bottom: 20px; right: 20px;
          background: #1e293b; color: #f1f5f9;
          padding: 10px 14px; border-radius: 8px;
          font: 13px/1.5 system-ui,sans-serif;
          z-index: 2147483647;
          max-width: 280px;
          box-shadow: 0 4px 24px rgba(0,0,0,.35);
          pointer-events: none;
        }
        #webpilot-progress .wp-step-num { color: #10b981; font-weight: 700; }
        #webpilot-progress .wp-step-desc {
          font-size: 12px; opacity: .8;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        
        /* Extract Modal */
        #webpilot-extract-modal {
          position: fixed; inset: 0;
          z-index: 2147483648;
          display: flex; align-items: center; justify-content: center;
          background: rgba(0,0,0,.5);
          font-family: system-ui, -apple-system, sans-serif;
        }
        .wp-extract-overlay {
          position: relative;
          width: 100%;
          height: 100%;
          display: flex; align-items: center; justify-content: center;
        }
        .wp-extract-panel {
          background: #fff; border-radius: 8px;
          box-shadow: 0 10px 40px rgba(0,0,0,.3);
          width: 90%; max-width: 380px;
          overflow: hidden;
        }
        .wp-extract-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 4px 12px 0;
          border-bottom: 1px solid #e5e7eb;
        }
        .wp-extract-tabs {
          display: flex; gap: 0;
        }
        .wp-tab-btn {
          background: none; border: none; border-bottom: 2.5px solid transparent;
          padding: 10px 14px; font: 600 13px/1.4 inherit; cursor: pointer;
          color: #6b7280; transition: color .15s, border-color .15s;
        }
        .wp-tab-btn:hover { color: #111; }
        .wp-tab-btn.wp-tab-active { color: #2563eb; border-bottom-color: #2563eb; }
        .wp-extract-close {
          background: none; border: none; font-size: 22px;
          cursor: pointer; color: #6b7280;
          padding: 0; width: 28px; height: 28px;
          display: flex; align-items: center; justify-content: center;
          margin-left: 4px;
        }
        .wp-extract-close:hover { color: #111; }
        .wp-tab-pane { display: none; }
        .wp-tab-pane.wp-tab-pane-active { display: block; }
        .wp-extract-body {
          padding: 14px 16px;
          display: flex; flex-direction: column; gap: 12px;
        }
        .wp-extract-field {
          display: flex; flex-direction: column; gap: 4px;
        }
        .wp-extract-label {
          font-size: 11px; font-weight: 600; color: #4b5563;
          text-transform: uppercase; letter-spacing: 0.3px;
        }
        .wp-extract-var-input {
          padding: 8px 10px; border: 1.5px solid #d1d5db;
          border-radius: 4px; font-size: 13px; font: inherit;
          box-sizing: border-box; transition: border-color .15s;
        }
        .wp-extract-var-input:focus {
          outline: none; border-color: #3b82f6;
        }
        .wp-extract-type-group {
          display: flex; gap: 16px;
        }
        .wp-extract-radio {
          display: flex; align-items: center; gap: 5px;
          cursor: pointer; font-size: 13px; user-select: none;
        }
        .wp-extract-radio input[type="radio"] { cursor: pointer; }
        .wp-tip {
          display: inline-flex; align-items: center; justify-content: center;
          width: 15px; height: 15px; border-radius: 50%;
          background: #e5e7eb; color: #6b7280;
          font-size: 10px; font-weight: 700; font-style: normal;
          cursor: default; flex-shrink: 0; position: relative;
          margin-left: 1px;
        }
        .wp-tip::after {
          content: attr(data-tip);
          display: none;
          position: absolute;
          bottom: calc(100% + 6px);
          left: 50%; transform: translateX(-50%);
          background: #1e293b; color: #f1f5f9;
          font-size: 11px; font-weight: 400; line-height: 1.5;
          padding: 6px 9px; border-radius: 5px;
          white-space: normal; width: 210px;
          box-shadow: 0 4px 12px rgba(0,0,0,.25);
          pointer-events: none; z-index: 10;
          text-align: left;
        }
        .wp-tip:hover::after { display: block; }
        .wp-extract-footer {
          display: flex; gap: 8px; padding: 10px 16px;
          border-top: 1px solid #e5e7eb;
          justify-content: flex-end;
        }
        .wp-extract-btn-cancel,
        .wp-extract-btn-extract {
          padding: 6px 14px; border-radius: 4px;
          font-size: 13px; font-weight: 500; border: none;
          cursor: pointer; transition: all .15s;
        }
        .wp-extract-btn-cancel {
          background: #f3f4f6; color: #374151;
        }
        .wp-extract-btn-cancel:hover { background: #e5e7eb; }
        .wp-extract-btn-extract {
          background: #2563eb; color: #fff;
        }
        .wp-extract-btn-extract:hover { background: #1d4ed8; }

        /* Variable list (Fill tab) */
        .wp-extract-vars-list {
          display: flex; flex-direction: column; gap: 6px;
          max-height: 200px; overflow-y: auto;
        }
        .wp-extract-var-btn {
          display: flex; align-items: center; justify-content: space-between;
          padding: 8px 10px; background: #f0f9ff; border: 1.5px solid #bfdbfe;
          border-radius: 4px; cursor: pointer; text-align: left;
          font-size: 12px; transition: all .15s; width: 100%;
        }
        .wp-extract-var-btn:hover { background: #dbeafe; border-color: #93c5fd; }
        .wp-var-name {
          font-weight: 600; color: #1e40af; font-family: monospace;
          flex-shrink: 0; margin-right: 8px;
        }
        .wp-var-value {
          color: #64748b; font-size: 11px; flex: 1;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          text-align: right;
        }
        .wp-no-vars {
          display: block; text-align: center;
          padding: 16px 8px; color: #9ca3af; font-size: 12px;
          font-style: italic; background: #f9fafb; border-radius: 4px;
        }

      `;
      document.head.appendChild(style);
    }

    WP.setHoverHighlight = function(el) {
      WP.clearHighlight();
      if (el && el !== WP.state.overlayRoot && !WP.state.overlayRoot?.contains(el)) {
        WP.state.hoveredEl = el;
        el.classList.add('wp-hover');
      }
    }

    WP.clearHighlight = function() {
      WP.state.hoveredEl?.classList.remove('wp-hover');
      WP.state.hoveredEl = null;
    }

    WP.flashRecorded = function(el) {
      el.classList.remove('wp-hover');
      el.classList.add('wp-recorded');
      setTimeout(() => el.classList.remove('wp-recorded'), 600);
    }
})(window.WebPilotContent);
