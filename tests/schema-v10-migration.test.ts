import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {describe,expect,it} from 'vitest';
const directory=new URL('../supabase/migrations/',import.meta.url);
const read=(name:string)=>readFileSync(new URL(name,directory),'utf8').replace(/\r\n/g,'\n');
const migration=read('20260925000000_canonical_schema_v10.sql');
const oldHashes:Record<string,string>={
 "20260919190346_create_ngsllc_core.sql": "dfa5c612e9edc4c58b685d3a80c4ebd826f0c0450df3d5ed0689005f01029840",
 "20260919190347_restrict_rls_auto_enable.sql": "16f698e12a5b68c5aa1022d37311ff127fe8350f8ed965eee08c8cf4a5fd592b",
 "20260919190348_create_room_server_command.sql": "ca25b2ddda8a351ad526a7884f0d8920fb137652f77a7235d4679fbb8941dd81",
 "20260920000000_join_room_server_command.sql": "bb96b67025475877d89a335e278dc6ce9b8b733d3c9858fd49dbdbd5a17aef79",
 "20260920000001_lobby_lifecycle.sql": "5ec1beccbe16f9a267806ddd155d08a349286a4d6625a0de3ac6eb94d592af96",
 "20260920000002_player_color_selection.sql": "0887a28b155576694e22f339e82fd1951c7ce9978da439661a217bbdeffc2230",
 "20260920000003_player_ready_state.sql": "73ac0263ec0f0af59da1394bdc00b687a47ac7f8c7e7587577813c5718de9f47",
 "20260920000004_start_game.sql": "5bc2bd51cdb12166ad1285740a60760974925593d0b5b0e40be2140ce2230706",
 "20260921000000_active_game_state_read.sql": "3956a00b749e0475e56b910e88671580ff4934b484498e05e875fcdf358359cb",
 "20260921000001_gameplay_mutation.sql": "a80840b9a2cade11645b7360c31ec401e900cc06413f5335e62c67a642dffaab",
 "20260922000000_realtime_game_sync.sql": "53d6e92e41b06371bab2be49dc8e05cf0f609e2d49addc258e135b6dae8696b6",
 "20260922000001_realtime_lobby_sync.sql": "783559b6fcfd841a5dbda98bf21a27bccce2899a9687c644a914955114bbc27a",
 "20260922000002_multiplayer_ai_players.sql": "68481194f0c79ea8b5729db7088e9fd4bacce03bf5ac76c902af0c69c1b418ff",
 "20260923000000_fix_multiplayer_ai_sql_ambiguity.sql": "3d684ce2b4285b1cce4747f27679d5693071a47fbef091d837c373cd83e5ba6d",
 "20260923000001_fix_start_game_coalesce.sql": "5139fda069f56017e9fcbccd8ce73a29dd05804494c6c9a01829ef816ffe8afb",
 "20260923000002_active_player_ai_takeover.sql": "1fca1fc0096a6cd37c53e5e7462569b34709b0094e636218e2575fe889e13905",
 "20260924000000_lobby_discovery_and_host_moderation.sql": "42b08a785f5c289639211df0c03344909f005f76b8e1848c65e5c99ad5efe568",
 "20260924000001_return_finished_game_to_lobby.sql": "af563be022bac9166854cf75a03841cdaf0159f14ceecb6f722661720a5a8a9a",
 "20260924000002_fix_return_to_lobby_signal_read.sql": "2eccc6391230116a28c6a3b19be44bb56c29412f1efcc6d48cb50f360f765e42",
 "20260924000003_lobby_presence_and_stale_directory.sql": "1864a73135e82f553c3c500a10676e7ffcc7239971eb6cd831b2c35dfa01f86a",
 "20260924000004_room_naming.sql": "5a1b88e0674afc7beebd966aff324c6d83294c685b414237c84f4ebde728e0fd",
 "20260924000005_room_chat.sql": "1ab7b2f0603f830205f973fd6013e24daece2a4678f294e570d80b748b69e341"
};
const definitions=(source:string)=>[...source.matchAll(/create(?: or replace)? function public\.[\s\S]*?\$\$;/gi)].map(match=>match[0]);
describe('schema-v10 SQL boundary — static contract, not PostgreSQL execution',()=>{
 it('adds only migration 23 and preserves every applied migration byte-for-byte',()=>{
  const names=readdirSync(directory).filter(name=>name.endsWith('.sql')).sort();
  expect(names).toHaveLength(23);expect(names.slice(0,22)).toEqual(Object.keys(oldHashes));expect(names[22]).toBe('20260925000000_canonical_schema_v10.sql');
  for(const [name,hash]of Object.entries(oldHashes))expect(createHash('sha256').update(readFileSync(new URL(name,directory))).digest('hex')).toBe(hash);
 });
 it.each([
  ['start_game_server','20260923000001_fix_start_game_coalesce.sql',1],
  ['commit_game_action_server','20260922000002_multiplayer_ai_players.sql',2],
  ['commit_ai_action_server','20260922000002_multiplayer_ai_players.sql',2],
  ['return_finished_game_to_lobby_server','20260924000001_return_finished_game_to_lobby.sql',1],
 ] as const)('%s changes exclusively its %i schema guards, preserving signature, locks, authorization, CAS and errors',(name,source,count)=>{
  const previous=definitions(read(source)).find(sql=>sql.includes('function public.'+name+'('))!;
  const current=definitions(migration).find(sql=>sql.includes('function public.'+name+'('))!;
  expect(previous).toBeTruthy();expect(current).toBeTruthy();
  expect(current).toBe(previous.replace('create function ','create or replace function ').replaceAll("schemaVersion' is distinct from '9'::jsonb","schemaVersion' is distinct from '10'::jsonb"));
  expect(current.match(/schemaVersion' is distinct from '10'::jsonb/g)).toHaveLength(count);
  expect(current).toMatch(/security invoker/i);expect(current).toMatch(/set search_path\s*=\s*''/i);
  // IS DISTINCT FROM rejects missing/null and every wrong version; it is not an "any version" check.
  expect(current).not.toContain("schemaVersion' is distinct from '9'");
 });
 it('only replaces the four functions and preserves inherited service-only EXECUTE ACLs',()=>{
  expect(definitions(migration)).toHaveLength(4);
  expect(migration).not.toMatch(/create table|alter table|create policy|alter publication|grant |revoke /i);
  for(const sql of definitions(migration))expect(sql).toMatch(/^create or replace function/);
 });
 it('all later effective SQL schema guards are v10; earlier v9 guards are historical only',()=>{
  const effective=new Map<string,string>();
  for(const name of readdirSync(directory).filter(n=>n.endsWith('.sql')).sort()){
   for(const sql of definitions(read(name))){const functionName=sql.match(/function (public\.[^(]+)/i)![1];effective.set(functionName,sql)}
  }
  const guarded=[...effective].filter(([,body])=>body.includes('schemaVersion'));
  expect(guarded.map(([name])=>name).sort()).toEqual(['public.commit_ai_action_server','public.commit_game_action_server','public.return_finished_game_to_lobby_server','public.start_game_server']);
  for(const [,body]of guarded){expect(body).not.toMatch(/schemaVersion[^\n]*?'9'::jsonb/);expect(body).toContain("'10'::jsonb")}
 });
});
