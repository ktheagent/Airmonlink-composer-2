(() => {
  'use strict';

  const BUILD_LABEL = 'Build 16';
  const VARSION_LABEL = 'Airmonlink Composer 1.1.0 · Build 16';

  function createButton(kind, title, description) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'export-card';
    button.dataset.publishKind = kind;
    button.dataset.build16Publish = 'true';
    button.innerHTML = `<span>${kind.toUpperCase()}</span><strong>${title}</strong><small>${description}</small>`;
    return button;
  }

  function installBuildBadge() {
    const brand = document.querySelector('.brand-wordmark');
    if (!brand || brand.querySelector('[data-build-16-badge]')) return;
    const badge = document.createElement('small');
    badge.dataset.build16Badge = 'true';
    badge.textContent = BUILD_LABEL;
    badge.title = 'Delivers dedicated PDF and numbered PNG publishing';
    Object.assign(badge.style, { marginLeft: '8px', padding: '2px 6px', borderRadius: '999px', fontSize: '11px', fontWeight: '700', background: 'rgba(46, 160, 67, 0.15)' });
    brand.appendChild(badge);
  }

  function updateAbout() {
    const about = document.querySelector('#aboutDialog .about-content strong');
    if (about) about.textContent = VERSION_LABEL;
  }

  function installExportDialog() {
    const dialog = document.getElementById('exportDialog');
    if (!dialog) return;
    const grid = dialog.querySelector('.export-grid');
    if (!grid) return;
    grid.querySelectorAll('[data-build-16-publish]').forEach(node => node.remove());
    const legacy = grid.querySelector('[data-export="print"]');
    if (legacy) {
      legacy.querySelector('strong').textContent = 'System Print';
      legacy.querySelector('small').textContent = 'Legacy print dialog fallback';
    }
    const pdf = createButton('pdf', 'Dedicated PDF', 'Multi-page publication with preserved page size');
    const png = createButton('png', 'PNG Pages', 'Numbered high-resolution image sequence');
    if (legacy) {
      grid.insertBefore(png, legacy);
      grid.insertBefore(pdf, png);
    } else {
      grid.append(pdf, png);
    }
  }

  function installExportMenu() {
    const menu = document.getElementById('exportMenu');
    if (!menu) return;
    menu.querySelectorAll('[data-build-16-menu]').forEach(node => node.remove());
    const legacy = menu.querySelector('[data-command="print"]');
    [['pdf', 'Dedicated PDF…'], ['png', 'Export PNG pages…"]].forEach(([kind, label]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.dataset.publishKind = kind;
      button.dataset.build16Menu = 'true';
      if (legacy) amenu.insertBefore(button, legacy);
      else menu.appendChild(button);
    });
  }

  function installStatus() {
    const host = document.getElementById('projectStats');
    if (!host || host.querySelector('[data-build-16-status]')) return;
    const status = document.createElement('div');
    status.dataset.build16Status = 'true';
    status.innerHTML = '<strong>Build 16 publishing active</strong><small> Dedicated PDF and PNG page exports are available from Export.</small>';
    host.prepend(status);
  }

  function install() {
    installBuildBadge();
    updateAbout();
    installExportDialog();
    installExportMenu();
    installStatus();
    document.documentElement.dataset.airmonBuild = '16';
  }

  const observer = new MutationObserver(install);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  install();
  window.AirmonPublishingExposure = Object.freeze({ build: 16, refresh: install });
})();
