"""Shared catalogue and artwork normalization. Python standard library only."""
from pathlib import Path
import hashlib, json, re, struct, zlib
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
MAX_BYTES = 5 * 1024 * 1024
SVG_NS = 'http://www.w3.org/2000/svg'
ET.register_namespace('', SVG_NS)
TAGS = set('svg g path rect circle ellipse line polyline polygon defs linearGradient radialGradient stop clipPath mask pattern symbol use text tspan style filter feGaussianBlur feOffset feBlend feColorMatrix feComponentTransfer feFuncA feFuncR feFuncG feFuncB feComposite feMerge feMergeNode feFlood feMorphology feTurbulence feDisplacementMap feSpecularLighting feDiffuseLighting feDistantLight fePointLight feSpotLight'.split())
ATTRS = set('id class style d x y x1 y1 x2 y2 cx cy r rx ry dx dy width height viewBox preserveAspectRatio points transform fill fill-rule fill-opacity stroke stroke-width stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset stroke-opacity opacity vector-effect paint-order clip-path clip-rule mask maskUnits maskContentUnits patternUnits patternContentUnits patternTransform gradientUnits gradientTransform spreadMethod offset stop-color stop-opacity href font-family font-size font-weight font-style text-anchor dominant-baseline letter-spacing word-spacing textLength lengthAdjust filter filterUnits primitiveUnits in in2 result stdDeviation mode type values operator k1 k2 k3 k4 slope intercept amplitude exponent tableValues flood-color flood-opacity radius baseFrequency numOctaves seed stitchTiles scale xChannelSelector yChannelSelector lighting-color surfaceScale specularConstant specularExponent diffuseConstant azimuth elevation limitingConeAngle pointsAtX pointsAtY pointsAtZ z color color-interpolation-filters display visibility overflow'.split())
ORIGIN_WORDS = re.compile(r'\b(?:codex|claude|anthropic|openai|generated\s+by|made\s+by)\b', re.I)

def digest(raw):
    return hashlib.sha256(raw).hexdigest()

def read_catalogue():
    d = json.loads((ROOT / 'catalogue/base.json').read_text(encoding='utf-8'))
    if not isinstance(d, dict) or not isinstance(d.get('designs'), list):
        raise ValueError('catalogue/base.json must contain a designs array')
    return d

def css_check(text):
    text = re.sub(r'/\*.*?\*/', '', text, flags=re.S)
    if re.search(r'@|\\|expression\s*\(|javascript|https?:|data:|file:', text, re.I):
        raise ValueError('Use self-contained SVG styles without external resources')
    for target in re.findall(r'url\s*\((.*?)\)', text, re.I):
        if not re.fullmatch(r'''\s*["']?#[A-Za-z_][\w:.-]*["']?\s*''', target):
            raise ValueError('SVG resources must reference this file only')
    return text

