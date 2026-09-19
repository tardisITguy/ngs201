import {describe,expect,it} from 'vitest';
import {applyAction,startNextRound} from '../src/games/worship-me/engine/reducer';
import {deserializeGame,serializeGame} from '../src/games/worship-me/engine/serialization';
import {renderBoard} from '../src/games/worship-me/ui/renderBoard';
import {game,player,reveal} from './helpers';

describe('board action-token overlays',()=>{
 it('renders every board coordinate from its actual cell id',()=>{const s=game(),html=renderBoard(s);expect((html.match(/class="tile-coordinate"/g)??[])).toHaveLength(25);for(const c of s.board)expect(html).toContain(`aria-label="Tile coordinate ${c.id}">${c.id}</span>`)});

 it('renders owned Bless and Smite tile artwork on the targeted tile',()=>{
  let blessed=game(),red=player(blessed);blessed=applyAction(blessed,{type:'placeTile',cellId:'1,1',kind:'bless',playerId:red.id});const blessHtml=renderBoard(blessed);
  expect(blessHtml).toContain('aria-label="Red (Player 1) Bless on hidden 1,1; pending"');expect(blessHtml).toContain('data-action-kind="bless" data-coordinate="1,1"');expect(blessHtml).toContain('/assets/bless-token.svg');
  let smited=game();red=player(smited);reveal(smited,'1,1');smited=applyAction(smited,{type:'placeTile',cellId:'1,1',kind:'smite',playerId:red.id});const smiteHtml=renderBoard(smited);
  expect(smiteHtml).toContain('aria-label="Red (Player 1) Smite on farm 1,1; pending"');expect(smiteHtml).toContain('data-action-kind="smite" data-coordinate="1,1"');expect(smiteHtml).toContain('/assets/smite-token.svg');
 });

 it('uses one physical border while preserving directed Bless Edge arrows',()=>{
  for(const [from,to,direction,arrow] of [['1,1','1,2','right','→'],['1,2','1,1','left','←']] as const){let s=game(),red=player(s);reveal(s,'1,1');reveal(s,'1,2');s=applyAction(s,{type:'placeEdge',from,to,kind:'bless',playerId:red.id});const html=renderBoard(s);expect(html).toContain(`edge-action-token edge-token-right bless pending direction-${direction}`);expect(html).toContain(`data-origin="${from}" data-destination="${to}"`);expect(html).toContain(`>${arrow}</span>`)}
 });

 it('renders Smite on the shared border without a movement arrow',()=>{let s=game(),red=player(s);reveal(s,'1,1');reveal(s,'1,2');s=applyAction(s,{type:'placeEdge',a:'1,1',b:'1,2',kind:'smite',playerId:red.id});const html=renderBoard(s),marker=html.match(/<span class="action-token edge-action-token[^>]+data-action-kind="smite"[^>]*>.*?<\/span>/)?.[0]??'';expect(marker).toContain('edge-token-right smite pending');expect(marker).not.toContain('direction-arrow')});

 it('reconstructs markers after save/load and removes them at round cleanup',()=>{let s=game(),red=player(s);s=applyAction(s,{type:'placeTile',cellId:'1,1',kind:'bless',playerId:red.id});const restored=deserializeGame(serializeGame(s));expect(renderBoard(restored)).toContain('data-action-kind="bless" data-coordinate="1,1"');startNextRound(restored);expect(renderBoard(restored)).not.toContain('class="action-token')});
});
