import {ensureAnonymousSession} from './auth/session';
export const PLAYER_DISPLAY_NAME_KEY='ngs.playerDisplayName';
export function validateDisplayName(value:string):string{const name=value.trim();if(name.length<1)return'Display name is required.';if(name.length>50)return'Display name must be 50 characters or fewer.';return'';}
export async function saveIdentity(value:string,storage:Pick<Storage,'setItem'>=localStorage,ensureSession=ensureAnonymousSession):Promise<string>{const displayName=value.trim(),error=validateDisplayName(displayName);if(error)throw new Error(error);await ensureSession();storage.setItem(PLAYER_DISPLAY_NAME_KEY,displayName);return displayName;}
export function getDisplayName(storage:Pick<Storage,'getItem'>=localStorage):string{const value=storage.getItem(PLAYER_DISPLAY_NAME_KEY)?.trim()??'';return validateDisplayName(value)?'':value;}
