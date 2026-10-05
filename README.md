# Strictons Map Studio

A print-first map design tool for Strictons guide products. It uses **OpenStreetMap-derived vector data** through OpenFreeMap, rendered with MapLibre GL JS, so the map is not a fixed screenshot: roads, water, parks, buildings and labels can be styled or hidden independently.

## Why this architecture

A normal `tile.openstreetmap.org` raster layer is already rendered, so it cannot provide the design control Strictons needs. Map Studio instead uses OSM-derived **vector tiles** and applies the Strictons editorial design in the browser.

Core workflow:

1. Choose the physical trim size in millimetres — including the Beachcomber 101.5 × 185 mm page and 203 × 185 mm spread presets.
2. Add bleed and choose output DPI.
3. Search or pan to the desired area.
4. Adjust the vector palette and remove map detail that is visually noisy.
5. Add an editorial `Featured places` layer. Clicking the map captures the underlying OSM feature name where possible, but the name remains fully editable.
6. Export a high-resolution PNG at the requested physical size. The exporter adds the required map attribution to the raster output.

## Stack

- React + TypeScript + Vite
- MapLibre GL JS
- OpenFreeMap Liberty style / OpenMapTiles schema / OpenStreetMap data
- OSM Nominatim for low-volume manual place search only

## Run locally

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
```

## Search / Nominatim policy

The built-in public Nominatim integration is deliberately conservative: it only searches on an explicit submit, never performs autocomplete, waits at least one second between uncached requests, and caches results in `localStorage`.

For a production/commercial deployment, Strictons should use a dedicated or self-hosted geocoder rather than depend on the public OSM Nominatim service. Point the app at that endpoint with:

```bash
VITE_GEOCODER_URL=https://your-geocoder.example/search
```

The endpoint is expected to be Nominatim-compatible (`q`, `format=jsonv2`, `limit`).

## Map attribution

OpenFreeMap requires attribution for printed media. OpenStreetMap data is licensed under ODbL and also requires attribution. The on-screen interactive map keeps the MapLibre attribution control. PNG export adds:

`OpenFreeMap © OpenMapTiles · Data from OpenStreetMap · ODbL: openstreetmap.org/copyright`

Do not remove this from externally distributed map artwork without replacing it with a compliant credit elsewhere in the produced work.

## Current v1 capabilities

- real-world trim width / height in mm
- bleed and DPI controls
- Beachcomber page and spread presets
- live OSM-derived vector map
- four visual presets plus direct colour editing
- independently toggle roads, minor roads, buildings, parks, boundaries and label categories
- curated featured-place layer with editable names and categories
- local autosave
- project JSON export
- high-resolution PNG output at physical dimensions

## Recommended next phase

The current version gets the expensive part of the workflow — generating and art-directing the base map — into one repeatable tool. The next additions with the highest production value would be:

- draggable featured labels with manual collision overrides
- numbered venue markers and Strictons icon sets
- importer for advertiser / guide venue CSV data
- saved brand templates by guide title
- multiple map frames in one project
- server-side vector PDF/SVG export for truly lossless print artwork
- self-hosted tiles/geocoding if usage becomes high-volume or mission-critical

## Notes on the styling engine

OpenFreeMap can evolve its layer IDs over time, so Map Studio classifies layers by both style-layer ID and source-layer name rather than depending on one hard-coded style document. Unsupported style properties are ignored safely. This keeps the editor resilient while still allowing much more control than raster OSM tiles.
