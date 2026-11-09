import {upgradeIconMarkup} from './upgrade-render.js';

// The game and the review page share the same inventory rows.
export function renderRunUpgradeList(list, entries, background) {
  list.replaceChildren(...entries.map(entry=>{
    const item=document.createElement('li'),icon=document.createElement('span'),body=document.createElement('div');
    const heading=document.createElement('h3'),name=document.createElement('span'),count=document.createElement('span'),description=document.createElement('p');
    item.className='run-upgrade-entry';item.dataset.upgradeId=entry.id;
    icon.className='run-upgrade-icon';icon.setAttribute('aria-hidden','true');icon.innerHTML=upgradeIconMarkup(entry.kind,background);
    body.className='run-upgrade-copy';name.textContent=entry.name;
    count.className='run-upgrade-count';count.textContent=`${entry.stacks} ${entry.id==='gambler'?'次':'层'}`;
    heading.append(name,count);description.textContent=entry.summary;body.append(heading,description);item.append(icon,body);
    return item;
  }));
}
