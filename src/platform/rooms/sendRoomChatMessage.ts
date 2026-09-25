import type {SupabaseClient} from '@supabase/supabase-js';
import {ensureAnonymousSession} from '../auth/session';
import {getSupabaseClient} from '../supabase/client';
import type {RoomChatMessage,SendRoomChatMessageRequest} from '../types';
import {normalizeRoomCode} from './joinRoom';
import {isRoomChatMessage} from './roomChatMessage';

export class RoomChatSendError extends Error{constructor(message='Unable to send message.'){super(message);this.name='RoomChatSendError';}}
const statusOf=(error:unknown)=>typeof error==='object'&&error!==null&&'context'in error&&typeof (error as {context?:{status?:unknown}}).context?.status==='number'?(error as {context:{status:number}}).context.status:undefined;
export async function sendRoomChatMessage(request:SendRoomChatMessageRequest,client:SupabaseClient=getSupabaseClient()):Promise<RoomChatMessage>{const roomCode=normalizeRoomCode(request.roomCode);if(!/^[A-Z0-9]{6,10}$/.test(roomCode)||/[\u0000-\u001f\u007f]/.test(request.messageText))throw new RoomChatSendError('Invalid chat message.');const messageText=request.messageText.trim();if([...messageText].length<1||[...messageText].length>500)throw new RoomChatSendError('Invalid chat message.');await ensureAnonymousSession(client);const {data,error}=await client.functions.invoke('send-chat-message',{body:{roomCode,messageText}});if(error){const status=statusOf(error);throw new RoomChatSendError(status===429?"You're sending messages too quickly.":status===404?'Room not found or unavailable':status===409?'Room does not allow chat':'Unable to send message.');}if(!isRoomChatMessage(data))throw new RoomChatSendError();return data;}
export function createSendRoomChatMessageAction(command:(request:SendRoomChatMessageRequest)=>Promise<RoomChatMessage>=sendRoomChatMessage){let pending=false;return async(request:SendRoomChatMessageRequest)=>{if(pending)return;pending=true;try{return await command(request);}finally{pending=false;}};}
