import type {Session,User,SupabaseClient} from '@supabase/supabase-js';
import {getSupabaseClient} from '../supabase/client';

export interface AuthenticatedPlatformSession {session:Session;user:User}

export class PlatformAuthError extends Error {
 constructor(message:string,readonly cause?:unknown){super(message);this.name='PlatformAuthError'}
}

export async function ensureAnonymousSession(client:SupabaseClient=getSupabaseClient()):Promise<AuthenticatedPlatformSession>{
 const current=await client.auth.getSession();
 if(current.error)throw new PlatformAuthError('Unable to read the current session.',current.error);
 if(current.data.session?.user)return{session:current.data.session,user:current.data.session.user};
 const created=await client.auth.signInAnonymously();
 if(created.error)throw new PlatformAuthError('Unable to start an anonymous session.',created.error);
 if(!created.data.session||!created.data.user)throw new PlatformAuthError('Anonymous authentication returned no session.');
 return{session:created.data.session,user:created.data.user};
}
