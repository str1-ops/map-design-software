import type { Map } from 'maplibre-gl'
import type { LayerVisibility, MapTheme } from './mapDesign'

export type RoadCategory = 'Highways' | 'Major Roads' | 'Minor Roads'
export type RoadOverrideMode = 'show' | 'hide'
export type RoadOverride = {
  id:string
  name:string
  roadClass:string
  category:RoadCategory
  mode:RoadOverrideMode
  coordinates:[number,number][]
}
export type RoadJunction = {
  index:number
  coordinates:[number,number]
  kind:'intersection'|'endpoint'
}
export type SelectedRoad = Omit<RoadOverride,'id'|'mode'> & {
  selectionHint:string
  routeCoordinates:[number,number][]
  junctions:RoadJunction[]
  startIndex:number
  endIndex:number
}

const SOURCE='strictons-road-choices'
const SHOW='strictons-road-choices-show'
const HIDE='strictons-road-choices-hide'

type P={x:number;y:number}
type RoadLine={
  coordinates:[number,number][]
  points:P[]
  name:string
  roadClass:string
  category:RoadCategory
  key:string
}
const roadTypes=new Set(['motorway','trunk','motorway_link','trunk_link','primary','secondary',
  'tertiary','primary_link','secondary_link','tertiary_link','minor','residential','living_street',
  'unclassified','service','track','path','pedestrian','footway','cycleway',
  'street','road','living_street','residential','construction'])

