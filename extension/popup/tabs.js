// WebPilot popup — tabs
(function (WP) {
  'use strict';
  // ---------------------------------------------------------------------------
  // Tab management
  // ---------------------------------------------------------------------------
  WP.switchTab = function(name) {
    WP.dom.tabBtns.forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    WP.dom.tabPanels.forEach((p) => p.classList.toggle('active', p.id === `tab-${name}`));
  };
})(window.WebPilotPopup);
