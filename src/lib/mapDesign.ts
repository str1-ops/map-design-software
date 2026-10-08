import type { Map, StyleSpecification } from 'maplibre-gl'

export const BASE_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'
export const FEATURED_SOURCE_ID = 'strictons-featured-places'
export const FEATURED_DOT_LAYER_ID = 'strictons-featured-dots'
export const FEATURED_LABEL_LAYER_ID = 'strictons-featured-labels'

export type RailwayStyle = 'solid' | 'dashed' | 'double' | 'sleepers'

export type MapTheme = {
  land: string
  water: string
  parks: string
  buildings: string
  highways: string
  roads: string
  minorRoads: string
  highwayWidthScale: number
  roadWidthScale: number
  minorRoadWidthScale: number
  railways: string
  railwayStyle: RailwayStyle
  railwayWidthScale: number
  boundaries: string
  labels: string
  labelHalo: string
  featured: string
  featuredText: string
  featuredHalo: string
  featuredLabelSize: number
}

export type LayerVisibility = {
  roads: boolean
  minorRoads: boolean
  railways: boolean
  buildings: boolean
  parks: boolean
  boundaries: boolean
  labels: boolean
  placeLabels: boolean
  roadLabels: boolean
  poiLabels: boolean
  waterLabels: boolean
}

export type FeaturedPlace = {
  id: string
  name: string
  lng: number
  lat: number
  category: string
}

export type CameraState = {
  center: [number, number]
  zoom: number
  bearing: number
  pitch: number
}

export type PrintSize = {
  widthMm: number
  heightMm: number
  bleedMm: number
  dpi: number
}

export const DEFAULT_THEME: MapTheme = {
  land: '#f2efe7',
  water: '#b9d7db',
  parks: '#d9dfc5',
  buildings: '#ded8cc',
  highways: '#d4ad78',
  roads: '#ffffff',
  minorRoads: '#ebe7df',
  highwayWidthScale: 1,
  roadWidthScale: 1,
  minorRoadWidthScale: 1,
  railways: '#8b8880',
  railwayStyle: 'solid',
  railwayWidthScale: 1,
  boundaries: '#b7b0a4',
  labels: '#282825',
  labelHalo: '#f2efe7',
  featured: '#11110f',
  featuredText: '#11110f',
  featuredHalo: '#fffdf7',
  featuredLabelSize: 15,
}

export const THEME_PRESETS: Record<string, MapTheme> = {
  Editorial: DEFAULT_THEME,
  Coastal: {
    ...DEFAULT_THEME,
    land: '#f6f0e3',
    water: '#8fc6cf',
    parks: '#cbd8bd',
    buildings: '#e4d7c6',
    highways: '#c99661',
    roads: '#fffaf1',
    minorRoads: '#eee5d8',
    railways: '#817a70',
    featured: '#1c4246',
    featuredText: '#16363a',
    featuredHalo: '#fffaf1',
  },
  Mono: {
    ...DEFAULT_THEME,
    land: '#f2f1ed',
    water: '#dbdbd7',
    parks: '#e6e5df',
    buildings: '#d3d2cd',
    highways: '#a9a7a0',
    roads: '#ffffff',
    minorRoads: '#e7e6e1',
    railways: '#85847e',
    boundaries: '#aaa9a4',
    labels: '#20201e',
    labelHalo: '#f2f1ed',
    featured: '#11110f',
    featuredText: '#11110f',
    featuredHalo: '#ffffff',
  },
  Night: {
    ...DEFAULT_THEME,
    land: '#171814',
    water: '#213a42',
    parks: '#273328',
    buildings: '#2d2d28',
    highways: '#b8945b',
    roads: '#575850',
    minorRoads: '#363731',
    railways: '#9a968a',
    boundaries: '#56574f',
    labels: '#ece8da',
    labelHalo: '#171814',
    featured: '#f0dc9b',
    featuredText: '#f6e9bc',
    featuredHalo: '#171814',
  },
}

const includes = (value: string, pattern: RegExp) => pattern.test(value.toLowerCase())

const originalLineWidths = new WeakMap<Map, globalThis.Map<string, unknown>>()

function getOriginalLineWidth(map: Map, layerId: string) {
  let widths = originalLineWidths.get(map)
  if (!widths) {
    widths = new globalThis.Map<string, unknown>()
    originalLineWidths.set(map, widths)
  }
  if (!widths.has(layerId)) {
    try {
      widths.set(layerId, (map as any).getPaintProperty(layerId, 'line-width'))
    } catch {
      widths.set(layerId, undefined)
    }
  }
  return widths.get(layerId)
}

function scaledLineWidth(original: unknown, scale: unknown): unknown {
  const scaledValue = (value: unknown) => {
    if (typeof value === 'number' && typeof scale === 'number') return value * scale
    if (typeof value === 'number') return ['*', value, scale]
    return value
  }

  if (typeof original === 'number') return scaledValue(original)
  if (!Array.isArray(original)) return original

  // MapLibre requires ["zoom"] to remain directly inside a top-level
  // interpolate/step expression. Scale each stop output instead of wrapping
  // the whole camera expression in ["*", ...].
  if (
    original[0] === 'interpolate' &&
    Array.isArray(original[2]) &&
    original[2][0] === 'zoom'
  ) {
    const result: unknown[] = [original[0], original[1], original[2]]
    for (let i = 3; i < original.length; i += 2) {
      result.push(original[i], scaledValue(original[i + 1]))
    }
    return result
  }

  if (
    original[0] === 'step' &&
    Array.isArray(original[1]) &&
    original[1][0] === 'zoom'
  ) {
    const result: unknown[] = [original[0], original[1], scaledValue(original[2])]
    for (let i = 3; i < original.length; i += 2) {
      result.push(original[i], scaledValue(original[i + 1]))
    }
    return result
  }

  // Expressions without camera/zoom input can be multiplied directly.
  const hasZoom = JSON.stringify(original).includes('"zoom"')
  return hasZoom ? original : ['*', original, scale]
}

function highwayClassExpression() {
  return [
    'any',
    ['match', ['get', 'class'], ['motorway', 'trunk', 'motorway_construction', 'trunk_construction'], true, false],
    ['==', ['get', 'expressway'], 1],
  ]
}

function majorRoadClassExpression() {
  return [
    'match',
    ['get', 'class'],
    ['primary', 'secondary', 'tertiary', 'primary_construction', 'secondary_construction', 'tertiary_construction', 'link'],
    true,
    false,
  ]
}

function minorRoadClassExpression() {
  return [
    'match',
    ['get', 'class'],
    ['minor', 'service', 'track', 'path', 'minor_construction', 'service_construction', 'track_construction', 'path_construction'],
    true,
    false,
  ]
}

function roadColourExpression(theme: MapTheme) {
  return [
    'case',
    highwayClassExpression(),
    theme.highways,
    majorRoadClassExpression(),
    theme.roads,
    minorRoadClassExpression(),
    theme.minorRoads,
    theme.roads,
  ]
}

function roadWidthScaleExpression(theme: MapTheme) {
  return [
    'case',
    highwayClassExpression(),
    theme.highwayWidthScale,
    majorRoadClassExpression(),
    theme.roadWidthScale,
    minorRoadClassExpression(),
    theme.minorRoadWidthScale,
    theme.roadWidthScale,
  ]
}

