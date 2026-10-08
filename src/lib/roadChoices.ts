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
export type SelectedRoad = Omit<RoadOverride,'id'|'mode'> & { selectionHint:string }

const SOURCE='strictons-road-choices'
const SHOW='strictons-road-choices-show'
const HIDE='strictons-road-choices-hide'
const SELECT_SOURCE='strictons-road-current-choice'
const SELECT_HALO='strictons-road-choice-halo'
const SELECT_LINE='strictons-road-choice-highlight'

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
  'unclassified','service','track','path','pedestrian','footway','cycleway'])

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
function sourceRoads(map:Map):RoadLine[] {
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
function pointSame(a:P,b:P,tolerance:number) {
  return Math.hypot(a.x-b.x,a.y-b.y)<=tolerance
}
function vertexJunctions(line:RoadLine,lines:RoadLine[]) {
  const nodes=new Set<number>([0,line.points.length-1])
  // OSM ways can continue straight across multiple segments. A junction is a
  // shared mapped vertex with another, non-collinear road, not just a line crossing.
  // Grade-separated roads with no shared vertex therefore are not split.
  const tolerance=1.35
  for(let i=1;i<line.points.length-1;i++){
    const vertex=line.points[i]
    const directionA=line.points[i-1]
    const directionB=line.points[i+1]
    const ux=directionB.x-directionA.x,uy=directionB.y-directionA.y
    const un=Math.hypot(ux,uy)
    for(const other of lines){
      if(other===line)continue
      const endpoints=[other.points[0],other.points[other.points.length-1]]
      // An independent way often ends at a T junction midway along the candidate way.
      // Shared intermediate vertices are also accepted if directions diverge.
      if(!endpoints.some((p)=>pointSame(p,vertex,tolerance))&&
         !other.points.some((p)=>pointSame(p,vertex,tolerance)))continue
      let direction:P|undefined
      for(let j=0;j<other.points.length;j++){
        if(!pointSame(other.points[j],vertex,tolerance))continue
        direction=other.points[j+1]||other.points[j-1]
        break
      }
      if(!direction)continue
      const vx=direction.x-vertex.x,vy=direction.y-vertex.y
      const vn=Math.hypot(vx,vy)
      if(un<0.01||vn<0.01)continue
      const alignment=Math.abs((ux*vx+uy*vy)/(un*vn))
      if(alignment<0.94){nodes.add(i);break}
    }
  }
  return [...nodes].sort((a,b)=>a-b)
}
export function selectRoadAt(map:Map,click:{x:number;y:number}):SelectedRoad|null {
  if(!map.isStyleLoaded())return null
  const lines=sourceRoads(map)
  const near:P={x:click.x,y:click.y}
  let nearest:RoadLine|undefined
  let best=11
  let bestSegment=0
  for(const line of lines){
    for(let i=1;i<line.points.length;i++){
      const distance=segmentDistance(near,line.points[i-1],line.points[i])
      if(distance<best){
        best=distance;nearest=line;bestSegment=i-1
      }
    }
  }
  if(!nearest)return null
  const junctions=vertexJunctions(nearest,lines)
  let from=0,to=nearest.points.length-1
  for(const i of junctions){
    if(i<=bestSegment)from=i
    if(i>=bestSegment+1){to=i;break}
  }
  if(from>=to)return null
  const coordinates=nearest.coordinates.slice(from,to+1)
  return {
    name:resolveName(nearest,namesFromSource(map)),
    roadClass:nearest.roadClass,category:nearest.category,coordinates,
    selectionHint:from===0||to===nearest.points.length-1
      ?'Section ends at mapped junctions or current source-tile boundaries.'
      :'Section ends at two mapped road junctions.'
  }
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
  map:Map, choices:RoadOverride[], selected:SelectedRoad|null,theme:MapTheme,visibility:LayerVisibility
) {
  if(!map.isStyleLoaded())return
  const source=map.getSource(SOURCE) as any
  if(source)source.setData(collection(choices))
  else map.addSource(SOURCE,{type:'geojson',data:collection(choices)} as any)
  const selectedSource=map.getSource(SELECT_SOURCE) as any
  if(selectedSource)selectedSource.setData(collection(selected?[selected]:[]))
  else map.addSource(SELECT_SOURCE,{type:'geojson',data:collection(selected?[selected]:[])} as any)

  // Above land detail and roads, below labels. OSM geometry remains unchanged.
  const firstLabel=(map.getStyle().layers as any[]).find((layer)=>layer.type==='symbol'&&!String(layer.id).startsWith('strictons-'))?.id
  const add=(id:string,sourceId:string,filter:any,paint:any)=>{
    if(!map.getLayer(id)){
      map.addLayer({
        id,type:'line',source:sourceId,filter,
        layout:{'line-cap':'round','line-join':'round'},
        paint
      } as any,firstLabel)
    }
  }
  add(HIDE,SOURCE,['==',['get','mode'],'hide'],
    {'line-color':theme.land,'line-width':themeWidth(theme,1.34)})
  add(SHOW,SOURCE,['==',['get','mode'],'show'],
    {'line-color':themeColour(theme),'line-width':themeWidth(theme)})
  add(SELECT_HALO,SELECT_SOURCE,undefined,
    {'line-color':'#ffffff','line-opacity':0.98,'line-width':11})
  add(SELECT_LINE,SELECT_SOURCE,undefined,
    {'line-color':'#1e7657','line-width':5,'line-opacity':1})
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
