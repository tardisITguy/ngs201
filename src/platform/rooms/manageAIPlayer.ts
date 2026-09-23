import type {SupabaseClient} from '@supabase/supabase-js';
import {ensureAnonymousSession} from '../auth/session';
import {getSupabaseClient} from '../supabase/client';
import type {ManageAIPlayerRequest,ManageAIPlayerResult} from '../types';
import {normalizeRoomCode} from './joinRoom';

export class ManageAIPlayerError extends Error{constructor(message:string){super(message);this.name='ManageAIPlayerError'}}
const errorStatus=(error:unknown)=>typeof error==='object'&&error!==null&&'context' in error&&typeof (error as {context?:{status?:unknown}}).context?.status==='number'?(error as {context:{status:number}}).context.status:undefined;
export async function manageAIPlayer(request:ManageAIPlayerRequest,client:SupabaseClient=getSupabaseClient()):Promise<ManageAIPlayerResult>{
 const roomCode=normalizeRoomCode(request.roomCode);if(!/^[A-Z0-9]{6,10}$/.test(roomCode))throw new ManageAIPlayerError('Invalid AI player request.');await ensureAnonymousSession(client);
 const {data,error}=await client.functions.invoke('manage-ai-player',{body:{roomCode,command:request.command}});if(error){const status=errorStatus(error);throw new ManageAIPlayerError(status===403?'Only the host can manage AI players.':status===409?'AI player could not be changed.':'Unable to manage AI player.');}
 if(!data||typeof data!=='object'||typeof (data as Record<string,unknown>).roomCode!=='string')throw new ManageAIPlayerError('Unable to manage AI player.');return data as ManageAIPlayerResult;
}
export function createManageAIPlayerAction(command:(request:ManageAIPlayerRequest)=>Promise<ManageAIPlayerResult>=manageAIPlayer){let pending=false;return async(request:ManageAIPlayerRequest)=>{if(pending)return;pending=true;try{return await command(request);}finally{pending=false;}};}
