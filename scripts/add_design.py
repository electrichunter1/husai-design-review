#!/usr/bin/env python3
"""Add local artwork, or artwork attached to a public GitHub submission."""
from pathlib import Path
import argparse, json, re, sys, urllib.parse, urllib.request
from design_lib import ROOT, MAX_BYTES, submission_record

REPOSITORY = 'electrichunter1/husai-design-review'

def get_bytes(url, api=False):
    parsed = urllib.parse.urlparse(url)
    allowed = parsed.scheme == 'https' and (parsed.hostname == 'api.github.com' if api else parsed.hostname == 'github.com' and parsed.path.startswith('/user-attachments/'))
    if not allowed:
        raise ValueError('Use an artwork attachment from the GitHub submission form')
    request = urllib.request.Request(url, headers={'User-Agent': 'HUSAI-design-review', 'Accept': 'application/vnd.github+json' if api else '*/*'})
    with urllib.request.urlopen(request, timeout=30) as response:
        host = urllib.parse.urlparse(response.url).hostname or ''
        if host not in {'api.github.com', 'github.com'} and not host.endswith('.githubusercontent.com'):
            raise ValueError('The attachment redirected outside GitHub')
        raw = response.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise ValueError('Use artwork under 5 MB')
    return raw

def add(raw, check=False):
    clean, extension, row = submission_record(raw)
    target = ROOT / 'submissions' / (row['sha256'] + extension)
    if not check:
        target.parent.mkdir(exist_ok=True)
        if target.exists() and target.read_bytes() != clean:
            raise ValueError('Existing submission differs; it was preserved')
        target.write_bytes(clean)
    print(json.dumps({'id': row['id'], 'file': str(target.relative_to(ROOT)), 'status': 'checked' if check else 'ready for a pull request'}))

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--file', type=Path)
    source.add_argument('--issue', type=int, help='Public design-submission issue number')
    parser.add_argument('--check', action='store_true', help='Validate without saving')
    args = parser.parse_args()
    if args.file:
        if not args.file.is_file() or args.file.stat().st_size > MAX_BYTES:
            raise ValueError('Use a local SVG or PNG under 5 MB')
        add(args.file.read_bytes(), args.check)
    else:
        issue = json.loads(get_bytes('https://api.github.com/repos/' + REPOSITORY + '/issues/' + str(args.issue), api=True))
        body = issue.get('body') or ''
        urls = list(dict.fromkeys(re.findall(r'https://github\.com/user-attachments/(?:assets|files)/[^\s)\]<>"\x27]+', body)))
        if not urls:
            raise ValueError('No artwork attachment found in that issue')
        for url in urls:
            add(get_bytes(url), args.check)

if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError) as exc:
        print('Could not add design: ' + str(exc), file=sys.stderr)
        sys.exit(1)
