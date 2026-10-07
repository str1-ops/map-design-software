import type { Map, StyleSpecification } from 'maplibre-gl'

export const BASE_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'
export const FEATURED_SOURCE_ID = 'strictons-featured-places'
export const FEATURED_DOT_LAYER_ID = 'strictons-featured-dots'
export const FEATURED_LABEL_LAYER_ID = 'strictons-featured-labels'

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

function scaledLineWidth(original: unknown, scale: number) {
  if (typeof original === 'number') return original * scale
  if (Array.isArray(original)) return ['*', original, scale]
  return original
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

function isHighway(layer: any) {
  return layer.type === 'line' && includes(layerFingerprint(layer), /motorway|trunk|freeway|expressway/)
}

function isMinorRoad(layer: any) {
  return layer.type === 'line' && includes(layerFingerprint(layer), /minor|residential|service|path|track|foot|cycle|pedestrian/)
}

function isRoad(layer: any) {
  return layer.type === 'line' && includes(layerFingerprint(layer), /road|street|highway|motorway|trunk|primary|secondary|tertiary|transportation|bridge|tunnel|path|track/)
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
        setPaintSafe(map, id, 'line-color', theme.railways)
      } else if (isBoundary(layer)) {
        setPaintSafe(map, id, 'line-color', theme.boundaries)
      } else if (isHighway(layer)) {
        setPaintSafe(map, id, 'line-color', theme.highways)
        const baseWidth = getOriginalLineWidth(map, id)
        const width = scaledLineWidth(baseWidth, theme.highwayWidthScale)
        if (width !== undefined) setPaintSafe(map, id, 'line-width', width)
      } else if (isMinorRoad(layer)) {
        setPaintSafe(map, id, 'line-color', theme.minorRoads)
        const baseWidth = getOriginalLineWidth(map, id)
        const width = scaledLineWidth(baseWidth, theme.minorRoadWidthScale)
        if (width !== undefined) setPaintSafe(map, id, 'line-width', width)
      } else if (isRoad(layer)) {
        setPaintSafe(map, id, 'line-color', theme.roads)
        const baseWidth = getOriginalLineWidth(map, id)
        const width = scaledLineWidth(baseWidth, theme.roadWidthScale)
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

export async function exportMapSvg(args: ExportMapArgs) {
  const output = await renderMapCanvas(args)
  const widthMm = args.size.widthMm + args.size.bleedMm * 2
  const heightMm = args.size.heightMm + args.size.bleedMm * 2
  const raster = output.toDataURL('image/png')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${widthMm}mm" height="${heightMm}mm" viewBox="0 0 ${output.width} ${output.height}" preserveAspectRatio="none"><image href="${raster}" xlink:href="${raster}" x="0" y="0" width="${output.width}" height="${output.height}" preserveAspectRatio="none"/></svg>`
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    downloadDataUrl(url, args.filename)
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}
