import type { Map } from 'maplibre-gl'
import type { LayerVisibility, MapTheme } from './mapDesign'

export const ROAD_REPAIR_SOURCE = 'strictons-road-repair-source'
export const ROAD_REPAIR_LAYER = 'strictons-road-repair-lines'

export type RoadCategory = 'Highways' | 'Major Roads' | 'Minor Roads'
export type RoadRepair = {
  id: string
  sourceKey: string
  name: string
  roadClass: string
  category: RoadCategory
  coordinates: [number, number][]
}
export type RoadSelection = { west: number; south: number; east: number; north: number }
export type RepairCheck = { repairs: RoadRepair[]; checked: number; reason?: string }

type Point = { x: number; y: number }
type IndexedSegment = { a: Point; b: Point; category: RoadCategory }
type NamedLine = { name: string; ref: string; roadClass: string; points: Point[] }

const ROAD_CLASSES = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor',
  'service', 'track', 'path', 'motorway_link', 'trunk_link',
  'primary_link', 'secondary_link', 'tertiary_link',
  'residential', 'living_street', 'unclassified'
])

function classify(value: string): RoadCategory {
  if (value === 'motorway' || value === 'trunk' || value === 'motorway_link' || value === 'trunk_link') return 'Highways'
  if (value === 'primary' || value === 'secondary' || value === 'tertiary' ||
      value === 'primary_link' || value === 'secondary_link' || value === 'tertiary_link') return 'Major Roads'
  return 'Minor Roads'
}

function roadClass(feature: any) {
  return String(feature.properties?.class || feature.properties?.subclass || '').toLowerCase()
}

function screenPoint(map: Map, coordinates: number[]): Point {
  const p = map.project([coordinates[0], coordinates[1]])
  return { x:p.x, y:p.y }
}

function screenLines(map: Map, geometry: any): Point[][] {
  if (geometry?.type === 'LineString') return [geometry.coordinates.map((c:number[]) => screenPoint(map,c))]
  if (geometry?.type === 'MultiLineString') return geometry.coordinates.map((line:number[][]) => line.map((c) => screenPoint(map,c)))
  return []
}

function pointDistance(point: Point, a: Point, b: Point) {
  const dx=b.x-a.x, dy=b.y-a.y
  const length=dx*dx+dy*dy
  const t=length===0 ? 0 : Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/length))
  return Math.hypot(point.x-a.x-dx*t,point.y-a.y-dy*t)
}

function clipSegment(a: Point, b: Point, rect: {left:number;top:number;right:number;bottom:number}): [Point,Point] | null {
  const dx=b.x-a.x, dy=b.y-a.y
  let t0=0, t1=1
  const constraints: [number,number][] = [
    [-dx,a.x-rect.left], [dx,rect.right-a.x],
    [-dy,a.y-rect.top], [dy,rect.bottom-a.y]
  ]
  for (const [p,q] of constraints) {
    if (p===0) { if (q<0) return null; continue }
    const t=q/p
    if (p<0) { if (t>t1) return null; if (t>t0) t0=t }
    else { if (t<t0) return null; if (t<t1) t1=t }
  }
  return [{x:a.x+dx*t0,y:a.y+dy*t0},{x:a.x+dx*t1,y:a.y+dy*t1}]
}

function clippedParts(points:Point[], rect:{left:number;top:number;right:number;bottom:number}):Point[][] {
  const parts:Point[][]=[]
  let current:Point[]=[]
  const end=()=>{if(current.length>1)parts.push(current);current=[]}
  for(let i=0;i<points.length-1;i++) {
    const segment=clipSegment(points[i],points[i+1],rect)
    if(!segment){end();continue}
    const [a,b]=segment
    if (!current.length) current=[a,b]
    else if(Math.hypot(a.x-current[current.length-1].x,a.y-current[current.length-1].y)<0.15) current.push(b)
    else {end();current=[a,b]}
  }
  end()
  return parts
}

function collectSegments(features:any[], map:Map, visibility:LayerVisibility):IndexedSegment[] {
  const segments:IndexedSegment[]=[]
  for(const feature of features){
    const layer=feature.layer
    if (!layer || layer.type!=='line' || String(layer.id).startsWith('strictons-')) continue
    const sl=String(feature.sourceLayer || layer['source-layer'] || '')
    if(sl!=='transportation') continue
    const cls=roadClass(feature)
    if(!ROAD_CLASSES.has(cls))continue
    const category=classify(cls)
    if(category==='Minor Roads'&&!visibility.minorRoads)continue
    for(const points of screenLines(map,feature.geometry)){
      for(let i=0;i<points.length-1;i++) {
        if(Math.hypot(points[i].x-points[i+1].x,points[i].y-points[i+1].y)>0.05) {
          segments.push({a:points[i],b:points[i+1],category})
        }
        if(segments.length>=14000)return segments
      }
    }
  }
  return segments
}

