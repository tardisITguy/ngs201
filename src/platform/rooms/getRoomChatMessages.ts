import type {SupabaseClient} from '@supabase/supabase-js';
import {ensureAnonymousSession} from '../auth/session';
import {getSupabaseClient} from '../supabase/client';
import type {RoomChatMessage} from '../types';
import {compareRoomChatMessages,roomChatMessageFromRow} from './roomChatMessage';

export const ROOM_CHAT_HISTORY_LIMIT=100;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function getRoomChatMessages(roomId:string,client:SupabaseClient=getSupabaseClient()):Promise<RoomChatMessage[]>{if(!uuid.test(roomId))throw Error('Invalid room id.');await ensureAnonymousSession(client);const {data,error}=await client.from('room_chat_messages').select('id,room_id,sender_display_name,message_text,created_at').eq('room_id',roomId).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(ROOM_CHAT_HISTORY_LIMIT);if(error||!Array.isArray(data))throw Error('Unable to load chat history.');const messages=data.map(roomChatMessageFromRow);if(messages.some(message=>!message))throw Error('Unable to load chat history.');return(messages as RoomChatMessage[]).sort(compareRoomChatMessages);}
