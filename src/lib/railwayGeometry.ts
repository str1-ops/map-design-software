import type { Map } from 'maplibre-gl'

// The OpenMapTiles transportation layer is divided into independently clipped
// vector tiles. Treating those pieces as separate dashed paths restarts the
// dash phase at every tile seam. Rebuild a small undirected track network,
// reconnect overlapping pieces, then cut physical dash segments from each
// continuous route. Explicit dash geometry has no per-tile dash phase.
export type RailCoordinate = [number, number]
export type RailPoint = { x: number; y: number }
export type RailGeoJson = { type: 'FeatureCollection'; features: Array<{
  type: 'Feature'; properties: Record<string, never>;
  geometry: { type: 'LineString'; coordinates: RailCoordinate[] }
}> }
export type RailwayArtwork = { paths: RailGeoJson; dashes: RailGeoJson; sleepers: RailGeoJson }

type RailNode = RailPoint & { ends: boolean }
type RailEdge = { a: number; b: number }

function asCollection(lines: RailCoordinate[][]): RailGeoJson {
  return {
    type: 'FeatureCollection',
    features: lines.filter(line => line.length >= 2).map(coordinates => ({
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'LineString' as const, coordinates },
    })),
  }
}

const distance = (a: RailPoint, b: RailPoint) => Math.hypot(a.x - b.x, a.y - b.y)

/**
 * Source features may be duplicated in adjacent tiles, reversed, and clipped
 * midway along a segment. Work in projected pixels, snap coincident vertices,
 * split overlapping lines at matching tile endpoints, then trace each route.
 * A junction can have multiple distinct routes; never invent a link between
 * railway tracks that do not physically meet.
 */
export function stitchRailwayPaths(
  lines: RailPoint[][],
  snapTolerance = 0.9,
): RailPoint[][] {
  const nodes: RailNode[] = []
  const rawEdges: RailEdge[] = []
  const buckets = new globalThis.Map<string, number[]>()
  const cell = Math.max(1, snapTolerance * 2)
  const bucketKey = (x: number, y: number) => `${x}:${y}`
  const nodeAt = (p: RailPoint, isEnd: boolean) => {
    const gx = Math.floor(p.x / cell), gy = Math.floor(p.y / cell)
    let best = -1, nearest = snapTolerance
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const index of buckets.get(bucketKey(gx + dx, gy + dy)) || []) {
        const d = distance(nodes[index], p)
        if (d <= nearest) { best = index; nearest = d }
      }
    }
    if (best >= 0) {
      if (isEnd) nodes[best].ends = true
      return best
    }
    const index = nodes.length
    nodes.push({ ...p, ends: isEnd })
    const key = bucketKey(gx, gy)
    buckets.set(key, [...(buckets.get(key) || []), index])
    return index
  }

  for (const line of lines) {
    if (line.length < 2) continue
    const ids = line.map((point, i) => nodeAt(point, i === 0 || i === line.length - 1))
    for (let i = 1; i < ids.length; i++) {
      if (ids[i] !== ids[i - 1]) rawEdges.push({ a: ids[i - 1], b: ids[i] })
    }
  }

  // Tile padding can make a line end in the middle of the adjacent tile's
  // longer segment. Splitting that segment at the clipped endpoint removes
  // duplicate, partially overlapping edges without moving the track.
  const candidateEnds = nodes.map((n, i) => n.ends ? i : -1).filter(i => i >= 0)
  const unique = new globalThis.Map<string, RailEdge>()
  const addEdge = (a: number, b: number) => {
    if (a === b || distance(nodes[a], nodes[b]) < 0.1) return
    const key = a < b ? `${a}:${b}` : `${b}:${a}`
    if (!unique.has(key)) unique.set(key, { a, b })
  }
  for (const edge of rawEdges) {
    const a = nodes[edge.a], b = nodes[edge.b]
    const vx = b.x - a.x, vy = b.y - a.y
    const len2 = vx * vx + vy * vy
    const cuts: { id: number; t: number }[] = [{ id: edge.a, t: 0 }, { id: edge.b, t: 1 }]
    if (len2 > 1) {
      for (const id of candidateEnds) {
        if (id === edge.a || id === edge.b) continue
        const p = nodes[id]
        if (p.x < Math.min(a.x, b.x) - snapTolerance ||
            p.x > Math.max(a.x, b.x) + snapTolerance ||
            p.y < Math.min(a.y, b.y) - snapTolerance ||
            p.y > Math.max(a.y, b.y) + snapTolerance) continue
        const t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2
        if (t <= 0.001 || t >= 0.999) continue
        if (Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy)) <= snapTolerance) {
          cuts.push({ id, t })
        }
      }
    }
    cuts.sort((one, two) => one.t - two.t)
    for (let i = 1; i < cuts.length; i++) addEdge(cuts[i - 1].id, cuts[i].id)
  }

  const edges = [...unique.values()]
  const adjacent: number[][] = nodes.map(() => [])
  edges.forEach((edge, i) => { adjacent[edge.a].push(i); adjacent[edge.b].push(i) })
  const used = new Set<number>()

  function trace(startNode: number, firstEdge: number): RailPoint[] {
    const path: RailPoint[] = [nodes[startNode]]
    let at = startNode, previous = -1, edgeIndex = firstEdge
    while (edgeIndex >= 0 && !used.has(edgeIndex)) {
      used.add(edgeIndex)
      const edge = edges[edgeIndex]
      const next = edge.a === at ? edge.b : edge.a
      path.push(nodes[next])
      const options = adjacent[next].filter(i => !used.has(i))
      if (!options.length) break

      let bestIndex = -1, bestStraightness = -2
      for (const candidate of options) {
        const other = edges[candidate].a === next ? edges[candidate].b : edges[candidate].a
        if (other === at) continue
        const enter = { x: nodes[next].x - nodes[at].x, y: nodes[next].y - nodes[at].y }
        const leave = { x: nodes[other].x - nodes[next].x, y: nodes[other].y - nodes[next].y }
        const product = (enter.x * leave.x + enter.y * leave.y) /
          (Math.hypot(enter.x, enter.y) * Math.hypot(leave.x, leave.y) || 1)
        if (product > bestStraightness) { bestIndex = candidate; bestStraightness = product }
      }
      // Avoid turning onto a crossing or unrelated branch at a junction.
      if (bestIndex < 0 || bestStraightness < 0.25) break
      previous = at
      at = next
      edgeIndex = bestIndex
      if (at === startNode || previous === at) break
    }
    return path
  }

  const routes: RailPoint[][] = []
  // Start at loose ends first so an entire through-route has one dash phase.
  const starts = nodes.map((_, i) => i).sort((a, b) => adjacent[a].length - adjacent[b].length)
  for (const node of starts) {
    for (const edge of adjacent[node]) {
      if (!used.has(edge)) {
        const route = trace(node, edge)
        if (route.length > 1) routes.push(route)
      }
    }
  }
  return routes
}