function nearestDistance(point:Point, segments:IndexedSegment[], category:RoadCategory) {
  let nearest=Infinity
  for (const segment of segments) {
    if(segment.category!==category)continue
    const minX=Math.min(segment.a.x,segment.b.x)-nearest
    const maxX=Math.max(segment.a.x,segment.b.x)+nearest
    const minY=Math.min(segment.a.y,segment.b.y)-nearest
    const maxY=Math.max(segment.a.y,segment.b.y)+nearest
    if(point.x<minX||point.x>maxX||point.y<minY||point.y>maxY)continue
    const distance=pointDistance(point,segment.a,segment.b)
    if(distance<nearest) nearest=distance
    if(nearest<0.7)break
  }
  return nearest
}

function sampleAtFraction(points:Point[], fraction:number):Point {
  const lengths:number[]=[]
  let total=0
  for(let i=1;i<points.length;i++){
    const length=Math.hypot(points[i].x-points[i-1].x,points[i].y-points[i-1].y)
    lengths.push(length)
    total+=length
  }
  let remaining=total*fraction
  for(let i=0;i<lengths.length;i++){
    if(remaining<=lengths[i]){
      const ratio=lengths[i]===0?0:remaining/lengths[i]
      return {x:points[i].x+(points[i+1].x-points[i].x)*ratio,y:points[i].y+(points[i+1].y-points[i].y)*ratio}
    }
    remaining-=lengths[i]
  }
  return points[points.length-1]
}

function sourceNameLines(map:Map, source:string):NamedLine[] {
  let features:any[]=[]
  try{ features=(map as any).querySourceFeatures(source,{sourceLayer:'transportation_name'}) || [] }
  catch{return []}
  const names:NamedLine[]=[]
  const seen=new Set<string>()
  for(const feature of features){
    const props=feature.properties || {}
    const name=String(props.name || props['name:en'] || props['name:latin'] || '')
    const ref=String(props.ref || props.route_ref || '')
    if(!name&&!ref)continue
    for(const points of screenLines(map,feature.geometry)){
      if(points.length<2)continue
      const key=name+'|'+ref+'|'+JSON.stringify([points[0],points[points.length-1]])
      if(seen.has(key))continue
      seen.add(key)
      names.push({name,ref,roadClass:String(props.class || ''),points})
    }
  }
  return names
}

function nameForRoad(points:Point[], cls:string, props:Record<string,any>, names:NamedLine[]) {
  const direct=String(props.name || props['name:en'] || props.ref || '')
  if(direct)return direct
  const mid=sampleAtFraction(points,0.5)
  const first=sampleAtFraction(points,0.2)
  const last=sampleAtFraction(points,0.8)
  let best:NamedLine|undefined
  let bestScore=Infinity
  for(const candidate of names){
    const candidateCategory=classify(candidate.roadClass)
    if(candidate.roadClass && candidateCategory!==classify(cls))continue
    let sum=0
    for (const point of [first,mid,last]) {
      let closest=Infinity
      for(let i=0;i<candidate.points.length-1;i++){
        closest=Math.min(closest,pointDistance(point,candidate.points[i],candidate.points[i+1]))
      }
      sum+=closest
    }
    if(sum<bestScore){bestScore=sum;best=candidate}
  }
  if(best&&bestScore/3<5){
    return best.name && best.ref && !best.name.includes(best.ref)
      ? best.name+' ('+best.ref+')'
      : best.name || 'Route '+best.ref
  }
  return 'Verified '+cls.replace(/_/g,' ')+' road'
}

