import type {Firestore} from "@google-cloud/firestore";
export function researchFakeFirestore(beforeGet?: () => void) {
  const data = new Map<string, unknown>();
  const calls: string[] = [];
  function snap(path: string) { return {exists:data.has(path),data:()=>structuredClone(data.get(path))}; }
  function collection(path: string) {
    return {doc:(id:string)=>doc(`${path}/${id}`),limit:()=>({path,query:true,get:async()=>{const docs=[...data.entries()].filter(([p])=>p.startsWith(`${path}/`)&&!p.slice(path.length+1).includes("/")).map(([,v])=>({data:()=>structuredClone(v)}));return {size:docs.length,docs};}})};
  }
  function doc(path:string) {
    return {path,collection:(name:string)=>collection(`${path}/${name}`),get:async()=>snap(path),set:async(value:unknown)=>{data.set(path,structuredClone(value));},create:async(value:unknown)=>{if(data.has(path))throw new Error("already exists");data.set(path,structuredClone(value));}};
  }
  const db = {collection,runTransaction:async(fn:(tx:unknown)=>Promise<void>)=>{
    const writes:(()=>void)[]=[];
    const tx = {get:async(ref:ReturnType<typeof doc>)=>{calls.push("get");if(writes.length)throw new Error("read after write");beforeGet?.();if((ref as unknown as {query?:boolean}).query){const docs=[...data.entries()].filter(([p])=>p.startsWith(`${ref.path}/`)&&!p.slice(ref.path.length+1).includes("/")).map(([,v])=>({data:()=>structuredClone(v)}));return {size:docs.length,docs};}return snap(ref.path);},create:(ref:ReturnType<typeof doc>,value:unknown)=>{calls.push("create");writes.push(()=>{if(data.has(ref.path))throw new Error("already exists");data.set(ref.path,structuredClone(value));});},set:(ref:ReturnType<typeof doc>,value:unknown)=>{calls.push("set");writes.push(()=>data.set(ref.path,structuredClone(value)));},update:(ref:ReturnType<typeof doc>,value:Record<string,unknown>)=>{calls.push("update");writes.push(()=>data.set(ref.path,{...(data.get(ref.path) as object),...value}));}};
    await fn(tx); writes.forEach(w=>w());
  }};
  return {db:db as unknown as Firestore,data,calls};
}
