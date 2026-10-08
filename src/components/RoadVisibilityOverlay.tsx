import { useEffect, useMemo, useState } from 'react'
import type { Map } from 'maplibre-gl'
import { visibleRoadAppearance, visibleIncludedRoadParts, type RoadOverride } from '../lib/roadChoices'
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
      const paths=visibleIncludedRoadParts(map,choice,choices).map(points=>
        points.map((p,i)=>`${i===0?'M':'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')
      ).filter(Boolean)
      return {id:choice.id,path:paths.join(' '),style:visibleRoadAppearance(theme,choice.category,zoom,map,choice.roadClass,choice.coordinates)}
    }).filter(road=>road.path.length>0)
  },[map,choices,theme,visibility.roads,viewport.revision])

  if(!map||drawn.length===0)return null
  return <svg className="road-visibility-overlay"
    width={viewport.width} height={viewport.height}
    viewBox={`0 0 ${viewport.width} ${viewport.height}`}
    aria-hidden="true">
    {drawn.map(road=><path key={road.id} d={road.path}
      fill="none" stroke={road.style.colour}
      strokeWidth={road.style.width} strokeLinecap="butt" strokeLinejoin="round"/>)}
  </svg>
}
