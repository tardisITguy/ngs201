// Compare recorded population metrics; do not infer removed/hidden population from old rules.
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
const read=directory=>JSON.parse(readFileSync(join(directory,'run-summary.json'),'utf8'));
const [beforePath,afterPath]=process.argv.slice(2);
if(!beforePath||!afterPath)throw Error('Usage: node scripts/compare-village-square.mjs BEFORE_DIRECTORY AFTER_DIRECTORY');
const summarize=report=>{
 const results=report.batch.results;
 const sum=key=>results.reduce((total,result)=>total+(result[key]??0),0);
 return{schemaVersion:report.schemaVersion??'historical',games:results.length,completed:results.filter(r=>!r.stalled).length,stalled:results.filter(r=>r.stalled).length,averageRounds:results.reduce((n,r)=>n+r.rounds,0)/results.length,homeBirths:sum('homeBirths'),blockedBirths:sum('blockedBirthEntries'),bonusNeutrals:sum('bonusNeutrals'),fallbackNeutrals:sum('fallbackNeutrals'),neutralHomeBirths:sum('neutralHomeBirths'),opponentToNeutralConversions:sum('opponentToNeutralConversions'),peakNeutralCount:Math.max(...results.map(r=>r.peakNeutralCount)),priestsCreated:results.reduce((n,r)=>n+r.players.reduce((v,p)=>v+p.priestsCreated,0),0),reducerErrors:results.flatMap(r=>r.errors)};
};
console.log(JSON.stringify({before:summarize(read(beforePath)),after:summarize(read(afterPath)),note:'Historical metrics absent from the old artifact are zero/unknown, not reconstructed.'},null,2));
