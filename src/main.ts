import './styles.css';
import {startLocalWorshipMe} from './games/worship-me/localApp';

const root=document.querySelector<HTMLDivElement>('#app')!;
startLocalWorshipMe(root);
