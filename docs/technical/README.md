# Technical document

`boundra-technical.pdf` is the compiled technical document: architecture, contracts, ACCE, mandates, the worker, data, API, web app, language model, SDK and MCP, security, testing and deployment.

The source is `boundra-technical.tex` (styles, brand colours, diagram styles) plus one file per chapter in `sections/`. It uses the brand palette from `apps/web/src/app/globals.css` and draws the mark from `apps/web/src/components/brand-mark.tsx`.

## Build

Compile with [Tectonic](https://tectonic-typesetting.github.io/) (XeTeX). It downloads the LaTeX packages and fonts it needs (Inter, Source Serif Pro, Source Code Pro) on first use:

```sh
tectonic -X compile docs/technical/boundra-technical.tex
```

After changing the document, check every page for layout problems (overfull lines, stranded headings, overlapping diagram labels) and commit the regenerated PDF with the source.
