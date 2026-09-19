import {createClient,type SupabaseClient} from '@supabase/supabase-js';

let client:SupabaseClient|undefined;

/**
 * Returns the shared browser client when platform features request it.
 * VITE_* values are public configuration and must never contain server secrets.
 */
export function getSupabaseClient():SupabaseClient {
 if(client)return client;
 const url=import.meta.env.VITE_SUPABASE_URL;
 const publishableKey=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
 if(!url||!publishableKey)throw Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.');
 client=createClient(url,publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
 return client;
}
