import { FormEvent, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { Map as MapLibreMap } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import {
  BASE_STYLE_URL, DEFAULT_THEME, THEME_PRESETS, applyMapDesign,
  ensureFeaturedLayers, exportMapPng, exportMapSvg, guessFeatureName, totalPrintPixels,
  type CameraState, type FeaturedPlace, type LayerVisibility,
  type MapTheme, type PrintSize,
} from './lib/mapDesign'
import { ensureRoadRepairLayers, findRoadRepairs, type RoadSelection, type RoadRepair } from './lib/roadRepairs'
import { ensureRoadChoiceLayers, selectRoadAt, type RoadOverride, type SelectedRoad } from './lib/roadChoices'

maplibregl.setWorkerUrl(workerUrl)

type Project = { name:string; size:PrintSize; theme:MapTheme; visible:LayerVisibility; places:FeaturedPlace[]; repairs:RoadRepair[]; roadChoices:RoadOverride[]; camera:CameraState }
type SearchResult = { place_id:number; display_name:string; lat:string; lon:string; type?:string }

const DEFAULTS: Project = {
  name:'Central Coast Map',
  size:{ widthMm:203, heightMm:185, bleedMm:3, dpi:300 },
  theme:DEFAULT_THEME,
  visible:{ roads:true, minorRoads:true, railways:true, buildings:true, parks:true, boundaries:false, labels:true, placeLabels:true, roadLabels:true, poiLabels:false, waterLabels:true },
  places:[], repairs:[], roadChoices:[], camera:{ center:[151.544,-33.263], zoom:11.2, bearing:0, pitch:0 },
}
const PRESETS = [
  ['Beachcomber spread',203,185],['Beachcomber page',101.5,185],['A4 landscape',297,210],['A4 portrait',210,297],
] as const
const STORE='strictons-map-studio-v1'
let lastSearch=0

function load():Project {
  try { const p=JSON.parse(localStorage.getItem(STORE)||'null'); return p ? {...DEFAULTS,...p,size:{...DEFAULTS.size,...p.size},theme:{...DEFAULT_THEME,...p.theme},visible:{...DEFAULTS.visible,...p.visible},repairs:Array.isArray(p.repairs)?p.repairs:[],roadChoices:Array.isArray(p.roadChoices)?p.roadChoices:[],camera:{...DEFAULTS.camera,...p.camera}} : DEFAULTS } catch { return DEFAULTS }
}
function fileName(s:string){ return s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'') || 'map' }

function Toggle({label,value,onChange}:{label:string;value:boolean;onChange:(v:boolean)=>void}){
  return <label className="toggle"><span>{label}</span><input type="checkbox" checked={value} onChange={e=>onChange(e.target.checked)}/><i/></label>
}
function Colour({label,value,onChange}:{label:string;value:string;onChange:(v:string)=>void}){
  return <label className="colour"><span>{label}</span><div><input type="color" value={value} onChange={e=>onChange(e.target.value)}/><code>{value.toUpperCase()}</code></div></label>
}

