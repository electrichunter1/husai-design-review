#!/usr/bin/env python3
"""Build the public gallery from its neutral catalogue and reviewed submissions."""
from pathlib import Path
import argparse, json, re, shutil, sys
from design_lib import ROOT, read_catalogue, submission_record, digest
from baseline_assets import ensure_baseline_assets

ALLOWED_SITE_FILES = {'index.html', '404.html', 'app.js', 'styles.css', 'workbench.js', 'contribute.html', 'contribute.js', 'contribute.css', 'favicon.svg', 'share-preview.png', 'robots.txt'}
ALLOWED_ROW_FIELDS = {'id','code','visibleID','name','kind','image','download','sha256','crop','collection','treatmentFamily','smallImage','smallDownload','smallSha256'}

def safe_asset(path):
    if not isinstance(path, str) or not path.startswith('assets/') or '..' in Path(path).parts or Path(path).is_absolute():
        raise ValueError('Catalogue image paths must stay in assets/')
    q = ROOT / 'site' / path
    if not q.is_file() or q.is_symlink():
        raise ValueError('Missing artwork asset: ' + path)
    return q

def build(output):
    ensure_baseline_assets()
    data = read_catalogue(); rows = []
    for source in data['designs']:
        if not re.fullmatch(r'D\d{4,}|D-[A-F0-9]{12}', source['id']):
            raise ValueError('Every public design needs a stable neutral ID')
        row = {k:v for k,v in source.items() if k in ALLOWED_ROW_FIELDS}
        row.update(id=source['id'], code=source['id'], visibleID=source['id'], name='Design ' + source['id'])
        if row.get('crop'):
            raise ValueError('Public raster designs must be isolated images')
        for key in ['image','download','smallImage','smallDownload']:
            if row.get(key):
                safe_asset(row[key])
        if row.get('sha256') and digest(safe_asset(row['download']).read_bytes()) != row['sha256']:
            raise ValueError('Artwork does not match catalogue hash: ' + row['id'])
        rows.append(row)
    extra = []
    for path in sorted((ROOT / 'submissions').glob('*')):
        if path.name.startswith('.') or path.name == 'README.md':
            continue
        if path.is_symlink() or path.suffix.lower() not in {'.svg','.png'}:
            raise ValueError('Submissions must be SVG or PNG files')
        clean, extension, row = submission_record(path.read_bytes())
        if any(r.get('sha256') == row['sha256'] for r in rows):
            continue
        if any(r['id'] == row['id'] for r in rows):
            raise ValueError('Duplicate public design ID')
        rows.append(row); extra.append((row['image'], clean))
    if len({r['id'] for r in rows}) != len(rows):
        raise ValueError('Duplicate catalogue IDs')
    output = output.resolve()
    checkout = ROOT.resolve()
    if output in {checkout, checkout/'site', checkout/'catalogue', checkout/'submissions'} or checkout not in output.parents:
        raise ValueError('Build output must be a separate directory inside this checkout')
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)
    for name in ALLOWED_SITE_FILES:
        q = ROOT/'site'/name
        if q.is_file():
            shutil.copy2(q, output/name)
    if not (output/'index.html').is_file():
        raise ValueError('site/index.html is missing')
    paths = {r[k] for r in rows for k in ['image','download','smallImage','smallDownload'] if r.get(k)}
    extra_map = dict(extra)
    for path in sorted(paths):
        target = output/path; target.parent.mkdir(parents=True, exist_ok=True)
        if path in extra_map:
            target.write_bytes(extra_map[path])
        else:
            shutil.copy2(safe_asset(path), target)
    svg_count=sum(r['kind']=='svg' for r in rows)
    sketch_count=sum(r['kind']=='sketch' for r in rows)
    counts = {'total':len(rows),'svg':svg_count,'sketch':sketch_count,'original':sum(r.get('collection')=='original' for r in rows),'recent':sum(r.get('collection')=='recent' for r in rows),'all':len(rows),'smallCompanions':sum(bool(r.get('smallImage')) for r in rows),'byKind':{'svg':svg_count,'sketch':sketch_count}}
    defaults = [code for code in data.get('meta',{}).get('defaultCompare',[]) if code in {r['id']for r in rows}][:4]
    public = {'meta':{'title':'HUSAI design review','defaultCompare':defaults,'counts':counts},'designs':rows}
    (output/'data.js').write_text('window.HUSAI_DATA = ' + json.dumps(public,ensure_ascii=False,separators=(',',':')) + ';\n',encoding='utf-8')
    (output/'catalogue.json').write_text(json.dumps(public,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
    (output/'.nojekyll').write_text('')
    print(json.dumps({'designs':len(rows),'newSubmissions':len(extra),'assets':len(paths),'output':str(output)}))

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=ROOT/'_site')
    args=parser.parse_args()
    try:
        build(args.output)
    except (ValueError,OSError,KeyError) as exc:
        print('Build failed: '+str(exc),file=sys.stderr);sys.exit(1)
