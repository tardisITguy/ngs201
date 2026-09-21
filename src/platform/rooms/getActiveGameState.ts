import type {SupabaseClient} from '@supabase/supabase-js';
import {ensureAnonymousSession} from '../auth/session';
import {getSupabaseClient} from '../supabase/client';
import {normalizeRoomCode} from './joinRoom';
import type {ActiveGameStateRequest,ActiveGameStateResult} from '../types';

export class ActiveGameStateError extends Error{constructor(message:string){super(message);this.name='ActiveGameStateError'}}
const errorStatus=(error:unknown)=>typeof error==='object'&&error!==null&&'context' in error&&typeof (error as {context?:{status?:unknown}}).context?.status==='number'?(error as {context:{status:number}}).context.status:undefined;
const isResult=(value:unknown):value is ActiveGameStateResult=>!!value&&typeof value==='object'&&typeof (value as ActiveGameStateResult).roomCode==='string'&&(value as ActiveGameStateResult).status==='active'&&typeof (value as ActiveGameStateResult).stateVersion==='number'&&typeof (value as ActiveGameStateResult).viewerPlayerId==='string'&&!!(value as ActiveGameStateResult).gameView;

export async function getActiveGameState(request:ActiveGameStateRequest,client:SupabaseClient=getSupabaseClient()):Promise<ActiveGameStateResult>{
 const roomCode=normalizeRoomCode(request.roomCode);if(!/^[A-Z0-9]{6,10}$/.test(roomCode))throw new ActiveGameStateError('Invalid room code.');await ensureAnonymousSession(client);
 const {data,error}=await client.functions.invoke('get-game-state',{body:{roomCode}});
 if(error){const status=errorStatus(error);throw new ActiveGameStateError(status===404?'Room not found or unavailable':status===409?'Game is not active':'Game state is unavailable');}
 if(!isResult(data))throw new ActiveGameStateError('Game state is unavailable');return data;
}
export function createGetActiveGameStateAction(command:(request:ActiveGameStateRequest)=>Promise<ActiveGameStateResult>=getActiveGameState){let pending=false;return async(request:ActiveGameStateRequest)=>{if(pending)return;pending=true;try{return await command(request);}finally{pending=false;}};}
