import {createClient} from 'npm:@supabase/supabase-js@2.116.0';

const corsHeaders={
 'Access-Control-Allow-Origin':'*',
 'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info',
 'Access-Control-Allow-Methods':'POST, OPTIONS',
 'Content-Type':'application/json',
};

const response=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:corsHeaders});

const defaultNamedKey=(environmentName:string):string|undefined=>{
 try{
  const parsed:unknown=JSON.parse(Deno.env.get(environmentName)??'{}');
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return undefined;
  const value=(parsed as Record<string,unknown>).default;
  return typeof value==='string'&&value.trim().length>0?value:undefined;
 }catch{return undefined;}
};

Deno.serve(async request=>{
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:corsHeaders});
 if(request.method!=='POST')return response(405,{error:'Method not allowed'});

 const authorization=request.headers.get('Authorization');
 const token=authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
 if(!token)return response(401,{error:'Authentication required'});

 const supabaseUrl=Deno.env.get('SUPABASE_URL');
 const publishableKey=defaultNamedKey('SUPABASE_PUBLISHABLE_KEYS');
 const secretKey=defaultNamedKey('SUPABASE_SECRET_KEYS');
 if(!supabaseUrl||!publishableKey||!secretKey)return response(500,{error:'Server configuration error'});

 const userClient=createClient(supabaseUrl,publishableKey,{
  global:{headers:{Authorization:authorization}},
  auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
 });
 const {data:{user},error:authError}=await userClient.auth.getUser(token);
 if(authError||!user)return response(401,{error:'Invalid or expired authentication'});

 let payload:unknown;
 try{payload=await request.json()}catch{return response(400,{error:'Request body must be valid JSON'});}
 if(!payload||typeof payload!=='object'||Array.isArray(payload))return response(400,{error:'Invalid request body'});
 const {roomCode,displayName}=payload as Record<string,unknown>;
 if(typeof roomCode!=='string')return response(400,{error:'Invalid room request'});
 const normalizedRoomCode=roomCode.trim().toUpperCase();
 if(normalizedRoomCode.length<6||normalizedRoomCode.length>10||!/^[A-Z0-9]+$/.test(normalizedRoomCode))return response(400,{error:'Invalid room request'});
 if(typeof displayName!=='string')return response(400,{error:'Invalid room request'});
 const trimmedDisplayName=displayName.trim();
 if(trimmedDisplayName.length<1||trimmedDisplayName.length>50)return response(400,{error:'Invalid room request'});

 const serverClient=createClient(supabaseUrl,secretKey,{
  auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
 });
 const {data,error}=await serverClient.rpc('join_room_server',{
  p_room_code:normalizedRoomCode,
  p_user_id:user.id,
  p_display_name:trimmedDisplayName,
 });
 if(error){
  if(error.code==='22023')return response(400,{error:'Invalid room request'});
  if(error.code==='P0002')return response(404,{error:'Room not found or unavailable'});
  if(error.code==='P0003')return response(409,{error:'Room is full'});
  return response(500,{error:'Unable to join room'});
 }
 const record=Array.isArray(data)?data[0]:data;
 if(!record||typeof record!=='object')return response(500,{error:'Unable to join room'});
 const room=record as Record<string,unknown>;
 if(typeof room.room_id!=='string'||typeof room.room_code!=='string'||typeof room.game_id!=='string'||room.status!=='lobby'||typeof room.joined_new!=='boolean')return response(500,{error:'Unable to join room'});

 return response(200,{room:{id:room.room_id,code:room.room_code,gameId:room.game_id,status:'lobby'},joinedNew:room.joined_new});
});
