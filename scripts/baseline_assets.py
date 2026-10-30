"""Fetch the versioned baseline artwork without adding it to Git history."""
import hashlib, json, tarfile, urllib.request
from pathlib import Path
import design_lib

def extract_verified(archive, manifest, destination):
    expected = {x['path']: x for x in manifest['files']}
    with tarfile.open(archive, 'r:gz') as bundle:
        members = bundle.getmembers()
        if len(members) != len(expected) or {m.name for m in members} != set(expected):
            raise ValueError('Artwork bundle does not match its manifest')
        for member in members:
            path = Path(member.name)
            if not member.isfile() or path.is_absolute() or '..' in path.parts or path.parts[0] != 'assets':
                raise ValueError('Invalid artwork archive path')
            row = expected[member.name]
            if member.size != row['bytes'] or member.size > 20*1024*1024:
                raise ValueError('Artwork size does not match manifest')
            raw = bundle.extractfile(member).read()
            if hashlib.sha256(raw).hexdigest() != row['sha256']:
                raise ValueError('Artwork checksum does not match manifest')
            target = destination/path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(raw)

def ensure_baseline_assets():
    root = design_lib.ROOT
    path = root/'catalogue/assets.json'
    if not path.is_file():
        return
    manifest = json.loads(path.read_text())
    def present(row):
        p = root/'site'/row['path']
        return p.is_file() and p.stat().st_size == row['bytes'] and hashlib.sha256(p.read_bytes()).hexdigest() == row['sha256']
    if all(present(row) for row in manifest['files']):
        return
    url = manifest['url']
    if not url.startswith('https://github.com/electrichunter1/husai-design-review/releases/download/'):
        raise ValueError('Baseline artwork URL must use this repository release')
    cache = root/'_asset_cache'; cache.mkdir(exist_ok=True)
    archive = cache/manifest['archive']
    good = archive.is_file() and archive.stat().st_size == manifest['bytes'] and hashlib.sha256(archive.read_bytes()).hexdigest() == manifest['sha256']
    if not good:
        partial = archive.with_suffix('.download')
        request = urllib.request.Request(url, headers={'User-Agent':'HUSAI-design-review'})
        count = 0; checksum = hashlib.sha256()
        with urllib.request.urlopen(request, timeout=60) as response, partial.open('wb') as out:
            while True:
                data = response.read(1024*1024)
                if not data:
                    break
                count += len(data)
                if count > manifest['bytes']:
                    raise ValueError('Baseline download is larger than declared')
                checksum.update(data);out.write(data)
        if count != manifest['bytes'] or checksum.hexdigest() != manifest['sha256']:
            raise ValueError('Baseline artwork download failed checksum validation')
        partial.replace(archive)
    extract_verified(archive, manifest, root/'site')
