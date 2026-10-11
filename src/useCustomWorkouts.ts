import {useEffect,useRef,useState} from 'react';
import {loadCustomWorkouts,putCustomWorkout,deleteCustomWorkout,BrowserModeError} from './api';
import {validateCustomWorkout,type CustomWorkoutDraft} from './customWorkouts';
import {getLocalStore} from './localStore';
const key='summit-custom-library';
type Library={drafts:CustomWorkoutDraft[];pending:Record<string,CustomWorkoutDraft|null>};
function parseLibrary(value:{drafts?:unknown;pending?:Record<string,unknown>}):Library {
  const drafts=(Array.isArray(value.drafts)?value.drafts:[]).flatMap((x:unknown)=>{try{return [validateCustomWorkout(x)]}catch{return []}});const pending:Library['pending']={};for(const [id,v] of Object.entries(value.pending??{})){try{pending[id]=v===null?null:validateCustomWorkout(v)}catch{/* bad local draft */}}return {drafts,pending};
}
function readLibrary():Library {
  try {return parseLibrary(JSON.parse(localStorage.getItem(key)||'{}'))}catch{return {drafts:[],pending:{}}}
}
const hasLocalLibrary=()=>{try{return localStorage.getItem(key)!==null}catch{return false}};
/** IndexedDB keeps a second copy, so templates survive a cleared localStorage. */
const mirror=(library:Library)=>void getLocalStore().then(store=>store.setValue('customLibrary',library)).catch(()=>{});
export function useCustomWorkouts(){
  const [library,setLibrary]=useState(readLibrary),[message,setMessage]=useState('');const ref=useRef(library);
  const requests=useRef<Promise<unknown>>(Promise.resolve());
  function serial<T>(operation:()=>Promise<T>):Promise<T>{const next=requests.current.then(operation,operation);requests.current=next.catch(()=>{});return next;}
  function store(next:Library){localStorage.setItem(key,JSON.stringify(next));ref.current=next;setLibrary(next);mirror(next)}
  useEffect(()=>{let cancelled=false;void serial(async()=>{
    if(!hasLocalLibrary()){try{const saved=await (await getLocalStore()).getValue<Library>('customLibrary');if(saved&&!cancelled){const restored=parseLibrary(saved);if(restored.drafts.length||Object.keys(restored.pending).length)store(restored)}}catch{/* nothing to restore */}}
    try{const remote=await loadCustomWorkouts();if(!Array.isArray(remote)||cancelled)return;const combined=new Map(remote.flatMap(v=>{try{const d=validateCustomWorkout(v);return [[d.id,d] as const]}catch{return []}}));const pending={...ref.current.pending};
      for(const [id,draft] of Object.entries(pending)){if(draft)combined.set(id,draft);else combined.delete(id)}
      store({drafts:[...combined.values()],pending});
      for(const [id,draft] of Object.entries(pending)){try{if(draft)await putCustomWorkout(draft);else await deleteCustomWorkout(id);if(cancelled)return;if(JSON.stringify(ref.current.pending[id])===JSON.stringify(draft)){const next={...ref.current.pending};delete next[id];store({...ref.current,pending:next})}}catch{if(!cancelled)setMessage('Egne økter er lagret i nettleseren. Databasen synkroniseres neste gang appen åpnes.')}}
    }catch{/* local library remains available offline and in browser mode */}
  });return()=>{cancelled=true}},[]);
  async function save(input:CustomWorkoutDraft){const draft=validateCustomWorkout(input);const next={drafts:[draft,...ref.current.drafts.filter(d=>d.id!==draft.id)],pending:{...ref.current.pending,[draft.id]:draft}};let local=false;
    try{store(next);local=true}catch{/* backend can still save */}
    try{await serial(()=>putCustomWorkout(draft));const pending={...(local?ref.current.pending:next.pending)};delete pending[draft.id];const saved={drafts:local?ref.current.drafts:next.drafts,pending};try{store(saved)}catch{ref.current=saved;setLibrary(saved)}setMessage('Økten er lagret i den lokale databasen.')}catch(error){if(!local)throw new Error('Kunne ikke lagre økten i nettleseren eller databasen. Prøv igjen.');setMessage(error instanceof BrowserModeError?'Økten er lagret i denne nettleseren.':'Økten er lagret i nettleseren. Databasen synkroniseres neste gang appen åpnes.')}
  }
  async function remove(id:string){const next={drafts:ref.current.drafts.filter(d=>d.id!==id),pending:{...ref.current.pending,[id]:null}};store(next);try{await serial(()=>deleteCustomWorkout(id));const pending={...ref.current.pending};delete pending[id];store({...ref.current,pending});setMessage('Øktmalen er slettet. Gjennomførte økter beholdes.')}catch(error){setMessage(error instanceof BrowserModeError?'Øktmalen er slettet. Gjennomførte økter beholdes.':'Øktmalen er slettet lokalt. Slettingen synkroniseres neste gang appen åpnes.')}}
  /** Adds templates from a backup; templates with the same ID are kept as they are. */
  function importDrafts(input:CustomWorkoutDraft[]){const known=new Set(ref.current.drafts.map(d=>d.id));const added=input.filter(d=>!known.has(d.id));if(!added.length)return 0;
    const pending={...ref.current.pending};for(const d of added)pending[d.id]=d;store({drafts:[...ref.current.drafts,...added],pending});
    void serial(async()=>{for(const d of added){try{await putCustomWorkout(d);if(JSON.stringify(ref.current.pending[d.id])===JSON.stringify(d)){const next={...ref.current.pending};delete next[d.id];store({...ref.current,pending:next})}}catch{break}}});
    return added.length;}
  return {drafts:library.drafts,save,remove,importDrafts,message};
}
