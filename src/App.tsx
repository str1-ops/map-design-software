import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { Map as MapLibreMap } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import {
  BASE_STYLE_URL, DEFAULT_THEME, THEME_PRESETS, applyMapDesign,
  ensureFeaturedLayers, exportMapPng, exportMapSvg, guessFeatureName, totalPrintPixels,
  type CameraState, type FeaturedPlace, type LayerVisibility,
  type MapTheme, type PrintSize,
} from './lib/mapDesign'

maplibregl.setWorkerUrl(workerUrl)

type Project = { name:string; size:PrintSize; theme:MapTheme; visible:LayerVisibility; places:FeaturedPlace[]; camera:CameraState }
type SearchResult = { place_id:number; display_name:string; lat:string; lon:string; type?:string }

const DEFAULTS: Project = {
  name:'Central Coast Map',
  size:{ widthMm:203, heightMm:185, bleedMm:3, dpi:300 },
  theme:DEFAULT_THEME,
  visible:{ roads:true, minorRoads:true, railways:true, buildings:true, parks:true, boundaries:false, labels:true, placeLabels:true, roadLabels:true, poiLabels:false, waterLabels:true },
  places:[], camera:{ center:[151.544,-33.263], zoom:11.2, bearing:0, pitch:0 },
}
const PRESETS = [
  ['Beachcomber spread',203,185],['Beachcomber page',101.5,185],['A4 landscape',297,210],['A4 portrait',210,297],
] as const
const STORE='strictons-map-studio-v1'
let lastSearch=0

function load():Project {
  try { const p=JSON.parse(localStorage.getItem(STORE)||'null'); return p ? {...DEFAULTS,...p,size:{...DEFAULTS.size,...p.size},theme:{...DEFAULT_THEME,...p.theme},visible:{...DEFAULTS.visible,...p.visible},camera:{...DEFAULTS.camera,...p.camera}} : DEFAULTS } catch { return DEFAULTS }
}
function fileName(s:string){ return s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'') || 'map' }

function Toggle({label,value,onChange}:{label:string;value:boolean;onChange:(v:boolean)=>void}){
  return <label className="toggle"><span>{label}</span><input type="checkbox" checked={value} onChange={e=>onChange(e.target.checked)}/><i/></label>
}
function Colour({label,value,onChange}:{label:string;value:string;onChange:(v:string)=>void}){
  return <label className="colour"><span>{label}</span><div><input type="color" value={value} onChange={e=>onChange(e.target.value)}/><code>{value.toUpperCase()}</code></div></label>
}

function MapView({project,pick,onCamera,onPick,onViewport}:{project:Project;pick:boolean;onCamera:(c:CameraState)=>void;onPick:(p:FeaturedPlace)=>void;onViewport:(v:{width:number;height:number})=>void}){
  const host=useRef<HTMLDivElement>(null), mapRef=useRef<MapLibreMap|null>(null), latest=useRef({onCamera,onPick,onViewport})
  latest.current={onCamera,onPick,onViewport}
  useEffect(()=>{
    if(!host.current || mapRef.current) return
    const map=new maplibregl.Map({container:host.current,style:BASE_STYLE_URL,center:project.camera.center,zoom:project.camera.zoom,bearing:0,pitch:0,attributionControl:{},canvasContextAttributes:{preserveDrawingBuffer:true}})
    mapRef.current=map; map.addControl(new maplibregl.NavigationControl({visualizePitch:false}),'top-right')
    const syncViewport=()=>{ map.resize(); if(host.current) latest.current.onViewport({width:host.current.clientWidth,height:host.current.clientHeight}) }
    const ro=new ResizeObserver(syncViewport); ro.observe(host.current)
    map.on('load',()=>{ syncViewport(); applyMapDesign(map,project.theme,project.visible); ensureFeaturedLayers(map,project.places,project.theme) })
    map.on('moveend',()=>{ const c=map.getCenter(); latest.current.onCamera({center:[c.lng,c.lat],zoom:map.getZoom(),bearing:map.getBearing(),pitch:map.getPitch()}) })
    map.on('click',e=>{ if(map.getCanvas().dataset.pick!=='1') return; latest.current.onPick({id:crypto.randomUUID(),name:guessFeatureName(map,e),lng:e.lngLat.lng,lat:e.lngLat.lat,category:'Featured'}) })
    return ()=>{ ro.disconnect(); map.remove(); mapRef.current=null }
  },[])
  useEffect(()=>{ const m=mapRef.current; if(m){m.getCanvas().dataset.pick=pick?'1':'';m.getCanvas().style.cursor=pick?'crosshair':''}},[pick])
  useEffect(()=>{ const m=mapRef.current;if(m?.isStyleLoaded()){applyMapDesign(m,project.theme,project.visible);ensureFeaturedLayers(m,project.places,project.theme)}},[project.theme,project.visible,project.places])
  useEffect(()=>{ const m=mapRef.current;if(!m)return;requestAnimationFrame(()=>m.resize()) },[project.size.widthMm,project.size.heightMm,project.size.bleedMm])
  useEffect(()=>{ const m=mapRef.current;if(!m)return;const c=m.getCenter();if(Math.abs(c.lng-project.camera.center[0])>.0001||Math.abs(c.lat-project.camera.center[1])>.0001||Math.abs(m.getZoom()-project.camera.zoom)>.01)m.easeTo({center:project.camera.center,zoom:project.camera.zoom,duration:450})},[project.camera.center,project.camera.zoom])
  const tw=project.size.widthMm+project.size.bleedMm*2, th=project.size.heightMm+project.size.bleedMm*2, bx=project.size.bleedMm/tw*100, by=project.size.bleedMm/th*100
  return <div className="paper"><div ref={host} className="map"/>{project.size.bleedMm>0&&<div className="trim" style={{inset:`${by}% ${bx}%`}}/>}<span className="size-chip">{project.size.widthMm} × {project.size.heightMm} mm</span>{pick&&<span className="pick-chip">Click a place on the map</span>}</div>
}