function categoryFor(cls:string):RoadCategory {
  if(['motorway','trunk','motorway_link','trunk_link'].includes(cls))return 'Highways'
  if(['primary','secondary','tertiary','primary_link','secondary_link','tertiary_link'].includes(cls))return 'Major Roads'
  return 'Minor Roads'
}
const point=(map:Map,c:[number,number]):P=>{
  const p=map.project(c)
  return {x:p.x,y:p.y}
}
function segmentDistance(p:P,a:P,b:P) {
  const x=b.x-a.x,y=b.y-a.y,den=x*x+y*y
  const t=den?Math.max(0,Math.min(1,((p.x-a.x)*x+(p.y-a.y)*y)/den)):0
  return Math.hypot(p.x-a.x-t*x,p.y-a.y-t*y)
}
function lineDistance(p:P,points:P[]) {
  let best=Infinity
  for(let i=1;i<points.length;i++)best=Math.min(best,segmentDistance(p,points[i-1],points[i]))
  return best
}
function cleanLine(coordinates:[number,number][]):[number,number][] {
  const output:[number,number][]=[]
  for(const coordinate of coordinates){
    const prev=output[output.length-1]
    if(!prev||Math.abs(prev[0]-coordinate[0])>1e-8||Math.abs(prev[1]-coordinate[1])>1e-8)output.push(coordinate)
  }
  return output
}
function featureLines(feature:any):[number,number][][] {
  const g=feature.geometry
  if(g?.type==='LineString')return [g.coordinates as [number,number][]]
  if(g?.type==='MultiLineString')return g.coordinates as [number,number][][]
  return []
}
function dedupeKey(cls:string, coords:[number,number][]) {
  const a=coords.map((v)=>v.map((x)=>x.toFixed(7)).join(',')).join(';')
  const b=[...coords].reverse().map((v)=>v.map((x)=>x.toFixed(7)).join(',')).join(';')
  return cls+'|'+(a<b?a:b)
}
function sourceRoads(map:Map, click?:P):RoadLine[] {
  const sources=new Set<string>()
  const style=map.getStyle()
  for(const layer of style.layers as any[]) {
    if(layer['source-layer']==='transportation'&&layer.source)sources.add(layer.source)
  }
  const lines:RoadLine[]=[]
  const seen=new Set<string>()
  for(const source of sources){
    let features:any[]=[]
    try{features=(map as any).querySourceFeatures(source,{sourceLayer:'transportation'}) || []}
    catch{continue}
    // Non-rendered source features are essential: roads hidden by the map at the current zoom
    // must still be selectable at close zoom and be stored for low-zoom output.
    for(const feature of features){
      const props=feature.properties||{}
      const cls=String(props.class||props.subclass||'').toLowerCase()
      if(!roadTypes.has(cls))continue
      for(const geometry of featureLines(feature)){
        const coords=cleanLine(geometry)
        if(coords.length<2)continue
        const key=dedupeKey(cls,coords)
        if(seen.has(key))continue
        seen.add(key)
        lines.push({coordinates:coords,points:coords.map((c)=>point(map,c)),
          name:String(props.name || props['name:en'] || props.ref || ''),
          roadClass:cls,category:categoryFor(cls),key})
      }
    }
  }
  // A rendered-feature fallback is essential for styles/sources that do not expose
  // all currently drawn roads through querySourceFeatures at a given zoom.
  if(click){
    let rendered:any[]=[]
    try{
      const pad=16
      rendered=map.queryRenderedFeatures([
        [click.x-pad,click.y-pad],[click.x+pad,click.y+pad]
      ]) as any[]
    }catch{/* map may still be loading */}
    for(const feature of rendered){
      const layerId=String(feature.layer?.id||'').toLowerCase()
      const src=String(feature.sourceLayer||feature.layer?.['source-layer']||'').toLowerCase()
      const cls=String(feature.properties?.class||feature.properties?.subclass||'').toLowerCase()
      if(feature.layer?.type!=='line' || layerId.startsWith('strictons-'))continue
      if(src!=='transportation' && !/road|street|highway/.test(layerId))continue
      if(!roadTypes.has(cls))continue
      for(const geometry of featureLines(feature)){
        const coords=cleanLine(geometry)
        if(coords.length<2)continue
        const key=dedupeKey(cls,coords)
        if(seen.has(key))continue
        seen.add(key)
        lines.push({
          coordinates:coords,points:coords.map(coord=>point(map,coord)),
          name:String(feature.properties?.name||feature.properties?.['name:en']||feature.properties?.ref||''),
          roadClass:cls,category:categoryFor(cls),key
        })
      }
    }
  }
  return lines
}
type NameCandidate={name:string;ref:string;cls:string;points:P[]}
function namesFromSource(map:Map):NameCandidate[]{
  const sources=new Set<string>()
  for(const layer of map.getStyle().layers as any[]){
    if(layer['source-layer']==='transportation'&&layer.source)sources.add(layer.source)
  }
  const out:NameCandidate[]=[]
  for(const source of sources){
    let features:any[]=[]
    try{features=(map as any).querySourceFeatures(source,{sourceLayer:'transportation_name'})||[]}
    catch{continue}
    for(const f of features){
      const p=f.properties||{}
      const name=String(p.name||p['name:en']||'')
      const ref=String(p.ref||'')
      if(!name&&!ref)continue
      for(const coords of featureLines(f)){
        if(coords.length>1)out.push({name,ref,cls:String(p.class||''),points:coords.map((c)=>point(map,c))})
      }
    }
  }
  return out
}
function resolveName(line:RoadLine,names:NameCandidate[]) {
  if(line.name)return line.name
  const center=line.points[Math.floor(line.points.length/2)]
  let best:NameCandidate|undefined,bestDist=Infinity
  for(const candidate of names){
    if(candidate.cls&&categoryFor(candidate.cls)!==line.category)continue
    const dist=lineDistance(center,candidate.points)
    if(dist<bestDist){bestDist=dist;best=candidate}
  }
  if(best&&bestDist<3.5)return best.name&&best.ref&&!best.name.includes(best.ref)
    ?best.name+' ('+best.ref+')':best.name||'Route '+best.ref
  return 'Unnamed '+line.roadClass.replace(/_/g,' ')+' road'
}
function sameCoordinate(a:[number,number],b:[number,number]) {
  // A sub-metre tolerance joins the fragments of one road without joining
  // streets that merely pass near each other.
  const metersX=(a[0]-b[0])*111320*Math.cos(a[1]*Math.PI/180)
  const metersY=(a[1]-b[1])*111320
  return Math.hypot(metersX,metersY)<0.6
}

