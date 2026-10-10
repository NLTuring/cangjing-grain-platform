import React, {Suspense, useMemo} from 'react';
import {Canvas} from '@react-three/fiber';
import {OrbitControls, ContactShadows} from '@react-three/drei';
import * as THREE from 'three';

function Roof({y=2.4}) {
  const geometry=useMemo(()=>{const s=new THREE.Shape();s.moveTo(-1.45,0);s.lineTo(0,.85);s.lineTo(1.45,0);s.closePath();const g=new THREE.ExtrudeGeometry(s,{depth:5.6,bevelEnabled:false});g.translate(0,0,-2.8);return g;},[]);
  return <mesh position={[0,y,0]} geometry={geometry} castShadow><meshStandardMaterial color="#72776d" roughness={.85}/></mesh>;
}
function Warehouse({position=[0,0,0],selected=false,onClick,mode='外观',label='03号仓',single=false,onPoint}) {
  const open=mode!=='外观', layers=mode==='分层';
  return <group position={position} onClick={e=>{e.stopPropagation();onClick?.();}}>
    <mesh position={[0,.1,0]} receiveShadow><boxGeometry args={[3.4,.2,6.2]}/><meshStandardMaterial color={selected?'#c9b47f':'#cecabe'}/></mesh>
    <mesh position={[0,1.25,2.65]} castShadow><boxGeometry args={[2.8,2.3,.16]}/><meshStandardMaterial color="#dfdccf"/></mesh>
    <mesh position={[-1.33,1.25,0]} castShadow><boxGeometry args={[.16,2.3,5.3]}/><meshStandardMaterial color="#e9e4d6"/></mesh>
    {!open&&<mesh position={[1.33,1.25,0]} castShadow><boxGeometry args={[.16,2.3,5.3]}/><meshStandardMaterial color="#eee9dc"/></mesh>}
    {!open&&<mesh position={[0,1.25,-2.65]} castShadow><boxGeometry args={[2.8,2.3,.16]}/><meshStandardMaterial color="#e5dfce"/></mesh>}
    {[0,1,2].map(i=><mesh key={i} position={[0,.48+i*(layers?.9:.48),0]} receiveShadow><boxGeometry args={[2.48,.44,5.05]}/><meshStandardMaterial color={i===1&&selected?'#bd9451':'#c9b47c'} roughness={1}/></mesh>)}
    <Roof y={open?(layers?4.2:3.5):2.4}/>
    {!open&&[-1.6,0,1.6].map(z=><mesh key={z} position={[1.425,1.65,z]}><boxGeometry args={[.025,.42,.65]}/><meshStandardMaterial color="#69766e"/></mesh>)}
    {selected&&open&&[0,1,2].map(i=><group key={i} position={[.8,.8+i*(layers?.9:.48),-1]}><mesh onClick={e=>{e.stopPropagation();onPoint?.(i);}}><sphereGeometry args={[.095,16,16]}/><meshStandardMaterial color={i===1?'#b54b37':'#50685a'}/></mesh></group>)}
  </group>;
}
export default function Scene({warehouses=[],selected,onSelect,single=false,mode='外观',dark=false,onPoint}) {
  return <Canvas shadows dpr={[1,1.5]} camera={{position:single?[10,8,-12]:[18,19,-21],fov:single?36:38}} gl={{antialias:true}}>
    <color attach="background" args={[dark?'#202922':'#eeece3']}/><ambientLight intensity={dark?1.2:1.7}/><directionalLight position={[5,15,-8]} intensity={2.5} castShadow shadow-mapSize={[2048,2048]}/>
    <Suspense fallback={null}>
    {single?<Warehouse single selected mode={mode} onPoint={onPoint}/>:<group position={[0,0,0]}>
      <mesh position={[0,-.22,0]} receiveShadow><boxGeometry args={[16,.4,19]}/><meshStandardMaterial color={dark?'#41473d':'#d9d7c9'}/></mesh>
      <mesh position={[0,.005,0]} rotation={[-Math.PI/2,0,0]}><planeGeometry args={[2.3,18]}/><meshStandardMaterial color="#babbb0"/></mesh>
      {warehouses.map((w,i)=><Warehouse key={w.id} position={[i%2?4:-4,0,Math.floor(i/2)*6.2-6.2]} selected={w.id===selected} onClick={()=>onSelect(w.id)} label={w.name}/>)}
      {[-1,1].map(s=><group key={s} position={[s*6.6,0,7.9]}><mesh position={[0,1.5,0]} castShadow><cylinderGeometry args={[.65,.65,3,24]}/><meshStandardMaterial color="#a7aaa0" metalness={.25} roughness={.6}/></mesh><mesh position={[0,3.15,0]}><coneGeometry args={[.7,.5,24]}/><meshStandardMaterial color="#687468"/></mesh></group>)}
    </group>}
    <ContactShadows position={[0,-.43,0]} opacity={.3} scale={40} blur={2.5} far={12}/>
    <OrbitControls makeDefault enablePan={false} minDistance={single?9:22} maxDistance={single?24:45} minPolarAngle={.35} maxPolarAngle={1.35} target={[0,single?1.4:0,0]}/>
    </Suspense>
  </Canvas>;
}
