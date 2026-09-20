import type {SupabaseClient} from '@supabase/supabase-js';
import {ensureAnonymousSession} from '../auth/session';
import {getSupabaseClient} from '../supabase/client';
import {normalizeRoomCode} from './joinRoom';
import type {SetPlayerColorRequest,SetPlayerColorResult} from '../types';

export class SetPlayerColorError extends Error{
 constructor(message:string){super(message);this.name='SetPlayerColorError'}
}
const errorStatus=(error:unknown)=>typeof error==='object'&&error!==null&&'context' in error&&typeof (error as {context?:{status?:unknown}}).context?.status==='number'?(error as {context:{status:number}}).context.status:undefined;

function validate(request:SetPlayerColorRequest):SetPlayerColorRequest{
 const roomCode=normalizeRoomCode(request.roomCode),playerColor=request.playerColor;
 if(!/^[A-Z0-9]{6,10}$/.test(roomCode))throw new SetPlayerColorError('Invalid room code.');
 if(playerColor!==null&&!/^[a-z][a-z0-9-]{0,39}$/.test(playerColor))throw new SetPlayerColorError('Invalid player color.');
 return{roomCode,playerColor};
}
function isResult(value:unknown):value is SetPlayerColorResult{if(!value||typeof value!=='object')return false;const result=value as Record<string,unknown>;return typeof result.roomCode==='string'&&(result.playerColor===null||typeof result.playerColor==='string')&&typeof result.changed==='boolean';}

export async function setPlayerColor(request:SetPlayerColorRequest,client:SupabaseClient=getSupabaseClient()):Promise<SetPlayerColorResult>{
 const body=validate(request);await ensureAnonymousSession(client);
 const {data,error}=await client.functions.invoke('set-player-color',{body});
 if(error)throw new SetPlayerColorError(errorStatus(error)===409?'That color is no longer available.':'Unable to update player color.');
 if(!isResult(data))throw new SetPlayerColorError('Set Player Color returned an invalid response.');
 return data;
}

export function createSetPlayerColorAction(command:(request:SetPlayerColorRequest)=>Promise<SetPlayerColorResult>=setPlayerColor){let pending=false;return async(request:SetPlayerColorRequest)=>{if(pending)return;pending=true;try{return await command(request);}finally{pending=false;}};}
