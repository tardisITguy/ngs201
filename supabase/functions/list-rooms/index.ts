import {createClient} from 'npm:@supabase/supabase-js@2.116.0';

const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json'};
const response=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers});
const key=(name:string):string|undefined=>{try{const value=(JSON.parse(Deno.env.get(name)??'{}') as Record<string,unknown>).default;return typeof value==='string'&&value.trim()?value:undefined;}catch{return;}};
const exact=(value:Record<string,unknown>,keys:string[])=>Object.keys(value).sort().join(',')===[...keys].sort().join(',');

Deno.serve(async request=>{
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(request.method!=='POST')return response(405,{error:'Method not allowed'});
 const authorization=request.headers.get('Authorization'),token=authorization?.match(/^Bearer\s+(.+)$/i)?.[1];if(!token)return response(401,{error:'Authentication required'});
 const url=Deno.env.get('SUPABASE_URL'),publishableKey=key('SUPABASE_PUBLISHABLE_KEYS'),secretKey=key('SUPABASE_SECRET_KEYS');if(!url||!publishableKey||!secretKey)return response(500,{error:'Server configuration error'});
 const userClient=createClient(url,publishableKey,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});const {data:{user},error:authError}=await userClient.auth.getUser(token);if(authError||!user)return response(401,{error:'Invalid or expired authentication'});
 let payload:unknown;try{payload=await request.json();}catch{return response(400,{error:'Invalid room directory request'});}if(!payload||typeof payload!=='object'||Array.isArray(payload))return response(400,{error:'Invalid room directory request'});const body=payload as Record<string,unknown>;if(!exact(body,['gameSlug'])||body.gameSlug!=='worship-me')return response(400,{error:'Invalid room directory request'});
 const server=createClient(url,secretKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});const {data,error}=await server.rpc('list_joinable_rooms_server',{p_game_slug:body.gameSlug,p_user_id:user.id});if(error)return response(error.code==='22023'?400:500,{error:error.code==='22023'?'Invalid room directory request':'Unable to load rooms'});
 if(!Array.isArray(data))return response(500,{error:'Unable to load rooms'});const rooms=data.map(value=>{const row=value as Record<string,unknown>;return{roomCode:row.room_code,roomName:row.room_name,hostDisplayName:row.host_display_name,humanPlayers:row.human_players,aiPlayers:row.ai_players,totalPlayers:row.total_players,maxPlayers:row.max_players,createdAt:row.created_at};});return response(200,{rooms});
});
