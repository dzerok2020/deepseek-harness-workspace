import React, {lazy, Suspense, useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import '@designcodeio/threeui/style.css';
import './style.css';
const Background = lazy(() => import('@designcodeio/threeui/components/EmeraldHorizonBackground').then(m=>({default:m.EmeraldHorizonBackground})));
const Scene = lazy(() => import('./vendor/TempleNightScene.js').then(m=>({default:m.TempleNightScene})));
const Interaction = lazy(() => import('@designcodeio/threeui/components/GradientPillButton').then(m=>({default:m.GradientPillButton})));
const Nebula = lazy(() => import('@designcodeio/threeui/components/NebulaBackground').then(m=>({default:m.NebulaBackground})));
function App(){
 const [tab,setTab]=useState('shader'), [mounted,setMounted]=useState(true), [reduce,setReduce]=useState(matchMedia('(prefers-reduced-motion: reduce)').matches);
 useEffect(()=>{const q=matchMedia('(prefers-reduced-motion: reduce)');const change=()=>setReduce(q.matches);q.addEventListener('change',change);return()=>q.removeEventListener('change',change)},[]);
 const Component={shader:Background,scene:Scene,interaction:Interaction,nebula:Nebula}[tab];
 return <main><header><span className="eyebrow">THREEUI / COMPATIBILITY FIELD NOTES</span><span className="edition">1.2.0 · THREE r186</span></header><div className="intro"><p className="eyebrow">RENDERING, WITHOUT THE GUESSWORK</p><h1>Light. Space.<br/><em>Verified motion.</em></h1><p className="lede">A contained test bench for a shader horizon, a procedural temple and an iframe-powered interaction. One specimen at a time.</p></div><nav aria-label="Specimens">{[['shader','01 / Shader'],['scene','02 / Scene'],['interaction','03 / Interaction'],['nebula','04 / External probe']].map(([id,label])=><button key={id} aria-pressed={tab===id} onClick={()=>{setTab(id);setMounted(true)}}>{label}</button>)}</nav><section className={'stage '+tab} aria-label="Component stage" data-testid="stage" data-mode={reduce?'reduced':'animated'}>{mounted ? reduce ? <div className="fallback" role="img" aria-label="Static landscape, reduced motion"><span>STILLNESS IS A FEATURE</span><p>Reduced motion enabled.<br/>No WebGL canvas or external iframe is mounted.</p></div> : <Suspense fallback={<p className="loading">Preparing specimen…</p>}><Component mode="dark" /></Suspense> : <div className="fallback">Specimen unmounted · resources released</div>}</section><footer><div><strong>{tab==='scene'?'Licensed source adaptation':'Supported component subpath'}</strong><p>{reduce?'Static fallback · honors live preference changes':tab==='interaction'||tab==='nebula'?'iframe specimen · external dependencies audited separately':'WebGL specimen · active lifecycle probe'}</p></div><button id="mount" onClick={()=>setMounted(v=>!v)}>{mounted?'Unmount specimen':'Mount specimen'}</button></footer></main>
}
createRoot(document.getElementById('root')).render(<App/>);