async function geocode(q:string):Promise<SearchResult[]> {
  const key='geo:'+q.toLowerCase(), cached=localStorage.getItem(key); if(cached)return JSON.parse(cached)
  const wait=1050-(Date.now()-lastSearch);if(wait>0)await new Promise(r=>setTimeout(r,wait));lastSearch=Date.now()
  const u=new URL(import.meta.env.VITE_GEOCODER_URL||'https://nominatim.openstreetmap.org/search');u.searchParams.set('q',q);u.searchParams.set('format','jsonv2');u.searchParams.set('limit','5')
  const r=await fetch(u,{headers:{Accept:'application/json','Accept-Language':'en-AU,en;q=.9'}});if(!r.ok)throw new Error('Location search unavailable')
  const data=await r.json();localStorage.setItem(key,JSON.stringify(data));return data
}

export default function App(){
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
  const go=(r:SearchResult)=>{patch('camera',{...project.camera,center:[Number(r.lon),Number(r.lat)],zoom:r.type==='city'||r.type==='town'?12:14});setResults([])}
  const add=(p:FeaturedPlace)=>{patch('places',[...project.places,p]);setPick(false);setTab('places')}
  const exportPng=async()=>{setBusy(true);try{await exportMapPng({filename:`${fileName(project.name)}-${project.size.widthMm}x${project.size.heightMm}mm.png`,size:project.size,camera:project.camera,previewViewport:viewport,theme:project.theme,visibility:project.visible,featuredPlaces:project.places});setNote('Print PNG exported')}catch(err){setNote(err instanceof Error?err.message:'Export failed')}finally{setBusy(false)}}
  const exportSvg=async()=>{setBusy(true);try{await exportMapSvg({filename:`${fileName(project.name)}-${project.size.widthMm}x${project.size.heightMm}mm.svg`,size:project.size,camera:project.camera,previewViewport:viewport,theme:project.theme,visibility:project.visible,featuredPlaces:project.places});setNote('SVG exported')}catch(err){setNote(err instanceof Error?err.message:'Export failed')}finally{setBusy(false)}}
  return <div className="shell">
    <header><b>STRictons <small>MAP STUDIO</small></b><input value={project.name} onChange={e=>patch('name',e.target.value)}/><div className="export-actions"><button onClick={exportPng} disabled={busy}>↓ PNG</button><button onClick={exportSvg} disabled={busy}>↓ SVG</button></div></header>
    <aside>
      <nav>{(['document','style','places'] as const).map(x=><button className={tab===x?'on':''} onClick={()=>setTab(x)} key={x}>{x}</button>)}</nav>
      <div className="panel">
      {tab==='document'&&<>
        <h3>Canvas <em>physical print size</em></h3><div className="presets">{PRESETS.map(([n,w,h])=><button key={n} className={project.size.widthMm===w&&project.size.heightMm===h?'on':''} onClick={()=>setProject(p=>({...p,size:{...p.size,widthMm:w,heightMm:h}}))}><b>{n}</b><small>{w} × {h} mm</small></button>)}</div>
        <div className="grid"><label>Width<input type="number" value={project.size.widthMm} onChange={e=>size('widthMm',+e.target.value)}/></label><label>Height<input type="number" value={project.size.heightMm} onChange={e=>size('heightMm',+e.target.value)}/></label><label>Bleed<input type="number" value={project.size.bleedMm} onChange={e=>size('bleedMm',+e.target.value)}/></label><label>DPI<select value={project.size.dpi} onChange={e=>size('dpi',+e.target.value)}><option>150</option><option>200</option><option>300</option></select></label></div>
        <div className="info"><small>Output canvas</small><b>{px.width.toLocaleString()} × {px.height.toLocaleString()} px</b></div>
        <h3>Location <em>OpenStreetMap search</em></h3><form onSubmit={search}><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Suburb, venue or address"/><button>⌕</button></form>{results.length>0&&<div className="results">{results.map(r=><button key={r.place_id} onClick={()=>go(r)}><b>{r.display_name.split(',')[0]}</b><small>{r.display_name}</small></button>)}</div>}<p className="help">Manual, cached Nominatim search. Configure VITE_GEOCODER_URL for production.</p>
      </>}
      {tab==='style'&&<>
        <h3>Presets <em>starting point</em></h3><div className="theme-presets">{Object.entries(THEME_PRESETS).map(([n,t])=><button key={n} onClick={()=>patch('theme',{...t})}><i style={{background:`linear-gradient(135deg,${t.land} 0 55%,${t.water} 55% 75%,${t.featured} 75%)`}}/>{n}</button>)}</div>
        <h3>Palette <em>live vector styling</em></h3>{([['Land','land'],['Water','water'],['Parks','parks'],['Buildings','buildings'],['Major roads','roads'],['Minor roads','minorRoads'],['Railways','railways'],['Map labels','labels'],['Featured','featured']] as [string,keyof MapTheme][]).map(([l,k])=><Colour key={k} label={l} value={String(project.theme[k])} onChange={v=>theme(k,v as never)}/>)}
        <h3>Line weights <em>relative thickness</em></h3><label className="range">Major roads <b>{project.theme.roadWidthScale.toFixed(2)}×</b><input type="range" min="0.25" max="2.5" step="0.05" value={project.theme.roadWidthScale} onChange={e=>theme('roadWidthScale',+e.target.value)}/></label><label className="range">Minor roads & paths <b>{project.theme.minorRoadWidthScale.toFixed(2)}×</b><input type="range" min="0.25" max="2.5" step="0.05" value={project.theme.minorRoadWidthScale} onChange={e=>theme('minorRoadWidthScale',+e.target.value)}/></label>
        <h3>Base detail <em>what appears</em></h3>{([['Road network','roads'],['Minor roads & paths','minorRoads'],['Rail network','railways'],['Buildings','buildings'],['Parks & land use','parks'],['Boundaries','boundaries'],['All base labels','labels'],['Suburbs & towns','placeLabels'],['Road names','roadLabels'],['OSM POIs','poiLabels'],['Water names','waterLabels']] as [string,keyof LayerVisibility][]).map(([l,k])=><Toggle key={k} label={l} value={project.visible[k]} onChange={v=>visible(k,v)}/>)}
      </>}
      {tab==='places'&&<>
        <h3>Featured places <em>editorial layer</em></h3><button className={pick?'primary':'wide'} onClick={()=>setPick(v=>!v)}>＋ {pick?'Click the map…':'Add place from map'}</button><p className="help">Capture a map point, then rename it exactly as it should appear in the guide.</p>
        <div className="places">{project.places.map((p,i)=><article key={p.id}><span>{String(i+1).padStart(2,'0')}</span><div><input value={p.name} onChange={e=>patch('places',project.places.map(x=>x.id===p.id?{...x,name:e.target.value}:x))}/><input className="sub" value={p.category} onChange={e=>patch('places',project.places.map(x=>x.id===p.id?{...x,category:e.target.value}:x))}/></div><button onClick={()=>patch('places',project.places.filter(x=>x.id!==p.id))}>×</button></article>)}</div>
        <h3>Featured labels <em>print emphasis</em></h3><label className="range">Size <b>{project.theme.featuredLabelSize}px</b><input type="range" min="10" max="28" value={project.theme.featuredLabelSize} onChange={e=>theme('featuredLabelSize',+e.target.value)}/></label><Colour label="Text" value={project.theme.featuredText} onChange={v=>theme('featuredText',v)}/><Colour label="Halo" value={project.theme.featuredHalo} onChange={v=>theme('featuredHalo',v)}/>
      </>}
      </div>
    </aside>
    <main><div className="bar"><span>● OSM vector base · OpenFreeMap + MapLibre</span><code>{project.camera.center[1].toFixed(4)}, {project.camera.center[0].toFixed(4)} · z{project.camera.zoom.toFixed(1)}</code></div><div className="stage"><div className="canvas" style={{aspectRatio:String(ratio),width:`min(92cqw, 1000px, calc(92cqh * ${ratio}))`}}><MapView project={project} pick={pick} onCamera={c=>patch('camera',c)} onPick={add} onViewport={setViewport}/></div></div><footer><span>Drag to pan · scroll to zoom · Places controls the editorial layer</span><code>{px.width.toLocaleString()} × {px.height.toLocaleString()} px @ {project.size.dpi} dpi</code></footer></main>
    {note&&<div className="toast">{note}</div>}
  </div>
}
