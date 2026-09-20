export type Route={name:'identity'}|{name:'games'}|{name:'worship-me'}|{name:'worship-me-join'}|{name:'room';code:string}|{name:'not-found'};

export function resolveRoute(pathname:string):Route{
 const path=pathname.length>1?pathname.replace(/\/+$/,''):pathname;
 if(path==='/')return{name:'identity'};
 if(path==='/games')return{name:'games'};
 if(path==='/games/worship-me')return{name:'worship-me'};
 if(path==='/games/worship-me/join')return{name:'worship-me-join'};
 const room=path.match(/^\/room\/([A-Za-z0-9]{6,10})$/);
 if(room)return{name:'room',code:room[1].toUpperCase()};
 return{name:'not-found'};
}

export interface NavigationWindow{location:{pathname:string};history:{pushState(data:unknown,title:string,url?:string|URL|null):void};addEventListener(type:'popstate',listener:()=>void):void}
export function createRouter(win:NavigationWindow,onRoute:(route:Route)=>void){
 const render=()=>onRoute(resolveRoute(win.location.pathname));
 win.addEventListener('popstate',render);
 return{start:render,navigate(path:string){if(path!==win.location.pathname)win.history.pushState(null,'',path);render()}};
}
