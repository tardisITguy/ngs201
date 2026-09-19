declare module 'node:fs'{export function writeFileSync(path:string,data:string):void;export function mkdirSync(path:string,options?:{recursive?:boolean}):unknown;export function readFileSync(path:string|URL,encoding:'utf8'):string;export function readdirSync(path:string|URL,options:{withFileTypes:true}):Array<{name:string;isDirectory():boolean}>}
declare module 'node:path'{export function join(...parts:string[]):string}
declare const process:{argv:string[]};