/** Split a continuous screen-space path into equally measured dash paths. */
export function segmentRailwayDashes(
  routes: RailPoint[][],
  dashLength: number,
  gapLength: number,
): RailPoint[][] {
  const dash = Math.max(1, dashLength), gap = Math.max(1, gapLength)
  const output: RailPoint[][] = []
  for (const route of routes) {
    let phase = 0
    let current: RailPoint[] = []
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1], b = route[i]
      const length = distance(a, b)
      if (length < 0.001) continue
      let along = 0
      while (along < length - 0.00001) {
        const on = phase < dash
        const remaining = (on ? dash : dash + gap) - phase
        const step = Math.min(length - along, remaining)
        const from = { x: a.x + (b.x - a.x) * along / length,
          y: a.y + (b.y - a.y) * along / length }
        const to = { x: a.x + (b.x - a.x) * (along + step) / length,
          y: a.y + (b.y - a.y) * (along + step) / length }
        if (on) {
          if (!current.length) current.push(from)
          current.push(to)
        }
        along += step
        phase += step
        if (phase >= dash + gap - 0.00001) phase = 0
        if ((phase >= dash - 0.00001 || phase === 0) && current.length > 1) {
          output.push(current)
          current = []
        }
      }
    }
    if (current.length > 1) output.push(current)
  }
  return output
}

export function railFeaturesFromSource(map: Map, source: string, sourceLayer: string): RailPoint[][] {
  let features: any[] = []
  try { features = map.querySourceFeatures(source, { sourceLayer }) as any[] }
  catch { return [] }

  const lines: RailPoint[][] = []
  for (const feature of features) {
    const cls = String(feature.properties?.class || '').toLowerCase()
    const subclass = String(feature.properties?.subclass || '').toLowerCase()
    if (!['rail', 'transit'].includes(cls) && !['rail', 'light_rail', 'subway', 'tram', 'narrow_gauge'].includes(subclass)) continue
    const geometry = feature.geometry
    const pieces = geometry?.type === 'LineString' ? [geometry.coordinates] :
      geometry?.type === 'MultiLineString' ? geometry.coordinates : []
    for (const piece of pieces) {
      if (piece.length < 2) continue
      const projected = piece.map((coord: RailCoordinate) => {
        const p = map.project(coord)
        return { x: p.x, y: p.y }
      })
      lines.push(projected)
    }
  }
  return lines
}

export function buildRailwayArtwork(map: Map, lines: RailPoint[][], dash: number, gap: number): RailwayArtwork {
  const routes = stitchRailwayPaths(lines)
  const toGeo = (items: RailPoint[][]) => asCollection(items.map(points => points.map(p => {
    const ll = map.unproject([p.x, p.y])
    return [ll.lng, ll.lat] as RailCoordinate
  })))
  return {
    paths: toGeo(routes),
    dashes: toGeo(segmentRailwayDashes(routes, dash, gap)),
    sleepers: toGeo(segmentRailwayDashes(routes, 0.8, 7)),
  }
}