function extendRoad(base:RoadLine,all:RoadLine[]):[number,number][] {
  let route=[...base.coordinates]
  const used=new Set([base.key])
  for(let iteration=0;iteration<48&&route.length<2500;iteration++){
    let extended=false
    for(const end of ['start','end'] as const){
      const anchor=end==='start'?route[0]:route[route.length-1]
      const inside=end==='start'?route[1]:route[route.length-2]
      const inwardX=(inside[0]-anchor[0])*Math.cos(anchor[1]*Math.PI/180)
      const inwardY=inside[1]-anchor[1]
      const inwardLen=Math.hypot(inwardX,inwardY)
      if(inwardLen<1e-10)continue
      const options:{road:RoadLine;coords:[number,number][];cosine:number}[]=[]
      for(const candidate of all){
        if(used.has(candidate.key)||candidate.roadClass!==base.roadClass)continue
        // Two explicitly different street names must never be joined as one.
        if(base.name&&candidate.name&&candidate.name!==base.name)continue
        const points=candidate.coordinates
        let coords:[number,number][]|null=null
        if(end==='start'){
          if(sameCoordinate(points[points.length-1],anchor))coords=points
          else if(sameCoordinate(points[0],anchor))coords=[...points].reverse()
        }else{
          if(sameCoordinate(points[0],anchor))coords=points
          else if(sameCoordinate(points[points.length-1],anchor))coords=[...points].reverse()
        }
        if(!coords||coords.length<2)continue
        const next=end==='start'?coords[coords.length-2]:coords[1]
        const dx=(next[0]-anchor[0])*Math.cos(anchor[1]*Math.PI/180)
        const dy=next[1]-anchor[1]
        const length=Math.hypot(dx,dy)
        if(length<1e-10)continue
        const cosine=(dx*inwardX+dy*inwardY)/(length*inwardLen)
        const minimum=base.name&&candidate.name? -0.35 : -0.78
        if(cosine>minimum)continue
        options.push({road:candidate,coords,cosine})
      }
      options.sort((a,b)=>a.cosine-b.cosine)
      if(!options.length)continue
      // Do not guess which branch continues the street at ambiguous junctions.
      if(options.length>1&&Math.abs(options[0].cosine-options[1].cosine)<0.045)continue
      const chosen=options[0]
      used.add(chosen.road.key)
      route=end==='start'
        ? [...chosen.coords.slice(0,-1),...route]
        : [...route,...chosen.coords.slice(1)]
      extended=true
    }
    if(!extended)break
  }
  return cleanLine(route)
}

function roadJunctions(route:[number,number][],all:RoadLine[]):RoadJunction[] {
  const lookup=new globalThis.Map<string,{index:number;directions:number[]}[]>()
  const key=(coord:[number,number])=>coord[0].toFixed(6)+','+coord[1].toFixed(6)
  for(let i=0;i<route.length;i++){
    const k=key(route[i])
    const entries=lookup.get(k)||[]
    entries.push({index:i,directions:[]})
    lookup.set(k,entries)
  }
  // Build a local angular graph from mapped vertices. T-junctions have
  // three or more unique outgoing arms; an overpass with no shared vertex
  // is deliberately not treated as a junction.
  for(const line of all){
    for(let i=0;i<line.coordinates.length;i++){
      const matches=lookup.get(key(line.coordinates[i]))
      if(!matches)continue
      const origin=line.coordinates[i]
      for(const adjacent of [line.coordinates[i-1],line.coordinates[i+1]]){
        if(!adjacent)continue
        const dx=(adjacent[0]-origin[0])*Math.cos(origin[1]*Math.PI/180)
        const dy=adjacent[1]-origin[1]
        if(Math.hypot(dx,dy)<1e-10)continue
        const angle=Math.atan2(dy,dx)
        for(const match of matches)match.directions.push(angle)
      }
    }
  }
  const junctions:RoadJunction[]=[]
  for(let i=0;i<route.length;i++){
    const match=lookup.get(key(route[i]))?.find(entry=>entry.index===i)
    const unique:number[]=[]
    for(const angle of match?.directions||[]){
      if(!unique.some(existing=>Math.abs(Math.atan2(Math.sin(angle-existing),Math.cos(angle-existing)))<0.19)){
        unique.push(angle)
      }
    }
    if(i===0||i===route.length-1){
      junctions.push({index:i,coordinates:route[i],kind:'endpoint'})
    }else if(unique.length>=3){
      junctions.push({index:i,coordinates:route[i],kind:'intersection'})
    }
  }
  // Where maps do not identify any intersections, the actual source-way
  // endpoints remain available; do not invent intermediary junctions.
  return junctions
}

