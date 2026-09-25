import type {RoomChatMessage} from '../types';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isValidSenderDisplayName=(value:unknown)=>typeof value==='string'&&value===value.trim()&&[...value].length>=1&&[...value].length<=50;
const isValidMessageText=(value:unknown)=>typeof value==='string'&&value===value.trim()&&[...value].length>=1&&[...value].length<=500&&!/[\u0000-\u001f\u007f]/.test(value);
export const isRoomChatMessage=(value:unknown):value is RoomChatMessage=>{if(!value||typeof value!=='object'||Array.isArray(value))return false;const row=value as Record<string,unknown>;return uuid.test(String(row.id))&&uuid.test(String(row.roomId))&&isValidSenderDisplayName(row.senderDisplayName)&&isValidMessageText(row.messageText)&&typeof row.createdAt==='string'&&!Number.isNaN(Date.parse(row.createdAt))&&Object.keys(row).sort().join(',')==='createdAt,id,messageText,roomId,senderDisplayName';};
export const roomChatMessageFromRow=(value:unknown):RoomChatMessage|undefined=>{if(!value||typeof value!=='object'||Array.isArray(value))return;const row=value as Record<string,unknown>,message={id:row.id,roomId:row.room_id,senderDisplayName:row.sender_display_name,messageText:row.message_text,createdAt:row.created_at};return isRoomChatMessage(message)?message:undefined;};
export const compareRoomChatMessages=(a:RoomChatMessage,b:RoomChatMessage)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id);
