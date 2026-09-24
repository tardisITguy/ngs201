import {normalizeRoomCode} from './joinRoom';
import type {GamePresenceRequest,GamePresenceResult} from '../types';

export const ACTIVE_GAME_PRESENCE_INTERVAL_MS=20_000;

export interface ActiveGamePresenceCallbacks{onError?:(error:unknown)=>void}
export interface ActiveGamePresenceEnvironment{
 setInterval:(callback:()=>void,delay:number)=>unknown;
 clearInterval:(handle:unknown)=>void;
 onVisibilityChange:(callback:()=>void)=>()=>void;
 onFocus:(callback:()=>void)=>()=>void;
 onOnline:(callback:()=>void)=>()=>void;
 isVisible:()=>boolean;
}
export interface ActiveGamePresenceDependencies{touch:(request:GamePresenceRequest)=>Promise<GamePresenceResult|undefined>;environment?:ActiveGamePresenceEnvironment}
export interface ActiveGamePresenceCoordinator{enter:(roomCode:string)=>void;leave:()=>void;touchNow:()=>Promise<void>;isCurrent:(roomCode:string)=>boolean}

const browserEnvironment=():ActiveGamePresenceEnvironment=>({
 setInterval:(callback,delay)=>window.setInterval(callback,delay),
 clearInterval:handle=>window.clearInterval(handle as number),
 onVisibilityChange:callback=>{document.addEventListener('visibilitychange',callback);return()=>document.removeEventListener('visibilitychange',callback);},
 onFocus:callback=>{window.addEventListener('focus',callback);return()=>window.removeEventListener('focus',callback);},
 onOnline:callback=>{window.addEventListener('online',callback);return()=>window.removeEventListener('online',callback);},
 isVisible:()=>document.visibilityState==='visible',
});

export function createActiveGamePresenceCoordinator(callbacks:ActiveGamePresenceCallbacks,dependencies:ActiveGamePresenceDependencies):ActiveGamePresenceCoordinator{
 const environment=dependencies.environment??browserEnvironment();let roomCode:string|undefined,generation=0,interval:unknown,inFlightGeneration:number|undefined,removeListeners:Array<()=>void>=[];
 const current=(code:string,token:number)=>roomCode===code&&generation===token;
 const run=async(code:string,token:number)=>{if(!current(code,token)||inFlightGeneration===token)return;inFlightGeneration=token;try{await dependencies.touch({roomCode:code});}catch(error){if(current(code,token))callbacks.onError?.(error);}finally{if(inFlightGeneration===token)inFlightGeneration=undefined;}};
 const leave=()=>{generation++;roomCode=undefined;inFlightGeneration=undefined;if(interval!==undefined){environment.clearInterval(interval);interval=undefined;}for(const remove of removeListeners)remove();removeListeners=[];};
 const enter=(value:string)=>{const normalized=normalizeRoomCode(value);if(roomCode===normalized)return;leave();roomCode=normalized;const token=++generation;const immediate=()=>{void run(normalized,token);};removeListeners=[environment.onVisibilityChange(()=>{if(environment.isVisible())immediate();}),environment.onFocus(immediate),environment.onOnline(immediate)];interval=environment.setInterval(immediate,ACTIVE_GAME_PRESENCE_INTERVAL_MS);immediate();};
 return{enter,leave,touchNow:async()=>{const code=roomCode,token=generation;if(code)await run(code,token);},isCurrent:value=>roomCode===normalizeRoomCode(value)};
}
