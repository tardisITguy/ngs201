import type {SupabaseClient} from '@supabase/supabase-js';
import {ensureAnonymousSession} from '../auth/session';
import {getSupabaseClient} from '../supabase/client';
import {normalizeRoomCode} from './joinRoom';
import type {StartGameRequest,StartGameResult} from '../types';

export class StartGameError extends Error{constructor(message:string){super(message);this.name='StartGameError'}}
const errorStatus=(error:unknown)=>typeof error==='object'&&error!==null&&'context' in error&&typeof (error as {context?:{status?:unknown}}).context?.status==='number'?(error as {context:{status:number}}).context.status:undefined;
function isResult(value:unknown):value is StartGameResult{if(!value||typeof value!=='object')return false;const result=value as Record<string,unknown>;return typeof result.roomCode==='string'&&result.status==='active'&&typeof result.stateVersion==='number';}

export async function startGame(request:StartGameRequest,client:SupabaseClient=getSupabaseClient()):Promise<StartGameResult>{
 const roomCode=normalizeRoomCode(request.roomCode);if(!/^[A-Z0-9]{6,10}$/.test(roomCode))throw new StartGameError('Invalid room code.');await ensureAnonymousSession(client);
 const {data,error}=await client.functions.invoke('start-game',{body:{roomCode}});
 if(error){const status=errorStatus(error);throw new StartGameError(status===403?'Only the host can start the game.':status===409?'The lobby is not ready. Refresh and try again.':'Unable to start game.');}
 if(!isResult(data))throw new StartGameError('Start Game returned an invalid response.');return data;
}
export function createStartGameAction(command:(request:StartGameRequest)=>Promise<StartGameResult>=startGame){let pending=false;return async(request:StartGameRequest)=>{if(pending)return;pending=true;try{return await command(request);}finally{pending=false;}};}
