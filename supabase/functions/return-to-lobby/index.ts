import {createClient} from 'npm:@supabase/supabase-js@2.116.0';

const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json'};
const response=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers});
const key=(name:string):string|undefined=>{try{const value=(JSON.parse(Deno.env.get(name)??'{}') as Record<string,unknown>).default;return typeof value==='string'&&value.trim()?value:undefined;}catch{return;}};
const exact=(value:Record<string,unknown>,keys:string[])=>Object.keys(value).sort().join(',')===[...keys].sort().join(',');

Deno.serve(async request=>{
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(request.method!=='POST')return response(405,{error:'Method not allowed'});
 const authorization=request.headers.get('Authorization'),token=authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
 if(!token)return response(401,{error:'Authentication required'});
 const url=Deno.env.get('SUPABASE_URL'),publishableKey=key('SUPABASE_PUBLISHABLE_KEYS'),secretKey=key('SUPABASE_SECRET_KEYS');
 if(!url||!publishableKey||!secretKey)return response(500,{error:'Server configuration error'});
 const userClient=createClient(url,publishableKey,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 const {data:{user},error:authError}=await userClient.auth.getUser(token);
 if(authError||!user)return response(401,{error:'Invalid or expired authentication'});
 let payload:unknown;
 try{payload=await request.json();}catch{return response(400,{error:'Invalid return-to-lobby request'});}
 if(!payload||typeof payload!=='object'||Array.isArray(payload))return response(400,{error:'Invalid return-to-lobby request'});
 const body=payload as Record<string,unknown>;
 if(!exact(body,['roomCode'])||typeof body.roomCode!=='string')return response(400,{error:'Invalid return-to-lobby request'});
 const roomCode=body.roomCode.trim().toUpperCase();
 if(!/^[A-Z0-9]{6,10}$/.test(roomCode))return response(400,{error:'Invalid return-to-lobby request'});
 const server=createClient(url,secretKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 const {data,error}=await server.rpc('return_finished_game_to_lobby_server',{p_room_code:roomCode,p_user_id:user.id});
 if(error){
  if(error.code==='22023')return response(400,{error:'Invalid return-to-lobby request'});
  if(error.code==='P0002')return response(404,{error:'Room not found or unavailable'});
  if(error.code==='P0003')return response(403,{error:'Only the host can return the room to the lobby.'});
  if(error.code==='P0004')return response(409,{error:'Game is not finished.'});
  return response(500,{error:'Unable to return to lobby'});
 }
 const row=(Array.isArray(data)?data[0]:data) as Record<string,unknown>|undefined;
 if(!row||typeof row.room_code!=='string'||row.room_status!=='lobby'||!Number.isSafeInteger(row.lobby_version)||(row.lobby_version as number)<0)return response(500,{error:'Unable to return to lobby'});
 return response(200,{roomCode:row.room_code,status:'lobby',lobbyVersion:row.lobby_version});
});
