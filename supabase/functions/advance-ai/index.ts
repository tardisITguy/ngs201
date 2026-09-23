import {createClient} from 'npm:@supabase/supabase-js@2.116.0';
import {advanceOneAIDecision} from '../../../src/games/worship-me/ai/advance.ts';
import {buildWorshipMePublicGameView} from '../../../src/games/worship-me/publicGameView.ts';

const corsHeaders={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json'};
const response=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:corsHeaders});
const defaultNamedKey=(name:string):string|undefined=>{try{const parsed:unknown=JSON.parse(Deno.env.get(name)??'{}');if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return;const value=(parsed as Record<string,unknown>).default;return typeof value==='string'&&value.trim()?value:undefined;}catch{return;}};

Deno.serve(async request=>{
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:corsHeaders});if(request.method!=='POST')return response(405,{error:'Method not allowed'});
 const authorization=request.headers.get('Authorization'),token=authorization?.match(/^Bearer\s+(.+)$/i)?.[1];if(!token)return response(401,{error:'Authentication required'});
 const supabaseUrl=Deno.env.get('SUPABASE_URL'),publishableKey=defaultNamedKey('SUPABASE_PUBLISHABLE_KEYS'),secretKey=defaultNamedKey('SUPABASE_SECRET_KEYS');if(!supabaseUrl||!publishableKey||!secretKey)return response(500,{error:'Server configuration error'});
 const userClient=createClient(supabaseUrl,publishableKey,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});const {data:{user},error:authError}=await userClient.auth.getUser(token);if(authError||!user)return response(401,{error:'Invalid or expired authentication'});
 let payload:unknown;try{payload=await request.json();}catch{return response(400,{error:'Invalid AI advance request'});}if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).length!==1||typeof (payload as Record<string,unknown>).roomCode!=='string')return response(400,{error:'Invalid AI advance request'});
 const roomCode=((payload as Record<string,unknown>).roomCode as string).trim().toUpperCase();if(!/^[A-Z0-9]{6,10}$/.test(roomCode))return response(400,{error:'Invalid AI advance request'});
 const serverClient=createClient(supabaseUrl,secretKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 let finalRow:Record<string,unknown>|undefined,commits=0,staleRetries=0;
 while(commits<128){
  const {data,error}=await serverClient.rpc('get_active_game_state_server',{p_room_code:roomCode,p_user_id:user.id});if(error){if(error.code==='P0002')return response(404,{error:'Room not found or unavailable'});if(error.code==='P0004')return response(409,{error:'Game is not active'});return response(500,{error:'Game state is unavailable'});}
  const row=(Array.isArray(data)?data[0]:data) as Record<string,unknown>|undefined;if(!row||row.room_status!=='active'||!Number.isSafeInteger(row.state_version)||!Number.isInteger(row.viewer_turn_order))return response(500,{error:'Game state is unavailable'});finalRow=row;
  let decision;try{decision=advanceOneAIDecision(row.game_state);}catch{return response(500,{error:'AI turn could not advance.'});}
  if(!decision.advanced)break;
  const {data:commitData,error:commitError}=await serverClient.rpc('commit_ai_action_server',{p_room_code:roomCode,p_user_id:user.id,p_expected_state_version:row.state_version,p_expected_ai_player_id:decision.playerId,p_next_game_state:decision.state});
  if(commitError){if(commitError.code==='P0006'&&staleRetries++<16)continue;if(commitError.code==='P0002')return response(404,{error:'Room not found or unavailable'});if(commitError.code==='P0004')return response(409,{error:'Game is not active'});return response(500,{error:'AI turn could not advance.'});}
  staleRetries=0;commits++;const committed=(Array.isArray(commitData)?commitData[0]:commitData) as Record<string,unknown>|undefined;if(!committed||!Number.isSafeInteger(committed.state_version))return response(500,{error:'AI turn could not advance.'});
 }
 if(commits>=128)return response(500,{error:'AI turn could not advance.'});
 const {data:latestData,error:latestError}=await serverClient.rpc('get_active_game_state_server',{p_room_code:roomCode,p_user_id:user.id});if(latestError)return response(500,{error:'Game state is unavailable'});finalRow=(Array.isArray(latestData)?latestData[0]:latestData) as Record<string,unknown>|undefined;
 if(!finalRow||typeof finalRow.room_code!=='string'||finalRow.room_status!=='active'||!Number.isSafeInteger(finalRow.state_version)||!Number.isInteger(finalRow.viewer_turn_order))return response(500,{error:'Game state is unavailable'});
 try{const gameView=buildWorshipMePublicGameView(finalRow.game_state),viewerPlayerId=`p${(finalRow.viewer_turn_order as number)+1}`;return response(200,{roomCode:finalRow.room_code,status:'active',stateVersion:finalRow.state_version,viewerPlayerId,gameView});}catch{return response(500,{error:'Game state is unavailable'});}
});