function layerFingerprint(layer: any) {
  return `${layer.id ?? ''} ${layer['source-layer'] ?? ''}`.toLowerCase()
}

function isWater(layer: any) {
  return includes(layerFingerprint(layer), /water|ocean|sea|marine|river|lake/)
}

function isBuilding(layer: any) {
  return includes(layerFingerprint(layer), /building/)
}

function isPark(layer: any) {
  return includes(layerFingerprint(layer), /park|forest|wood|grass|scrub|landcover|landuse|cemetery|golf|pitch|garden|meadow/)
}

function isBoundary(layer: any) {
  return layer.type === 'line' && includes(layerFingerprint(layer), /boundary|admin/)
}

function isRailway(layer: any) {
  return layer.type === 'line' && includes(layerFingerprint(layer), /rail/)
}

function isMinorRoad(layer: any) {
  return layer.type === 'line' && includes(layerFingerprint(layer), /minor|residential|service|path|track|foot|cycle|pedestrian/)
}

function isRoad(layer: any) {
  return layer.type === 'line' && includes(layerFingerprint(layer), /road|street|highway|motorway|trunk|primary|secondary|tertiary|minor|service|bridge|tunnel|path|track|link/)
}

function isPoiLabel(layer: any) {
  return layer.type === 'symbol' && includes(layerFingerprint(layer), /poi|shop|amenity|tourism|leisure|airport|aeroway|station|transit|housenumber|address/)
}

function isRoadLabel(layer: any) {
  return layer.type === 'symbol' && includes(layerFingerprint(layer), /road|street|highway|transportation|route/)
}

function isPlaceLabel(layer: any) {
  return layer.type === 'symbol' && includes(layerFingerprint(layer), /place|country|state|city|town|village|suburb|neighbour|locality/)
}

function isWaterLabel(layer: any) {
  return layer.type === 'symbol' && isWater(layer)
}

function visibilityForLayer(layer: any, visibility: LayerVisibility): 'visible' | 'none' | undefined {
  if (layer.id?.startsWith('strictons-')) return 'visible'
  if (isBuilding(layer) && !visibility.buildings) return 'none'
  if (isPark(layer) && !visibility.parks) return 'none'
  if (isBoundary(layer) && !visibility.boundaries) return 'none'
  if (isRailway(layer)) return visibility.railways ? undefined : 'none'
  if (isRoad(layer) && !visibility.roads) return 'none'
  if (isMinorRoad(layer) && (!visibility.roads || !visibility.minorRoads)) return 'none'
  if (layer.type === 'symbol') {
    if (!visibility.labels) return 'none'
    if (isPoiLabel(layer) && !visibility.poiLabels) return 'none'
    if (isRoadLabel(layer) && !visibility.roadLabels) return 'none'
    if (isPlaceLabel(layer) && !visibility.placeLabels) return 'none'
    if (isWaterLabel(layer) && !visibility.waterLabels) return 'none'
  }
  return undefined
}

function setPaintSafe(map: Map, layerId: string, property: string, value: unknown) {
  try {
    ;(map as any).setPaintProperty(layerId, property, value)
  } catch {
    // External styles can change. Unsupported properties are intentionally ignored.
  }
}

function setLayoutSafe(map: Map, layerId: string, property: string, value: unknown) {
  try {
    ;(map as any).setLayoutProperty(layerId, property, value)
  } catch {
    // Same reasoning as setPaintSafe.
  }
}

function railwayOverlayId(layerId: string) {
  return `strictons-rail-sleepers-${layerId}`
}

function ensureRailwaySleeperOverlay(map: Map, layer: any, theme: MapTheme, visible: boolean) {
  const source = layer.source
  const sourceLayer = layer['source-layer']
  if (!source || !sourceLayer) return

  const overlayId = railwayOverlayId(layer.id)
  if (!map.getLayer(overlayId)) {
    const style = map.getStyle() as StyleSpecification | undefined
    const firstSymbol = (style?.layers as any[] | undefined)?.find((candidate) => candidate.type === 'symbol' && !candidate.id?.startsWith('strictons-'))?.id

    try {
      map.addLayer({
        id: overlayId,
        type: 'line',
        source,
        'source-layer': sourceLayer,
        minzoom: layer.minzoom,
        maxzoom: layer.maxzoom,
        filter: layer.filter,
        layout: {
          visibility: 'none',
          'line-cap': 'butt',
          'line-join': 'round',
        },
        paint: {
          'line-color': theme.railways,
          'line-width': 3,
          'line-dasharray': [0.18, 1.45],
        },
      } as any, firstSymbol)
    } catch {
      return
    }
  }

  const baseWidth = getOriginalLineWidth(map, layer.id)
  const sleeperWidth = scaledLineWidth(baseWidth, theme.railwayWidthScale * 3.2)
  setPaintSafe(map, overlayId, 'line-color', theme.railways)
  if (sleeperWidth !== undefined) setPaintSafe(map, overlayId, 'line-width', sleeperWidth)
  setPaintSafe(map, overlayId, 'line-dasharray', [0.18, 1.45])
  setLayoutSafe(map, overlayId, 'visibility', visible && theme.railwayStyle === 'sleepers' ? 'visible' : 'none')
}

function styleRailwayLayer(map: Map, layer: any, theme: MapTheme, visible: boolean) {
  const id = layer.id
  const baseWidth = getOriginalLineWidth(map, id)
  const normalWidth = scaledLineWidth(baseWidth, theme.railwayWidthScale)

  setPaintSafe(map, id, 'line-color', theme.railways)
  setLayoutSafe(map, id, 'line-join', 'round')

  if (theme.railwayStyle === 'dashed') {
    if (normalWidth !== undefined) setPaintSafe(map, id, 'line-width', normalWidth)
    setPaintSafe(map, id, 'line-gap-width', 0)
    setPaintSafe(map, id, 'line-dasharray', [3.2, 2.2])
    setLayoutSafe(map, id, 'line-cap', 'butt')
  } else if (theme.railwayStyle === 'double') {
    const railWidth = scaledLineWidth(baseWidth, theme.railwayWidthScale * 0.72)
    const gapWidth = scaledLineWidth(baseWidth, theme.railwayWidthScale * 1.6)
    if (railWidth !== undefined) setPaintSafe(map, id, 'line-width', railWidth)
    if (gapWidth !== undefined) setPaintSafe(map, id, 'line-gap-width', gapWidth)
    setPaintSafe(map, id, 'line-dasharray', null)
    setLayoutSafe(map, id, 'line-cap', 'round')
  } else if (theme.railwayStyle === 'sleepers') {
    const railWidth = scaledLineWidth(baseWidth, theme.railwayWidthScale * 0.72)
    if (railWidth !== undefined) setPaintSafe(map, id, 'line-width', railWidth)
    setPaintSafe(map, id, 'line-gap-width', 0)
    setPaintSafe(map, id, 'line-dasharray', null)
    setLayoutSafe(map, id, 'line-cap', 'round')
  } else {
    if (normalWidth !== undefined) setPaintSafe(map, id, 'line-width', normalWidth)
    setPaintSafe(map, id, 'line-gap-width', 0)
    setPaintSafe(map, id, 'line-dasharray', null)
    setLayoutSafe(map, id, 'line-cap', 'round')
  }

  ensureRailwaySleeperOverlay(map, layer, theme, visible)
}

