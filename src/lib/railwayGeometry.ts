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
  // At junctions, pair the two edges forming the straightest continuation.
  // This preserves the main railway as a continuous route and leaves sidings
  // or branch tracks as independent routes without altering their geography.
  const paired = nodes.map(() => new globalThis.Map<number, number>())
  for (let node = 0; node < nodes.length; node++) {
    const incident = adjacent[node]
    const possibilities: { a: number; b: number; alignment: number }[] = []
    for (let i = 0; i < incident.length; i++) for (let j = i + 1; j < incident.length; j++) {
      const first = edges[incident[i]], second = edges[incident[j]]
      const a = nodes[first.a === node ? first.b : first.a]
      const b = nodes[second.a === node ? second.b : second.a]
      const ax = a.x - nodes[node].x, ay = a.y - nodes[node].y
      const bx = b.x - nodes[node].x, by = b.y - nodes[node].y
      const alignment = (ax * bx + ay * by) /
        (Math.hypot(ax, ay) * Math.hypot(bx, by) || 1)
      if (alignment < -0.25) possibilities.push({
        a: incident[i], b: incident[j], alignment,
      })
    }
    possibilities.sort((a, b) => a.alignment - b.alignment)
    for (const option of possibilities) {
      if (paired[node].has(option.a) || paired[node].has(option.b)) continue
      paired[node].set(option.a, option.b)
      paired[node].set(option.b, option.a)
    }
  }

  const used = new Set<number>()
  const trace = (start: number, first: number): RailPoint[] => {
    const route: RailPoint[] = [nodes[start]]
    let at = start, edgeIndex = first
    while (!used.has(edgeIndex)) {
      used.add(edgeIndex)
      const edge = edges[edgeIndex]
      const next = edge.a === at ? edge.b : edge.a
      route.push(nodes[next])
      const continuation = paired[next].get(edgeIndex)
      if (continuation === undefined || used.has(continuation)) break
      at = next
      edgeIndex = continuation
    }
    return route
  }

  const routes: RailPoint[][] = []
  // Start with every unpaired endpoint of a route. All paired edges are
  // travelled through in one pass, even across degree-three junctions.
  const starts = nodes.flatMap((_, node) => adjacent[node]
    .filter(edge => !paired[node].has(edge))
    .map(edge => ({ node, edge })))
    .sort((a, b) => nodes[a.node].y - nodes[b.node].y ||
      nodes[a.node].x - nodes[b.node].x)
  for (const start of starts) {
    if (!used.has(start.edge)) {
      const route = trace(start.node, start.edge)
      if (route.length > 1) routes.push(route)
    }
  }
  // Closed-loop railways have no loose ends.
  for (let index = 0; index < edges.length; index++) {
    if (!used.has(index)) {
      const route = trace(edges[index].a, index)
      if (route.length > 1) routes.push(route)
    }
  }
  return routes
}


/**
 * Editorial maps depict a railway corridor as ONE centreline, not every
 * overlapping vector-tile trace or neighbouring track of a double track.
 * First connect tile-split endpoints pointing in the same direction; then
 * keep the longest alignment and add only genuinely new branches.
 */
const corridorDistance = 17 // CSS pixels at the current map zoom
const minimumBranchLength = 32

function polylineLength(path: RailPoint[]) {
  let length = 0
  for (let i = 1; i < path.length; i++) length += distance(path[i - 1], path[i])
  return length
}

function routeHeading(route: RailPoint[], atEnd: boolean): RailPoint {
  const a = atEnd ? route[route.length - 2] : route[0]
  const b = atEnd ? route[route.length - 1] : route[1]
  const length = distance(a, b) || 1
  return { x: (b.x - a.x) / length, y: (b.y - a.y) / length }
}

function closeRailwayGaps(paths: RailPoint[][]): RailPoint[][] {
  const routes = paths.filter(path => path.length > 1 && polylineLength(path) >= 2)
    .map(path => [...path])
  const maxJoins = routes.length - 1
  const cell = 20
  const bucketKey = (x: number, y: number) => `${x}:${y}`
  type Endpoint = { index: number; tail: boolean; point: RailPoint; outward: RailPoint }
  // Search only neighbouring endpoints, not every possible route pair. Large
  // city maps can contain hundreds of rail segments across source tiles.
  for (let pass = 0; pass < maxJoins; pass++) {
    const endpoints: Endpoint[] = []
    for (let i = 0; i < routes.length; i++) {
      const route = routes[i]
      const head = routeHeading(route, false)
      const tail = routeHeading(route, true)
      endpoints.push({
        index: i, tail: false, point: route[0],
        outward: { x: -head.x, y: -head.y },
      }, {
        index: i, tail: true, point: route[route.length - 1],
        outward: tail,
      })
    }
    const grid = new globalThis.Map<string, Endpoint[]>()
    for (const endpoint of endpoints) {
      const x = Math.floor(endpoint.point.x / cell), y = Math.floor(endpoint.point.y / cell)
      const key = bucketKey(x, y)
      const bucket = grid.get(key) || []
      bucket.push(endpoint)
      grid.set(key, bucket)
    }

    let best: { a: Endpoint; b: Endpoint; score: number } | null = null
    for (const a of endpoints) {
      const gx = Math.floor(a.point.x / cell), gy = Math.floor(a.point.y / cell)
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        for (const b of grid.get(bucketKey(gx + ox, gy + oy)) || []) {
          if (a.index === b.index) continue
          const gap = distance(a.point, b.point)
          if (gap > 19) continue
          // Both endpoint tangents are directed OUT of their respective
          // paths: valid continuation means they face opposite directions.
          const alignment = -(a.outward.x * b.outward.x + a.outward.y * b.outward.y)
          if (alignment < 0.78) continue
          if (gap > 2) {
            const dx = (b.point.x - a.point.x) / gap
            const dy = (b.point.y - a.point.y) / gap
            const forwardA = a.outward.x * dx + a.outward.y * dy
            const forwardB = -(b.outward.x * dx + b.outward.y * dy)
            if (forwardA < 0.38 || forwardB < 0.38) continue
          }
          const score = gap + (1 - alignment) * 16
          if (!best || score < best.score) best = { a, b, score }
        }
      }
    }
    if (!best) break
    const { a, b } = best
    const first = a.tail ? routes[a.index] : [...routes[a.index]].reverse()
    const second = b.tail ? [...routes[b.index]].reverse() : routes[b.index]
    routes[a.index] = [
      ...first,
      ...second.slice(distance(first[first.length - 1], second[0]) < 0.2 ? 1 : 0),
    ]
    routes.splice(b.index, 1)
  }
  return routes
}

