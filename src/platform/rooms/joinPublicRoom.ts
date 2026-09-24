import type {SupabaseClient} from '@supabase/supabase-js';
import {ensureAnonymousSession} from '../auth/session';
import {getSupabaseClient} from '../supabase/client';
import type {JoinPublicRoomRequest,JoinPublicRoomResult} from '../types';
import {normalizeRoomCode} from './joinRoom';

export class JoinPublicRoomError extends Error{constructor(message:string){super(message);this.name='JoinPublicRoomError'}}
const errorMessage=async(error:unknown)=>{const context=typeof error==='object'&&error!==null&&'context'in error?(error as {context?:unknown}).context:undefined;if(context instanceof Response){try{const body=await context.clone().json() as {error?:unknown};if(typeof body.error==='string')return body.error;}catch{return;}}};
const isResult=(value:unknown):value is JoinPublicRoomResult=>{if(!value||typeof value!=='object')return false;const result=value as Record<string,unknown>,room=result.room;if(!room||typeof room!=='object')return false;const record=room as Record<string,unknown>;return typeof record.id==='string'&&typeof record.code==='string'&&typeof record.gameId==='string'&&record.status==='lobby'&&typeof result.joinedNew==='boolean';};
export async function joinPublicRoom(request:JoinPublicRoomRequest,client:SupabaseClient=getSupabaseClient()):Promise<JoinPublicRoomResult>{const roomCode=normalizeRoomCode(request.roomCode),displayName=request.displayName.trim();if(!/^[A-Z0-9]{6,10}$/.test(roomCode)||displayName.length<1||displayName.length>50)throw new JoinPublicRoomError('Invalid room request.');await ensureAnonymousSession(client);const {data,error}=await client.functions.invoke('join-public-room',{body:{roomCode,displayName}});if(error)throw new JoinPublicRoomError((await errorMessage(error))??'Unable to join room.');if(!isResult(data))throw new JoinPublicRoomError('Unable to join room.');return data;}
export function createJoinPublicRoomAction(command:(request:JoinPublicRoomRequest)=>Promise<JoinPublicRoomResult>=joinPublicRoom){let pending=false;return async(request:JoinPublicRoomRequest)=>{if(pending)return;pending=true;try{return await command(request);}finally{pending=false;}};}
