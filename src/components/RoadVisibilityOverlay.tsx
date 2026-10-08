import { useEffect, useMemo, useState } from 'react'
import type { Map } from 'maplibre-gl'
import { visibleRoadAppearance, type RoadOverride } from '../lib/roadChoices'
import type { LayerVisibility, MapTheme } from '../lib/mapDesign'

type Props={
  map:Map|null
  choices:RoadOverride[]
  theme:MapTheme
  visibility:LayerVisibility
}

// Standalone screen-space rendering guarantees that a deliberately shown
// road remains on the print preview regardless of the base map's zoom rules.
export default function RoadVisibilityOverlay({map,choices,theme,visibility}:Props){
  const [viewport,setViewport]=useState({width:1,height:1,revision:0})
  useEffect(()=>{
    if(!map)return
    let frame=0
    const update=()=>{
      if(frame)return
      frame=requestAnimationFrame(()=>{
        frame=0
        const canvas=map.getCanvas()
        setViewport(last=>({
          width:Math.max(1,canvas.clientWidth),
          height:Math.max(1,canvas.clientHeight),
          revision:last.revision+1
        }))
      })
    }
    map.on('move',update)
    map.on('resize',update)
    update()
    return ()=>{
      map.off('move',update)
      map.off('resize',update)
      if(frame)cancelAnimationFrame(frame)
    }
  },[map])

  const drawn=useMemo(()=>{
    if(!map||!visibility.roads)return []
    const zoom=map.getZoom()
    return choices.filter(choice=>
      choice.mode==='show'&&choice.coordinates?.length>1
    ).map(choice=>{
      const points=choice.coordinates.map(coord=>map.project(coord))
      const path=points.map((p,i)=>
        `${i===0?'M':'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`
      ).join(' ')
      return {id:choice.id,path,style:visibleRoadAppearance(theme,choice.category,zoom)}
    })
  },[map,choices,theme,visibility.roads,viewport.revision])

  if(!map||drawn.length===0)return null
  return <svg className="road-visibility-overlay"
    width={viewport.width} height={viewport.height}
    viewBox={`0 0 ${viewport.width} ${viewport.height}`}
    aria-hidden="true">
    {drawn.map(road=><g key={road.id}>
      <path d={road.path} fill="none" stroke={road.style.casing}
        strokeWidth={road.style.casingWidth} strokeLinecap="round" strokeLinejoin="round"/>
      <path d={road.path} fill="none" stroke={road.style.colour}
        strokeWidth={road.style.width} strokeLinecap="round" strokeLinejoin="round"/>
    </g>)}
  </svg>
}