function selectedRoadHint(selected:SelectedRoad) {
  const start=selected.junctions.find(p=>p.index===selected.startIndex)
  const end=selected.junctions.find(p=>p.index===selected.endIndex)
  return start?.kind==='intersection'&&end?.kind==='intersection'
    ?'Selection runs between mapped road junctions. Blue dots can adjust either end.'
    :'Blue dots mark mapped junctions and available road boundaries. Adjust either end before saving.'
}

export function adjustRoadSelection(
  selected:SelectedRoad,boundary:'start'|'end',junctionIndex:number
):SelectedRoad|null {
  if(!Number.isInteger(junctionIndex)||junctionIndex<0||junctionIndex>=selected.routeCoordinates.length)return null
  const startIndex=boundary==='start'?junctionIndex:selected.startIndex
  const endIndex=boundary==='end'?junctionIndex:selected.endIndex
  if(startIndex>=endIndex)return null
  // Users can also snap an endpoint directly to a vertex on the same source
  // road. This is the fallback when map tiles omit a nearby intersection.
  const hasMarker=selected.junctions.some(point=>point.index===junctionIndex)
  const junctions=hasMarker?selected.junctions:
    [...selected.junctions,{index:junctionIndex,coordinates:selected.routeCoordinates[junctionIndex],kind:'endpoint' as const}]
      .sort((a,b)=>a.index-b.index)
  const updated:SelectedRoad={
    ...selected,startIndex,endIndex,junctions,
    coordinates:selected.routeCoordinates.slice(startIndex,endIndex+1)
  }
  const hint=hasMarker?selectedRoadHint(updated):
    'Endpoint snapped to the mapped road geometry. Adjust it again or save the blue section.'
  return {...updated,selectionHint:hint}
}

export function selectRoadAt(map:Map,click:{x:number;y:number}):SelectedRoad|null {
  const near:P={x:click.x,y:click.y}
  const lines=sourceRoads(map,near)
  if(!lines.length)return null
  let nearest:RoadLine|undefined
  let best=15
  let bestCoordinate:[number,number][]|null=null
  let bestSegment=0
  for(const line of lines){
    for(let i=1;i<line.points.length;i++){
      const distance=segmentDistance(near,line.points[i-1],line.points[i])
      if(distance<best){
        best=distance;nearest=line;bestCoordinate=line.coordinates;bestSegment=i-1
      }
    }
  }
  if(!nearest||!bestCoordinate)return null
  const initialEdge=bestCoordinate[bestSegment]
  const nextEdge=bestCoordinate[bestSegment+1]
  const routeCoordinates=extendRoad(nearest,lines)
  const junctions=roadJunctions(routeCoordinates,lines)
  let hitSegment=0,bestDistance=Infinity
  const midpoint:[number,number]=[(initialEdge[0]+nextEdge[0])/2,(initialEdge[1]+nextEdge[1])/2]
  const hit=point(map,midpoint)
  const projectedRoute=routeCoordinates.map(c=>point(map,c))
  for(let i=1;i<projectedRoute.length;i++){
    const distance=segmentDistance(hit,projectedRoute[i-1],projectedRoute[i])
    if(distance<bestDistance){bestDistance=distance;hitSegment=i-1}
  }
  let startIndex=0,endIndex=routeCoordinates.length-1
  for(const junction of junctions){
    if(junction.index<=hitSegment)startIndex=junction.index
    if(junction.index>=hitSegment+1){endIndex=junction.index;break}
  }
  if(startIndex>=endIndex)return null
  const selected:SelectedRoad={
    name:resolveName(nearest,namesFromSource(map)),
    roadClass:nearest.roadClass,category:nearest.category,
    coordinates:routeCoordinates.slice(startIndex,endIndex+1),
    routeCoordinates,junctions,startIndex,endIndex,
    selectionHint:''
  }
  return {...selected,selectionHint:selectedRoadHint(selected)}
}

