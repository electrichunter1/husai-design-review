/* Non-destructive, SVG-native display treatments. Source assets are never written. */
(() => {
  'use strict';
  const palettes = {
    original: { name: 'Original colors' },
    navyGold: { name: 'Navy + gold', ink: '#102A52', accent: '#F3C13F' },
    cobaltIce: { name: 'Electric cobalt + ice', ink: '#174BE8', accent: '#A8E8FF' },
    tealMint: { name: 'Teal + mint', ink: '#075B60', accent: '#94E5BE' },
    aubergineCoral: { name: 'Aubergine + coral', ink: '#512D54', accent: '#F28579' },
    oxbloodCream: { name: 'Oxblood + cream', ink: '#732D3C', accent: '#EAD9AF' },
    graphiteChartreuse: { name: 'Graphite + chartreuse', ink: '#30383D', accent: '#CADC54' }
  };
  const variants = { original: 'Original', mirror: 'Mirror', rotate90: 'Rotate 90°', compact: 'Compact', wide: 'Wide', outline: 'Outline' };
  const sourceCache = new Map();
  const derivedCache = new Map();
  const completedViews = new Map();
  const downloadLeases = new Map();
  const deferredRevocations = new Set();
  let cacheGeneration = 0;
  let pruneScheduled = false;
  const paintAttributes = ['fill', 'stroke', 'stop-color', 'color', 'flood-color', 'lighting-color'];
  const named = { black: '#000000', white: '#ffffff', navy: '#000080', gold: '#ffd700', red: '#ff0000', blue: '#0000ff', gray: '#808080', grey: '#808080' };
  const ns = 'http://www.w3.org/2000/svg';
  function parseColor(value) {
    if (typeof value !== 'string') return null;
    let input = value.trim().toLowerCase().replace(/\s*!important\s*$/, '');
    input = named[input] || input;
    if (/^#[\da-f]{3,4}$/i.test(input)) input = '#' + [...input.slice(1)].map(char => char + char).join('');
    if (/^#[\da-f]{6}([\da-f]{2})?$/i.test(input)) return { rgb: [1, 3, 5].map(i => parseInt(input.slice(i, i + 2), 16)), alpha: input.length === 9 ? parseInt(input.slice(7, 9), 16) / 255 : 1 };
    const match = input.match(/^rgba?\(([^)]+)\)$/);
    if (!match) return null;
    const components = match[1].trim().replace(/[,/]/g, ' ').split(/\s+/);
    if (![3, 4].includes(components.length) || components.some(v => !/^[+-]?(?:\d+\.?\d*|\.\d+)%?$/.test(v))) return null;
    return { rgb: components.slice(0, 3).map(v => Math.max(0, Math.min(255, parseFloat(v) * (v.endsWith('%') ? 2.55 : 1)))), alpha: components[3] === undefined ? 1 : Math.max(0, Math.min(1, parseFloat(components[3]) / (components[3].endsWith('%') ? 100 : 1))) };
  }
  const lightness = rgb => (Math.max(...rgb) + Math.min(...rgb)) / 510;
  const chromatic = rgb => Math.max(...rgb) - Math.min(...rgb) > 22;
  const paper = rgb => Math.min(...rgb) >= 233;
  const neutralBlack = rgb => Math.max(...rgb) <= 45 && Math.max(...rgb) - Math.min(...rgb) <= 8;
  const hue = rgb => {
    const [r, g, b] = rgb.map(v => v / 255), max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    if (!d) return 0;
    return ((max === r ? (g - b) / d : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60 + 360) % 360;
  };
  function colorString(rgb, alpha = 1) {
    const color = rgb.map(v => Math.max(0, Math.min(255, Math.round(v))));
    return alpha < 1 ? `rgba(${color.join(',')},${Number(alpha.toFixed(5))})` : '#' + color.map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  function tone(rgb, base, target) {
    const a = lightness(rgb), b = lightness(base);
    if (Math.abs(a - b) < .002) return target;
    if (a > b) { const t = Math.min(.88, (a - b) / Math.max(.01, 1 - b)); return target.map(v => v + (255 - v) * t); }
    const t = Math.max(.12, a / Math.max(.01, b));
    return target.map(v => v * t);
  }
  function paintFor(value, context, palette) {
    const parsed = parseColor(value);
    if (!parsed || parsed.alpha === 0 || paper(parsed.rgb)) return value;
    if (!context.monochrome && neutralBlack(parsed.rgb)) return value;
    if (!context.monochrome && !chromatic(parsed.rgb)) return value;
    const target = parseColor(palette.ink).rgb;
    const h = hue(parsed.rgb);
    const baseHue = hue(context.base);
    const distance = Math.min(Math.abs(h - baseHue), 360 - Math.abs(h - baseHue));
    const colorKey = colorString(parsed.rgb);
    const gradientPaint = context.gradientColors?.includes(colorKey);
    const isAccent = !context.monochrome && !gradientPaint && chromatic(parsed.rgb) && (context.accentColors?.includes(colorKey) || (h >= 30 && h <= 80 && lightness(parsed.rgb) > .38) || (distance > 65 && lightness(parsed.rgb) > .35));
    return colorString(isAccent ? parseColor(palette.accent).rgb : tone(parsed.rgb, context.base, target), parsed.alpha) + (/!important\s*$/i.test(value) ? ' !important' : '');
  }
  function boundsFor(box, variant) {
    const [x, y, w, h] = box;
    const cx = x + w / 2, cy = y + h / 2;
    if (variant === 'mirror') return { box, transform: `translate(${2 * cx} 0) scale(-1 1)` };
    if (variant === 'rotate90') return { box: [cx - h / 2, cy - w / 2, h, w], transform: `translate(${cx} ${cy}) rotate(90) translate(${-cx} ${-cy})` };
    if (variant === 'compact') return { box, transform: `translate(${cx} ${cy}) scale(.82) translate(${-cx} ${-cy})` };
    if (variant === 'wide') return { box: [cx - w * .59, y, w * 1.18, h], transform: `translate(${cx} ${cy}) scale(1.18 1) translate(${-cx} ${-cy})` };
    return { box, transform: '' };
  }
  function isMaskPaint(node) {
    for (let parent = node; parent; parent = parent.parentElement) if (['mask', 'clipPath'].includes(parent.localName)) return true;
    return false;
  }
  function styleRules(root, visit) {
    for (const style of root.querySelectorAll('style')) for (const rule of style.textContent.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      let targets;
      try { targets = [...root.querySelectorAll(rule[1].trim())]; } catch (_) { continue; }
      visit(targets, rule[2]);
    }
  }
  function contextFor(root) {
    const counts = new Map();
    const gradientColors = new Set();
    let translucent = false;
    const collect = value => {
      const color = parseColor(value);
      if (!color || paper(color.rgb) || !color.alpha) return;
      if (color.alpha < 1) translucent = true;
      const key = colorString(color.rgb);
      counts.set(key, (counts.get(key) || 0) + 1);
    };
    for (const node of [root, ...root.querySelectorAll('*')]) {
      if (isMaskPaint(node)) continue;
      paintAttributes.forEach(attribute => collect(node.getAttribute(attribute)));
      for (const match of (node.getAttribute('style') || '').matchAll(/(?:^|;)\s*(?:fill|stroke|stop-color|color|flood-color|lighting-color)\s*:\s*([^;]+)/gi)) collect(match[1]);
      if (node.localName === 'style') for (const match of node.textContent.matchAll(/(?:^|[;{])\s*(?:fill|stroke|stop-color|color|flood-color|lighting-color)\s*:\s*([^;}{]+)/gi)) collect(match[1]);
      for (const attribute of ['opacity', 'fill-opacity', 'stroke-opacity', 'stop-opacity']) if (node.hasAttribute(attribute) && Number(node.getAttribute(attribute)) < 1) translucent = true;
      if (/(?:^|;)\s*(?:opacity|fill-opacity|stroke-opacity|stop-opacity)\s*:\s*0?\.\d+/i.test(node.getAttribute('style') || '')) translucent = true;
      if (node.localName === 'stop') {
        const direct = parseColor(node.getAttribute('stop-color'));
        if (direct) gradientColors.add(colorString(direct.rgb));
        for (const match of (node.getAttribute('style') || '').matchAll(/(?:^|;)\s*stop-color\s*:\s*([^;]+)/gi)) {
          const color = parseColor(match[1]);
          if (color) gradientColors.add(colorString(color.rgb));
        }
      }
    }
    const colors = [...counts].sort((a, b) => b[1] - a[1]);
    styleRules(root, (targets, declarations) => {
      if (/(?:^|;)\s*(?:opacity|fill-opacity|stroke-opacity|stop-opacity)\s*:\s*0?\.\d+/i.test(declarations)) translucent = true;
      if (targets.some(node => node.localName === 'stop')) for (const match of declarations.matchAll(/(?:^|;)\s*stop-color\s*:\s*([^;]+)/gi)) {
        const color = parseColor(match[1]);
        if (color) gradientColors.add(colorString(color.rgb));
      }
    });
    const inks = colors.filter(([color]) => chromatic(parseColor(color).rgb) && lightness(parseColor(color).rgb) < .62);
    let base = parseColor(inks[0]?.[0] || colors.find(([color]) => lightness(parseColor(color).rgb) < .5)?.[0] || '#000000').rgb;
    const chromaticColors = colors.filter(([color]) => chromatic(parseColor(color).rgb));
    const accentColors = [];
    // A flat two-ink source may deliberately use the same hue for ink and an
    // ice/mint accent. Require exactly two chromatic paints and a substantial
    // lightness gap; gradients, translucency and multi-tone sets stay tonal.
    if (chromaticColors.length === 2 && !translucent && !root.querySelector('linearGradient,radialGradient,stop')) {
      const sorted = chromaticColors.map(([color]) => ({ color, rgb: parseColor(color).rgb })).sort((a, b) => lightness(a.rgb) - lightness(b.rgb));
      const gap = lightness(sorted[1].rgb) - lightness(sorted[0].rgb);
      const hueGap = Math.abs(hue(sorted[1].rgb) - hue(sorted[0].rgb));
      const separation = Math.min(hueGap, 360 - hueGap);
      // Mid-light mint can be an intentional second ink despite falling below
      // the ice threshold. Require a stronger lightness gap plus a hue shift,
      // so a same-hue two-tone shading pair still follows the tonal path.
      const lightInk = lightness(sorted[1].rgb) >= .66 || (lightness(sorted[1].rgb) >= .55 && gap >= .30 && separation >= 12);
      if (lightInk && gap >= .18) {
        base = sorted[0].rgb;
        accentColors.push(sorted[1].color);
      }
    }
    return { base, monochrome: !inks.length, accentColors, gradientColors: [...gradientColors] };
  }
  function recolor(root, palette) {
    const context = contextFor(root);
    const map = value => paintFor(value, context, palette);
    // Freeze original stylesheet paints on masks before the visible stylesheet
    // is recolored; a shared class must not alter mask luminance semantics.
    styleRules(root, (targets, declarations) => {
      const paints = [...declarations.matchAll(/(?:^|;)\s*(fill|stroke|color|stop-color)\s*:\s*([^;]+)/gi)];
      for (const node of targets) if (isMaskPaint(node)) for (const [, property, value] of paints) node.setAttribute('style', `${node.getAttribute('style') || ''};${property}:${value.replace(/\s*!important\s*$/i, '')} !important`);
    });
    // A mask's black/white luminance semantics must remain unchanged even when
    // a visible monochrome mark inherits the new root fill.
    for (const mask of root.querySelectorAll('mask,clipPath')) if (!mask.hasAttribute('fill')) mask.setAttribute('fill', '#000000');
    const needsDefaultFill = context.monochrome && !root.hasAttribute('fill');
    const needsDefaultColor = !root.hasAttribute('color');
    for (const node of [root, ...root.querySelectorAll('*')]) {
      if (isMaskPaint(node)) continue;
      for (const attribute of paintAttributes) if (node.hasAttribute(attribute)) node.setAttribute(attribute, map(node.getAttribute(attribute)));
      if (node.hasAttribute('style')) node.setAttribute('style', node.getAttribute('style').replace(/(^|;)\s*(fill|stroke|stop-color|color|flood-color|lighting-color)\s*:\s*([^;]+)/gi, (_, separator, property, value) => `${separator}${property}:${map(value)}`));
      if (node.localName === 'style') node.textContent = node.textContent.replace(/(fill|stroke|stop-color|color|flood-color|lighting-color)\s*:\s*([^;}{]+)/gi, (_, property, value) => `${property}:${map(value)}`);
    }
    if (needsDefaultFill) root.setAttribute('fill', palette.ink);
    if (needsDefaultColor) root.setAttribute('color', palette.ink);
    return context;
  }
  function resolvedPaint(node, property, fallback) {
    for (let parent = node; parent; parent = parent.parentElement) {
      const inline = [...(parent.getAttribute('style') || '').matchAll(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'gi'))].pop()?.[1];
      const value = (inline || parent.getAttribute(property) || '').trim().replace(/\s*!important\s*$/i, '');
      if (value && value !== 'inherit') return value;
    }
    return fallback;
  }
  function outlineSVG(root, box) {
    // Native attribute/inline-style paints cover the current catalogue. A
    // stylesheet cascade needs separate source-authored treatment; do not guess.
    if (root.querySelector('style')) throw new Error('Outline requires native SVG paints; use this source’s authored outline.');
    const [x, y, width, height] = box;
    const weight = Math.min(width, height) * .018;
    const supported = new Set(['path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line', 'text']);
    let changed = 0;
    let nativeStrokedShapes = 0;
    for (const node of root.querySelectorAll('*')) {
      if (!supported.has(node.localName)) continue;
      let definition = false;
      for (let parent = node; parent; parent = parent.parentElement) if (['defs', 'mask', 'clipPath', 'pattern', 'marker'].includes(parent.localName)) definition = true;
      if (definition) continue;
      if (node.localName === 'rect') {
        const dimension = (name, extent, fallback) => {
          const value = node.getAttribute(name);
          return value === null ? fallback : value.endsWith('%') ? parseFloat(value) * extent / 100 : parseFloat(value);
        };
        if (dimension('x', width, 0) <= x && dimension('y', height, 0) <= y && dimension('width', width, 0) >= width && dimension('height', height, 0) >= height) continue;
      }
      const stroke = resolvedPaint(node, 'stroke', 'none');
      const strokeColor = parseColor(stroke);
      if (stroke !== 'none' && stroke !== 'transparent' && (!strokeColor || strokeColor.alpha > 0) && parseFloat(resolvedPaint(node, 'stroke-width', '1')) > 0 && parseFloat(resolvedPaint(node, 'stroke-opacity', '1')) > 0) nativeStrokedShapes++;
      if (node.localName === 'line') continue;
      const fill = resolvedPaint(node, 'fill', '#000000');
      const parsed = parseColor(fill);
      if (fill === 'none' || fill === 'transparent' || (parsed && (parsed.alpha === 0 || paper(parsed.rgb)))) continue;
      const opacity = resolvedPaint(node, 'fill-opacity', '1');
      node.setAttribute('style', `${node.getAttribute('style') || ''};fill:none !important;stroke:${fill} !important;stroke-width:${weight} !important;stroke-opacity:${opacity} !important;stroke-linejoin:round;stroke-linecap:round`);
      changed++;
    }
    if (!changed) {
      if (nativeStrokedShapes) return { weight: null, changedShapes: 0, nativeOutlineRetained: true, nativeStrokedShapes, box };
      throw new Error('No painted foreground geometry is available for an outline treatment.');
    }
    const padding = weight / 2;
    return { weight, changedShapes: changed, box: [x - padding, y - padding, width + weight, height + weight] };
  }
  function safeSVG(text) {
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('SVG entity declarations are unsupported.');
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const root = doc.documentElement;
    if (root.localName !== 'svg' || doc.querySelector('parsererror')) throw new Error('SVG could not be parsed.');
    if (root.querySelector('script,foreignObject,iframe,object,embed,image,audio,video,animate,animateTransform,set')) throw new Error('SVG contains unsupported active or linked content.');
    for (const node of [root, ...root.querySelectorAll('*')]) {
      for (const attribute of node.attributes) {
        if (/^on/i.test(attribute.localName)) throw new Error('SVG event attributes are unsupported.');
        if (['href', 'src'].includes(attribute.localName) && !attribute.value.startsWith('#')) throw new Error('External SVG links are unsupported.');
        if (/javascript\s*:|@import/i.test(attribute.value)) throw new Error('Active SVG styling is unsupported.');
        for (const match of attribute.value.matchAll(/url\((.*?)\)/gi)) if (!match[1].trim().replace(/^['"]|['"]$/g, '').startsWith('#')) throw new Error('External SVG paint is unsupported.');
      }
      if (node.localName === 'style') {
        if (/@import/i.test(node.textContent)) throw new Error('External styles are unsupported.');
        for (const match of node.textContent.matchAll(/url\((.*?)\)/gi)) if (!match[1].trim().replace(/^['"]|['"]$/g, '').startsWith('#')) throw new Error('External styles are unsupported.');
      }
    }
    return root;
  }
  async function readAsset(url) {
    if (!sourceCache.has(url)) sourceCache.set(url, (async () => {
      const target = new URL(url, document.baseURI);
      if (target.origin !== location.origin || !target.pathname.endsWith('.svg')) throw new Error('Only local SVG assets support treatments.');
      const response = await fetch(target.href);
      if (!response.ok) throw new Error('SVG source could not load.');
      return response.text();
    })());
    return sourceCache.get(url);
  }
  function leaseDownload(url) {
    if (typeof url !== 'string' || !url.startsWith('blob:')) return;
    const prior = downloadLeases.get(url);
    if (prior) clearTimeout(prior.timer);
    const expires = Date.now() + 15000;
    const timer = setTimeout(() => {
      if (downloadLeases.get(url)?.expires !== expires) return;
      downloadLeases.delete(url);
      if (deferredRevocations.delete(url)) URL.revokeObjectURL(url);
    }, 15000);
    downloadLeases.set(url, { expires, timer });
  }
  function requestViewRevocation(url) {
    const lease = downloadLeases.get(url);
    if (lease && lease.expires > Date.now()) { deferredRevocations.add(url); return; }
    if (lease) { clearTimeout(lease.timer); downloadLeases.delete(url); }
    deferredRevocations.delete(url);
    URL.revokeObjectURL(url);
  }
  function schedulePrune() {
    if (pruneScheduled) return;
    pruneScheduled = true;
    // Image/download promise callbacks settle before this frame. Protect every
    // blob URL currently referenced by live DOM, including offscreen images.
    requestAnimationFrame(() => {
      pruneScheduled = false;
      if (completedViews.size <= 256) return;
      const live = new Set([...document.querySelectorAll('img[src],a[href]')].map(node => node.localName === 'img' ? node.src : node.href));
      for (const [key, result] of completedViews) {
        if (completedViews.size <= 256) break;
        if (live.has(result.url)) continue;
        requestViewRevocation(result.url);
        completedViews.delete(key);
        derivedCache.delete(key);
      }
    });
  }
  async function derive(assetURL, item, selection) {
    if (!/^(?:D\d{4}|D-[0-9A-F]{12})$/.test(item?.id || '')) throw new Error('Invalid design ID.');
    const generation = cacheGeneration;
    const paletteKey = palettes[selection.palette] ? selection.palette : 'original';
    const variantKey = variants[selection.variant] ? selection.variant : 'original';
    const key = JSON.stringify([assetURL, item.id, paletteKey, variantKey]);
    if (completedViews.has(key)) {
      const recent = completedViews.get(key);
      completedViews.delete(key);
      completedViews.set(key, recent);
      schedulePrune();
    }
    if (!derivedCache.has(key)) derivedCache.set(key, (async () => {
      const root = safeSVG(await readAsset(assetURL));
      for (const node of [...root.querySelectorAll('metadata,title,desc')]) node.remove();
      const clean = node => { for (const child of [...node.childNodes]) { if (child.nodeType === 8) child.remove(); else clean(child); } };
      clean(root);
      for (const node of [root, ...root.querySelectorAll('*')]) for (const attribute of [...node.attributes]) if (attribute.localName.startsWith('data-')) node.removeAttributeNode(attribute);
      root.removeAttribute('aria-labelledby');
      root.removeAttribute('aria-describedby');
      root.setAttribute('aria-label', `Design ${item.id}`);
      const title = root.ownerDocument.createElementNS(ns, 'title');
      title.textContent = `Design ${item.id}`;
      root.insertBefore(title, root.firstChild);
      const palette = palettes[paletteKey];
      if (paletteKey !== 'original') recolor(root, palette);
      let box = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
      if (box.length !== 4 || box.some(v => !Number.isFinite(v)) || box[2] <= 0 || box[3] <= 0) {
        const w = parseFloat(root.getAttribute('width')), h = parseFloat(root.getAttribute('height'));
        if (!(w > 0 && h > 0)) throw new Error('SVG has no usable viewBox.');
        box = [0, 0, w, h];
      }
      const outline = variantKey === 'outline' ? outlineSVG(root, box) : null;
      const geometry = outline ? { box: outline.box, transform: '' } : boundsFor(box, variantKey);
      if (geometry.transform) {
        const group = root.ownerDocument.createElementNS(ns, 'g');
        group.setAttribute('transform', geometry.transform);
        for (const node of [...root.childNodes]) if (node.nodeType === 1 && !['defs', 'title', 'desc', 'metadata', 'style'].includes(node.localName)) group.append(node);
        root.append(group);
        root.setAttribute('viewBox', geometry.box.join(' '));
        root.setAttribute('width', String(geometry.box[2]));
        root.setAttribute('height', String(geometry.box[3]));
      }
      if (outline && !outline.nativeOutlineRetained) {
        root.setAttribute('viewBox', geometry.box.join(' '));
        root.setAttribute('width', String(geometry.box[2]));
        root.setAttribute('height', String(geometry.box[3]));
      }
      const settings = { id: item.id, palette: paletteKey, transform: variantKey };
      const metadata = root.ownerDocument.createElementNS(ns, 'metadata');
      metadata.setAttribute('id', 'preview-settings');
      metadata.textContent = JSON.stringify(settings);
      root.append(metadata);
      const text = new XMLSerializer().serializeToString(root) + '\n';
      const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml;charset=utf-8' }));
      const result = { text, url, metadata: settings };
      if (generation === cacheGeneration) {
        completedViews.set(key, result);
        schedulePrune();
      }
      return result;
    })());
    return derivedCache.get(key);
  }
  function releaseViews() {
    cacheGeneration++;
    for (const promise of derivedCache.values()) Promise.resolve(promise).then(result => requestViewRevocation(result.url)).catch(() => {});
    derivedCache.clear();
    completedViews.clear();
  }
  window.HUSAI_WORKBENCH = { palettes, variants, derive, releaseViews, leaseDownload, paintFor, parseColor, boundsFor, contextFor, recolor, outlineSVG };
})();
