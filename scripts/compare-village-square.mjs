import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';

const root=process.cwd(),labels=['2p','3p','4p','6p','8p'];
const beforeRoot=join(root,process.argv[2]??'validation-results-five-games'),afterRoot=join(root,process.argv[3]??'validation-results-village-square');
const read=(base,label)=>JSON.parse(readFileSync(join(base,label,'run-summary.json'),'utf8')).batch.results[0];
const play=(base,label)=>JSON.parse(readFileSync(join(base,label,`game-001-seed-five-test-${label}-batch-0.json`),'utf8'));
const count=(values,predicate)=>values.filter(predicate).length;

function analyze(base,label){
 const summary=read(base,label),artifact=play(base,label),events=artifact.history.events;
 const starts=events.filter(e=>e.type==='roundBoundary'&&String(e.id).endsWith('-START'));
 let neutralAddedByVillageSquare=0;
 const refillEvents=starts.map(e=>{
  const d=e.data,before=d.villageSquareBefore,after=d.villageSquareAfter;
  const beforeNeutral=before?.neutralCount??before?.occupants?.villagers?.filter(v=>v==='neutral').length??0;
  const afterNeutral=after?.neutralCount??after?.occupants?.villagers?.filter(v=>v==='neutral').length??0;
  const neutralAdded=d.neutralAdded??Math.max(0,afterNeutral-beforeNeutral);neutralAddedByVillageSquare+=neutralAdded;
  return{round:e.round,beforeNeutral,afterNeutral,neutralAdded,blockedReason:d.refillBlockedReason??null};
 });
 const decisions=events.filter(e=>e.type==='resolutionDecision'),neutralInfluenceMoves=count(decisions,e=>e.data.decision?.neutral===true),conversionEvents=decisions.filter(e=>e.data.movementOutcome?.conversionOccurred===true);
 let runningNeutral=Math.min(5,summary.playerCount),neutralCapFirstReachedRound;
 const chronology=[...refillEvents.map(e=>({round:e.round,ordinal:events.find(x=>x.id===`R${e.round}-START`)?.ordinal??0,delta:e.neutralAdded})),...conversionEvents.map(e=>({round:e.round,ordinal:e.ordinal,delta:1}))].sort((a,b)=>a.ordinal-b.ordinal);
 for(const e of chronology){runningNeutral+=e.delta;if(neutralCapFirstReachedRound===undefined&&runningNeutral>=10)neutralCapFirstReachedRound=e.round}
 const homeEvents=events.filter(e=>e.type==='production'&&e.data.tileType==='home');
 const homeFacts=homeEvents.map(e=>{const b=e.data.before,occupants=[...(b?.occupants?.villagers??[]),...(b?.occupants?.priests??[])];const bread=(b?.bread??0)>0,exactlyTwo=occupants.length===2,ready=bread&&exactlyTwo;return{round:e.round,bread,exactlyTwo,ready,successful:e.data.homeEligibility===true}});
 return{
  seed:summary.seed,winnerId:summary.winnerId??null,winnerStrategy:summary.winnerStrategy??null,stalled:summary.stalled,rounds:summary.rounds,actions:summary.totalActions,
  triggeringPlayerIds:summary.triggeringPlayerIds,winnerFollowerTotal:summary.winnerFollowerTotal??null,finalNeutralCount:summary.finalNeutralCount,peakNeutralCount:summary.peakNeutralCount,
  neutralCapFirstReachedRound:neutralCapFirstReachedRound??null,capPreventedConversions:summary.neutralConversionsPreventedByCap,finalVillageTileFlippedRound:summary.allLandRevealedRound??null,breadProduced:summary.breadProduced,homeBirths:summary.homeBirths,
  resourceOnlyWheatMoves:summary.resourceOnlyWheatMoves,resourceOnlyBreadMoves:summary.resourceOnlyBreadMoves,priestsCreated:summary.players.reduce((n,p)=>n+p.priestsCreated,0),
  neutralSources:{villageSquare:neutralAddedByVillageSquare,opponentConversion:summary.opponentToNeutralConversions,neutralInfluenceMoves,netNeutralRemovedByOtherMechanics:0},
  homeObservation:{opportunities:count(homeFacts,x=>x.ready),successfulBirths:count(homeFacts,x=>x.successful),snapshotsWithBread:count(homeFacts,x=>x.bread),snapshotsWithExactlyTwoVillagers:count(homeFacts,x=>x.exactlyTwo),snapshotsReady:count(homeFacts,x=>x.ready),roundsReady:[...new Set(homeFacts.filter(x=>x.ready).map(x=>x.round))]},
  refillAudit:{eventsInspected:refillEvents.length,eligibleEvents:count(refillEvents,e=>e.blockedReason===null),maximumAddedInOneRound:Math.max(0,...refillEvents.map(e=>e.neutralAdded)),eventsAddingTwoOrMore:count(refillEvents,e=>e.neutralAdded>=2),blockedByNoUnflippedTiles:count(refillEvents,e=>e.blockedReason==='no-unflipped-tiles'),blockedBySquareCapacity:count(refillEvents,e=>e.blockedReason==='square-at-capacity'),blockedByGlobalNeutralCap:count(refillEvents,e=>e.blockedReason==='global-neutral-cap'),violations:refillEvents.filter(e=>e.neutralAdded>1)}
 };
}
function delta(before,after){const fields=['rounds','actions','winnerFollowerTotal','finalNeutralCount','peakNeutralCount','capPreventedConversions','breadProduced','homeBirths','resourceOnlyWheatMoves','resourceOnlyBreadMoves','priestsCreated'];return Object.fromEntries(fields.map(k=>[k,(after[k]??0)-(before[k]??0)]))}
const games=Object.fromEntries(labels.map(label=>{const before=analyze(beforeRoot,label),after=analyze(afterRoot,label);return[label,{before,after,difference:delta(before,after)}]}));
const output={generatedAt:new Date().toISOString(),rule:'At most one Neutral is added at the start of an eligible round.',games};
mkdirSync(afterRoot,{recursive:true});writeFileSync(join(afterRoot,'comparison-summary.json'),JSON.stringify(output,null,2));
console.log(JSON.stringify(output,null,2));
