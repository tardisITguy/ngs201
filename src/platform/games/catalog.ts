import {ensureAnonymousSession} from '../auth/session';
import {getSupabaseClient} from '../supabase/client';
export interface CatalogGame{id:string;slug:string;name:string;status:'active'}
export class GamesCatalogError extends Error{constructor(){super('We could not load the games catalog.');this.name='GamesCatalogError'}}
export async function listActiveGames(client=getSupabaseClient()):Promise<CatalogGame[]>{await ensureAnonymousSession(client);const {data,error}=await client.from('games').select('id,slug,name,status').eq('status','active').order('name');if(error||!Array.isArray(data))throw new GamesCatalogError();return data.filter((game):game is CatalogGame=>!!game&&typeof game.id==='string'&&typeof game.slug==='string'&&typeof game.name==='string'&&game.status==='active');}
