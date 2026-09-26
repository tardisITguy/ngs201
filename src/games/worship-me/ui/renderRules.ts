import {WORSHIP_ME_HOW_TO_PLAY_SECTIONS} from './howToPlay';
const escape=(text:string)=>text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
export function renderRules(){return `<nav class="rules"><h2>Rules Reference</h2>${WORSHIP_ME_HOW_TO_PLAY_SECTIONS.filter(section=>section.title!=='GAME CONTROLS').map(section=>`<h3>${escape(section.title)}</h3>${section.paragraphs.map(p=>`<p>${escape(p)}</p>`).join('')}${section.bullets?`<ul>${section.bullets.map(p=>`<li>${escape(p)}</li>`).join('')}</ul>`:''}`).join('')}</nav>`}