export async function findRoadRepairs(
  map:Map,
  selection:RoadSelection,
  visibility:LayerVisibility,
  alreadyAccepted:RoadRepair[]
):Promise<RepairCheck>{
  if(!visibility.roads)return {repairs:[],checked:0,reason:'Enable the road network before checking for gaps.'}
  if(!map.isStyleLoaded())return {repairs:[],checked:0,reason:'Wait for map tiles to finish loading.'}
  await new Promise<void>((resolve)=>window.requestAnimationFrame(()=>resolve()))
  const nw=map.project([selection.west,selection.north])
  const se=map.project([selection.east,selection.south])
  const rect={left:Math.min(nw.x,se.x),top:Math.min(nw.y,se.y),right:Math.max(nw.x,se.x),bottom:Math.max(nw.y,se.y)}
  if(rect.right-rect.left<8||rect.bottom-rect.top<8)return {repairs:[],checked:0,reason:'Draw a larger selection around the incomplete road.'}

  const sources=new Set<string>()
  const style=map.getStyle()
  for(const layer of style.layers as any[]){
    if(layer['source-layer']==='transportation' && layer.source)sources.add(String(layer.source))
  }
  const rendered=map.queryRenderedFeatures([[rect.left,rect.top],[rect.right,rect.bottom]]) as any[]
  const segments=collectSegments(rendered,map,visibility)
  for(const repair of alreadyAccepted){
    if(repair.coordinates.length<2)continue
    const points=repair.coordinates.map((c)=>screenPoint(map,c))
    for(let i=1;i<points.length;i++)segments.push({a:points[i-1],b:points[i],category:repair.category})
  }
  const generated:RoadRepair[]=[]
  const seen=new Set(alreadyAccepted.map((repair)=>repair.sourceKey))
  let checked=0
  for(const source of sources){
    let features:any[]=[]
    try{features=(map as any).querySourceFeatures(source,{sourceLayer:'transportation'}) || []}
    catch{continue}
    const names=sourceNameLines(map,source)
    for(const feature of features.slice(0,6000)){
      const cls=roadClass(feature)
      if(!ROAD_CLASSES.has(cls))continue
      const category=classify(cls)
      if(category==='Minor Roads'&&!visibility.minorRoads)continue
      for(const sourcePoints of screenLines(map,feature.geometry)){
        const pieces=clippedParts(sourcePoints,rect)
        for(const points of pieces){
          const length=points.slice(1).reduce((sum,p,index)=>sum+Math.hypot(p.x-points[index].x,p.y-points[index].y),0)
          if(length<10)continue
          checked++
          const first=points[0]
          const last=points[points.length-1]
          const distances=[0,0.2,0.4,0.6,0.8,1].map((fraction)=>nearestDistance(sampleAtFraction(points,fraction),segments,category))
          const missing=distances.slice(1,-1).filter((distance)=>distance>5).length
          if(missing<2)continue
          // A verified road segment is accepted only when both ends can meet a drawn road.
          if(nearestDistance(first,segments,category)>17||nearestDistance(last,segments,category)>17)continue

          const coords=points.map((point):[number,number]=>{
            const lnglat=map.unproject([point.x,point.y])
            return [lnglat.lng,lnglat.lat]
          })
          const edge=coords[0].map((v)=>v.toFixed(6)).join(',')+'|'+coords[coords.length-1].map((v)=>v.toFixed(6)).join(',')
          const forward=edge
          const reverse=coords[coords.length-1].map((v)=>v.toFixed(6)).join(',')+'|'+coords[0].map((v)=>v.toFixed(6)).join(',')
          const sourceKey=source+'|'+cls+'|'+[forward,reverse].sort()[0]
          if(seen.has(sourceKey))continue
          seen.add(sourceKey)
          const name=nameForRoad(points,cls,feature.properties || {},names)
          generated.push({id:crypto.randomUUID(),sourceKey,name,roadClass:cls,category,coordinates:coords})
          if(generated.length>=125)return {repairs:generated,checked,reason:'Review these verified road segments. Limit of 125 repairs per check.'}
        }
      }
    }
  }
  if(!sources.size)return {repairs:[],checked:0,reason:'The map has no loaded transportation source in this area.'}
  return {repairs:generated,checked}
}

function repairCollection(repairs:RoadRepair[]){
  return {
    type:'FeatureCollection' as const,
    features:repairs.map((repair)=>({
      type:'Feature' as const,
      properties:{id:repair.id,name:repair.name,category:repair.category,roadClass:repair.roadClass},
      geometry:{type:'LineString' as const,coordinates:repair.coordinates}
    }))
  }
}

export function ensureRoadRepairLayers(map:Map,repairs:RoadRepair[],theme:MapTheme,visible:LayerVisibility){
  const data=repairCollection(repairs)
  const source=map.getSource(ROAD_REPAIR_SOURCE) as any
  if(source)source.setData(data)
  else map.addSource(ROAD_REPAIR_SOURCE,{type:'geojson',data} as any)

  const colour:any=['match',['get','category'],
    'Highways',theme.highways,'Major Roads',theme.roads,'Minor Roads',theme.minorRoads,theme.roads
  ]
  const scaleHigh=Math.max(0.25,theme.highwayWidthScale)
  const scaleMajor=Math.max(0.25,theme.roadWidthScale)
  const scaleMinor=Math.max(0.25,theme.minorRoadWidthScale)
  const widths:any=['interpolate',['linear'],['zoom'],
    10,['match',['get','category'],'Highways',1.3*scaleHigh,'Major Roads',0.9*scaleMajor,'Minor Roads',0.5*scaleMinor,1],
    14,['match',['get','category'],'Highways',3*scaleHigh,'Major Roads',2*scaleMajor,'Minor Roads',1.05*scaleMinor,1],
    18,['match',['get','category'],'Highways',7*scaleHigh,'Major Roads',5*scaleMajor,'Minor Roads',2.4*scaleMinor,2]
  ]

  if(!map.getLayer(ROAD_REPAIR_LAYER)){
    const firstSymbol=(map.getStyle().layers as any[]).find((layer)=>layer.type==='symbol'&&!String(layer.id).startsWith('strictons-'))?.id
    map.addLayer({
      id:ROAD_REPAIR_LAYER,type:'line',source:ROAD_REPAIR_SOURCE,
      layout:{'line-cap':'round','line-join':'round'},
      paint:{'line-color':colour,'line-width':widths,'line-opacity':1}
    } as any, firstSymbol)
  }
  ;(map as any).setPaintProperty(ROAD_REPAIR_LAYER,'line-color',colour)
  ;(map as any).setPaintProperty(ROAD_REPAIR_LAYER,'line-width',widths)
  ;(map as any).setLayoutProperty(ROAD_REPAIR_LAYER,'visibility',visible.roads?'visible':'none')
  ;(map as any).setFilter(ROAD_REPAIR_LAYER,visible.minorRoads?null:['!=',['get','category'],'Minor Roads'])
}
