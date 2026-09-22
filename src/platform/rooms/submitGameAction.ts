import type {SupabaseClient} from '@supabase/supabase-js';
import {ensureAnonymousSession} from '../auth/session';
import {getSupabaseClient} from '../supabase/client';
import {normalizeRoomCode} from './joinRoom';
import type {SubmitGameActionRequest,SubmitGameActionResult} from '../types';

export class GameActionError extends Error{constructor(message:string,readonly stale=false){super(message);this.name='GameActionError'}}
const errorStatus=(error:unknown)=>typeof error==='object'&&error!==null&&'context' in error&&typeof (error as {context?:{status?:unknown}}).context?.status==='number'?(error as {context:{status:number}}).context.status:undefined;
const isResult=(value:unknown):value is SubmitGameActionResult=>!!value&&typeof value==='object'&&typeof (value as SubmitGameActionResult).roomCode==='string'&&(value as SubmitGameActionResult).status==='active'&&Number.isSafeInteger((value as SubmitGameActionResult).stateVersion)&&typeof (value as SubmitGameActionResult).viewerPlayerId==='string'&&!!(value as SubmitGameActionResult).gameView;

export async function submitGameAction(request:SubmitGameActionRequest,client:SupabaseClient=getSupabaseClient()):Promise<SubmitGameActionResult>{
 const roomCode=normalizeRoomCode(request.roomCode);if(!/^[A-Z0-9]{6,10}$/.test(roomCode)||!Number.isSafeInteger(request.expectedStateVersion)||request.expectedStateVersion<1)throw new GameActionError('Invalid game action request.');await ensureAnonymousSession(client);
 const {data,error}=await client.functions.invoke('game-action',{body:{roomCode,expectedStateVersion:request.expectedStateVersion,command:request.command}});
 if(error){const status=errorStatus(error);if(status===409)throw new GameActionError('Game state changed. Refresh and try again.',true);if(status===403)throw new GameActionError('It is not your turn.');if(status===404)throw new GameActionError('Room not found or unavailable');if(status===400)throw new GameActionError('That action is not legal.');throw new GameActionError('Unable to update game.');}
 if(!isResult(data))throw new GameActionError('Unable to update game.');return data;
}
export function createSubmitGameAction(command:(request:SubmitGameActionRequest)=>Promise<SubmitGameActionResult>=submitGameAction){let pending=false;return async(request:SubmitGameActionRequest)=>{if(pending)return;pending=true;try{return await command(request);}finally{pending=false;}};}
