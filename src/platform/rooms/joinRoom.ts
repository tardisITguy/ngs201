import type {SupabaseClient} from '@supabase/supabase-js';
import {ensureAnonymousSession} from '../auth/session';
import {getSupabaseClient} from '../supabase/client';
import type {JoinRoomRequest,JoinRoomResult} from '../types';

export class JoinRoomError extends Error {
 constructor(message:string){super(message);this.name='JoinRoomError'}
}

export function normalizeRoomCode(value:string):string{return value.trim().toUpperCase();}

async function functionErrorMessage(error:unknown):Promise<string|undefined>{const context=typeof error==='object'&&error!==null&&'context'in error?(error as {context?:unknown}).context:undefined;if(!(context instanceof Response))return;try{const body=await context.clone().json() as {error?:unknown};return typeof body.error==='string'?body.error:undefined;}catch{return;}}

function validatedRequest(request:JoinRoomRequest):JoinRoomRequest{
 const roomCode=normalizeRoomCode(request.roomCode);
 const displayName=request.displayName.trim();
 if(roomCode.length<6||roomCode.length>10||!/^[A-Z0-9]+$/.test(roomCode))throw new JoinRoomError('Enter a valid room code.');
 if(displayName.length<1||displayName.length>50)throw new JoinRoomError('Display name must be between 1 and 50 characters.');
 return{roomCode,displayName};
}

function isResult(value:unknown):value is JoinRoomResult{
 if(!value||typeof value!=='object')return false;
 const candidate=value as {room?:unknown;joinedNew?:unknown};
 const room=candidate.room;
 return!!room&&typeof room==='object'
  &&typeof (room as Record<string,unknown>).id==='string'
  &&typeof (room as Record<string,unknown>).code==='string'
  &&typeof (room as Record<string,unknown>).gameId==='string'
  &&(room as Record<string,unknown>).status==='lobby'
  &&typeof candidate.joinedNew==='boolean';
}

export async function joinRoom(request:JoinRoomRequest,client:SupabaseClient=getSupabaseClient()):Promise<JoinRoomResult>{
 const body=validatedRequest(request);
 await ensureAnonymousSession(client);
 const {data,error}=await client.functions.invoke('join-room',{body});
 if(error)throw new JoinRoomError((await functionErrorMessage(error))??'Unable to join room.');
 if(!isResult(data))throw new JoinRoomError('Join Room returned an invalid response.');
 return data;
}

export function createJoinAction(command:(request:JoinRoomRequest)=>Promise<JoinRoomResult>=joinRoom){
 let pending=false;
 return async(request:JoinRoomRequest):Promise<JoinRoomResult|undefined>=>{
  if(pending)return;
  pending=true;
  try{return await command(request);}finally{pending=false;}
 };
}
