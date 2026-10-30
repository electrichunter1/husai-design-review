# Public gallery maintenance

Keep public design labels neutral. Do not add creator, device, model, source-path, or private review information to interface text, accessible labels, public catalogue data, or downloadable artwork.

Preserve all existing design IDs and baseline artwork. Add new artwork with `python3 scripts/add_design.py --file <path>` and commit the resulting `submissions/` files. Use one pull request for a coherent batch. Do not rename all existing designs or count color treatments as unrelated concepts.

Run `python3 -m unittest discover -s tests` and `python3 scripts/build_site.py`. For interface changes, verify the rendered desktop and mobile gallery, favorites, four-way comparison, shortlist sharing, and downloads. Keep build output in `_site/`; do not commit it.

Do not alter the initial catalogue or overwrite submitted files merely to add a new design. Baseline artwork is fetched automatically from its checksum-pinned release; do not commit `site/assets/` or `_asset_cache/`. Do not introduce credentials or direct client-side repository writes. A maintainer reviews the pull request; merged changes publish automatically through GitHub Pages.

When interacting with Cloudflare, use the cf CLI unless the project has a Wrangler configuration file.
