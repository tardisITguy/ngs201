import {createRoom} from './createRoom';
import type {CreateRoomResult} from '../types';
export function createHostAction(command:(input:{gameSlug:string;displayName:string})=>Promise<CreateRoomResult>=createRoom){let pending=false;return async(displayName:string):Promise<CreateRoomResult|undefined>=>{if(pending)return;pending=true;try{return await command({gameSlug:'worship-me',displayName});}finally{pending=false;}};}