function MapView({project,pick,locked,selecting,selection,roadPicking,selectedRoad,onCamera,onPick,onViewport,onMapReady,onSelection,onRoadClick}:{
  project:Project;pick:boolean;locked:boolean;selecting:boolean;selection:RoadSelection|null;
  roadPicking:boolean;selectedRoad:SelectedRoad|null;
  onCamera:(c:CameraState)=>void;onPick:(p:FeaturedPlace)=>void;
  onViewport:(v:{width:number;height:number})=>void;
  onMapReady:(map:MapLibreMap|null)=>void;
  onSelection:(area:RoadSelection|null)=>void
  onRoadClick:(candidate:SelectedRoad|null)=>void
}){
  const host=useRef<HTMLDivElement>(null),mapRef=useRef<MapLibreMap|null>(null)
  // Read the current selection mode from a ref, not from canvas data attributes.
  // The MapLibre map and its click listener are only created once.
  const latest=useRef({onCamera,onPick,onViewport,onMapReady,onSelection,onRoadClick,roadPicking,pick})
  latest.current={onCamera,onPick,onViewport,onMapReady,onSelection,onRoadClick,roadPicking,pick}
  const pointerStart=useRef<{x:number;y:number}|null>(null)
  const [drag,setDrag]=useState<{left:number;top:number;width:number;height:number}|null>(null)

  useEffect(()=>{
    if(!host.current || mapRef.current) return
    const map=new maplibregl.Map({
      container:host.current,style:BASE_STYLE_URL,center:project.camera.center,
      zoom:project.camera.zoom,bearing:project.camera.bearing,pitch:project.camera.pitch,
      attributionControl:false,canvasContextAttributes:{preserveDrawingBuffer:true}
    })
    mapRef.current=map
    latest.current.onMapReady(map)
    const syncViewport=()=>{
      map.resize()
      if(host.current)latest.current.onViewport({width:host.current.clientWidth,height:host.current.clientHeight})
    }
    const ro=new ResizeObserver(syncViewport)
    ro.observe(host.current)
    map.on('load',()=>{
      syncViewport()
      applyMapDesign(map,project.theme,project.visible)
      ensureRoadRepairLayers(map,project.repairs,project.theme,project.visible)
      ensureRoadChoiceLayers(map,project.roadChoices,selectedRoad,project.theme,project.visible)
      ensureFeaturedLayers(map,project.places,project.theme)
    })
    map.on('moveend',()=>{
      const c=map.getCenter()
      latest.current.onCamera({center:[c.lng,c.lat],zoom:map.getZoom(),bearing:map.getBearing(),pitch:map.getPitch()})
    })
    map.on('click',e=>{
      if(latest.current.roadPicking){
        latest.current.onRoadClick(selectRoadAt(map,{x:e.point.x,y:e.point.y}))
        return
      }
      if(!latest.current.pick)return
      latest.current.onPick({
        id:crypto.randomUUID(),name:guessFeatureName(map,e),
        lng:e.lngLat.lng,lat:e.lngLat.lat,category:'Featured'
      })
    })
    return ()=>{
      ro.disconnect()
      latest.current.onMapReady(null)
      map.remove()
      mapRef.current=null
    }
  },[])

  useEffect(()=>{
    const m=mapRef.current
    if(m){
      m.getCanvas().dataset.pick=pick?'1':''
      m.getCanvas().dataset.roadPick=roadPicking?'1':''
      m.getCanvas().style.cursor=pick||roadPicking?'crosshair':''
    }
  },[pick,roadPicking])
  useEffect(()=>{
    const m=mapRef.current
    if(m?.isStyleLoaded()){
      applyMapDesign(m,project.theme,project.visible)
      ensureRoadRepairLayers(m,project.repairs,project.theme,project.visible)
      ensureRoadChoiceLayers(m,project.roadChoices,selectedRoad,project.theme,project.visible)
      ensureFeaturedLayers(m,project.places,project.theme)
    }
  },[project.theme,project.visible,project.places,project.repairs,project.roadChoices,selectedRoad])
  useEffect(()=>{
    const m=mapRef.current
    if(m)requestAnimationFrame(()=>m.resize())
  },[project.size.widthMm,project.size.heightMm,project.size.bleedMm])
  useEffect(()=>{
    const m=mapRef.current
    if(!m||locked)return
    const c=m.getCenter()
    if(Math.abs(c.lng-project.camera.center[0])>.0001||
       Math.abs(c.lat-project.camera.center[1])>.0001||
       Math.abs(m.getZoom()-project.camera.zoom)>.01){
      m.easeTo({center:project.camera.center,zoom:project.camera.zoom,duration:450})
    }
  },[project.camera.center,project.camera.zoom,locked])

  const mouseLocation=(event:ReactPointerEvent<HTMLDivElement>)=>{
    const rect=event.currentTarget.getBoundingClientRect()
    return {
      x:Math.max(0,Math.min(rect.width,event.clientX-rect.left)),
      y:Math.max(0,Math.min(rect.height,event.clientY-rect.top))
    }
  }
  const onPointerDown=(event:ReactPointerEvent<HTMLDivElement>)=>{
    if(event.button!==0)return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const point=mouseLocation(event)
    pointerStart.current=point
    setDrag({left:point.x,top:point.y,width:0,height:0})
  }
  const onPointerMove=(event:ReactPointerEvent<HTMLDivElement>)=>{
    if(!pointerStart.current)return
    const p=mouseLocation(event),start=pointerStart.current
    setDrag({
      left:Math.min(start.x,p.x),top:Math.min(start.y,p.y),
      width:Math.abs(start.x-p.x),height:Math.abs(start.y-p.y)
    })
  }
  const onPointerUp=(event:ReactPointerEvent<HTMLDivElement>)=>{
    const start=pointerStart.current
    if(!start)return
    pointerStart.current=null
    const end=mouseLocation(event)
    const m=mapRef.current
    setDrag(null)
    if(!m||Math.abs(end.x-start.x)<8||Math.abs(end.y-start.y)<8){
      latest.current.onSelection(null)
      return
    }
    const a=m.unproject([start.x,start.y])
    const b=m.unproject([end.x,end.y])
    latest.current.onSelection({
      west:Math.min(a.lng,b.lng),east:Math.max(a.lng,b.lng),
      south:Math.min(a.lat,b.lat),north:Math.max(a.lat,b.lat)
    })
  }
  const selectionRect=(()=>{
    if(!selection||!mapRef.current)return null
    const a=mapRef.current.project([selection.west,selection.north])
    const b=mapRef.current.project([selection.east,selection.south])
    return {left:Math.min(a.x,b.x),top:Math.min(a.y,b.y),
      width:Math.abs(b.x-a.x),height:Math.abs(b.y-a.y)}
  })()
  const tw=project.size.widthMm+project.size.bleedMm*2
  const th=project.size.heightMm+project.size.bleedMm*2
  const bx=project.size.bleedMm/tw*100
  const by=project.size.bleedMm/th*100

  return <>
    <div className="paper">
      <div ref={host} className="map"/>
      {selectionRect&&!selecting&&<div className="repair-area" style={selectionRect}/>}
      {selecting&&<div className="repair-selector" onPointerDown={onPointerDown}
        onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onPointerCancel={()=>{pointerStart.current=null;setDrag(null)}}>
        {drag&&<div className="repair-area" style={drag}/>}
      </div>}
      {project.size.bleedMm>0&&<div className="trim" style={{inset:by+'% '+bx+'%'}}/>}
    </div>
    <div className="map-tools">
      <button type="button" onClick={()=>mapRef.current?.zoomIn({duration:220})} aria-label="Zoom in">+</button>
      <button type="button" onClick={()=>mapRef.current?.zoomOut({duration:220})} aria-label="Zoom out">−</button>
    </div>
    <div className="canvas-meta">{project.size.widthMm} × {project.size.heightMm} mm{locked?' · Saved canvas locked':''}</div>
    {pick&&<div className="pick-chip">Click a place on the map</div>}
    {selecting&&<div className="pick-chip">Drag a rectangle around the incomplete roads</div>}
    {roadPicking&&!selecting&&<div className="pick-chip">Click a road to select one section, then choose Show or Hide</div>}
  </>
}