export function applyMapDesign(map: Map, theme: MapTheme, visibility: LayerVisibility) {
  const style = map.getStyle() as StyleSpecification | undefined
  if (!style?.layers) return

  for (const layer of style.layers as any[]) {
    const id = layer.id
    if (!id || id.startsWith('strictons-')) continue

    const requestedVisibility = visibilityForLayer(layer, visibility)
    setLayoutSafe(map, id, 'visibility', requestedVisibility ?? 'visible')

    if (layer.type === 'background') {
      setPaintSafe(map, id, 'background-color', theme.land)
      continue
    }

    if (layer.type === 'fill') {
      if (isWater(layer)) setPaintSafe(map, id, 'fill-color', theme.water)
      else if (isBuilding(layer)) setPaintSafe(map, id, 'fill-color', theme.buildings)
      else if (isPark(layer)) setPaintSafe(map, id, 'fill-color', theme.parks)
    }

    if (layer.type === 'line') {
      if (isRailway(layer)) {
        styleRailwayLayer(map, layer, theme, visibility.railways)
      } else if (isBoundary(layer)) {
        setPaintSafe(map, id, 'line-color', theme.boundaries)
      } else if (isRoad(layer)) {
        // Style each road feature by its actual OpenMapTiles class rather than
        // classifying the whole style layer. This keeps roads visually continuous
        // when motorway/trunk/primary/secondary classes change mid-route.
        setPaintSafe(map, id, 'line-color', roadColourExpression(theme))
        setLayoutSafe(map, id, 'line-cap', 'round')
        setLayoutSafe(map, id, 'line-join', 'round')
        const baseWidth = getOriginalLineWidth(map, id)
        const width = scaledLineWidth(baseWidth, roadWidthScaleExpression(theme))
        if (width !== undefined) setPaintSafe(map, id, 'line-width', width)
      }
    }

    if (layer.type === 'symbol') {
      setPaintSafe(map, id, 'text-color', theme.labels)
      setPaintSafe(map, id, 'text-halo-color', theme.labelHalo)
    }
  }
}

function featuredGeoJson(places: FeaturedPlace[]) {
  return {
    type: 'FeatureCollection' as const,
    features: places.map((place) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [place.lng, place.lat] },
      properties: { id: place.id, name: place.name, category: place.category },
    })),
  }
}

export function ensureFeaturedLayers(map: Map, places: FeaturedPlace[], theme: MapTheme) {
  const data = featuredGeoJson(places)
  const source = map.getSource(FEATURED_SOURCE_ID) as any

  if (source) {
    source.setData(data)
  } else {
    map.addSource(FEATURED_SOURCE_ID, { type: 'geojson', data })
  }

  if (!map.getLayer(FEATURED_DOT_LAYER_ID)) {
    map.addLayer({
      id: FEATURED_DOT_LAYER_ID,
      type: 'circle',
      source: FEATURED_SOURCE_ID,
      paint: {
        'circle-radius': 5,
        'circle-color': theme.featured,
        'circle-stroke-width': 2,
        'circle-stroke-color': theme.featuredHalo,
      },
    })
  }

  if (!map.getLayer(FEATURED_LABEL_LAYER_ID)) {
    map.addLayer({
      id: FEATURED_LABEL_LAYER_ID,
      type: 'symbol',
      source: FEATURED_SOURCE_ID,
      layout: {
        'text-field': ['get', 'name'],
        'text-size': theme.featuredLabelSize,
        'text-font': ['Noto Sans Bold'],
        'text-anchor': 'top',
        'text-offset': [0, 0.65],
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: {
        'text-color': theme.featuredText,
        'text-halo-color': theme.featuredHalo,
        'text-halo-width': 1.5,
      },
    })
  }

  setPaintSafe(map, FEATURED_DOT_LAYER_ID, 'circle-color', theme.featured)
  setPaintSafe(map, FEATURED_DOT_LAYER_ID, 'circle-stroke-color', theme.featuredHalo)
  setPaintSafe(map, FEATURED_LABEL_LAYER_ID, 'text-color', theme.featuredText)
  setPaintSafe(map, FEATURED_LABEL_LAYER_ID, 'text-halo-color', theme.featuredHalo)
  setLayoutSafe(map, FEATURED_LABEL_LAYER_ID, 'text-size', theme.featuredLabelSize)
}

export function guessFeatureName(map: Map, event: any) {
  try {
    const rendered = map.queryRenderedFeatures(event.point)
    const named = rendered.find((feature) => feature.properties?.name || feature.properties?.['name:en'])
    return named?.properties?.name || named?.properties?.['name:en'] || 'Featured place'
  } catch {
    return 'Featured place'
  }
}

export function mmToPixels(mm: number, dpi: number) {
  return Math.round((mm / 25.4) * dpi)
}

export function totalPrintPixels(size: PrintSize) {
  return {
    width: mmToPixels(size.widthMm + size.bleedMm * 2, size.dpi),
    height: mmToPixels(size.heightMm + size.bleedMm * 2, size.dpi),
  }
}

function downloadDataUrl(dataUrl: string, filename: string) {
  const anchor = document.createElement('a')
  anchor.href = dataUrl
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

type ExportMapArgs = {
  filename: string
  size: PrintSize
  camera: CameraState
  previewViewport: { width: number; height: number }
  theme: MapTheme
  visibility: LayerVisibility
  featuredPlaces: FeaturedPlace[]
}

type ExportSvgArgs = ExportMapArgs & {
  map: Map
}

async function renderMapCanvas(args: ExportMapArgs) {
  const { width, height } = totalPrintPixels(args.size)
  if (width > 8192 || height > 8192 || width * height > 45_000_000) {
    throw new Error(`Export is ${width} × ${height}px. Reduce the DPI or physical size for this browser export.`)
  }

  const logicalWidth = Math.max(1, Math.round(args.previewViewport.width))
  const logicalHeight = Math.max(1, Math.round(args.previewViewport.height))
  if (!args.previewViewport.width || !args.previewViewport.height) {
    throw new Error('The preview canvas is not ready yet. Move or resize the map once, then export again.')
  }
  const exportPixelRatio = Math.max(1, Math.min(width / logicalWidth, height / logicalHeight))

  const host = document.createElement('div')
  host.style.position = 'fixed'
  host.style.left = '-100000px'
  host.style.top = '0'
  host.style.width = `${logicalWidth}px`
  host.style.height = `${logicalHeight}px`
  document.body.appendChild(host)

  const maplibregl = await import('maplibre-gl')
  const exportMap = new maplibregl.Map({
    container: host,
    style: BASE_STYLE_URL,
    center: args.camera.center,
    zoom: args.camera.zoom,
    bearing: args.camera.bearing,
    pitch: args.camera.pitch,
    interactive: false,
    attributionControl: false,
    pixelRatio: exportPixelRatio,
    maxCanvasSize: [width, height],
    canvasContextAttributes: { preserveDrawingBuffer: true },
  })

  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('The map export timed out while loading tiles.')), 30000)
      exportMap.once('load', () => {
        applyMapDesign(exportMap, args.theme, args.visibility)
        ensureFeaturedLayers(exportMap, args.featuredPlaces, args.theme)
        exportMap.once('idle', () => {
          window.clearTimeout(timeout)
          resolve()
        })
      })
      exportMap.once('error', (event: any) => {
        if (event?.error) console.warn('Map export tile/style warning:', event.error)
      })
    })

    const output = document.createElement('canvas')
    output.width = width
    output.height = height
    const ctx = output.getContext('2d')
    if (!ctx) throw new Error('Could not create the export canvas.')
    ctx.drawImage(exportMap.getCanvas(), 0, 0, width, height)
    return output
  } finally {
    exportMap.remove()
    host.remove()
  }
}

