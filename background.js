// Keeps the content script registered on every remembered site and the team sheet in sync.
importScripts('catalogo.js', 'core.js');
const TEAM_MINUTES = 10;
// One sync at a time: granting a permission and saving the site fire two syncs, and an older run
// finishing last would re-register the list without the new site.
let syncing = Promise.resolve();
const sync = () => (syncing = syncing.then(() => QR.syncSites()).catch(() => {}));
const team = () => QR.syncTeam().catch(() => {});
// Only recreate the alarm when it is missing or has another period (an alarm restarted on every wake-up would never fire).
const alarm = async () => { try { const a = await chrome.alarms.get('team'); if (a?.periodInMinutes !== TEAM_MINUTES) await chrome.alarms.create('team', { periodInMinutes: TEAM_MINUTES }); } catch {} };
// Red "!" on the icon while the connected sheet has an error; cleared after the next successful sync.
const badge = async () => {
  try {
    const failed = !!(await QR.loadTeam())?.error;
    await chrome.action.setBadgeText({ text: failed ? '!' : '' });
    if (failed) await chrome.action.setBadgeBackgroundColor({ color: '#d93025' });
  } catch {}
};
chrome.runtime.onInstalled.addListener(({ reason }) => {
  sync(); team(); alarm(); badge();
  if (reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('biblioteca.html?bemvindo') });
});
chrome.runtime.onStartup.addListener(() => { sync(); team(); alarm(); badge(); });
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'team') team(); });
chrome.permissions.onRemoved.addListener(sync);
chrome.permissions.onAdded.addListener(sync);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.sites) sync();
  if (changes.team) badge();
});
