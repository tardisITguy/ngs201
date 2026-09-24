import type {Lobby} from './lobby';
import {normalizeRoomCode} from './joinRoom';

export interface ActiveRoomLobbyLifecycleCallbacks{onActiveMetadata(lobby:Lobby):void;onReturnedLobby(lobby:Lobby):Promise<void>|void}
export interface ActiveRoomLobbyLifecycle{enter(roomCode:string):void;accept(lobby:Lobby):void;leave():void;isCurrent(roomCode:string):boolean}

export function createActiveRoomLobbyLifecycle(callbacks:ActiveRoomLobbyLifecycleCallbacks):ActiveRoomLobbyLifecycle{let currentRoom:string|undefined,generation=0,transitioning=false;return{enter(value){const roomCode=normalizeRoomCode(value);if(currentRoom===roomCode)return;generation++;currentRoom=roomCode;transitioning=false;},accept(lobby){if(!currentRoom||lobby.room.code!==currentRoom)return;if(lobby.room.status==='active'){callbacks.onActiveMetadata(lobby);return;}if(lobby.room.status!=='lobby'||transitioning)return;transitioning=true;const token=generation;void Promise.resolve(callbacks.onReturnedLobby(lobby)).finally(()=>{if(token===generation&&currentRoom===lobby.room.code)transitioning=false;});},leave(){generation++;currentRoom=undefined;transitioning=false;},isCurrent(value){return currentRoom===normalizeRoomCode(value);}};}
