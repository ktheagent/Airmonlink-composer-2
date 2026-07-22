(() => {
  'use strict';

  let restoreState = null;
  let busy = false;

  const byId = id => document.getElementById(id);
  const visible = element => element && !element.classList.contains('hidden') && getComputedStyle(element).display !== 'none';

  function viewName() {
    return visible(byId('solfaPage')) ? 'solfa' : 'score';
  }

  function title() {
    return String(
      byId('documentTitle')?.textContent ||
      byId('pageTitle')?.textContent ||
      byId('solfaTitle')?.textContent ||
      document.title ||
      'Untitled Score'
    ).trim();
  }

  function toast(message, kind = 'success') {
    const host = byId('toastContainer');
    if (!host) return;
    const node = document.createElement('div');
    node.className = `toast ${kind}`;
    node.textContent = message;
    host.appendChild(node);
    setTimeout(() => node.remove(), 5000);
  }

  async function settle() {
    await document.fonts?.ready?.catch(() => {});
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  function sourcePages(view) {
    if (view === 'solfa') {
      const pages = Array.from(document.querySelectorAll('#solfaPage .solfa-sheet')).filter(visible);
      if (pages.length) return pages.map(node => ({ kind: 'dom', node }));
      const page = byId('solfaPage');
      return page ? [{ kind: 'dom', node: page }] : [];
    }

    const score = byId('scorePage');
    const svg = score?.querySelector('#notationCanvas svg');
    const sheets = svg ? Array.from(svg.querySelectorAll('.score-page-sheet')) : [];
    if (score && svg && sheets.length) {
      return sheets.map((sheet, index) => ({
        kind: 'svg',
        score,
        svg,
        sheet,
        index,
        width: Number(sheet.getAttribute('width')) || svg.viewBox.baseVal.width || 900,
        height: Number(sheet.getAttribute('height')) || 1165,
        x: Number(sheet.getAttribute('x')) || 0,
        y: Number(sheet.getAttribute('y')) || index * 1165
      }));
    }
    return score ? [{ kind: 'dom', node: score }] : [];
  }

  function makePage(item) {
    const page = document.createElement('div');
    page.className = 'airmon-publish-page';
    page.style.background = '#fff';
    page.style.overflow = 'hidden';
    page.style.position = 'relative';

    if (item.kind === 'dom') {
      const clone = item.node.cloneNode(true);
      clone.classList.remove('hidden');
      clone.style.display = 'block';
      clone.style.margin = '0';
      clone.style.transform = 'none';
      const rect = item.node.getBoundingClientRect();
      page.style.width = `${Math.max(240, Math.round(rect.width || item.node.offsetWidth || 794))}px`;
      page.style.height = `${Math.max(240, Math.round(rect.height || item.node.offsetHeight || 1123))}px`;
      page.appendChild(clone);
      return page;
    }

    page.style.width = `${Math.round(item.width)}px`;
    page.style.height = `${Math.round(item.height)}px`;
    const header = item.score.querySelector('.page-header')?.cloneNode(true);
    if (header && item.index === 0) page.appendChild(header);

    const svg = item.svg.cloneNode(true);
    svg.setAttribute('width', String(item.width));
    svg.setAttribute('height', String(item.height));
    svg.setAttribute('viewBox', `${item.x} ${item.y} ${item.width} ${item.height}`);
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.display = 'block';
    page.appendChild(svg);
    return page;
  }

  function begin(view, mode) {
    if (restoreState) throw new Error('Publishing mode is already active.');
    const pages = sourcePages(view);
    if (!pages.length) throw new Error('No rendered page is available for export.');

    const root = document.createElement('div');
    root.id = 'airmonPublishingRoot';
    root.dataset.mode = mode;
    Object.assign(root.style, {
      position: mode === 'png' ? 'fixed' : 'static',
      inset: mode === 'png' ? '0' : 'auto',
      zIndex: '2147483647',
      background: '#fff',
      overflow: 'hidden'
    });
    pages.map(makePage).forEach(page => root.appendChild(page));

    const style = document.createElement('style');
    style.id = 'airmonPublishingStyle';
    style.textContent = `
      body.airmon-publishing > *:not(#airmonPublishingRoot) { display:none !important; }
      body.airmon-publishing { margin:0 !important; background:#fff !important; overflow:visible !important; }
      #airmonPublishingRoot .airmon-publish-page { margin:0 auto; break-after:page; page-break-after:always; }
      #airmonPublishingRoot .airmon-publish-page:last-child { break-after:auto; page-break-after:auto; }
      @media print {
        #airmonPublishingRoot { display:block !important; }
        #airmonPublishingRoot .airmon-publish-page { box-shadow:none !important; }
      }
    `;
    document.head.appendChild(style);
    document.body.appendChild(root);
    document.body.classList.add('airmon-publishing');
    restoreState = { root, style, pages: Array.from(root.children), mode };
    return restoreState;
  }

  function metrics(page) {
    const rect = page.getBoundingClientRect();
    return {
      x: Math.max(0, Math.round(rect.left)),
      y: Math.max(0, Math.round(rect.top)),
      width: Math.max(240, Math.round(rect.width)),
      height: Math.max(240, Math.round(rect.height))
    };
  }

  async function beginPdf(view) {
    const state = begin(view, 'pdf');
    await settle();
    const first = metrics(state.pages[0]);
    const pageStyle = document.createElement('style');
    pageStyle.id = 'airmonPublishingPageSize';
    pageStyle.textContent = `@page { size: ${first.width / 96}in ${first.height / 96}in; margin: 0; }`;
    document.head.appendChild(pageStyle);
    state.pageStyle = pageStyle;
    return { count: state.pages.length, width: first.width, height: first.height };
  }

  async function beginPng(view) {
    const state = begin(view, 'png');
    state.pages.forEach((page, index) => { page.style.display = index === 0 ? 'block' : 'none'; });
    await settle();
    const first = metrics(state.pages[0]);
    return { count: state.pages.length, width: first.width, height: first.height };
  }

  async function showPngPage(index) {
    if (!restoreState || restoreState.mode !== 'png') throw new Error('PNG publishing mode is not active.');
    if (!Number.isInteger(index) || !restoreState.pages[index]) throw new Error('Invalid PNG page index.');
    restoreState.pages.forEach((page, pageIndex) => { page.style.display = pageIndex === index ? 'block' : 'none'; });
    await settle();
    return metrics(restoreState.pages[index]);
  }

  function endPublishing() {
    if (!restoreState) return;
    restoreState.root.remove();
    restoreState.style.remove();
    restoreState.pageStyle?.remove();
    document.body.classList.remove('airmon-publishing');
    restoreState = null;
  }

  function request(kind) {
    if (busy) return;
    const view = viewName();
    const pages = sourcePages(view);
    if (!pages.length) return toast('No rendered page is available for export.', 'error');
    const sample = makePage(pages[0]);
    document.body.appendChild(sample);
    const rect = sample.getBoundingClientRect();
    sample.remove();

    busy = true;
    const url = new URL(`airmon-publish://${kind}`);
    url.searchParams.set('view', view);
    url.searchParams.set('title', title());
    url.searchParams.set('width', String(Math.round(rect.width || 794)));
    url.searchParams.set('height', String(Math.round(rect.height || 1123)));
    window.open(url.toString(), '_blank', 'noopener');
  }

  function installButtons() {
    const dialog = byId('exportDialog');
    if (!dialog || dialog.querySelector('[data-dedicated-publish]')) return;
    const host = dialog.querySelector('.export-grid, .modal-body') || dialog;
    const wrapper = document.createElement('div');
    wrapper.dataset.dedicatedPublish = 'true';
    wrapper.className = 'export-grid';
    wrapper.innerHTML = `
      <button class="export-card" type="button" data-publish-kind="pdf">
        <span>PDF</span><strong>Dedicated PDF</strong><small>Physical multi-page document</small>
      </button>
      <button class="export-card" type="button" data-publish-kind="png">
        <span>PNG</span><strong>PNG Pages</strong><small>Numbered image sequence</small>
      </button>`;
    host.appendChild(wrapper);
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-publish-kind]');
    if (!button) return;
    event.preventDefault();
    byId('exportDialog')?.close?.();
    request(button.dataset.publishKind);
  });

  const observer = new MutationObserver(installButtons);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  installButtons();

  window.AirmonPublishingUI = {
    beginPdf,
    beginPng,
    showPngPage,
    endPublishing,
    complete(result = {}) {
      busy = false;
      endPublishing();
      if (result.canceled) return;
      if (result.error) return toast(result.error, 'error');
      if (result.kind === 'png') toast(`${result.count} PNG page${result.count === 1 ? '' : 's'} exported.`);
      else toast('PDF exported.');
    }
  };
})();