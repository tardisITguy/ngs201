import {describe,expect,it,vi} from 'vitest';
import type {Session,SupabaseClient,User} from '@supabase/supabase-js';
import {createRoom,CreateRoomError} from '../src/platform/rooms/createRoom';

const user={id:'host-1'} as User;
const session={access_token:'token',user} as Session;
const result={room:{id:'room-1',code:'ABC234',gameId:'game-1',status:'lobby' as const}};

function clientWith(invoke:ReturnType<typeof vi.fn>):SupabaseClient{
 return{auth:{getSession:vi.fn().mockResolvedValue({data:{session},error:null})},functions:{invoke}} as unknown as SupabaseClient;
}

describe('createRoom client command',()=>{
 it('invokes the Edge Function with only validated public input',async()=>{
  const invoke=vi.fn().mockResolvedValue({data:result,error:null});
  await expect(createRoom({gameSlug:'worship-me',displayName:'  Player Name  '},clientWith(invoke))).resolves.toEqual(result);
  expect(invoke).toHaveBeenCalledWith('create-room',{body:{gameSlug:'worship-me',displayName:'Player Name'}});
  const body=invoke.mock.calls[0][1].body;
  expect(body).not.toHaveProperty('host_user_id');
  expect(body).not.toHaveProperty('hostUserId');
  expect(body).not.toHaveProperty('userId');
 });

 it('rejects invalid input before invoking the function',async()=>{
  const invoke=vi.fn();
  await expect(createRoom({gameSlug:'Not Valid','displayName':'Player'},clientWith(invoke))).rejects.toBeInstanceOf(CreateRoomError);
  await expect(createRoom({gameSlug:'a','displayName':'Player'},clientWith(invoke))).rejects.toBeInstanceOf(CreateRoomError);
  await expect(createRoom({gameSlug:'a'.repeat(65),'displayName':'Player'},clientWith(invoke))).rejects.toBeInstanceOf(CreateRoomError);
  await expect(createRoom({gameSlug:'worship-me','displayName':'   '},clientWith(invoke))).rejects.toBeInstanceOf(CreateRoomError);
  expect(invoke).not.toHaveBeenCalled();
 });

 it('accepts a legal two-character slug',async()=>{
  const invoke=vi.fn().mockResolvedValue({data:result,error:null});
  await expect(createRoom({gameSlug:'ab',displayName:'Player'},clientWith(invoke))).resolves.toEqual(result);
  expect(invoke).toHaveBeenCalledWith('create-room',{body:{gameSlug:'ab',displayName:'Player'}});
 });

 it('rejects function errors and unsafe response shapes',async()=>{
  await expect(createRoom({gameSlug:'worship-me',displayName:'Player'},clientWith(vi.fn().mockResolvedValue({data:null,error:Error('failed')})))).rejects.toBeInstanceOf(CreateRoomError);
  await expect(createRoom({gameSlug:'worship-me',displayName:'Player'},clientWith(vi.fn().mockResolvedValue({data:{room:{id:'room-1',game_state:{secret:true}}},error:null})))).rejects.toBeInstanceOf(CreateRoomError);
 });
});
