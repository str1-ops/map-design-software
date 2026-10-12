import type { RailPoint } from './railwayGeometry'

// A single editorial centreline represents a railway corridor, even where
// OSM supplies multiple parallel physical tracks, turnouts and tile fragments.
// Build a graph of the actual rail geometry and choose one end-to-end route
// through it. The pathfinder cannot double back around a siding or loop.
type Node = RailPoint & { links: globalThis.Map<number, number> }
type Line = RailPoint[]
const length = (a: RailPoint, b: RailPoint) => Math.hypot(a.x - b.x, a.y - b.y)
const routeLength = (route: Line) => route.reduce(
  (sum, p, i) => sum + (i ? length(route[i - 1], p) : 0), 0)
const cellKey = (x: number, y: number) => `${x}:${y}`

class MinHeap {
  private data: { node: number; cost: number }[] = []
  push(node: number, cost: number) {
    const array = this.data
    let i = array.length
    array.push({ node, cost })
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (array[parent].cost <= cost) break
      array[i] = array[parent]
      i = parent
    }
    array[i] = { node, cost }
  }
  pop(): { node: number; cost: number } | undefined {
    const heap = this.data
    if (!heap.length) return undefined
    const root = heap[0]
    const last = heap.pop()!
    if (heap.length) {
      let i = 0
      while (i * 2 + 1 < heap.length) {
        const left = i * 2 + 1, right = left + 1
        const child = right < heap.length && heap[right].cost < heap[left].cost
          ? right : left
        if (heap[child].cost >= last.cost) break
        heap[i] = heap[child]
        i = child
      }
      heap[i] = last
    }
    return root
  }
  get size() { return this.data.length }
}

function buildGraph(lines: Line[]) {
  const nodes: Node[] = []
  const grid = new globalThis.Map<string, number[]>()
  const size = 2
  const tolerance = 0.85
  const nodeAt = (p: RailPoint) => {
    const x = Math.floor(p.x / size), y = Math.floor(p.y / size)
    let nearest = -1, distance = tolerance
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const index of grid.get(cellKey(x + dx, y + dy)) || []) {
        const d = length(nodes[index], p)
        if (d < distance) { nearest = index; distance = d }
      }
    }
    if (nearest !== -1) return nearest
    const index = nodes.length
    nodes.push({ x: p.x, y: p.y, links: new globalThis.Map() })
    const key = cellKey(x, y)
    grid.set(key, [...(grid.get(key) || []), index])
    return index
  }
  const connect = (a: number, b: number) => {
    if (a === b) return
    const d = length(nodes[a], nodes[b])
    if (d < 0.05) return
    const old = nodes[a].links.get(b)
    if (old !== undefined && old <= d) return
    nodes[a].links.set(b, d)
    nodes[b].links.set(a, d)
  }
  for (const line of lines) {
    if (line.length < 2) continue
    let before = nodeAt(line[0])
    for (let i = 1; i < line.length; i++) {
      const next = nodeAt(line[i])
      connect(before, next)
      before = next
    }
  }

  // Only bridge small gaps when the two rails are facing one another.
  // Never join adjacent parallel endpoints just because they are nearby.
  type End = { index: number; outward: RailPoint }
  const ends: End[] = []
  const endGrid = new globalThis.Map<string, End[]>()
  for (let index = 0; index < nodes.length; index++) {
    const neighbours = [...nodes[index].links.keys()]
    if (neighbours.length !== 1) continue
    const other = nodes[neighbours[0]]
    const n = nodes[index], d = length(other, n)
    const item = { index, outward: { x: (n.x - other.x) / d, y: (n.y - other.y) / d } }
    ends.push(item)
    const key = cellKey(Math.floor(n.x / 12), Math.floor(n.y / 12))
    endGrid.set(key, [...(endGrid.get(key) || []), item])
  }
  const candidates: { a: number; b: number; score: number }[] = []
  for (const a of ends) {
    const first = nodes[a.index]
    const gx = Math.floor(first.x / 12), gy = Math.floor(first.y / 12)
    for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
      for (const b of endGrid.get(cellKey(gx + ox, gy + oy)) || []) {
        if (b.index <= a.index) continue
        const second = nodes[b.index], d = length(first, second)
        if (d < 0.8 || d > 9) continue
        const vx = (second.x - first.x) / d, vy = (second.y - first.y) / d
        const startAlignment = a.outward.x * vx + a.outward.y * vy
        const endAlignment = -(b.outward.x * vx + b.outward.y * vy)
        if (startAlignment < 0.58 || endAlignment < 0.58) continue
        candidates.push({ a: a.index, b: b.index,
          score: d + 5 * (2 - startAlignment - endAlignment) })
      }
    }
  }
  candidates.sort((a, b) => a.score - b.score)
  const joined = new Set<number>()
  for (const c of candidates) {
    if (joined.has(c.a) || joined.has(c.b)) continue
    connect(c.a, c.b)
    joined.add(c.a); joined.add(c.b)
  }
  return nodes
}

function connectedComponents(nodes: Node[]) {
  const visited = new Set<number>()
  const components: number[][] = []
  for (let start = 0; start < nodes.length; start++) {
    if (visited.has(start) || !nodes[start].links.size) continue
    const stack = [start]
    const component: number[] = []
    visited.add(start)
    while (stack.length) {
      const node = stack.pop()!
      component.push(node)
      for (const next of nodes[node].links.keys()) {
        if (visited.has(next)) continue
        visited.add(next); stack.push(next)
      }
    }
    components.push(component)
  }
  return components
}