export async function exportMapPng(args: ExportMapArgs) {
  const output = await renderMapCanvas(args)
  downloadDataUrl(output.toDataURL('image/png'), args.filename)
}

function escapeXml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function svgId(value: string) {
  const cleaned = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' And ')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  const readable = cleaned || 'Item'
  return /^[A-Za-z_]/.test(readable) ? readable : `Item_${readable}`
}

function evaluateStyleExpression(value: any, properties: Record<string, any>, zoom: number): any {
  if (!Array.isArray(value)) return value
  const op = value[0]

  if (op === 'literal') return value[1]
  if (op === 'zoom') return zoom
  if (op === 'get') return properties?.[String(value[1])]
  if (op === 'has') return Object.prototype.hasOwnProperty.call(properties || {}, String(value[1]))
  if (op === 'coalesce') {
    for (let i = 1; i < value.length; i++) {
      const candidate = evaluateStyleExpression(value[i], properties, zoom)
      if (candidate !== null && candidate !== undefined) return candidate
    }
    return undefined
  }
  if (op === '==') return evaluateStyleExpression(value[1], properties, zoom) === evaluateStyleExpression(value[2], properties, zoom)
  if (op === '!=') return evaluateStyleExpression(value[1], properties, zoom) !== evaluateStyleExpression(value[2], properties, zoom)
  if (op === 'any') return value.slice(1).some((v:any) => Boolean(evaluateStyleExpression(v, properties, zoom)))
  if (op === 'all') return value.slice(1).every((v:any) => Boolean(evaluateStyleExpression(v, properties, zoom)))
  if (op === '*') {
    const numbers = value.slice(1).map((v:any) => Number(evaluateStyleExpression(v, properties, zoom)))
    return numbers.every((v:number) => Number.isFinite(v)) ? numbers.reduce((a:number,b:number)=>a*b,1) : undefined
  }
  if (op === 'case') {
    for (let i = 1; i < value.length - 1; i += 2) {
      if (evaluateStyleExpression(value[i], properties, zoom)) return evaluateStyleExpression(value[i + 1], properties, zoom)
    }
    return evaluateStyleExpression(value[value.length - 1], properties, zoom)
  }
  if (op === 'match') {
    const input = evaluateStyleExpression(value[1], properties, zoom)
    for (let i = 2; i < value.length - 1; i += 2) {
      const candidate = value[i]
      if ((Array.isArray(candidate) && candidate.includes(input)) || candidate === input) {
        return evaluateStyleExpression(value[i + 1], properties, zoom)
      }
    }
    return evaluateStyleExpression(value[value.length - 1], properties, zoom)
  }
  if (op === 'step') {
    const input = Number(evaluateStyleExpression(value[1], properties, zoom))
    let output = evaluateStyleExpression(value[2], properties, zoom)
    for (let i = 3; i < value.length; i += 2) {
      if (input < Number(value[i])) break
      output = evaluateStyleExpression(value[i + 1], properties, zoom)
    }
    return output
  }
  if (op === 'interpolate') {
    const input = Number(evaluateStyleExpression(value[2], properties, zoom))
    const stops: { stop:number; output:any }[] = []
    for (let i = 3; i < value.length; i += 2) {
      stops.push({ stop:Number(value[i]), output:evaluateStyleExpression(value[i + 1], properties, zoom) })
    }
    if (!stops.length) return undefined
    if (input <= stops[0].stop) return stops[0].output
    if (input >= stops[stops.length - 1].stop) return stops[stops.length - 1].output
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i], b = stops[i + 1]
      if (input >= a.stop && input <= b.stop) {
        if (typeof a.output !== 'number' || typeof b.output !== 'number') return a.output
        const t = (input - a.stop) / Math.max(0.000001, b.stop - a.stop)
        return a.output + (b.output - a.output) * t
      }
    }
  }
  return undefined
}

function styleValue(map: Map, layerId: string, kind: 'paint' | 'layout', property: string, featureProps: Record<string, any>, fallback: any) {
  try {
    const raw = kind === 'paint'
      ? (map as any).getPaintProperty(layerId, property)
      : (map as any).getLayoutProperty(layerId, property)
    const evaluated = evaluateStyleExpression(raw, featureProps, map.getZoom())
    return evaluated ?? fallback
  } catch {
    return fallback
  }
}

function projectCoordinate(map: Map, coordinate: any, sx: number, sy: number) {
  const point = map.project([Number(coordinate[0]), Number(coordinate[1])])
  return { x: point.x * sx, y: point.y * sy }
}

type SvgPoint = { x:number; y:number }

function pointPath(points: SvgPoint[]) {
  return points.map((point, index) =>
    `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`
  ).join(' ')
}

function pointInsideCanvas(point: SvgPoint, width: number, height: number) {
  return point.x >= 0 && point.x <= width && point.y >= 0 && point.y <= height
}

function clipSegmentToCanvas(a: SvgPoint, b: SvgPoint, width: number, height: number): [SvgPoint,SvgPoint] | null {
  let x0=a.x, y0=a.y, x1=b.x, y1=b.y
  const dx=x1-x0, dy=y1-y0
  let t0=0, t1=1
  const tests:[number,number][]=[
    [-dx,x0],
    [dx,width-x0],
    [-dy,y0],
    [dy,height-y0],
  ]

  for(const [p,q] of tests){
    if(p===0){
      if(q<0) return null
      continue
    }
    const r=q/p
    if(p<0){
      if(r>t1) return null
      if(r>t0) t0=r
    }else{
      if(r<t0) return null
      if(r<t1) t1=r
    }
  }

  return [
    {x:x0+t0*dx,y:y0+t0*dy},
    {x:x0+t1*dx,y:y0+t1*dy},
  ]
}

function clippedPolylinePath(points: SvgPoint[], width: number, height: number) {
  if(points.length<2) return ''
  const paths:SvgPoint[][]=[]
  let current:SvgPoint[]=[]
  const same=(a:SvgPoint,b:SvgPoint)=>Math.abs(a.x-b.x)<0.01&&Math.abs(a.y-b.y)<0.01
  const flush=()=>{if(current.length>1)paths.push(current);current=[]}

  for(let i=0;i<points.length-1;i++){
    const clipped=clipSegmentToCanvas(points[i],points[i+1],width,height)
    if(!clipped){flush();continue}
    const [start,end]=clipped
    if(!current.length) current=[start,end]
    else if(same(current[current.length-1],start)) current.push(end)
    else {flush();current=[start,end]}
  }
  flush()
  return paths.map(pointPath).join(' ')
}

