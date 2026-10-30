# Add designs

## From the gallery

1. Open **Add a design**.
2. Export a self-contained SVG or still PNG under 5 MB. Include only the artwork.
3. Open the GitHub submission form, attach the file, and submit it. A maintainer reviews it before publication.

The gallery shows neutral IDs. GitHub issue and pull request accounts are visible on GitHub itself.

## From a checkout

Create a branch, then run:

```sh
python3 scripts/add_design.py --file /path/to/design.svg
python3 -m unittest discover -s tests
python3 scripts/build_site.py
```

Commit the new file in `submissions/` and open a pull request. Use Python 3.10 or later; no third-party packages are required. Multiple files can be added with repeated commands. Re-adding identical normalized artwork keeps the same ID and file.

The first build automatically downloads and verifies the baseline artwork from this repository's versioned release. Later builds reuse it. This keeps the large initial asset library out of the code history.

Preview the full build with:

```sh
python3 -m http.server 4173 --directory _site
```

Open `http://localhost:4173/`.

## Maintainer: import a submitted attachment

Replace `7` with the submission issue number:

```sh
python3 scripts/add_design.py --issue 7
python3 -m unittest discover -s tests
python3 scripts/build_site.py
```

Inspect the actual artwork and changes, then commit the added files in `submissions/` through a pull request. The importer accepts artwork attached to this repository's public issues. It does not execute submitted files or publish them by itself. Close the issue after the pull request merges.

## Catalogue and publishing

- `catalogue/base.json` holds the initial neutral catalogue. Preserve its IDs.
- `site/` holds the gallery interface and baseline assets.
- `catalogue/assets.json` pins the baseline artwork release and every asset checksum. Downloaded baseline files in `site/assets/` are ignored by Git.
- `submissions/` holds reviewed new artwork. New neutral IDs are derived from normalized file content, so later imports do not renumber earlier designs.
- `scripts/build_site.py` emits `_site/`, copying only the interface and artwork used by the catalogue. It strips unapproved metadata fields from the public data.
- Pull requests run validation. Merging to `main` automatically publishes the validated `_site/` build through GitHub Pages.

Keep external scripts, links, embedded images, animations, and document entities out of SVG submissions. Export text as paths when font matching matters. PNG normalization removes text metadata while preserving the image's pixel-data chunks. The SVG normalizer removes descriptive metadata and neutralizes internal resource names while retaining drawing attributes.

Do not commit `_site/`, private archives, creator crosswalks, credentials, or internal review reports. Additions do not need AI scores or a particular meaning to be considered.
