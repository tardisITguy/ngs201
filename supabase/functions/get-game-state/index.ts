import {createClient} from 'npm:@supabase/supabase-js@2.116.0';
import {buildWorshipMePublicGameView} from '../../../src/games/worship-me/publicGameView.ts';

const corsHeaders={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json'};
const response=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:corsHeaders});
const defaultNamedKey=(name:string):string|undefined=>{try{const parsed:unknown=JSON.parse(Deno.env.get(name)??'{}');if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return;const value=(parsed as Record<string,unknown>).default;return typeof value==='string'&&value.trim()?value:undefined;}catch{return;}};

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
 let payload:unknown;try{payload=await request.json();}catch{return response(400,{error:'Invalid game-state request'});}
 if(!payload||typeof payload!=='object'||Array.isArray(payload))return response(400,{error:'Invalid game-state request'});
 const record=payload as Record<string,unknown>,keys=Object.keys(record);
 if(keys.length!==1||keys[0]!=='roomCode'||typeof record.roomCode!=='string')return response(400,{error:'Invalid game-state request'});
 const roomCode=record.roomCode.trim().toUpperCase();
 if(!/^[A-Z0-9]{6,10}$/.test(roomCode))return response(400,{error:'Invalid game-state request'});

 const serverClient=createClient(supabaseUrl,secretKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 const {data,error}=await serverClient.rpc('get_active_game_state_server',{p_room_code:roomCode,p_user_id:user.id});
 if(error){if(error.code==='22023')return response(400,{error:'Invalid game-state request'});if(error.code==='P0002')return response(404,{error:'Room not found or unavailable'});if(error.code==='P0004')return response(409,{error:'Game is not active'});return response(500,{error:'Game state is unavailable'});}
 const row=Array.isArray(data)?data[0]:data;
 if(!row||typeof row!=='object')return response(500,{error:'Game state is unavailable'});
 const value=row as Record<string,unknown>;
 if(typeof value.room_code!=='string'||value.room_status!=='active'||typeof value.state_version!=='number'||!Number.isInteger(value.viewer_turn_order)||typeof value.viewer_turn_order!=='number'||value.viewer_turn_order<0)return response(500,{error:'Game state is unavailable'});
 try{
  const gameView=buildWorshipMePublicGameView(value.game_state),viewerPlayerId=`p${value.viewer_turn_order+1}`;
  if(!gameView.players.some(player=>player.id===viewerPlayerId))throw Error('Invalid viewer mapping');
  return response(200,{roomCode:value.room_code,status:'active',stateVersion:value.state_version,viewerPlayerId,gameView});
 }catch{return response(500,{error:'Game state is unavailable'});}
});
