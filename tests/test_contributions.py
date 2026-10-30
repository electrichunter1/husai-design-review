import importlib.util, io, json, struct, sys, tarfile, tempfile, unittest, zlib
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import design_lib

SVG=b'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><title>creator label</title><metadata>private source</metadata><defs><linearGradient id="named-resource"><stop offset="0" stop-color="#12306b"/><stop offset="1" stop-color="#ff7066"/></linearGradient></defs><path id="named-path" fill="url(#named-resource)" d="M2 2L20 2L10 20Z"/></svg>'''

def chunk(kind,payload):
    return struct.pack('>I',len(payload))+kind+payload+struct.pack('>I',zlib.crc32(kind+payload)&0xffffffff)

class Contributions(unittest.TestCase):
    def test_baseline_bundle_checks_bytes_and_rejects_escape_paths(self):
        import baseline_assets
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);archive=root/'art.tar.gz';raw=b'actual artwork'
            def bundle(name):
                with tarfile.open(archive,'w:gz')as t:
                    info=tarfile.TarInfo(name);info.size=len(raw);t.addfile(info,io.BytesIO(raw))
                return {'files':[{'path':name,'bytes':len(raw),'sha256':design_lib.digest(raw)}]}
            manifest=bundle('assets/one.svg');baseline_assets.extract_verified(archive,manifest,root/'out')
            self.assertEqual((root/'out/assets/one.svg').read_bytes(),raw)
            with self.assertRaises(ValueError):baseline_assets.extract_verified(archive,bundle('../escape.svg'),root/'out')

    def test_static_art_and_gradient_survive_private_metadata_removal(self):
        result=design_lib.normalize_svg(SVG)
        tree=design_lib.ET.fromstring(result)
        path=next(n for n in tree.iter()if n.tag.endswith('path'))
        gradient=next(n for n in tree.iter()if n.tag.endswith('linearGradient'))
        self.assertEqual(path.get('d'),'M2 2L20 2L10 20Z')
        self.assertEqual(path.get('fill'),'url(#'+gradient.get('id')+')')
        self.assertNotIn(b'creator label',result)
        self.assertNotIn(b'private source',result)
        self.assertEqual(result,design_lib.normalize_svg(result))

    def test_active_or_external_svg_cannot_enter_gallery(self):
        for element in [b'<script>alert(1)</script>',b'<image href="https://example.org/a.png"/>',b'<path onload="alert(1)"/>',b'<use href="https://example.org/a.svg#x"/>']:
            with self.subTest(element=element),self.assertRaises(ValueError):
                design_lib.normalize_svg(b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'+element+b'</svg>')

    def test_png_pixel_payload_unchanged_and_metadata_removed(self):
        payload=zlib.compress(b'\0\xff\0\0\xff')
        png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',1,1,8,6,0,0,0))+chunk(b'tEXt',b'Author\0private label')+chunk(b'IDAT',payload)+chunk(b'IEND',b'')
        clean=design_lib.normalize_png(png)
        self.assertIn(chunk(b'IDAT',payload),clean)
        self.assertNotIn(b'private label',clean)
        self.assertEqual(clean,design_lib.normalize_png(clean))

    def test_neutral_id_is_stable_across_filename_and_metadata_changes(self):
        a=design_lib.submission_record(SVG)[2]
        b=design_lib.submission_record(SVG.replace(b'creator label',b'another label'))[2]
        self.assertEqual(a['id'],b['id'])
        self.assertRegex(a['id'],r'^D-[A-F0-9]{12}$')
        self.assertNotIn('maker',a)

    def test_build_keeps_baseline_ids_and_additions_stable(self):
        import build_site
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);(root/'catalogue').mkdir();(root/'site/assets').mkdir(parents=True);(root/'submissions').mkdir()
            (root/'site/index.html').write_text('<title>Review</title>')
            clean=design_lib.normalize_svg(SVG);(root/'site/assets/base.svg').write_bytes(clean)
            base={'meta':{},'designs':[{'id':'D0001','kind':'svg','image':'assets/base.svg','download':'assets/base.svg','sha256':design_lib.digest(clean),'crop':None,'maker':'private label'}]}
            (root/'catalogue/base.json').write_text(json.dumps(base))
            (root/'submissions/new.svg').write_bytes(SVG.replace(b'M2 2L20 2L10 20Z',b'M4 4L18 4L12 18Z'))
            old_a,old_b=design_lib.ROOT,build_site.ROOT
            design_lib.ROOT=build_site.ROOT=root
            try:
                build_site.build(root/'_site')
                first=json.loads((root/'_site/catalogue.json').read_text())
                build_site.build(root/'_site')
                second=json.loads((root/'_site/catalogue.json').read_text())
            finally:
                design_lib.ROOT,build_site.ROOT=old_a,old_b
            self.assertEqual(first,second)
            self.assertEqual(first['designs'][0]['id'],'D0001')
            self.assertEqual(len(first['designs']),2)
            self.assertNotIn('maker',first['designs'][0])

if __name__=='__main__':
    unittest.main()