function clipPolygonRing(points: SvgPoint[], width: number, height: number) {
  const edges=[
    {
      inside:(p:SvgPoint)=>p.x>=0,
      intersect:(a:SvgPoint,b:SvgPoint)=>({x:0,y:a.y+(b.y-a.y)*(0-a.x)/(b.x-a.x)}),
    },
    {
      inside:(p:SvgPoint)=>p.x<=width,
      intersect:(a:SvgPoint,b:SvgPoint)=>({x:width,y:a.y+(b.y-a.y)*(width-a.x)/(b.x-a.x)}),
    },
    {
      inside:(p:SvgPoint)=>p.y>=0,
      intersect:(a:SvgPoint,b:SvgPoint)=>({x:a.x+(b.x-a.x)*(0-a.y)/(b.y-a.y),y:0}),
    },
    {
      inside:(p:SvgPoint)=>p.y<=height,
      intersect:(a:SvgPoint,b:SvgPoint)=>({x:a.x+(b.x-a.x)*(height-a.y)/(b.y-a.y),y:height}),
    },
  ]

  let output=points
  for(const edge of edges){
    if(!output.length) break
    const input=output
    output=[]
    let previous=input[input.length-1]
    let previousInside=edge.inside(previous)

    for(const current of input){
      const currentInside=edge.inside(current)
      if(currentInside){
        if(!previousInside) output.push(edge.intersect(previous,current))
        output.push(current)
      }else if(previousInside){
        output.push(edge.intersect(previous,current))
      }
      previous=current
      previousInside=currentInside
    }
  }
  return output.filter((point)=>Number.isFinite(point.x)&&Number.isFinite(point.y))
}

function geometryPath(map: Map, geometry: any, sx: number, sy: number, width: number, height: number): string {
  if (!geometry) return ''
  const projectLine=(coordinates:any[])=>coordinates.map((coordinate)=>projectCoordinate(map,coordinate,sx,sy))

  if (geometry.type === 'LineString') {
    return clippedPolylinePath(projectLine(geometry.coordinates),width,height)
  }
  if (geometry.type === 'MultiLineString') {
    return geometry.coordinates.map((line:any[])=>clippedPolylinePath(projectLine(line),width,height)).filter(Boolean).join(' ')
  }
  if (geometry.type === 'Polygon') {
    return geometry.coordinates.map((ring:any[])=>{
      const clipped=clipPolygonRing(projectLine(ring),width,height)
      return clipped.length>=3?`${pointPath(clipped)} Z`:''
    }).filter(Boolean).join(' ')
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.flatMap((polygon:any[][])=>polygon.map((ring:any[])=>{
      const clipped=clipPolygonRing(projectLine(ring),width,height)
      return clipped.length>=3?`${pointPath(clipped)} Z`:''
    })).filter(Boolean).join(' ')
  }
  return ''
}

function lineLabelPlacement(map: Map, coordinates: any[], sx: number, sy: number) {
  const points = coordinates.map((c:any) => projectCoordinate(map, c, sx, sy))
  if (!points.length) return null
  if (points.length === 1) return { ...points[0], angle:0 }
  const lengths:number[] = []
  let total = 0
  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1].x - points[i].x
    const dy = points[i + 1].y - points[i].y
    const len = Math.hypot(dx, dy)
    lengths.push(len)
    total += len
  }
  let target = total / 2
  for (let i = 0; i < lengths.length; i++) {
    if (target <= lengths[i]) {
      const a = points[i], b = points[i + 1]
      const t = lengths[i] ? target / lengths[i] : 0
      let angle = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI
      if (angle > 90 || angle < -90) angle += 180
      return { x:a.x + (b.x - a.x) * t, y:a.y + (b.y - a.y) * t, angle }
    }
    target -= lengths[i]
  }
  return { ...points[Math.floor(points.length / 2)], angle:0 }
}

function labelPlacement(map: Map, geometry: any, sx: number, sy: number) {
  if (!geometry) return null
  if (geometry.type === 'Point') {
    const p = projectCoordinate(map, geometry.coordinates, sx, sy)
    return { ...p, angle:0 }
  }
  if (geometry.type === 'MultiPoint') {
    const p = projectCoordinate(map, geometry.coordinates[0], sx, sy)
    return { ...p, angle:0 }
  }
  if (geometry.type === 'LineString') return lineLabelPlacement(map, geometry.coordinates, sx, sy)
  if (geometry.type === 'MultiLineString') {
    const longest = [...geometry.coordinates].sort((a:any[],b:any[]) => b.length - a.length)[0]
    return longest ? lineLabelPlacement(map, longest, sx, sy) : null
  }
  const rings = geometry.type === 'Polygon' ? geometry.coordinates : geometry.type === 'MultiPolygon' ? geometry.coordinates?.[0] : null
  const ring = Array.isArray(rings?.[0]?.[0]) ? rings[0] : rings?.[0] || rings
  if (!Array.isArray(ring) || !ring.length) return null
  const points = ring.map((c:any) => projectCoordinate(map, c, sx, sy))
  const xs = points.map((p:any) => p.x), ys = points.map((p:any) => p.y)
  return { x:(Math.min(...xs)+Math.max(...xs))/2, y:(Math.min(...ys)+Math.max(...ys))/2, angle:0 }
}

function roadGroup(properties: Record<string, any>) {
  const roadClass = String(properties?.class || '')
  const expressway = properties?.expressway === 1 || properties?.expressway === '1' || properties?.expressway === true
  if (expressway || ['motorway','trunk','motorway_construction','trunk_construction'].includes(roadClass)) return 'Highways'
  if (['primary','secondary','tertiary','primary_construction','secondary_construction','tertiary_construction','link'].includes(roadClass)) return 'Major Roads'
  return 'Minor Roads'
}