def normalize_svg(raw):
    if len(raw) > MAX_BYTES or re.search(br'<!DOCTYPE|<!ENTITY', raw, re.I):
        raise ValueError('Use an SVG under 5 MB without document entities')
    try:
        root = ET.fromstring(raw)
    except ET.ParseError as exc:
        raise ValueError('The SVG could not be read') from exc
    if root.tag != '{' + SVG_NS + '}svg':
        raise ValueError('The file must be an SVG image')
    for parent in root.iter():
        for child in list(parent):
            if child.tag.rsplit('}', 1)[-1] in {'metadata', 'title', 'desc'}:
                parent.remove(child)
    nodes = list(root.iter())
    if len(nodes) > 20000:
        raise ValueError('Simplify the SVG before submitting it')
    idmap = {n.attrib['id']: f'r{i}' for i, n in enumerate(nodes) if 'id' in n.attrib}
    classes = {name for n in nodes for name in n.get('class', '').split()}
    classmap = {name: f'c{i}' for i, name in enumerate(sorted(classes))}
    def references(value):
        return re.sub(r'''url\(\s*["']?#([\w:.-]+)["']?\s*\)''', lambda m: 'url(#' + idmap.get(m[1], m[1]) + ')', value)
    for node in nodes:
        tag = node.tag.rsplit('}', 1)[-1]
        if tag not in TAGS or not node.tag.startswith('{' + SVG_NS + '}'):
            raise ValueError('Use a static SVG without scripts, embedded images or interactive content')
        attrs = {}
        for key, value in node.attrib.items():
            name = key.rsplit('}', 1)[-1]
            if name.lower().startswith('on'):
                raise ValueError('Interactive SVG content is not accepted')
            if name not in ATTRS:
                continue
            if name == 'href':
                if not value.startswith('#') or value[1:] not in idmap:
                    raise ValueError('SVG references must stay inside the file')
                value = '#' + idmap[value[1:]]
            elif name == 'id':
                value = idmap[value]
            elif name == 'class':
                value = ' '.join(classmap[c] for c in value.split())
            else:
                value = references(css_check(value))
            attrs[name] = value
        node.attrib.clear()
        node.attrib.update(sorted(attrs.items()))
        if tag == 'style' and node.text:
            sheet = css_check(node.text)
            for old, new in classmap.items():
                sheet = re.sub(r'\.' + re.escape(old) + r'(?=[\s{:.,>#\[])', '.' + new, sheet)
            for old, new in idmap.items():
                sheet = re.sub(r'(^|})([^{}]*)#' + re.escape(old) + r'(?=[\s{:.,>#\[])', lambda m: m[1] + m[2] + '#' + new, sheet)
            node.text = references(sheet)
        elif tag in {'text', 'tspan'} and ORIGIN_WORDS.search(node.text or ''):
            raise ValueError('Export the artwork without creator annotations')
        elif node.text is not None and not node.text.strip():
            node.text = None
        if node.tail is not None and not node.tail.strip():
            node.tail = None
    if not root.get('viewBox') and not (root.get('width') and root.get('height')):
        raise ValueError('The SVG needs a viewBox or width and height')
    return ET.tostring(root, encoding='utf-8', xml_declaration=True) + b'\n'

def normalize_png(raw):
    if len(raw) > MAX_BYTES or not raw.startswith(b'\x89PNG\r\n\x1a\n'):
        raise ValueError('Use a PNG image under 5 MB')
    out = bytearray(raw[:8]); pos = 8; done = False; seen_header = False
    keep = {b'IHDR', b'PLTE', b'tRNS', b'gAMA', b'sRGB', b'cHRM', b'iCCP', b'sBIT', b'IDAT', b'IEND'}
    while pos + 12 <= len(raw):
        length = struct.unpack('>I', raw[pos:pos+4])[0]
        kind = raw[pos+4:pos+8]; end = pos + 12 + length
        if end > len(raw):
            raise ValueError('The PNG is incomplete')
        payload = raw[pos+8:pos+8+length]
        crc = struct.unpack('>I', raw[pos+8+length:end])[0]
        if zlib.crc32(kind + payload) & 0xffffffff != crc:
            raise ValueError('The PNG has an invalid image chunk')
        if kind == b'IHDR':
            if seen_header or length != 13:
                raise ValueError('The PNG header is invalid')
            width, height = struct.unpack('>II', payload[:8]); seen_header = True
            if not width or not height or width * height > 40_000_000:
                raise ValueError('Use a PNG with at most 40 million pixels')
        if kind in keep:
            out.extend(raw[pos:end])
        elif kind in {b'acTL', b'fcTL', b'fdAT'}:
            raise ValueError('Use a still image rather than an animated PNG')
        if kind == b'IEND':
            done = True; break
        pos = end
    if not done or not seen_header:
        raise ValueError('The PNG is incomplete')
    return bytes(out)

def normalize_art(raw):
    if raw.startswith(b'\x89PNG\r\n\x1a\n'):
        return normalize_png(raw), '.png'
    return normalize_svg(raw), '.svg'

def submission_record(raw):
    clean, extension = normalize_art(raw)
    fingerprint = digest(clean)
    code = 'D-' + fingerprint[:12].upper()
    asset = 'assets/submissions/' + fingerprint + extension
    return clean, extension, {
        'id': code, 'code': code, 'visibleID': code, 'name': 'Design ' + code,
        'kind': 'svg' if extension == '.svg' else 'sketch',
        'image': asset, 'download': asset, 'sha256': fingerprint, 'crop': None,
        'collection': 'recent'
    }
