import {normalizeRoomCode} from './joinRoom';
import type {LobbyPresenceRequest,LobbyPresenceResult} from '../types';

export const ACTIVE_LOBBY_PRESENCE_INTERVAL_MS=20_000;

export interface ActiveLobbyPresenceCallbacks{onError?:(error:unknown)=>void}
export interface ActiveLobbyPresenceEnvironment{
 setInterval:(callback:()=>void,delay:number)=>unknown;
 clearInterval:(handle:unknown)=>void;
 onVisibilityChange:(callback:()=>void)=>()=>void;
 onFocus:(callback:()=>void)=>()=>void;
 onOnline:(callback:()=>void)=>()=>void;
 isVisible:()=>boolean;
}
export interface ActiveLobbyPresenceDependencies{touch:(request:LobbyPresenceRequest)=>Promise<LobbyPresenceResult|undefined>;environment?:ActiveLobbyPresenceEnvironment}
export interface ActiveLobbyPresenceCoordinator{enter:(roomCode:string)=>void;leave:()=>void;touchNow:()=>Promise<void>;isCurrent:(roomCode:string)=>boolean}

const browserEnvironment=():ActiveLobbyPresenceEnvironment=>({
 setInterval:(callback,delay)=>window.setInterval(callback,delay),
 clearInterval:handle=>window.clearInterval(handle as number),
 onVisibilityChange:callback=>{document.addEventListener('visibilitychange',callback);return()=>document.removeEventListener('visibilitychange',callback);},
 onFocus:callback=>{window.addEventListener('focus',callback);return()=>window.removeEventListener('focus',callback);},
 onOnline:callback=>{window.addEventListener('online',callback);return()=>window.removeEventListener('online',callback);},
 isVisible:()=>document.visibilityState==='visible',
});

export function createActiveLobbyPresenceCoordinator(callbacks:ActiveLobbyPresenceCallbacks,dependencies:ActiveLobbyPresenceDependencies):ActiveLobbyPresenceCoordinator{
 const environment=dependencies.environment??browserEnvironment();let roomCode:string|undefined,generation=0,interval:unknown,inFlightGeneration:number|undefined,removeListeners:Array<()=>void>=[];
 const current=(code:string,token:number)=>roomCode===code&&generation===token;
 const run=async(code:string,token:number)=>{if(!current(code,token)||inFlightGeneration===token)return;inFlightGeneration=token;try{await dependencies.touch({roomCode:code});}catch(error){if(current(code,token))callbacks.onError?.(error);}finally{if(inFlightGeneration===token)inFlightGeneration=undefined;}};
 const leave=()=>{generation++;roomCode=undefined;inFlightGeneration=undefined;if(interval!==undefined){environment.clearInterval(interval);interval=undefined;}for(const remove of removeListeners)remove();removeListeners=[];};
 const enter=(value:string)=>{const normalized=normalizeRoomCode(value);if(roomCode===normalized)return;leave();roomCode=normalized;const token=++generation;const touchIfVisible=()=>{if(environment.isVisible())void run(normalized,token);};removeListeners=[environment.onVisibilityChange(touchIfVisible),environment.onFocus(touchIfVisible),environment.onOnline(touchIfVisible)];interval=environment.setInterval(touchIfVisible,ACTIVE_LOBBY_PRESENCE_INTERVAL_MS);touchIfVisible();};
 return{enter,leave,touchNow:async()=>{const code=roomCode,token=generation;if(code&&environment.isVisible())await run(code,token);},isCurrent:value=>roomCode===normalizeRoomCode(value)};
}