function titleCaseRoadClass(value: unknown) {
  const text = String(value || 'road').replace(/_/g, ' ').trim()
  return text.replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function roadIdentity(properties: Record<string, any>, feature: any, layerId: string, namedProperties?: Record<string, any>) {
  const name = String(
    namedProperties?.name ||
    namedProperties?.['name:en'] ||
    namedProperties?.['name:latin'] ||
    properties?.name ||
    properties?.['name:en'] ||
    properties?.['name:latin'] ||
    ''
  ).trim()
  const ref = String(
    namedProperties?.ref ||
    namedProperties?.route_ref ||
    namedProperties?.['ref:road'] ||
    properties?.ref ||
    properties?.route_ref ||
    properties?.['ref:road'] ||
    ''
  ).trim()
  const roadClass = String(properties?.class || properties?.subclass || namedProperties?.class || 'road').trim()

  let label = ''
  if (name && ref && !name.toLowerCase().includes(ref.toLowerCase())) label = `${name} (${ref})`
  else if (name) label = name
  else if (ref) label = `Route ${ref}`
  else label = `Unnamed ${titleCaseRoadClass(roadClass)} Road`

  const fallbackId = feature?.id !== undefined && feature?.id !== null
    ? String(feature.id)
    : layerId
  const key = name || ref
    ? `${name.toLowerCase()}|${ref.toLowerCase()}|${roadClass.toLowerCase()}`
    : `unnamed|${roadClass.toLowerCase()}|${fallbackId}`

  return { label, key, roadClass }
}

type RoadNameCandidate = {
  source: string
  properties: Record<string, any>
  lines: SvgPoint[][]
  roadClass: string
}

function geometryScreenLines(map: Map, geometry: any): SvgPoint[][] {
  const projectLine = (coordinates:any[]):SvgPoint[] => coordinates.map((coordinate):SvgPoint => {
    const point = map.project([Number(coordinate[0]), Number(coordinate[1])])
    return { x:point.x, y:point.y }
  })
  if (!geometry) return [] as SvgPoint[][]
  if (geometry.type === 'LineString') return [projectLine(geometry.coordinates)]
  if (geometry.type === 'MultiLineString') return geometry.coordinates.map((line:any[]) => projectLine(line))
  return [] as SvgPoint[][]
}

function roadSamplePoints(map: Map, geometry: any) {
  const lines = geometryScreenLines(map, geometry)
  const points:SvgPoint[] = []
  for (const line of lines) {
    if (!line.length) continue
    points.push(line[0])
    points.push(line[Math.floor((line.length - 1) / 2)])
    points.push(line[line.length - 1])
    if (line.length > 4) {
      points.push(line[Math.floor((line.length - 1) * 0.25)])
      points.push(line[Math.floor((line.length - 1) * 0.75)])
    }
  }
  return points.filter((point, index, all) =>
    all.findIndex((candidate) => Math.abs(candidate.x-point.x)<0.01 && Math.abs(candidate.y-point.y)<0.01) === index
  )
}

function pointToSegmentDistance(point: SvgPoint, a: SvgPoint, b: SvgPoint) {
  const dx=b.x-a.x, dy=b.y-a.y
  const lengthSq=dx*dx+dy*dy
  if (!lengthSq) return Math.hypot(point.x-a.x,point.y-a.y)
  const t=Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/lengthSq))
  return Math.hypot(point.x-(a.x+t*dx),point.y-(a.y+t*dy))
}

function pointToLinesDistance(point: SvgPoint, lines: SvgPoint[][]) {
  let best=Infinity
  for (const line of lines) {
    for (let i=0;i<line.length-1;i++) {
      best=Math.min(best,pointToSegmentDistance(point,line[i],line[i+1]))
      if (best<0.35) return best
    }
  }
  return best
}

function roadClassFamily(value: unknown) {
  const roadClass=String(value || '').toLowerCase()
  if (['motorway','trunk','motorway_construction','trunk_construction'].includes(roadClass)) return 'highway'
  if (['primary','secondary','tertiary','primary_construction','secondary_construction','tertiary_construction','link'].includes(roadClass)) return 'major'
  return roadClass ? 'minor' : ''
}

function collectRoadNameCandidates(map: Map, features: any[]) {
  const sources = new Set<string>()
  for (const feature of features) {
    const sourceLayer=String(feature.sourceLayer || feature.layer?.['source-layer'] || '').toLowerCase()
    if (sourceLayer === 'transportation' && feature.source) sources.add(String(feature.source))
  }

  const candidates:RoadNameCandidate[]=[]
  const seen=new Set<string>()
  for (const source of sources) {
    let namedFeatures:any[]=[]
    try {
      namedFeatures=(map as any).querySourceFeatures(source,{sourceLayer:'transportation_name'}) || []
    } catch {
      continue
    }

    for (const feature of namedFeatures) {
      const properties=feature.properties || {}
      const name=properties.name || properties['name:en'] || properties['name:latin']
      const ref=properties.ref || properties.route_ref || properties['ref:road']
      if (!name && !ref) continue
      const lines=geometryScreenLines(map,feature.geometry)
      if (!lines.some((line)=>line.length>1)) continue
      const signature=`${source}|${name || ''}|${ref || ''}|${properties.class || ''}|${JSON.stringify(feature.geometry)}`
      if (seen.has(signature)) continue
      seen.add(signature)
      candidates.push({
        source,
        properties,
        lines,
        roadClass:String(properties.class || properties.subclass || ''),
      })
    }
  }
  return candidates
}

function matchRoadName(map: Map, feature: any, candidates: RoadNameCandidate[]) {
  const source=String(feature.source || '')
  const samples=roadSamplePoints(map,feature.geometry)
  if (!source || !samples.length) return undefined

  const currentClass=String(feature.properties?.class || feature.properties?.subclass || '')
  const currentFamily=roadClassFamily(currentClass)
  let best:{ candidate:RoadNameCandidate; score:number; maxDistance:number }|undefined

  for (const candidate of candidates) {
    if (candidate.source !== source) continue
    const distances=samples.map((point)=>pointToLinesDistance(point,candidate.lines)).filter(Number.isFinite)
    if (!distances.length) continue
    distances.sort((a,b)=>a-b)
    const considered=distances.slice(0,Math.min(3,distances.length))
    const average=considered.reduce((sum,value)=>sum+value,0)/considered.length
    const maxDistance=Math.max(...considered)
    const candidateFamily=roadClassFamily(candidate.roadClass)
    const classPenalty=currentFamily && candidateFamily && currentFamily!==candidateFamily ? 9 : 0
    const exactClassBonus=currentClass && candidate.roadClass && currentClass===candidate.roadClass ? -2 : 0
    const score=average+classPenalty+exactClassBonus

    if (!best || score<best.score) best={candidate,score,maxDistance}
  }

  if (!best) return undefined
  // Tight enough to avoid borrowing names from nearby parallel or crossing roads.
  if (best.maxDistance>14 || best.score>18) return undefined
  return best.candidate.properties
}

function featureCategory(feature: any) {
  const layer = feature.layer || {}
  const props = feature.properties || {}
  const fingerprint = `${layer.id || ''} ${feature.sourceLayer || layer['source-layer'] || ''}`.toLowerCase()
  const sourceLayer = String(feature.sourceLayer || layer['source-layer'] || '').toLowerCase()
  const roadClass = String(props.class || '').toLowerCase()

  if (String(layer.id || '').startsWith('strictons-')) return null
  if (layer.type === 'symbol') return 'Labels'
  if (sourceLayer === 'building' || /building/.test(fingerprint)) return 'Buildings'
  if (sourceLayer === 'water' || sourceLayer === 'waterway' || /water|ocean|sea|marine|river|lake/.test(fingerprint)) return 'Water'
  if (/park|forest|wood|grass|scrub|landcover|landuse|cemetery|golf|pitch|garden|meadow/.test(fingerprint)) return 'Parks'
  if (sourceLayer === 'boundary' || /boundary|admin/.test(fingerprint)) return 'Boundaries'
  if (/rail/.test(fingerprint) || ['rail','light_rail','subway','tram','narrow_gauge'].includes(roadClass)) return 'Railways'
  if (
    sourceLayer === 'transportation' ||
    /road|street|highway|motorway|trunk|primary|secondary|tertiary|minor|service|bridge|tunnel|path|track|link/.test(fingerprint)
  ) return roadGroup(props)
  if (layer.type === 'fill') return 'Land Details'
  if (layer.type === 'line') return 'Other Lines'
  if (layer.type === 'circle') return 'Points'
  return null
}

