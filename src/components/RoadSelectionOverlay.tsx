import { useEffect, useMemo, useState } from 'react'
import type { KeyboardEvent, MouseEvent, PointerEvent } from 'react'
import type { Map } from 'maplibre-gl'
import type { SelectedRoad } from '../lib/roadChoices'

type View = { width:number; height:number; revision:number }
type Props = {
  map: Map | null
  road: SelectedRoad | null
  boundary: 'start' | 'end'
  onJunctionClick: (index:number)=>void
  onRoadPointClick: (index:number)=>void
}

// This editor is deliberately independent of MapLibre style layers.
// The selected geometry is drawn in a normal SVG above the canvas; no
// tile/style refresh can hide the highlight or intercept junction clicks.
export default function RoadSelectionOverlay({map,road,boundary,onJunctionClick,onRoadPointClick}:Props){
  const [view,setView]=useState<View>({width:1,height:1,revision:0})
  useEffect(()=>{
    if(!map)return
    let frame=0
    const update=()=>{
      if(frame)return
      frame=window.requestAnimationFrame(()=>{
        frame=0
        const canvas=map.getCanvas()
        setView(previous=>({
          width:Math.max(1,canvas.clientWidth),
          height:Math.max(1,canvas.clientHeight),
          revision:previous.revision+1
        }))
      })
    }
    update()
    map.on('move',update)
    map.on('resize',update)
    map.on('rotate',update)
    map.on('pitch',update)
    return ()=>{
      map.off('move',update)
      map.off('resize',update)
      map.off('rotate',update)
      map.off('pitch',update)
      if(frame)window.cancelAnimationFrame(frame)
    }
  },[map])

  const projected=useMemo(()=>{
    if(!map||!road)return null
    const coords=road.routeCoordinates
    const points=coords.map(coordinate=>{
      const p=map.project(coordinate)
      return {x:p.x,y:p.y}
    })
    const selected=points.slice(road.startIndex,road.endIndex+1)
    const path=(values:{x:number;y:number}[])=>values.map((p,index)=>
      `${index===0?'M':'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')
    const validMarkers=road.junctions.filter((junction)=>{
      const marker=points[junction.index]
      return marker &&
        marker.x>-22&&marker.x<view.width+22&&
        marker.y>-22&&marker.y<view.height+22
    })
    const startAt=road.junctions.findIndex(marker=>marker.index===road.startIndex)
    const endAt=road.junctions.findIndex(marker=>marker.index===road.endIndex)
    const minIndex=Math.max(0,Math.min(startAt,endAt)-5)
    const maxIndex=Math.min(road.junctions.length-1,Math.max(startAt,endAt)+5)
    const nearby=new Set(road.junctions.slice(minIndex,maxIndex+1).map(j=>j.index))
    return {
      route:path(points),
      selected:path(selected),
      routePoints:points,
      markers:validMarkers.filter(j=>nearby.has(j.index)).map(junction=>({
        ...junction,x:points[junction.index].x,y:points[junction.index].y,
        selected: junction.index===road.startIndex||junction.index===road.endIndex,
        valid:boundary==='start'?junction.index<road.endIndex:junction.index>road.startIndex,
        active: junction.index===(boundary==='start'?road.startIndex:road.endIndex)
      }))
    }
  },[map,road,boundary,view.width,view.height,view.revision])

  if(!road||!projected)return null
  const activate=(index:number,event:MouseEvent<SVGGElement>|KeyboardEvent<SVGGElement>)=>{
    event.preventDefault()
    event.stopPropagation()
    onJunctionClick(index)
  }
  const stopPointer=(event:PointerEvent<SVGGElement>)=>{
    event.stopPropagation()
  }
  const chooseRoadPoint=(event:MouseEvent<SVGPathElement>)=>{
    event.stopPropagation()
    const svg=event.currentTarget.ownerSVGElement
    if(!svg)return
    const bounds=svg.getBoundingClientRect()
    if(!bounds.width||!bounds.height)return
    const x=(event.clientX-bounds.left)*view.width/bounds.width
    const y=(event.clientY-bounds.top)*view.height/bounds.height
    let nearest=-1
    let distance=Infinity
    for(let i=0;i<projected.routePoints.length;i++){
      const p=projected.routePoints[i]
      const d=Math.hypot(p.x-x,p.y-y)
      if(d<distance){distance=d;nearest=i}
    }
    if(nearest>=0)onRoadPointClick(nearest)
  }
  return <svg className="road-selection-overlay"
    viewBox={`0 0 ${view.width} ${view.height}`}
    width={view.width} height={view.height}
    aria-label="Selected road and adjustable mapped junctions">
    <path className="road-editor-route" d={projected.route}/>
    <path className="road-editor-outline" d={projected.selected}/>
    <path className="road-editor-line" d={projected.selected}/>
    <path className="road-editor-interaction" d={projected.route}
      aria-label={`Click the road line to move the ${boundary} endpoint`}
      onPointerDown={event=>event.stopPropagation()}
      onClick={chooseRoadPoint}/>
    {projected.markers.map(marker=>{
      const label=marker.active?`Current ${boundary} of selection`:
        `${marker.kind==='intersection'?'Junction':'Road endpoint'}: move ${boundary} here`
      return <g key={marker.index}
        className={`road-editor-handle ${marker.active?'current':''} ${!marker.valid?'invalid':''}`}
        role="button" tabIndex={marker.valid?0:-1}
        aria-label={label}
        aria-disabled={!marker.valid}
        onPointerDown={stopPointer}
        onClick={event=>{if(marker.valid)activate(marker.index,event);else event.stopPropagation()}}
        onKeyDown={event=>{
          if(marker.valid&&(event.key==='Enter'||event.key===' '))activate(marker.index,event)
        }}>
        <circle className="road-editor-hit" cx={marker.x} cy={marker.y} r={17}/>
        <circle className="road-editor-dot" cx={marker.x} cy={marker.y} r={marker.selected?9:6.5}/>
        {marker.active&&<circle className="road-editor-centre" cx={marker.x} cy={marker.y} r={3}/>}
        <title>{label}</title>
      </g>
    })}
  </svg>
}