function shortestPaths(nodes: Node[], start: number) {
  const cost = new globalThis.Map<number, number>()
  const previous = new globalThis.Map<number, number>()
  const heap = new MinHeap()
  heap.push(start, 0)
  cost.set(start, 0)
  while (heap.size) {
    const item = heap.pop()!
    if (item.cost > (cost.get(item.node) ?? Infinity)) continue
    for (const [next, distance] of nodes[item.node].links) {
      const candidate = item.cost + distance
      if (candidate >= (cost.get(next) ?? Infinity)) continue
      cost.set(next, candidate)
      previous.set(next, item.node)
      heap.push(next, candidate)
    }
  }
  return { cost, previous }
}

/**
 * Follow the largest geodesic route through the network. Choosing the
 * SHORTEST path between its farthest endpoints also removes duplicate
 * turnouts, parallel diversions and U-shaped rejoining tracks.
 */
function trunk(nodes: Node[], component: number[]): Line {
  if (!component.length) return []
  const endpoints = component.filter(index => nodes[index].links.size === 1)
  const eligible = endpoints.length > 1 ? endpoints : component
  const extent = (starting: number) => {
    const shortest = shortestPaths(nodes, starting)
    let farthest = starting, farthestDistance = -1
    for (const index of eligible) {
      const d = shortest.cost.get(index) ?? -1
      if (d > farthestDistance) { farthestDistance = d; farthest = index }
    }
    return { farthest, shortest }
  }
  let start = eligible[0]
  // Two sweeps are sufficient to find the dominant route of an approximately
  // linear rail network, without an expensive all-endpoint path search.
  for (let i = 0; i < 2; i++) start = extent(start).farthest
  const { farthest: finish, shortest } = extent(start)
  const route = [finish]
  let current = finish
  while (current !== start) {
    const previous = shortest.previous.get(current)
    if (previous === undefined) break
    route.push(previous)
    current = previous
  }
  route.reverse()
  return route.map(id => ({ x: nodes[id].x, y: nodes[id].y }))
}

function sampleRoute(route: Line, spacing = 5): Line {
  const points: Line = []
  if (!route.length) return points
  points.push(route[0])
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i]
    const count = Math.max(1, Math.ceil(length(a, b) / spacing))
    for (let n = 1; n <= count; n++) {
      const t = n / count
      points.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) })
    }
  }
  return points
}

function distanceToRoute(p: RailPoint, line: Line) {
  let best = Infinity
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i]
    const dx = b.x - a.x, dy = b.y - a.y
    const t = Math.max(0, Math.min(1,
      ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)))
    const d = Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)
    if (d < best) best = d
  }
  return best
}

/**
 * Separate OSM physical tracks can be disconnected graph components.
 * These are alternative depictions of the SAME corridor when they follow
 * the accepted centreline nearby. Keep distinct, distant railways.
 */
function reduceParallelTracks(routes: Line[]): Line[] {
  const sorted = routes
    .filter(route => routeLength(route) > 12)
    .sort((a, b) => routeLength(b) - routeLength(a))
  const accepted: Line[] = []
  const overlapTolerance = 22
  for (const route of sorted) {
    if (!accepted.length) { accepted.push(route); continue }
    const samples = sampleRoute(route, 6)
    const nearest = samples.map(p => Math.min(
      ...accepted.map(reference => distanceToRoute(p, reference))))
    const near = nearest.filter(d => d <= overlapTolerance).length
    const fraction = near / samples.length

    // A separate parallel railway close to the main line should not be
    // rendered twice; keep any non-overlapping continuation at its ends.
    if (fraction >= 0.35) {
      let attached = false
      for (const main of accepted) {
        const original = [...main]
        for (const atStart of [false, true]) {
          const endpoint = atStart ? main[0] : main[main.length - 1]
          const neighbour = atStart ? main[1] : main[main.length - 2]
          const outward = { x: endpoint.x - neighbour.x,
            y: endpoint.y - neighbour.y }
          const magnitude = Math.hypot(outward.x, outward.y) || 1
          let best: Line | null = null, bestForward = 0
          for (let i = 0; i < samples.length; i++) {
            if (length(samples[i], endpoint) > 17) continue
            for (const branch of [
              samples.slice(i), [...samples.slice(0, i + 1)].reverse(),
            ]) {
              if (branch.length < 2) continue
              const last = branch[branch.length - 1]
              const dx = last.x - endpoint.x, dy = last.y - endpoint.y
              const forward = (dx * outward.x + dy * outward.y) / magnitude
              if (forward <= 22 || forward < Math.hypot(dx, dy) * 0.7) continue
              if (forward > bestForward) { bestForward = forward; best = branch }
            }
          }
          if (!best) continue
          const addition = best.slice(1)
          if (atStart) main.unshift(...addition.reverse())
          else main.push(...addition)
          attached = true
        }
        if (attached && routeLength(main) > routeLength(original)) break
      }
      if (fraction > 0.65 || attached) continue
    }
    accepted.push(route)
  }
  return accepted
}

export function representativeRailwayRoutes(lines: Line[]): Line[] {
  const nodes = buildGraph(lines)
  const components = connectedComponents(nodes)
  const routes = components.map(ids => trunk(nodes, ids))
  return reduceParallelTracks(routes)
}
