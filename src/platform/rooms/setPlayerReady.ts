import type {SupabaseClient} from '@supabase/supabase-js';
import {ensureAnonymousSession} from '../auth/session';
import {getSupabaseClient} from '../supabase/client';
import {normalizeRoomCode} from './joinRoom';
import type {SetPlayerReadyRequest,SetPlayerReadyResult} from '../types';

export class SetPlayerReadyError extends Error{
 constructor(message:string){super(message);this.name='SetPlayerReadyError'}
}
const errorStatus=(error:unknown)=>typeof error==='object'&&error!==null&&'context' in error&&typeof (error as {context?:{status?:unknown}}).context?.status==='number'?(error as {context:{status:number}}).context.status:undefined;

function validate(request:SetPlayerReadyRequest):SetPlayerReadyRequest{
 const roomCode=normalizeRoomCode(request.roomCode);
 if(!/^[A-Z0-9]{6,10}$/.test(roomCode))throw new SetPlayerReadyError('Invalid room code.');
 if(typeof request.isReady!=='boolean')throw new SetPlayerReadyError('Invalid Ready value.');
 return{roomCode,isReady:request.isReady};
}
function isResult(value:unknown):value is SetPlayerReadyResult{if(!value||typeof value!=='object')return false;const result=value as Record<string,unknown>;return typeof result.roomCode==='string'&&typeof result.isReady==='boolean'&&typeof result.changed==='boolean';}

export async function setPlayerReady(request:SetPlayerReadyRequest,client:SupabaseClient=getSupabaseClient()):Promise<SetPlayerReadyResult>{
 const body=validate(request);await ensureAnonymousSession(client);
 const {data,error}=await client.functions.invoke('set-player-ready',{body});
 if(error)throw new SetPlayerReadyError(errorStatus(error)===400?'Choose a color before marking Ready.':'Unable to update Ready state.');
 if(!isResult(data))throw new SetPlayerReadyError('Set Player Ready returned an invalid response.');
 return data;
}

export function createSetPlayerReadyAction(command:(request:SetPlayerReadyRequest)=>Promise<SetPlayerReadyResult>=setPlayerReady){let pending=false;return async(request:SetPlayerReadyRequest)=>{if(pending)return;pending=true;try{return await command(request);}finally{pending=false;}};}