const collection=(items:(RoadOverride|SelectedRoad)[])=>({
  type:'FeatureCollection' as const,
  features:items.map((item)=>({
    type:'Feature' as const,
    properties:{name:item.name,category:item.category,roadClass:item.roadClass,mode:'mode' in item?item.mode:'selected'},
    geometry:{type:'LineString' as const,coordinates:item.coordinates}
  }))
})
function themeColour(theme:MapTheme){
  return ['match',['get','category'],'Highways',theme.highways,'Major Roads',theme.roads,
    'Minor Roads',theme.minorRoads,theme.roads] as any
}
function themeWidth(theme:MapTheme,boost=1) {
  const h=theme.highwayWidthScale,major=theme.roadWidthScale,minor=theme.minorRoadWidthScale
  return ['interpolate',['linear'],['zoom'],
    9,['match',['get','category'],'Highways',1.4*h*boost,'Major Roads',0.8*major*boost,
      'Minor Roads',0.45*minor*boost,1],
    14,['match',['get','category'],'Highways',3.4*h*boost,'Major Roads',2.1*major*boost,
      'Minor Roads',1.15*minor*boost,1],
    18,['match',['get','category'],'Highways',7.4*h*boost,'Major Roads',4.8*major*boost,
      'Minor Roads',2.5*minor*boost,1]
  ] as any
}
export function ensureRoadChoiceLayers(
  map:Map, choices:RoadOverride[], _selected:SelectedRoad|null,theme:MapTheme,visibility:LayerVisibility
) {
  if(!map.isStyleLoaded())return
  const source=map.getSource(SOURCE) as any
  if(source)source.setData(collection(choices))
  else map.addSource(SOURCE,{type:'geojson',data:collection(choices)} as any)
  // Above land detail and roads, below labels. OSM geometry remains unchanged.
  const firstLabel=(map.getStyle().layers as any[]).find((layer)=>layer.type==='symbol'&&!String(layer.id).startsWith('strictons-'))?.id
  const add=(id:string,sourceId:string,filter:any,paint:any,top=false)=>{
    if(!map.getLayer(id)){
      map.addLayer({
        id,type:'line',source:sourceId,filter,
        layout:{'line-cap':'round','line-join':'round'},
        paint
      } as any,top?undefined:firstLabel)
    }
  }
  add(HIDE,SOURCE,['==',['get','mode'],'hide'],
    {'line-color':theme.land,'line-width':themeWidth(theme,1.34)})
  add(SHOW,SOURCE,['==',['get','mode'],'show'],
    {'line-color':themeColour(theme),'line-width':themeWidth(theme)})
  const set=(id:string,property:string,value:unknown)=>{
    try{(map as any).setPaintProperty(id,property,value)}catch{/* external style can reload */}
  }
  set(HIDE,'line-color',theme.land)
  set(HIDE,'line-width',themeWidth(theme,1.34))
  set(SHOW,'line-color',themeColour(theme))
  set(SHOW,'line-width',themeWidth(theme))
  for(const id of [HIDE,SHOW]) {
    try{(map as any).setLayoutProperty(id,'visibility',visibility.roads?'visible':'none')}catch{/* no-op */}
  }
}
