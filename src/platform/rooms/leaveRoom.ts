import type {SupabaseClient} from '@supabase/supabase-js';
import {ensureAnonymousSession} from '../auth/session';
import {getSupabaseClient} from '../supabase/client';
import {normalizeRoomCode} from './joinRoom';
import type {LeaveRoomRequest,LeaveRoomResult} from '../types';

export class LeaveRoomError extends Error{
 constructor(message:string){super(message);this.name='LeaveRoomError'}
}

function isResult(value:unknown):value is LeaveRoomResult{
 if(!value||typeof value!=='object')return false;
 const result=value as Record<string,unknown>;
 return result.completed===true;
}

export async function leaveRoom(request:LeaveRoomRequest,client:SupabaseClient=getSupabaseClient()):Promise<LeaveRoomResult>{
 const roomCode=normalizeRoomCode(request.roomCode);
 if(roomCode.length<6||roomCode.length>10||!/^[A-Z0-9]+$/.test(roomCode))throw new LeaveRoomError('Invalid room code.');
 await ensureAnonymousSession(client);
 const {data,error}=await client.functions.invoke('leave-room',{body:{roomCode}});
 if(error)throw new LeaveRoomError('Unable to leave lobby.');
 if(!isResult(data))throw new LeaveRoomError('Leave Lobby returned an invalid response.');
 return data;
}

export function createLeaveAction(command:(request:LeaveRoomRequest)=>Promise<LeaveRoomResult>=leaveRoom){
 let pending=false;
 return async(request:LeaveRoomRequest):Promise<LeaveRoomResult|undefined>=>{
  if(pending)return;
  pending=true;
  try{return await command(request);}finally{pending=false;}
 };
}
