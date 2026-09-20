import {createClient} from 'npm:@supabase/supabase-js@2.116.0';

const corsHeaders={
 'Access-Control-Allow-Origin':'*',
 'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info',
 'Access-Control-Allow-Methods':'POST, OPTIONS',
 'Content-Type':'application/json',
};
const response=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:corsHeaders});
const defaultNamedKey=(environmentName:string):string|undefined=>{
 try{const parsed:unknown=JSON.parse(Deno.env.get(environmentName)??'{}');if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return;const value=(parsed as Record<string,unknown>).default;return typeof value==='string'&&value.trim()?value:undefined;}catch{return;}
};

Deno.serve(async request=>{
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:corsHeaders});
 if(request.method!=='POST')return response(405,{error:'Method not allowed'});
 const authorization=request.headers.get('Authorization'),token=authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
 if(!token)return response(401,{error:'Authentication required'});
 const supabaseUrl=Deno.env.get('SUPABASE_URL'),publishableKey=defaultNamedKey('SUPABASE_PUBLISHABLE_KEYS'),secretKey=defaultNamedKey('SUPABASE_SECRET_KEYS');
 if(!supabaseUrl||!publishableKey||!secretKey)return response(500,{error:'Server configuration error'});
 const userClient=createClient(supabaseUrl,publishableKey,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 const {data:{user},error:authError}=await userClient.auth.getUser(token);
 if(authError||!user)return response(401,{error:'Invalid or expired authentication'});

 let payload:unknown;
 try{payload=await request.json();}catch{return response(400,{error:'Request body must be valid JSON'});}
 if(!payload||typeof payload!=='object'||Array.isArray(payload))return response(400,{error:'Invalid Ready request'});
 const record=payload as Record<string,unknown>,keys=Object.keys(record);
 if(keys.some(key=>key!=='roomCode'&&key!=='isReady')||!keys.includes('roomCode')||!keys.includes('isReady'))return response(400,{error:'Invalid Ready request'});
 const {roomCode,isReady}=record;
 if(typeof roomCode!=='string'||typeof isReady!=='boolean')return response(400,{error:'Invalid Ready request'});
 const normalizedRoomCode=roomCode.trim().toUpperCase();
 if(!/^[A-Z0-9]{6,10}$/.test(normalizedRoomCode))return response(400,{error:'Invalid Ready request'});

 const serverClient=createClient(supabaseUrl,secretKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 const {data,error}=await serverClient.rpc('set_player_ready_server',{p_room_code:normalizedRoomCode,p_user_id:user.id,p_is_ready:isReady});
 if(error){
  if(error.code==='22023')return response(400,{error:'Invalid Ready request'});
  if(error.code==='P0004')return response(400,{error:'Choose a color before marking Ready.'});
  if(error.code==='P0002')return response(404,{error:'Room not found or unavailable'});
  return response(500,{error:'Unable to update Ready state'});
 }
 const result=Array.isArray(data)?data[0]:data;
 if(!result||typeof result!=='object')return response(500,{error:'Unable to update Ready state'});
 const value=result as Record<string,unknown>;
 if(typeof value.room_code!=='string'||typeof value.is_ready!=='boolean'||typeof value.changed!=='boolean')return response(500,{error:'Unable to update Ready state'});
 return response(200,{roomCode:value.room_code,isReady:value.is_ready,changed:value.changed});
});