async function geocode(q:string):Promise<SearchResult[]> {
  const key='geo:'+q.toLowerCase(), cached=localStorage.getItem(key); if(cached)return JSON.parse(cached)
  const wait=1050-(Date.now()-lastSearch);if(wait>0)await new Promise(r=>setTimeout(r,wait));lastSearch=Date.now()
  const u=new URL(import.meta.env.VITE_GEOCODER_URL||'https://nominatim.openstreetmap.org/search');u.searchParams.set('q',q);u.searchParams.set('format','jsonv2');u.searchParams.set('limit','5')
  const r=await fetch(u,{headers:{Accept:'application/json','Accept-Language':'en-AU,en;q=.9'}});if(!r.ok)throw new Error('Location search unavailable')
  const data=await r.json();localStorage.setItem(key,JSON.stringify(data));return data
}

export default function App(){
  const liveMapRef=useRef<MapLibreMap|null>(null)
  const [locked,setLocked]=useState(true)
  const [selecting,setSelecting]=useState(false)
  const [selection,setSelection]=useState<RoadSelection|null>(null)
  const [checking,setChecking]=useState(false)
  const [roadPicking,setRoadPicking]=useState(true)
  const [selectedRoad,setSelectedRoad]=useState<SelectedRoad|null>(null)
  const [lastRepairIds,setLastRepairIds]=useState<string[]>([])
  const [repairStatus,setRepairStatus]=useState('')
  const [project,setProject]=useState<Project>(()=>load()), [tab,setTab]=useState<'document'|'style'|'places'>('document'), [pick,setPick]=useState(false)
  const [query,setQuery]=useState(''),[results,setResults]=useState<SearchResult[]>([]),[busy,setBusy]=useState(false),[note,setNote]=useState(''),[viewport,setViewport]=useState({width:0,height:0})
  const px=useMemo(()=>totalPrintPixels(project.size),[project.size]), ratio=(project.size.widthMm+project.size.bleedMm*2)/(project.size.heightMm+project.size.bleedMm*2)
  useEffect(()=>localStorage.setItem(STORE,JSON.stringify(project)),[project])
  useEffect(()=>{if(!note)return;const t=setTimeout(()=>setNote(''),2400);return()=>clearTimeout(t)},[note])
  const patch=<K extends keyof Project>(key:K,value:Project[K])=>setProject(p=>({...p,[key]:value}))
  const size=(key:keyof PrintSize,value:number)=>setProject(p=>({...p,size:{...p.size,[key]:value}}))
  const theme=<K extends keyof MapTheme>(key:K,value:MapTheme[K])=>setProject(p=>({...p,theme:{...p.theme,[key]:value}}))
  const visible=(key:keyof LayerVisibility,value:boolean)=>setProject(p=>({...p,visible:{...p.visible,[key]:value}}))
  const search=async(e:FormEvent)=>{e.preventDefault();if(!query.trim())return;setBusy(true);try{const r=await geocode(query.trim());setResults(r);if(!r.length)setNote('No places found')}catch(err){setNote(err instanceof Error?err.message:'Search failed')}finally{setBusy(false)}}
  const go=(r:SearchResult)=>{if(locked){setNote('Unlock canvas before changing location.');return}patch('camera',{...project.camera,center:[Number(r.lon),Number(r.lat)],zoom:r.type==='city'||r.type==='town'?12:14});setResults([])}
  const add=(p:FeaturedPlace)=>{patch('places',[...project.places,p]);setPick(false);setTab('places')}
  const lockCanvas=()=>{
    const map=liveMapRef.current
    // Commit any new print view before entering locked inspection mode.
    if(map){
      const center=map.getCenter()
      patch('camera',{center:[center.lng,center.lat],zoom:map.getZoom(),bearing:map.getBearing(),pitch:map.getPitch()})
    }
    setLocked(true);setPick(false);setSelection(null);setSelecting(false);setSelectedRoad(null);setRoadPicking(true)
    setRepairStatus('Canvas locked. Click a road to select it, or zoom in to inspect.')
  }
  const resetView=()=>{
    setSelecting(false);setSelection(null);setSelectedRoad(null)
    const map=liveMapRef.current
    if(map)map.jumpTo({center:project.camera.center,zoom:project.camera.zoom,bearing:project.camera.bearing,pitch:project.camera.pitch})
    setRepairStatus('Returned to the saved print view. Canvas remains locked.')
  }
  const unlockCanvas=()=>{
    resetView()
    setLocked(false);setRoadPicking(false)
    setRepairStatus('Canvas unlocked. You can resize or reposition your saved map.')
  }
  const chooseRoad=(choice:'show'|'hide')=>{
    if(!selectedRoad)return
    const coords=selectedRoad.coordinates
    const forward=coords.map((p)=>p.map((v)=>v.toFixed(7)).join(',')).join(';')
    const reverse=[...coords].reverse().map((p)=>p.map((v)=>v.toFixed(7)).join(',')).join(';')
    const canonical=forward<reverse?forward:reverse
    setProject(p=>{
      const cleaned=p.roadChoices.filter(item=>{
        const f=item.coordinates.map(point=>point.map(v=>v.toFixed(7)).join(',')).join(';')
        const back=[...item.coordinates].reverse().map(point=>point.map(v=>v.toFixed(7)).join(',')).join(';')
        return (f<back?f:back)!==canonical
      })
      return {...p,roadChoices:[...cleaned,{...selectedRoad,id:crypto.randomUUID(),mode:choice}]}
    })
    setRepairStatus((choice==='show'?'Always show':'Hide')+' applied to '+selectedRoad.name+'. Select another section or return to canvas.')
    setSelectedRoad(null)
  }
  const removeRoadChoice=(id:string)=>setProject(p=>({...p,roadChoices:p.roadChoices.filter(choice=>choice.id!==id)}))
  const checkRepair=async()=>{
    const map=liveMapRef.current
    if(!locked||!selection||!map)return
    setChecking(true)
    setRepairStatus('Checking loaded road geometry against visible roads...')
    try{
      const result=await findRoadRepairs(map,selection,project.visible,project.repairs)
      if(result.repairs.length){
        const items=result.repairs
        setProject((previous)=>({...previous,repairs:[...previous.repairs,...items]}))
        setLastRepairIds(items.map((item)=>item.id))
      }
      setRepairStatus(result.reason || (result.repairs.length?
        'Restored '+result.repairs.length+' mapped road segment(s) from source data.':
        'No supported missing connections found here. Try zooming closer or selecting a wider gap.'))
    }catch(err){
      setRepairStatus(err instanceof Error?err.message:'Unable to check this area.')
    }finally{
      setChecking(false);setSelection(null)
    }
  }
  const undoRepairs=()=>{
    if(!lastRepairIds.length)return
    const ids=new Set(lastRepairIds)
    setProject((previous)=>({...previous,repairs:previous.repairs.filter((repair)=>!ids.has(repair.id))}))
    setLastRepairIds([])
    setRepairStatus('Last repair batch undone.')
  }
  const exportPng=async()=>{setBusy(true);try{await exportMapPng({filename:`${fileName(project.name)}-${project.size.widthMm}x${project.size.heightMm}mm.png`,size:project.size,camera:project.camera,previewViewport:viewport,theme:project.theme,visibility:project.visible,featuredPlaces:project.places,repairs:project.repairs,roadChoices:project.roadChoices});setNote('Print PNG exported')}catch(err){setNote(err instanceof Error?err.message:'Export failed')}finally{setBusy(false)}}
  const exportSvg=async()=>{setBusy(true);try{const map=liveMapRef.current;if(!map)throw new Error('The live map is not ready yet.');await exportMapSvg({filename:`${fileName(project.name)}-${project.size.widthMm}x${project.size.heightMm}mm.svg`,map,size:project.size,camera:project.camera,previewViewport:viewport,theme:project.theme,visibility:project.visible,featuredPlaces:project.places,repairs:project.repairs,roadChoices:project.roadChoices});setNote('Editable SVG exported')}catch(err){setNote(err instanceof Error?err.message:'Export failed')}finally{setBusy(false)}}
  return <div className="shell">
    <header><b>STRictons <small>MAP STUDIO</small></b><input value={project.name} onChange={e=>patch('name',e.target.value)}/><div className="export-actions"><button onClick={exportPng} disabled={busy}>↓ PNG</button><button onClick={exportSvg} disabled={busy}>↓ SVG</button></div></header>
    <aside>
      <nav>{(['document','style','places'] as const).map(x=><button className={tab===x?'on':''} onClick={()=>setTab(x)} key={x}>{x}</button>)}</nav>
      <div className="panel">
      {tab==='document'&&<>
        <h3>Canvas <em>physical print size</em></h3><div className="presets">{PRESETS.map(([n,w,h])=><button key={n} disabled={locked} className={project.size.widthMm===w&&project.size.heightMm===h?'on':''} onClick={()=>setProject(p=>({...p,size:{...p.size,widthMm:w,heightMm:h}}))}><b>{n}</b><small>{w} × {h} mm</small></button>)}</div>
        <div className="grid"><label>Width<input type="number" disabled={locked} value={project.size.widthMm} onChange={e=>size('widthMm',+e.target.value)}/></label><label>Height<input type="number" disabled={locked} value={project.size.heightMm} onChange={e=>size('heightMm',+e.target.value)}/></label><label>Bleed<input type="number" disabled={locked} value={project.size.bleedMm} onChange={e=>size('bleedMm',+e.target.value)}/></label><label>DPI<select disabled={locked} value={project.size.dpi} onChange={e=>size('dpi',+e.target.value)}><option>150</option><option>200</option><option>300</option></select></label></div>
        <div className="info"><small>Output canvas</small><b>{px.width.toLocaleString()} × {px.height.toLocaleString()} px</b></div>
        <h3>Location <em>OpenStreetMap search</em></h3><form onSubmit={search}><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Suburb, venue or address"/><button>⌕</button></form>{results.length>0&&<div className="results">{results.map(r=><button key={r.place_id} onClick={()=>go(r)}><b>{r.display_name.split(',')[0]}</b><small>{r.display_name}</small></button>)}</div>}<p className="help">Manual, cached Nominatim search. Configure VITE_GEOCODER_URL for production.</p>
        {locked&&<div className="road-choice-box">
          <h3>Selected road section <em>junction to junction</em></h3>
          {selectedRoad?<><p className="road-choice-name">{selectedRoad.name}</p>
            <p className="help">{selectedRoad.category} · {selectedRoad.selectionHint}</p>
            <label><input type="checkbox" checked={false} onChange={()=>chooseRoad('show')}/> Always show this section</label>
            <label><input type="checkbox" checked={false} onChange={()=>chooseRoad('hide')}/> Hide this section</label>
            <button type="button" className="road-choice-cancel" onClick={()=>setSelectedRoad(null)}>Cancel selection</button>
          </>:<p className="help">Choose “Select road” above the map, then click a road while zoomed in. Only the highlighted section will change.</p>}
        </div>}
        <h3>Road visibility choices <em>{project.roadChoices.length} saved</em></h3>
        <p className="help">Sections are stored as editable geometry, independent of how far you zoom out. Remove an entry to restore its default display.</p>
        <div className="repair-list">{project.roadChoices.length===0?<p className="help">No custom visibility choices yet.</p>:project.roadChoices.map((choice,index)=><article key={choice.id}><span>{String(index+1).padStart(2,'0')}</span><div><b>{choice.name}</b><small>{choice.mode==='show'?'Always show':'Hide'} · {choice.category}</small></div><button type="button" aria-label={'Remove choice for '+choice.name} onClick={()=>removeRoadChoice(choice.id)}>×</button></article>)}</div>
        <h3>Verified road repairs <em>{project.repairs.length} saved</em></h3>
        <p className="help">Only road geometry found in the underlying map source is restored. Select a road below to remove that correction.</p>
        <div className="repair-list">{project.repairs.length===0?<p className="help">No repairs saved yet.</p>:project.repairs.map((repair,index)=><article key={repair.id}><span>{String(index+1).padStart(2,'0')}</span><div><b>{repair.name}</b><small>{repair.category} · {repair.roadClass}</small></div><button type="button" aria-label={'Remove '+repair.name} onClick={()=>patch('repairs',project.repairs.filter(item=>item.id!==repair.id))}>×</button></article>)}</div>
      </>}
      {tab==='style'&&<>
        <h3>Presets <em>starting point</em></h3><div className="theme-presets">{Object.entries(THEME_PRESETS).map(([n,t])=><button key={n} onClick={()=>patch('theme',{...t})}><i style={{background:`linear-gradient(135deg,${t.land} 0 55%,${t.water} 55% 75%,${t.featured} 75%)`}}/>{n}</button>)}</div>
        <h3>Palette <em>live vector styling</em></h3>{([['Land','land'],['Water','water'],['Parks','parks'],['Buildings','buildings'],['Highways','highways'],['Major roads','roads'],['Minor roads','minorRoads'],['Railways','railways'],['Map labels','labels'],['Featured','featured']] as [string,keyof MapTheme][]).map(([l,k])=><Colour key={k} label={l} value={String(project.theme[k])} onChange={v=>theme(k,v as never)}/>)}
        <h3>Railway <em>line treatment</em></h3><label className="style-select"><span>Style</span><select value={project.theme.railwayStyle} onChange={e=>theme('railwayStyle',e.target.value as MapTheme['railwayStyle'])}><option value="solid">Solid</option><option value="dashed">Dashed</option><option value="double">Double rail</option><option value="sleepers">Sleepers</option></select></label>
        <h3>Line weights <em>relative thickness</em></h3><label className="range">Highways <b>{project.theme.highwayWidthScale.toFixed(2)}×</b><input type="range" min="0.25" max="2.5" step="0.05" value={project.theme.highwayWidthScale} onChange={e=>theme('highwayWidthScale',+e.target.value)}/></label><label className="range">Major roads <b>{project.theme.roadWidthScale.toFixed(2)}×</b><input type="range" min="0.25" max="2.5" step="0.05" value={project.theme.roadWidthScale} onChange={e=>theme('roadWidthScale',+e.target.value)}/></label><label className="range">Minor roads & paths <b>{project.theme.minorRoadWidthScale.toFixed(2)}×</b><input type="range" min="0.25" max="2.5" step="0.05" value={project.theme.minorRoadWidthScale} onChange={e=>theme('minorRoadWidthScale',+e.target.value)}/></label><label className="range">Railways <b>{project.theme.railwayWidthScale.toFixed(2)}×</b><input type="range" min="0.25" max="2.5" step="0.05" value={project.theme.railwayWidthScale} onChange={e=>theme('railwayWidthScale',+e.target.value)}/></label>
        <h3>Base detail <em>what appears</em></h3>{([['Road network','roads'],['Minor roads & paths','minorRoads'],['Rail network','railways'],['Buildings','buildings'],['Parks & land use','parks'],['Boundaries','boundaries'],['All base labels','labels'],['Suburbs & towns','placeLabels'],['Road names','roadLabels'],['OSM POIs','poiLabels'],['Water names','waterLabels']] as [string,keyof LayerVisibility][]).map(([l,k])=><Toggle key={k} label={l} value={project.visible[k]} onChange={v=>visible(k,v)}/>)}
      </>}
      {tab==='places'&&<>
        <h3>Featured places <em>editorial layer</em></h3><button className={pick?'primary':'wide'} onClick={()=>setPick(v=>!v)}>＋ {pick?'Click the map…':'Add place from map'}</button><p className="help">Capture a map point, then rename it exactly as it should appear in the guide.</p>
        <div className="places">{project.places.map((p,i)=><article key={p.id}><span>{String(i+1).padStart(2,'0')}</span><div><input value={p.name} onChange={e=>patch('places',project.places.map(x=>x.id===p.id?{...x,name:e.target.value}:x))}/><input className="sub" value={p.category} onChange={e=>patch('places',project.places.map(x=>x.id===p.id?{...x,category:e.target.value}:x))}/></div><button onClick={()=>patch('places',project.places.filter(x=>x.id!==p.id))}>×</button></article>)}</div>
        <h3>Featured labels <em>print emphasis</em></h3><label className="range">Size <b>{project.theme.featuredLabelSize}px</b><input type="range" min="10" max="28" value={project.theme.featuredLabelSize} onChange={e=>theme('featuredLabelSize',+e.target.value)}/></label><Colour label="Text" value={project.theme.featuredText} onChange={v=>theme('featuredText',v)}/><Colour label="Halo" value={project.theme.featuredHalo} onChange={v=>theme('featuredHalo',v)}/>
      </>}
      </div>
    </aside>
    <main><div className="bar"><div className="edit-toolbar"><span>● OSM vector base</span>{!locked?<button className="lock-action" onClick={lockCanvas}>Lock canvas · Edit roads</button>:<><strong>● Canvas locked</strong><button className={roadPicking?'active':''} onClick={()=>{setRoadPicking(v=>!v);setSelecting(false);setSelection(null);setSelectedRoad(null);setTab('document')}}>{roadPicking?'Road selection on':'Select road'}</button><button onClick={()=>{setSelecting(true);setRoadPicking(false);setSelectedRoad(null);setSelection(null)}} className={selecting?'active':''}>Draw selection</button><button disabled={!selection||checking} onClick={checkRepair}>{checking?'Checking...':'Check & repair roads'}</button><button disabled={!lastRepairIds.length} onClick={undoRepairs}>Undo repair</button><button onClick={resetView}>Reset zoom</button><button className="lock-action" onClick={unlockCanvas}>Unlock canvas</button></>}</div><code>{project.camera.center[1].toFixed(4)}, {project.camera.center[0].toFixed(4)} · z{project.camera.zoom.toFixed(1)}</code></div><div className="stage"><div className="canvas" style={{aspectRatio:String(ratio),width:`min(92cqw, 1000px, calc(92cqh * ${ratio}))`}}><MapView project={project} pick={pick} locked={locked} selecting={selecting} selection={selection} roadPicking={roadPicking} selectedRoad={selectedRoad} onCamera={c=>{if(locked){setSelection(null)}else{patch('camera',c)}}} onPick={add} onViewport={setViewport} onMapReady={map=>{liveMapRef.current=map}} onSelection={area=>{setSelection(area);setSelecting(false);if(area)setRepairStatus('Area selected. Click Check & repair roads.')}} onRoadClick={road=>{setSelectedRoad(road);setTab('document');setRepairStatus(road?'Section selected. Choose Always show or Hide in the Document panel.':'Could not select a road here. Zoom in and click a visible road line.')}}/></div></div><footer><span>{locked ? repairStatus || 'Canvas locked by default. Click a road to select it; unlock to resize or reposition.' : 'Drag to pan · scroll to zoom · OpenFreeMap © OpenMapTiles · Data from OpenStreetMap'}</span><code>{px.width.toLocaleString()} × {px.height.toLocaleString()} px @ {project.size.dpi} dpi</code></footer></main>
    {note&&<div className="toast">{note}</div>}
  </div>
}
