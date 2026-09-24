import type {SupabaseClient} from '@supabase/supabase-js';
import {ensureAnonymousSession} from '../auth/session';
import {getSupabaseClient} from '../supabase/client';
import type {ManageLobbyRequest,ManageLobbyResult} from '../types';
import {normalizeRoomCode} from './joinRoom';

export class ManageLobbyError extends Error{constructor(message:string){super(message);this.name='ManageLobbyError'}}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const statusOf=(error:unknown)=>typeof error==='object'&&error!==null&&'context'in error&&typeof (error as {context?:{status?:unknown}}).context?.status==='number'?(error as {context:{status:number}}).context.status:undefined;
export async function manageLobby(request:ManageLobbyRequest,client:SupabaseClient=getSupabaseClient()):Promise<ManageLobbyResult>{const roomCode=normalizeRoomCode(request.roomCode);if(!/^[A-Z0-9]{6,10}$/.test(roomCode)||(request.command.type==='kickPlayer'&&!uuid.test(request.command.targetUserId)))throw new ManageLobbyError('Invalid lobby management request.');await ensureAnonymousSession(client);const {data,error}=await client.functions.invoke('manage-lobby',{body:{roomCode,command:request.command}});if(error){const status=statusOf(error);throw new ManageLobbyError(status===403?'Only the host can manage the lobby.':status===404?'Room or player not found or unavailable.':status===409?'Lobby is unavailable.':'Unable to manage lobby.');}if(!data||typeof data!=='object'||typeof (data as Record<string,unknown>).roomCode!=='string')throw new ManageLobbyError('Unable to manage lobby.');return data as ManageLobbyResult;}
export function createManageLobbyAction(command:(request:ManageLobbyRequest)=>Promise<ManageLobbyResult>=manageLobby){let pending=false;return async(request:ManageLobbyRequest)=>{if(pending)return;pending=true;try{return await command(request);}finally{pending=false;}};}
