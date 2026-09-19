import type {GameState,Player,VictoryResult} from './types';

export function followerTotal(s:GameState,p:Player){return s.board.reduce((n,c)=>n+c.villagers.filter(v=>v===p.color).length+c.priests.filter(v=>v===p.color).length,0)}
export function followersInOwnTemple(s:GameState,p:Player){const c=s.board.find(c=>c.id===p.templeCellId)!;return c.villagers.filter(v=>v===p.color).length+c.priests.filter(v=>v===p.color).length}
export function allVillageTilesFaceUp(s:GameState){return s.board.filter(c=>c.hiddenKind).every(c=>c.visibleKind!=='hidden')}

export function checkVictory(s:GameState):VictoryResult{
 const allVillageTilesRevealed=allVillageTilesFaceUp(s),followerTotals=Object.fromEntries(s.players.map(p=>[p.id,followerTotal(s,p)])),triggeringPlayerIds=s.players.filter(p=>followersInOwnTemple(s,p)>=s.config.templeTriggerFollowers).map(p=>p.id),templeTriggerSatisfied=triggeringPlayerIds.length>0,gameEnds=allVillageTilesRevealed&&templeTriggerSatisfied;
 if(!allVillageTilesRevealed)return{reason:'not-revealed',allVillageTilesRevealed,templeTriggerSatisfied,triggeringPlayerIds,gameEnds,followerTotals};
 s.revealCompleted=true;
 if(!templeTriggerSatisfied)return{reason:'no-temple-trigger',allVillageTilesRevealed,templeTriggerSatisfied,triggeringPlayerIds,gameEnds,followerTotals};
 const highestFollowerTotal=Math.max(...Object.values(followerTotals)),leaders=s.players.filter(p=>followerTotals[p.id]===highestFollowerTotal);
 return leaders.length===1?{reason:'winner',winnerId:leaders[0].id,allVillageTilesRevealed,templeTriggerSatisfied,triggeringPlayerIds,gameEnds,followerTotals,highestFollowerTotal}:{reason:'tie',allVillageTilesRevealed,templeTriggerSatisfied,triggeringPlayerIds,gameEnds,followerTotals,highestFollowerTotal};
}
