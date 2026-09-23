import {createClient} from 'npm:@supabase/supabase-js@2.116.0';

const corsHeaders={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json'};
const response=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:corsHeaders});
const defaultNamedKey=(name:string):string|undefined=>{try{const parsed:unknown=JSON.parse(Deno.env.get(name)??'{}');if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return;const value=(parsed as Record<string,unknown>).default;return typeof value==='string'&&value.trim()?value:undefined;}catch{return;}};
const exact=(record:Record<string,unknown>,keys:string[])=>{const actual=Object.keys(record).sort(),expected=[...keys].sort();return actual.length===expected.length&&actual.every((key,index)=>key===expected[index]);};
const uuid=(value:unknown)=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

Deno.serve(async request=>{
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:corsHeaders});if(request.method!=='POST')return response(405,{error:'Method not allowed'});
 const authorization=request.headers.get('Authorization'),token=authorization?.match(/^Bearer\s+(.+)$/i)?.[1];if(!token)return response(401,{error:'Authentication required'});
 const supabaseUrl=Deno.env.get('SUPABASE_URL'),publishableKey=defaultNamedKey('SUPABASE_PUBLISHABLE_KEYS'),secretKey=defaultNamedKey('SUPABASE_SECRET_KEYS');if(!supabaseUrl||!publishableKey||!secretKey)return response(500,{error:'Server configuration error'});
 const userClient=createClient(supabaseUrl,publishableKey,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});const {data:{user},error:authError}=await userClient.auth.getUser(token);if(authError||!user)return response(401,{error:'Invalid or expired authentication'});
 let payload:unknown;try{payload=await request.json();}catch{return response(400,{error:'Invalid lobby seat request'});}if(!payload||typeof payload!=='object'||Array.isArray(payload))return response(400,{error:'Invalid lobby seat request'});
 const body=payload as Record<string,unknown>;if(!exact(body,['roomCode','command'])||typeof body.roomCode!=='string'||!body.command||typeof body.command!=='object'||Array.isArray(body.command))return response(400,{error:'Invalid lobby seat request'});
 const roomCode=body.roomCode.trim().toUpperCase(),command=body.command as Record<string,unknown>;if(!/^[A-Z0-9]{6,10}$/.test(roomCode)||typeof command.type!=='string')return response(400,{error:'Invalid AI player request'});
 let rpc:string,args:Record<string,unknown>={p_room_code:roomCode,p_user_id:user.id};
 if(command.type==='addAI'&&exact(command,['type']))rpc='add_room_ai_player_server';
 else if(command.type==='removeAI'&&exact(command,['type','aiPlayerId'])&&uuid(command.aiPlayerId)){rpc='remove_room_ai_player_server';args={...args,p_ai_player_id:command.aiPlayerId};}
 else if(command.type==='setAIColor'&&exact(command,['type','aiPlayerId','playerColor'])&&uuid(command.aiPlayerId)&&typeof command.playerColor==='string'&&/^[a-z][a-z0-9-]{0,39}$/.test(command.playerColor)){rpc='set_room_ai_player_color_server';args={...args,p_ai_player_id:command.aiPlayerId,p_player_color:command.playerColor};}
 else if(command.type==='setAIStrategy'&&exact(command,['type','aiPlayerId','botStrategy'])&&uuid(command.aiPlayerId)&&['random','growth','templeRush','balanced'].includes(command.botStrategy as string)){rpc='set_room_ai_player_strategy_server';args={...args,p_ai_player_id:command.aiPlayerId,p_bot_strategy:command.botStrategy};}
 else return response(400,{error:'Invalid lobby seat request'});
 const serverClient=createClient(supabaseUrl,secretKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});const {data,error}=await serverClient.rpc(rpc,args);
 if(error){if(error.code==='22023')return response(400,{error:'Invalid AI player request'});if(error.code==='P0002')return response(404,{error:'Room or AI player not found or unavailable'});if(error.code==='P0003')return response(403,{error:'Only the host can manage AI players.'});if(error.code==='P0004')return response(409,{error:'AI players can only be changed in the lobby.'});if(error.code==='P0005')return response(409,{error:'The requested AI player is unavailable.'});if(error.code==='P0006')return response(409,{error:'That color is no longer available.'});return response(500,{error:'Unable to manage AI player'});}
 const value=Array.isArray(data)?data[0]:data;if(!value||typeof value!=='object')return response(500,{error:'Unable to manage AI player'});return response(200,{roomCode,...(value as Record<string,unknown>)});
});
