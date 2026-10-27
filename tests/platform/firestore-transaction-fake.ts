import type { Firestore } from "@google-cloud/firestore";
/**
 * A Firestore double with the two transaction rules the platform's atomicity relies on: a read after a write inside a
 * transaction throws, and a transaction whose document reads changed before it commits is retried (optimistic concurrency).
 */
export function fakeFirestore(beforeGet?: () => void) {
  const data = new Map<string, unknown>();
  const calls: string[] = [];
  const versions = new Map<string, number>();
  const commit = (path: string, value: unknown) => { versions.set(path, (versions.get(path) ?? 0) + 1); data.set(path, structuredClone(value)); };
  function snap(path: string) { return {exists:data.has(path),data:()=>structuredClone(data.get(path))}; }
  function collection(path: string) {
    return {doc:(id:string)=>doc(`${path}/${id}`),limit:()=>({path,query:true,get:async()=>{const docs=[...data.entries()].filter(([p])=>p.startsWith(`${path}/`)&&!p.slice(path.length+1).includes("/")).map(([,v])=>({data:()=>structuredClone(v)}));return {size:docs.length,docs};}})};
  }
  function doc(path:string) {
    return {path,collection:(name:string)=>collection(`${path}/${name}`),get:async()=>snap(path),set:async(value:unknown)=>{commit(path,value);},create:async(value:unknown)=>{if(data.has(path))throw new Error("already exists");commit(path,value);}};
  }
  const db = {collection,runTransaction:async(fn:(tx:unknown)=>Promise<void>)=>{
    for(let attempt=0;attempt<8;attempt++){
      const writes:(()=>void)[]=[],reads=new Map<string,number>();
      const tx = {get:async(ref:ReturnType<typeof doc>)=>{calls.push("get");if(writes.length)throw new Error("read after write");beforeGet?.();if((ref as unknown as {query?:boolean}).query){const docs=[...data.entries()].filter(([p])=>p.startsWith(`${ref.path}/`)&&!p.slice(ref.path.length+1).includes("/")).map(([,v])=>({data:()=>structuredClone(v)}));return {size:docs.length,docs};}reads.set(ref.path,versions.get(ref.path)??0);return snap(ref.path);},create:(ref:ReturnType<typeof doc>,value:unknown)=>{calls.push("create");writes.push(()=>{if(data.has(ref.path))throw new Error("already exists");commit(ref.path,value);});},set:(ref:ReturnType<typeof doc>,value:unknown)=>{calls.push("set");writes.push(()=>commit(ref.path,value));},update:(ref:ReturnType<typeof doc>,value:Record<string,unknown>)=>{calls.push("update");writes.push(()=>commit(ref.path,{...(data.get(ref.path) as object),...value}));}};
      await fn(tx);
      if([...reads].some(([path,version])=>(versions.get(path)??0)!==version))continue;
      writes.forEach(w=>w());
      return;
    }
    throw new Error("transaction aborted after repeated contention");
  }};
  return {db:db as unknown as Firestore,data,calls};
}
