(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const validID = id => typeof id === 'string' && /^(?:D\d{4}|D-[0-9A-F]{12})$/.test(id);
  const designs = (window.HUSAI_DATA?.designs || []).filter(item => validID(item.id));
  const byID = new Map(designs.map(item => [item.id, item]));
  const bench = window.HUSAI_WORKBENCH;
  const pickKey = 'husai-public-review-picks-v1', previewKey = 'husai-public-review-preview-v1';
  const familyNames = { solid: 'Solid', 'color-mix': 'Color mix', gradient: 'Gradient', outline: 'Outline', mixed: 'Mixed', dark: 'Dark' };
  const known = values => Array.isArray(values) ? [...new Set(values.filter(id => validID(id) && byID.has(id)))] : [];
  let favorites = new Set(), compared = [], selection = { palette: 'original', variant: 'original' };
  try {
    const picks = JSON.parse(localStorage.getItem(pickKey));
    favorites = new Set(known(picks?.favorites)); compared = known(picks?.compare).slice(0, 4);
    const preview = JSON.parse(localStorage.getItem(previewKey));
    if (bench.palettes[preview?.palette] && bench.variants[preview?.variant]) selection = { palette: preview.palette, variant: preview.variant };
  } catch (_) { /* A fresh browser starts with no picks and the original view. */ }
  let sharedURLActive = false;
  function picksFromHash() {
    const params = new URLSearchParams(location.hash.slice(1));
    if (!params.has('favorites') && !params.has('compare')) return false;
    favorites = new Set(known((params.get('favorites') || '').split(',')));
    compared = known((params.get('compare') || '').split(',')).slice(0, 4);
    sharedURLActive = true; return true;
  }
  const openedShortlist = picksFromHash();
  let view = openedShortlist && favorites.size ? 'favorites' : 'all';
  let limit = 60, revision = 0, detailID = null, small = false, paletteGrid = false, toastTimer;
  const failedPreviews = new Set();
  const heart = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.7 4.7a5.2 5.2 0 0 0-7.4 0L12 6l-1.3-1.3a5.2 5.2 0 0 0-7.4 7.4L12 21l8.7-8.9a5.2 5.2 0 0 0 0-7.4Z"></path></svg>';
  function el(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
  function toast(message) { clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false; toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5000); }
  function shortlistURL() {
    const url = new URL(location.href); url.search = '';
    url.hash = new URLSearchParams({ favorites: [...favorites].join(','), compare: compared.join(',') }).toString();
    return url.href;
  }
  function updateSharePanel() { const url = shortlistURL(); $('share-url').value = url; $('open-shortlist').href = url; }
  function persist() {
    try { localStorage.setItem(pickKey, JSON.stringify({ favorites: [...favorites], compare: compared })); }
    catch (_) { toast('This browser could not save picks. Share or export your shortlist to keep it.'); }
    if (sharedURLActive) history.replaceState(null, '', shortlistURL());
    if (!$('share-panel').hidden) updateSharePanel();
  }
  function hasPreview(chosen = selection) { return chosen.palette !== 'original' || chosen.variant !== 'original'; }
  function previewError(item) { if (!failedPreviews.has(item.id)) { failedPreviews.add(item.id); toast(`Preview unavailable for ${item.id}. Its original design is shown.`); } }
  function artwork(item, useSmall = false, chosen = selection) {
    const box = el('div', 'artwork'), image = document.createElement('img');
    const asset = useSmall && item.smallImage ? item.smallImage : item.image;
    image.src = asset; image.alt = `Design ${item.id}`; image.decoding = 'async'; box.append(image);
    if (item.kind === 'svg' && hasPreview(chosen)) {
      const current = revision;
      bench.derive(asset, { id: item.id }, { ...chosen }).then(result => {
        if (!image.isConnected || current !== revision) return;
        image.src = result.url; image.alt = `Design ${item.id}, ${bench.palettes[chosen.palette].name}, ${bench.variants[chosen.variant]} preview`;
      }).catch(() => { if (image.isConnected && current === revision) previewError(item); });
    }
    return box;
  }
  function artButton(item) {
    const button = el('button', 'art-button'); button.type = 'button'; button.setAttribute('aria-label', `View design ${item.id}`); button.append(artwork(item));
    button.addEventListener('click', () => openDetail(item.id)); return button;
  }
  function restoreActionFocus(kind, id) {
    const scope = $('design-dialog').open ? $('design-dialog') : $('compare-dialog').open ? $('compare-dialog') : $('gallery');
    const candidate = scope.querySelector(`[data-${kind}="${id}"]`) || document.querySelector('.tab.active');
    candidate?.focus({ preventScroll: true });
  }
  function favoriteButton(item) {
    const button = el('button', 'icon-button favorite-button'); button.type = 'button'; button.innerHTML = heart; button.dataset.favorite = item.id;
    button.setAttribute('aria-pressed', String(favorites.has(item.id))); button.setAttribute('aria-label', `${favorites.has(item.id) ? 'Unfavorite' : 'Favorite'} ${item.id}`);
    button.addEventListener('click', () => {
      const focused = document.activeElement === button;
      favorites.has(item.id) ? favorites.delete(item.id) : favorites.add(item.id); persist(); refresh();
      if ($('design-dialog').open) renderDetail(); if (focused) restoreActionFocus('favorite', item.id);
    }); return button;
  }
  function compareCheck(item) {
    const label = el('label', 'compare-check'), input = document.createElement('input'); input.type = 'checkbox'; input.checked = compared.includes(item.id); input.dataset.compare = item.id;
    input.setAttribute('aria-label', `Compare ${item.id}`);
    input.addEventListener('change', () => {
      if (input.checked && compared.length >= 4) { input.checked = false; toast('Compare up to four designs. Remove one to add another.'); return; }
      const focused = document.activeElement === input;
      compared = input.checked ? [...compared, item.id] : compared.filter(id => id !== item.id); persist(); refresh();
      if ($('design-dialog').open) renderDetail(); if (focused) restoreActionFocus('compare', item.id);
    }); label.append(input); return label;
  }
  function cardLine(item, showFormat = true) {
    const line = el('div', 'card-line'), copy = el('div', 'card-copy'), controls = el('div', 'card-controls'); copy.append(el('h3', '', item.id));
    if (item.id.length > 8) line.classList.add('long-id');
    if (showFormat) copy.append(el('p', '', item.collection === 'original' && familyNames[item.treatmentFamily] ? familyNames[item.treatmentFamily] : item.kind === 'svg' ? 'SVG' : 'Image'));
    controls.append(favoriteButton(item), compareCheck(item)); line.append(copy, controls); return line;
  }
  function renderCompare() {
    $('comparison').hidden = compared.length === 0; $('compare-count').textContent = `${compared.length} of 4`; $('compare-tray').replaceChildren();
    for (const id of compared) {
      const item = byID.get(id), card = el('article', 'tray-card'), remove = el('button', 'icon-button tray-remove', '×'); remove.type = 'button'; remove.setAttribute('aria-label', `Remove ${id} from comparison`);
      remove.addEventListener('click', () => { compared = compared.filter(pick => pick !== id); persist(); refresh(); });
      card.append(remove, artButton(item), el('h3', '', id)); $('compare-tray').append(card);
    }
    if ($('compare-dialog').open) renderComparisonDialog();
  }
  function matches() {
    const query = $('search').value.trim().toUpperCase().replace(/^DESIGN\s*/, '');
    return designs.filter(item => {
      if (view === 'original' && item.collection !== 'original') return false;
      if (view === 'recent' && item.collection !== 'recent') return false;
      if (view === 'favorites' && !favorites.has(item.id)) return false;
      if ($('format').value && item.kind !== $('format').value) return false;
      if (view === 'original' && $('family').value && item.treatmentFamily !== $('family').value) return false;
      return !query || item.id.includes(query);
    });
  }
  function clearFilters() { $('search').value = ''; $('format').value = ''; $('family').value = ''; limit = 60; renderGallery(); }
  function renderGallery() {
    const list = matches(), gallery = $('gallery'); gallery.replaceChildren();
    for (const item of list.slice(0, limit)) { const card = el('article', 'design-card'); card.append(artButton(item), cardLine(item)); gallery.append(card); }
    const shown = Math.min(limit, list.length);
    $('result-count').textContent = `${list.length.toLocaleString()} ${list.length === 1 ? 'design' : 'designs'}${shown < list.length ? ` · showing ${shown}` : ''}`;
    $('collection-note').textContent = view === 'original' ? 'One mark, explored through color and line.' : view === 'recent' ? 'Recent studies and variations.' : view === 'favorites' ? 'Your shortlist, ready to share.' : 'Browse the full collection.';
    $('favorite-count').textContent = favorites.size ? String(favorites.size) : ''; $('family-label').hidden = view !== 'original' || $('family').options.length < 2;
    $('load-more').hidden = shown >= list.length; $('load-more').textContent = `Show ${Math.min(60, list.length - shown)} more`;
    $('load-controls').hidden = shown >= list.length;
    document.querySelectorAll('[data-load-all]').forEach(button => { button.hidden = shown >= list.length; button.textContent = `Load all ${list.length.toLocaleString()}`; button.setAttribute('aria-label', `Load all ${list.length.toLocaleString()} designs`); });
    const empty = $('empty-state'); empty.hidden = list.length > 0; empty.replaceChildren();
    if (!list.length) {
      const noFavorites = view === 'favorites' && !favorites.size;
      empty.append(el('p', '', noFavorites ? 'Your favorites will appear here. Tap a heart on any design to start.' : 'No designs match these filters.'));
      const reset = el('button', 'outline-button', noFavorites ? 'Browse designs' : 'Clear filters'); reset.type = 'button';
      reset.addEventListener('click', () => { if (noFavorites) view = 'all'; clearFilters(); }); empty.append(reset);
    }
    document.querySelectorAll('[data-view]').forEach(button => { const active = button.dataset.view === view; button.classList.toggle('active', active); if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
  }
  function refresh() { renderCompare(); renderGallery(); }
  function renderPreviewOptions() {
    $('palette').value = selection.palette; $('treatment').value = selection.variant; const swatches = $('palette-swatches'); swatches.replaceChildren();
    const palette = bench.palettes[selection.palette]; if (palette.ink) for (const paint of [palette.ink, palette.accent]) { const dot = el('span'); dot.style.backgroundColor = paint; swatches.append(dot); }
    $('preview-help').textContent = 'SVG designs support color and geometry previews. Images keep their original appearance.' + (selection.variant === 'outline' ? ' Outline changes colored fills; white and light areas stay filled. Existing outline strokes are retained.' : '');
  }
  function changePreview(next) {
    bench.releaseViews(); revision++; selection = next; try { localStorage.setItem(previewKey, JSON.stringify(selection)); } catch (_) { /* Preview controls work without storage. */ }
    renderPreviewOptions(); refresh(); if ($('design-dialog').open) renderDetail(); toast(hasPreview() ? 'Preview updated.' : 'Original view restored.');
  }
  function resetDialogPosition() { const dialog = $('design-dialog'); dialog.scrollTop = 0; if (dialog.open) $('close-detail').focus({ preventScroll: true }); requestAnimationFrame(() => { if (dialog.open) dialog.scrollTop = 0; }); }
  function originalDownload(item, useSmall) {
    const asset = useSmall ? item.smallDownload || item.smallImage : item.download;
    const extension = asset.split(/[?#]/)[0].match(/\.([a-z0-9]+)$/i)?.[1] || (item.kind === 'svg' ? 'svg' : 'png');
    const link = el('a', 'outline-button', item.kind === 'svg' ? 'Download SVG' : 'Download image'); link.href = asset; link.download = `${item.id}${useSmall ? '-small' : ''}.${extension}`; return link;
  }
  function renderPaletteGrid(item, useSmall) {
    $('detail-art').classList.add('palette-comparison'); const grid = el('div', 'palette-grid');
    for (const [key, palette] of Object.entries(bench.palettes)) {
      if (key === 'original') continue;
      const card = el('section', 'palette-card'), picture = el('div', 'palette-art'); picture.append(artwork(item, useSmall, { palette: key, variant: selection.variant }));
      const use = el('button', 'outline-button', 'Use palette'); use.type = 'button'; use.setAttribute('aria-label', `Use ${palette.name} palette`);
      use.addEventListener('click', () => { paletteGrid = false; changePreview({ palette: key, variant: selection.variant }); resetDialogPosition(); }); card.append(el('h3', '', palette.name), picture, use); grid.append(card);
    }
    $('detail-art').replaceChildren(grid); const back = el('button', 'outline-button', 'Back to design'); back.type = 'button'; back.addEventListener('click', () => { paletteGrid = false; renderDetail(); resetDialogPosition(); });
    $('detail-actions').replaceChildren(back, originalDownload(item, useSmall)); $('detail-note').textContent = `Six palettes for ${item.id}, with the ${bench.variants[selection.variant].toLowerCase()} treatment. Secondary colors appear where a design already has an accent.`;
  }
  function renderDetail() {
    const item = byID.get(detailID); if (!item) return; const useSmall = small && Boolean(item.smallImage);
    $('detail-heading').textContent = item.id; $('detail-caption').textContent = item.kind === 'svg' ? useSmall ? 'SVG · small version' : 'SVG design' : 'Image design';
    if (paletteGrid && item.kind === 'svg') { renderPaletteGrid(item, useSmall); return; }
    $('detail-art').classList.remove('palette-comparison'); $('detail-art').replaceChildren(artwork(item, useSmall)); const actions = $('detail-actions'); actions.replaceChildren(favoriteButton(item), compareCheck(item), originalDownload(item, useSmall));
    if (item.kind === 'svg') { const colors = el('button', 'outline-button', 'Compare colors'); colors.type = 'button'; colors.addEventListener('click', () => { paletteGrid = true; renderDetail(); resetDialogPosition(); }); actions.append(colors); }
    if (item.smallImage) { const toggle = el('button', 'small-toggle', useSmall ? 'Show full version' : 'Show small version'); toggle.type = 'button'; toggle.setAttribute('aria-pressed', String(useSmall)); toggle.addEventListener('click', () => { small = !small; renderDetail(); }); actions.append(toggle); }
    $('detail-note').textContent = item.kind === 'svg' && hasPreview() ? `${bench.palettes[selection.palette].name} · ${bench.variants[selection.variant]} preview.` + (selection.variant === 'outline' ? ' Colored fills are outlined; white and light areas stay filled. Existing outline strokes are retained.' : '') : item.kind !== 'svg' ? 'Color and geometry options apply to SVG designs.' : '';
    if (item.kind === 'svg' && hasPreview()) {
      const current = revision, chosen = { ...selection }, download = el('a', 'outline-button', 'Preparing preview…'); download.setAttribute('aria-disabled', 'true'); actions.append(download);
      bench.derive(useSmall ? item.smallImage : item.image, { id: item.id }, chosen).then(result => {
        if (!download.isConnected || current !== revision) return; download.href = result.url; download.download = `${item.id}-${chosen.palette}-${chosen.variant}.svg`; download.textContent = 'Download preview SVG'; download.removeAttribute('aria-disabled'); download.addEventListener('click', () => bench.leaseDownload(result.url));
      }).catch(() => { if (download.isConnected && current === revision) { download.textContent = 'Preview unavailable'; previewError(item); } });
    }
  }
  function openDetail(id) { if ($('compare-dialog').open) $('compare-dialog').close(); detailID = id; small = false; paletteGrid = false; renderDetail(); $('design-dialog').showModal(); resetDialogPosition(); }
  function renderComparisonDialog() {
    const grid = $('comparison-grid'); grid.replaceChildren(); if (!compared.length) { $('compare-dialog').close(); return; }
    for (const id of compared) { const item = byID.get(id), card = el('article'); card.append(artButton(item), cardLine(item, false)); grid.append(card); }
  }
  const available = new Set(designs.filter(item => item.collection === 'original').map(item => item.treatmentFamily));
  Object.entries(familyNames).forEach(([key, text]) => { if (available.has(key)) { const option = el('option', '', text); option.value = key; $('family').append(option); } });
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => { view = button.dataset.view; clearFilters(); }));
  ['search', 'format', 'family'].forEach(id => $(id).addEventListener(id === 'search' ? 'input' : 'change', () => { limit = 60; renderGallery(); }));
  $('load-more').addEventListener('click', () => { limit += 60; renderGallery(); }); $('clear-compare').addEventListener('click', () => { compared = []; persist(); refresh(); document.querySelector('.tab.active')?.focus({ preventScroll: true }); });
  document.querySelectorAll('[data-load-all]').forEach(button => button.addEventListener('click', () => { limit = matches().length; renderGallery(); $('result-count').focus({ preventScroll: true }); }));
  $('open-comparison').addEventListener('click', () => { renderComparisonDialog(); $('compare-dialog').showModal(); $('compare-dialog').scrollTop = 0; });
  $('close-comparison').addEventListener('click', () => $('compare-dialog').close()); $('close-detail').addEventListener('click', () => $('design-dialog').close());
  for (const id of ['design-dialog', 'compare-dialog']) $(id).addEventListener('click', event => { if (event.target !== $(id)) return; const rect = $(id).getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $(id).close(); });
  $('palette').addEventListener('change', () => changePreview({ ...selection, palette: $('palette').value })); $('treatment').addEventListener('change', () => changePreview({ ...selection, variant: $('treatment').value })); $('reset-preview').addEventListener('click', () => changePreview({ palette: 'original', variant: 'original' }));
  $('share-shortlist').addEventListener('click', async () => {
    if (!favorites.size && !compared.length) { toast('Favorite or compare a design, then share your shortlist.'); return; }
    sharedURLActive = true; persist(); updateSharePanel(); $('share-panel').hidden = false; $('share-shortlist').setAttribute('aria-expanded', 'true');
    try { await navigator.clipboard.writeText(shortlistURL()); toast('Shortlist link copied.'); }
    catch (_) { $('share-url').focus(); $('share-url').select(); toast('Your shortlist link is ready. Copy it from the box.'); }
  });
  $('close-share').addEventListener('click', () => { $('share-panel').hidden = true; $('share-shortlist').setAttribute('aria-expanded', 'false'); $('share-shortlist').focus({ preventScroll: true }); }); $('share-url').addEventListener('click', () => $('share-url').select());
  $('export-picks').addEventListener('click', () => {
    const data = { schema: 'husai-public-review-shortlist', version: 1, favorites: [...favorites], compare: compared }, url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'husai-shortlist.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 15000); toast('Picks exported.');
  });
  $('import-picks').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', async event => {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    try { if (file.size > 1000000) throw new Error(); const payload = JSON.parse(await file.text()); if (payload.schema !== 'husai-public-review-shortlist' || payload.version !== 1 || !Array.isArray(payload.favorites) || !Array.isArray(payload.compare)) throw new Error(); favorites = new Set(known(payload.favorites)); compared = known(payload.compare).slice(0, 4); persist(); view = 'favorites'; clearFilters(); renderCompare(); toast('Picks imported.'); }
    catch (_) { toast('Choose a JSON file made with Export picks.'); }
  });
  window.addEventListener('hashchange', () => { if (picksFromHash()) { persist(); view = favorites.size ? 'favorites' : 'all'; clearFilters(); renderCompare(); toast('Shared shortlist loaded.'); } });
  if (openedShortlist) persist(); renderPreviewOptions(); refresh();
})();
