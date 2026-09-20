import {createClient} from 'npm:@supabase/supabase-js@2.116.0';
import {buildWorshipMeInitialState,type TrustedStartPlayer} from './candidate.ts';

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
 let payload:unknown;try{payload=await request.json();}catch{return response(400,{error:'Request body must be valid JSON'});}
 if(!payload||typeof payload!=='object'||Array.isArray(payload))return response(400,{error:'Invalid Start request'});
 const record=payload as Record<string,unknown>,keys=Object.keys(record);
 if(keys.length!==1||keys[0]!=='roomCode'||typeof record.roomCode!=='string')return response(400,{error:'Invalid Start request'});
 const roomCode=record.roomCode.trim().toUpperCase();
 if(!/^[A-Z0-9]{6,10}$/.test(roomCode))return response(400,{error:'Invalid Start request'});

 const serverClient=createClient(supabaseUrl,secretKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 const roomResult=await serverClient.from('rooms').select('id,code,status,game_id,host_user_id').eq('code',roomCode).maybeSingle();
 if(roomResult.error||!roomResult.data)return response(404,{error:'Room not found or unavailable'});
 const membershipResult=await serverClient.from('room_players').select('user_id').eq('room_id',roomResult.data.id).eq('user_id',user.id).maybeSingle();
 if(membershipResult.error)return response(500,{error:'Unable to start game'});
 if(!membershipResult.data)return response(404,{error:'Room not found or unavailable'});
 if(roomResult.data.host_user_id!==user.id)return response(403,{error:'Only the host can start the game.'});
 if(roomResult.data.status!=='lobby')return response(409,{error:'This game has already started.'});
 const gameResult=await serverClient.from('games').select('id,slug,status,min_players,max_players').eq('id',roomResult.data.game_id).maybeSingle();
 if(gameResult.error||!gameResult.data||gameResult.data.status!=='active'||gameResult.data.slug!=='worship-me')return response(409,{error:'All players must choose a color and be Ready.'});
 const playerResult=await serverClient.from('room_players').select('user_id,display_name,player_color,is_ready,joined_at,turn_order').eq('room_id',roomResult.data.id).order('joined_at').order('user_id');
 if(playerResult.error||!Array.isArray(playerResult.data))return response(500,{error:'Unable to start game'});
 const players:TrustedStartPlayer[]=[];
 for(const value of playerResult.data){
  if(typeof value.user_id!=='string'||typeof value.display_name!=='string'||typeof value.player_color!=='string'||value.is_ready!==true||value.turn_order!==null)return response(409,{error:'All players must choose a color and be Ready.'});
  players.push({userId:value.user_id,displayName:value.display_name,playerColor:value.player_color});
 }
 if(players.length<gameResult.data.min_players||players.length>gameResult.data.max_players)return response(409,{error:'All players must choose a color and be Ready.'});
 const seed=crypto.randomUUID();
 let gameState:unknown;
 try{gameState=buildWorshipMeInitialState(players,seed);}catch{return response(409,{error:'All players must choose a color and be Ready.'});}
 const {data,error}=await serverClient.rpc('start_game_server',{p_room_code:roomCode,p_user_id:user.id,p_expected_players:players,p_game_state:gameState});
 if(error){
  if(error.code==='22023')return response(400,{error:'Invalid Start request'});
  if(error.code==='P0002')return response(404,{error:'Room not found or unavailable'});
  if(error.code==='P0003')return response(403,{error:'Only the host can start the game.'});
  if(error.code==='P0005')return response(409,{error:'This game has already started.'});
  if(error.code==='P0006')return response(409,{error:'The lobby changed. Refresh and try again.'});
  if(error.code==='P0004')return response(409,{error:'All players must choose a color and be Ready.'});
  return response(500,{error:'Unable to start game'});
 }
 const result=Array.isArray(data)?data[0]:data;
 if(!result||typeof result!=='object')return response(500,{error:'Unable to start game'});
 const value=result as Record<string,unknown>;
 if(typeof value.room_code!=='string'||value.room_status!=='active'||typeof value.state_version!=='number')return response(500,{error:'Unable to start game'});
 return response(200,{roomCode:value.room_code,status:value.room_status,stateVersion:value.state_version});
});