type Proximity = { near: boolean; x: number; y: number }
type IndexedSegment = { a: RailPoint; b: RailPoint; tx: number; ty: number }

function railwayReference() {
  const grid = new globalThis.Map<string, IndexedSegment[]>()
  const cell = 32
  const key = (x: number, y: number) => `${x}:${y}`
  const add = (route: RailPoint[]) => {
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1], b = route[i]
      const length = distance(a, b)
      if (length < 0.01) continue
      const segment: IndexedSegment = { a, b,
        tx: (b.x - a.x) / length, ty: (b.y - a.y) / length }
      const left = Math.floor((Math.min(a.x, b.x) - corridorDistance) / cell)
      const right = Math.floor((Math.max(a.x, b.x) + corridorDistance) / cell)
      const top = Math.floor((Math.min(a.y, b.y) - corridorDistance) / cell)
      const bottom = Math.floor((Math.max(a.y, b.y) + corridorDistance) / cell)
      for (let x = left; x <= right; x++) for (let y = top; y <= bottom; y++) {
        const id = key(x, y)
        const items = grid.get(id) || []
        items.push(segment)
        grid.set(id, items)
      }
    }
  }
  const nearest = (p: RailPoint, tangent: RailPoint): Proximity => {
    const x = Math.floor(p.x / cell), y = Math.floor(p.y / cell)
    const candidates = grid.get(key(x, y)) || []
    let best = corridorDistance
    let result: Proximity = { near: false, x: p.x, y: p.y }
    for (const s of candidates) {
      const parallel = Math.abs(s.tx * tangent.x + s.ty * tangent.y)
      if (parallel < 0.72) continue
      const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y
      const t = Math.max(0, Math.min(1, ((p.x - s.a.x) * dx + (p.y - s.a.y) * dy) / (dx * dx + dy * dy)))
      const px = s.a.x + t * dx, py = s.a.y + t * dy
      const delta = Math.hypot(p.x - px, p.y - py)
      if (delta <= best) { best = delta; result = { near: true, x: px, y: py } }
    }
    return result
  }
  return { add, nearest }
}

function sampleRailway(route: RailPoint[], spacing = 5) {
  const samples: RailPoint[] = []
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i]
    const length = distance(a, b)
    const steps = Math.max(1, Math.ceil(length / spacing))
    for (let j = 0; j < steps; j++) {
      const t = j / steps
      samples.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
    }
  }
  if (route.length) samples.push(route[route.length - 1])
  return samples
}

export function consolidateRailwayCorridors(paths: RailPoint[][]): RailPoint[][] {
  const connected = closeRailwayGaps(paths)
    .sort((a, b) => polylineLength(b) - polylineLength(a))
  const corridor = railwayReference()
  const clean: RailPoint[][] = []
  for (const candidate of connected) {
    const sampled = sampleRailway(candidate)
    if (sampled.length < 2) continue
    const proximity = sampled.map((p, i) => {
      const a = sampled[Math.max(0, i - 1)]
      const b = sampled[Math.min(sampled.length - 1, i + 1)]
      const length = distance(a, b) || 1
      return corridor.nearest(p, { x: (b.x - a.x) / length, y: (b.y - a.y) / length })
    })
    // Each uninterrupted section not already represented by a longer route
    // becomes a new branch. Nearby repeated traces are discarded. In
    // particular, a short side track which leaves and rejoins the same main
    // corridor is not drawn as a second copy of the railway.
    const branches: RailPoint[][] = []
    let i = 0
    while (i < sampled.length) {
      while (i < sampled.length && proximity[i].near) i++
      if (i >= sampled.length) break
      const start = i
      while (i < sampled.length && !proximity[i].near) i++
      const end = i
      const original = sampled.slice(start, end)
      if (polylineLength(original) < minimumBranchLength) continue
      // A parallel diversion that rejoins the mainline is not a separate
      // guide-map railway. A genuine branch only attaches at one end.
      const atStart = start > 0 && proximity[start - 1].near
      const atEnd = end < sampled.length && proximity[end].near
      if (atStart && atEnd) continue
      const branch: RailPoint[] = []
      if (atStart) branch.push({ x: proximity[start - 1].x, y: proximity[start - 1].y })
      branch.push(...original)
      if (atEnd) branch.push({ x: proximity[end].x, y: proximity[end].y })
      if (branch.length > 1) branches.push(branch)
    }
    // No accepted centreline exists yet: the entire first and longest route
    // forms the corridor, with its original accurate vertices intact.
    if (!clean.length && !branches.length) branches.push(candidate)
    for (const route of branches) {
      clean.push(route)
      corridor.add(route)
    }
  }
  return clean
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
  const routes = consolidateRailwayCorridors(stitchRailwayPaths(lines))
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
