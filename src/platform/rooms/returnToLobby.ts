import type {SupabaseClient} from '@supabase/supabase-js';
import {ensureAnonymousSession} from '../auth/session';
import {getSupabaseClient} from '../supabase/client';
import type {ReturnToLobbyRequest,ReturnToLobbyResult} from '../types';
import {normalizeRoomCode} from './joinRoom';

export class ReturnToLobbyError extends Error{constructor(message:string){super(message);this.name='ReturnToLobbyError'}}
const errorMessage=async(error:unknown)=>{const context=typeof error==='object'&&error!==null&&'context'in error?(error as {context?:unknown}).context:undefined;if(context instanceof Response){try{const body=await context.clone().json() as {error?:unknown};if(typeof body.error==='string')return body.error;}catch{return;}}};
const isResult=(value:unknown):value is ReturnToLobbyResult=>{if(!value||typeof value!=='object'||Array.isArray(value))return false;const result=value as Record<string,unknown>;return Object.keys(result).sort().join(',')==='lobbyVersion,roomCode,status'&&typeof result.roomCode==='string'&&result.status==='lobby'&&Number.isSafeInteger(result.lobbyVersion)&&(result.lobbyVersion as number)>=0;};

export async function returnToLobby(request:ReturnToLobbyRequest,client:SupabaseClient=getSupabaseClient()):Promise<ReturnToLobbyResult>{const roomCode=normalizeRoomCode(request.roomCode);if(!/^[A-Z0-9]{6,10}$/.test(roomCode))throw new ReturnToLobbyError('Invalid return-to-lobby request.');await ensureAnonymousSession(client);const {data,error}=await client.functions.invoke('return-to-lobby',{body:{roomCode}});if(error)throw new ReturnToLobbyError((await errorMessage(error))??'Unable to return to lobby.');if(!isResult(data))throw new ReturnToLobbyError('Unable to return to lobby.');return data;}
export function createReturnToLobbyAction(command:(request:ReturnToLobbyRequest)=>Promise<ReturnToLobbyResult>=returnToLobby){let pending=false;return async(request:ReturnToLobbyRequest)=>{if(pending)return;pending=true;try{return await command(request);}finally{pending=false;}};}
