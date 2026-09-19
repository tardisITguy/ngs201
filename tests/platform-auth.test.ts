import {describe,expect,it,vi} from 'vitest';
import type {Session,SupabaseClient,User} from '@supabase/supabase-js';
import {ensureAnonymousSession,PlatformAuthError} from '../src/platform/auth/session';

const user={id:'user-1'} as User;
const session={access_token:'token',user} as Session;

describe('anonymous platform session',()=>{
 it('reuses an existing session',async()=>{
  const signInAnonymously=vi.fn();
  const client={auth:{getSession:vi.fn().mockResolvedValue({data:{session},error:null}),signInAnonymously}} as unknown as SupabaseClient;
  await expect(ensureAnonymousSession(client)).resolves.toEqual({session,user});
  expect(signInAnonymously).not.toHaveBeenCalled();
 });

 it('signs in anonymously only when no session exists',async()=>{
  const signInAnonymously=vi.fn().mockResolvedValue({data:{session,user},error:null});
  const client={auth:{getSession:vi.fn().mockResolvedValue({data:{session:null},error:null}),signInAnonymously}} as unknown as SupabaseClient;
  await expect(ensureAnonymousSession(client)).resolves.toEqual({session,user});
  expect(signInAnonymously).toHaveBeenCalledTimes(1);
 });

 it('propagates session and anonymous sign-in failures as typed errors',async()=>{
  const readFailure={auth:{getSession:vi.fn().mockResolvedValue({data:{session:null},error:Error('read failed')})}} as unknown as SupabaseClient;
  await expect(ensureAnonymousSession(readFailure)).rejects.toBeInstanceOf(PlatformAuthError);
  const signInFailure={auth:{getSession:vi.fn().mockResolvedValue({data:{session:null},error:null}),signInAnonymously:vi.fn().mockResolvedValue({data:{session:null,user:null},error:Error('sign in failed')})}} as unknown as SupabaseClient;
  await expect(ensureAnonymousSession(signInFailure)).rejects.toBeInstanceOf(PlatformAuthError);
 });
});