function fallbackLineWidth(category: string, theme: MapTheme) {
  if (category === 'Highways') return 2.4 * theme.highwayWidthScale
  if (category === 'Major Roads') return 1.6 * theme.roadWidthScale
  if (category === 'Minor Roads') return 0.85 * theme.minorRoadWidthScale
  if (category === 'Railways') return 1 * theme.railwayWidthScale
  if (category === 'Boundaries') return 0.7
  return 0.8
}

function fallbackLineColour(category: string, theme: MapTheme) {
  if (category === 'Highways') return theme.highways
  if (category === 'Major Roads') return theme.roads
  if (category === 'Minor Roads') return theme.minorRoads
  if (category === 'Railways') return theme.railways
  if (category === 'Boundaries') return theme.boundaries
  if (category === 'Water') return theme.water
  return theme.labels
}

function fallbackFillColour(category: string, theme: MapTheme) {
  if (category === 'Water') return theme.water
  if (category === 'Parks') return theme.parks
  if (category === 'Buildings') return theme.buildings
  return theme.land
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function exportMapSvg(args: ExportSvgArgs) {
  const map = args.map
  if (!map || !map.isStyleLoaded()) throw new Error('The live map is not ready for SVG export.')

  const canvas = map.getCanvas()
  const logicalWidth = canvas.clientWidth || args.previewViewport.width
  const logicalHeight = canvas.clientHeight || args.previewViewport.height
  if (!logicalWidth || !logicalHeight) throw new Error('The preview canvas is not ready for SVG export.')

  const { width, height } = totalPrintPixels(args.size)
  const sx = width / logicalWidth
  const sy = height / logicalHeight
  const strokeScale = (sx + sy) / 2
  const widthMm = args.size.widthMm + args.size.bleedMm * 2
  const heightMm = args.size.heightMm + args.size.bleedMm * 2
  const features = [...map.queryRenderedFeatures()].reverse() as any[]
  const roadNameCandidates = collectRoadNameCandidates(map, features)

  const groupNames = [
    'Land Details',
    'Water',
    'Parks',
    'Buildings',
    'Boundaries',
    'Minor Roads',
    'Major Roads',
    'Highways',
    'Railways',
    'Other Lines',
    'Points',
    'Labels',
    'Featured Markers',
    'Featured Labels',
  ]
  const groups = new globalThis.Map<string,string[]>(groupNames.map(name => [name, []]))
  const roadCategories = new Set(['Minor Roads','Major Roads','Highways'])
  const namedRoadGroups = new globalThis.Map<string, globalThis.Map<string, { label:string; roadClass:string; items:string[]; count:number }>>(
    [...roadCategories].map((name) => [name, new globalThis.Map()])
  )
  const seen = new Set<string>()
  const seenLabels = new Set<string>()
  let objectNumber = 0

  for (const feature of features) {
    const category = featureCategory(feature)
    if (!category || !groups.has(category)) continue
    const layerId = String(feature.layer?.id || 'map-layer')
    const properties = feature.properties || {}
    const geometry = feature.geometry
    const featureKey = `${layerId}|${feature.id ?? ''}|${JSON.stringify(geometry)}`
    if (category !== 'Labels') {
      if (seen.has(featureKey)) continue
      seen.add(featureKey)
    }

    if (category === 'Labels') {
      const name = properties.name || properties['name:en'] || properties.ref
      if (!name) continue
      const placement = labelPlacement(map, geometry, sx, sy)
      if (!placement || !pointInsideCanvas(placement, width, height)) continue
      const labelKey = `${name}|${Math.round(placement.x / 18)}|${Math.round(placement.y / 18)}`
      if (seenLabels.has(labelKey)) continue
      seenLabels.add(labelKey)

      const fontSizeRaw = Number(styleValue(map, layerId, 'layout', 'text-size', properties, 12))
      const fontSize = Math.max(6, fontSizeRaw * strokeScale)
      const fill = String(styleValue(map, layerId, 'paint', 'text-color', properties, args.theme.labels))
      const halo = String(styleValue(map, layerId, 'paint', 'text-halo-color', properties, args.theme.labelHalo))
      const haloWidth = Number(styleValue(map, layerId, 'paint', 'text-halo-width', properties, 1))
      const transform = placement.angle ? ` transform="rotate(${placement.angle.toFixed(2)} ${placement.x.toFixed(2)} ${placement.y.toFixed(2)})"` : ''
      groups.get('Labels')!.push(
        `<text id="label-${++objectNumber}" data-layer="${escapeXml(layerId)}" x="${placement.x.toFixed(2)}" y="${placement.y.toFixed(2)}" text-anchor="middle" dominant-baseline="middle" font-family="Arial, sans-serif" font-size="${fontSize.toFixed(2)}" fill="${escapeXml(fill)}" stroke="${escapeXml(halo)}" stroke-width="${Math.max(0,haloWidth*strokeScale).toFixed(2)}" paint-order="stroke"${transform}>${escapeXml(name)}</text>`
      )
      continue
    }

    if (category === 'Points' || geometry?.type === 'Point' && feature.layer?.type === 'circle') {
      const placement = labelPlacement(map, geometry, sx, sy)
      if (!placement || !pointInsideCanvas(placement, width, height)) continue
      const radius = Number(styleValue(map, layerId, 'paint', 'circle-radius', properties, 3)) * strokeScale
      const fill = String(styleValue(map, layerId, 'paint', 'circle-color', properties, args.theme.featured))
      groups.get('Points')!.push(
        `<circle id="point-${++objectNumber}" data-layer="${escapeXml(layerId)}" cx="${placement.x.toFixed(2)}" cy="${placement.y.toFixed(2)}" r="${Math.max(1,radius).toFixed(2)}" fill="${escapeXml(fill)}"/>`
      )
      continue
    }

    const d = geometryPath(map, geometry, sx, sy, width, height)
    if (!d) continue

    if (feature.layer?.type === 'fill' || ['Water','Parks','Buildings','Land Details'].includes(category) && /Polygon/.test(geometry?.type || '')) {
      const fill = String(styleValue(map, layerId, 'paint', 'fill-color', properties, fallbackFillColour(category,args.theme)))
      const opacity = Number(styleValue(map, layerId, 'paint', 'fill-opacity', properties, 1))
      groups.get(category)!.push(
        `<path id="${svgId(category)}-${++objectNumber}" data-layer="${escapeXml(layerId)}" d="${d}" fill="${escapeXml(fill)}" fill-opacity="${Number.isFinite(opacity)?opacity:1}" fill-rule="evenodd"/>`
      )
      continue
    }

    const colour = String(styleValue(map, layerId, 'paint', 'line-color', properties, fallbackLineColour(category,args.theme)))
    const rawWidth = Number(styleValue(map, layerId, 'paint', 'line-width', properties, fallbackLineWidth(category,args.theme)))
    const opacity = Number(styleValue(map, layerId, 'paint', 'line-opacity', properties, 1))
    const strokeWidth = Math.max(0.2, (Number.isFinite(rawWidth)?rawWidth:fallbackLineWidth(category,args.theme)) * strokeScale)

    if (category === 'Railways') {
      const railId = `railway-${++objectNumber}`
      const opacityValue = Number.isFinite(opacity) ? opacity : 1

      if (args.theme.railwayStyle === 'dashed') {
        groups.get('Railways')!.push(
          `<path id="${railId}" data-name="Railway" data-style="dashed" data-layer="${escapeXml(layerId)}" d="${d}" fill="none" stroke="${escapeXml(colour)}" stroke-width="${strokeWidth.toFixed(2)}" stroke-opacity="${opacityValue}" stroke-dasharray="${(strokeWidth*3.2).toFixed(2)} ${(strokeWidth*2.2).toFixed(2)}" stroke-linecap="butt" stroke-linejoin="round"/>`
        )
      } else if (args.theme.railwayStyle === 'double') {
        const outerWidth = strokeWidth * 2.8
        const gapWidth = strokeWidth * 1.15
        const maskId = `${railId}-mask`
        groups.get('Railways')!.push(
          `<g id="${railId}" data-name="Railway" data-style="double" data-layer="${escapeXml(layerId)}"><defs><mask id="${maskId}" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}"><rect x="0" y="0" width="${width}" height="${height}" fill="white"/><path d="${d}" fill="none" stroke="black" stroke-width="${gapWidth.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/></mask></defs><path d="${d}" fill="none" stroke="${escapeXml(colour)}" stroke-width="${outerWidth.toFixed(2)}" stroke-opacity="${opacityValue}" stroke-linecap="round" stroke-linejoin="round" mask="url(#${maskId})"/></g>`
        )
      } else if (args.theme.railwayStyle === 'sleepers') {
        const railWidth = Math.max(0.2, strokeWidth * 0.72)
        const sleeperWidth = Math.max(0.6, strokeWidth * 3.2)
        groups.get('Railways')!.push(
          `<g id="${railId}" data-name="Railway" data-style="sleepers" data-layer="${escapeXml(layerId)}"><path data-name="Rail" d="${d}" fill="none" stroke="${escapeXml(colour)}" stroke-width="${railWidth.toFixed(2)}" stroke-opacity="${opacityValue}" stroke-linecap="round" stroke-linejoin="round"/><path data-name="Sleepers" d="${d}" fill="none" stroke="${escapeXml(colour)}" stroke-width="${sleeperWidth.toFixed(2)}" stroke-opacity="${opacityValue}" stroke-dasharray="${(sleeperWidth*0.18).toFixed(2)} ${(sleeperWidth*1.45).toFixed(2)}" stroke-linecap="butt" stroke-linejoin="round"/></g>`
        )
      } else {
        groups.get('Railways')!.push(
          `<path id="${railId}" data-name="Railway" data-style="solid" data-layer="${escapeXml(layerId)}" d="${d}" fill="none" stroke="${escapeXml(colour)}" stroke-width="${strokeWidth.toFixed(2)}" stroke-opacity="${opacityValue}" stroke-linecap="round" stroke-linejoin="round"/>`
        )
      }
    } else if (roadCategories.has(category)) {
      const namedProperties = matchRoadName(map, feature, roadNameCandidates)
      const identity = roadIdentity(properties, feature, layerId, namedProperties)
      const categoryRoads = namedRoadGroups.get(category)!
      let road = categoryRoads.get(identity.key)
      if (!road) {
        road = { label:identity.label, roadClass:identity.roadClass, items:[], count:0 }
        categoryRoads.set(identity.key, road)
      }
      const segmentNumber = ++road.count
      const segmentName = `${identity.label} - Segment ${String(segmentNumber).padStart(2,'0')}`
      road.items.push(
        `<path id="${svgId(segmentName)}_${++objectNumber}" data-name="${escapeXml(segmentName)}" data-road-name="${escapeXml(identity.label)}" data-road-class="${escapeXml(identity.roadClass)}" data-layer="${escapeXml(layerId)}" d="${d}" fill="none" stroke="${escapeXml(colour)}" stroke-width="${strokeWidth.toFixed(2)}" stroke-opacity="${Number.isFinite(opacity)?opacity:1}" stroke-linecap="round" stroke-linejoin="round"/>`
      )
    } else {
      groups.get(category)!.push(
        `<path id="${svgId(category)}-${++objectNumber}" data-layer="${escapeXml(layerId)}" d="${d}" fill="none" stroke="${escapeXml(colour)}" stroke-width="${strokeWidth.toFixed(2)}" stroke-opacity="${Number.isFinite(opacity)?opacity:1}" stroke-linecap="round" stroke-linejoin="round"/>`
      )
    }
  }

  for (const place of args.featuredPlaces) {
    const point = projectCoordinate(map, [place.lng, place.lat], sx, sy)
    const markerRadius = Math.max(2, 5 * strokeScale)
    if (point.x - markerRadius < 0 || point.x + markerRadius > width || point.y - markerRadius < 0 || point.y + markerRadius > height) continue
    groups.get('Featured Markers')!.push(
      `<circle id="featured-marker-${++objectNumber}" data-name="${escapeXml(place.name)}" cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="${markerRadius.toFixed(2)}" fill="${escapeXml(args.theme.featured)}" stroke="${escapeXml(args.theme.featuredHalo)}" stroke-width="${Math.max(1,2*strokeScale).toFixed(2)}"/>`
    )
    groups.get('Featured Labels')!.push(
      `<text id="featured-label-${++objectNumber}" data-name="${escapeXml(place.name)}" x="${point.x.toFixed(2)}" y="${(point.y + 16*strokeScale).toFixed(2)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${Math.max(6,args.theme.featuredLabelSize*strokeScale).toFixed(2)}" fill="${escapeXml(args.theme.featuredText)}" stroke="${escapeXml(args.theme.featuredHalo)}" stroke-width="${Math.max(0.5,1.5*strokeScale).toFixed(2)}" paint-order="stroke">${escapeXml(place.name)}</text>`
    )
  }

  const orderedGroups = groupNames.map((name) => {
    if (roadCategories.has(name)) {
      const roads = [...(namedRoadGroups.get(name)?.values() || [])]
        .sort((a,b) => a.label.localeCompare(b.label))
        .map((road, roadIndex) => {
          const groupId = `${svgId(road.label)}_${String(roadIndex + 1).padStart(2,'0')}`
          return `<g id="${groupId}" data-name="${escapeXml(road.label)}" inkscape:groupmode="layer" inkscape:label="${escapeXml(road.label)}" data-road-class="${escapeXml(road.roadClass)}">${road.items.join('')}</g>`
        })
        .join('')
      return `<g id="${svgId(name)}" data-name="${escapeXml(name)}" inkscape:groupmode="layer" inkscape:label="${escapeXml(name)}">${roads}</g>`
    }

    const items = groups.get(name) || []
    return `<g id="${svgId(name)}" data-name="${escapeXml(name)}" inkscape:groupmode="layer" inkscape:label="${escapeXml(name)}">${items.join('')}</g>`
  }).join('')

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${widthMm}mm" height="${heightMm}mm" viewBox="0 0 ${width} ${height}" shape-rendering="geometricPrecision">
  <g id="Map_Artwork" data-name="Map Artwork" inkscape:groupmode="layer" inkscape:label="Map Artwork">
    <rect id="Land_Background" x="0" y="0" width="${width}" height="${height}" fill="${escapeXml(args.theme.land)}"/>
    ${orderedGroups}
  </g>
</svg>`

  downloadBlob(new Blob([svg], { type:'image/svg+xml;charset=utf-8' }), args.filename)
}
