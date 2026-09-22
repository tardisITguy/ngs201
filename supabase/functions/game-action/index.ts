import {createClient} from 'npm:@supabase/supabase-js@2.116.0';
import {buildWorshipMePublicGameView} from '../../../src/games/worship-me/publicGameView.ts';
import {applyTrustedWorshipMeCommand,parseWorshipMeBrowserCommand} from '../../../src/games/worship-me/trustedGameCommand.ts';

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

 let payload:unknown;try{payload=await request.json();}catch{return response(400,{error:'Invalid game action request'});}
 if(!payload||typeof payload!=='object'||Array.isArray(payload))return response(400,{error:'Invalid game action request'});
 const record=payload as Record<string,unknown>,keys=Object.keys(record).sort();
 if(keys.length!==3||keys[0]!=='command'||keys[1]!=='expectedStateVersion'||keys[2]!=='roomCode'||typeof record.roomCode!=='string'||!Number.isSafeInteger(record.expectedStateVersion)||(record.expectedStateVersion as number)<1)return response(400,{error:'Invalid game action request'});
 const roomCode=record.roomCode.trim().toUpperCase();
 if(!/^[A-Z0-9]{6,10}$/.test(roomCode))return response(400,{error:'Invalid game action request'});
 let command;try{command=parseWorshipMeBrowserCommand(record.command);}catch{return response(400,{error:'Invalid game action request'});}
 const expectedStateVersion=record.expectedStateVersion as number;

 const serverClient=createClient(supabaseUrl,secretKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 const {data:readData,error:readError}=await serverClient.rpc('get_active_game_state_server',{p_room_code:roomCode,p_user_id:user.id});
 if(readError){if(readError.code==='P0002')return response(404,{error:'Room not found or unavailable'});if(readError.code==='P0004')return response(409,{error:'Game is not active'});return response(500,{error:'Game state is unavailable'});}
 const readRow=Array.isArray(readData)?readData[0]:readData;
 if(!readRow||typeof readRow!=='object')return response(500,{error:'Game state is unavailable'});
 const current=readRow as Record<string,unknown>;
 if(current.room_status!=='active'||typeof current.room_code!=='string'||!Number.isSafeInteger(current.state_version)||!Number.isInteger(current.viewer_turn_order)||typeof current.viewer_turn_order!=='number'||current.viewer_turn_order<0)return response(500,{error:'Game state is unavailable'});
 if(current.state_version!==expectedStateVersion)return response(409,{error:'Game state changed. Refresh and try again.'});
 const viewerPlayerId=`p${current.viewer_turn_order+1}`;
 let candidate:unknown;
 try{candidate=applyTrustedWorshipMeCommand(current.game_state,command,viewerPlayerId);}catch{return response(400,{error:'That action is not legal.'});}
 let gameView;
 try{gameView=buildWorshipMePublicGameView(candidate);}catch{return response(500,{error:'Game state is unavailable'});}

 const {data:commitData,error:commitError}=await serverClient.rpc('commit_game_action_server',{p_room_code:roomCode,p_user_id:user.id,p_expected_state_version:expectedStateVersion,p_next_game_state:candidate});
 if(commitError){if(commitError.code==='P0002')return response(404,{error:'Room not found or unavailable'});if(commitError.code==='P0003')return response(403,{error:'It is not your turn.'});if(commitError.code==='P0004')return response(409,{error:'Game is not active'});if(commitError.code==='P0005')return response(500,{error:'Game state is unavailable'});if(commitError.code==='P0006')return response(409,{error:'Game state changed. Refresh and try again.'});if(commitError.code==='22023')return response(400,{error:'That action is not legal.'});return response(500,{error:'Unable to update game'});}
 const commitRow=Array.isArray(commitData)?commitData[0]:commitData;
 if(!commitRow||typeof commitRow!=='object')return response(500,{error:'Unable to update game'});
 const committed=commitRow as Record<string,unknown>;
 if(typeof committed.room_code!=='string'||committed.room_status!=='active'||committed.state_version!==expectedStateVersion+1||committed.viewer_turn_order!==current.viewer_turn_order)return response(500,{error:'Unable to update game'});
 return response(200,{roomCode:committed.room_code,status:'active',stateVersion:committed.state_version,viewerPlayerId,gameView});
});
