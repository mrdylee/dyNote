import { createPluginRuntime } from './plugin-runtime.mjs';
import './plugin-window.css';

const bridge = window.pluginBridge;
const request = async (action, value) => { const result = await bridge.request(action, value); if (!result.ok) throw new Error(result.error); return result.value; };
const publish = value => request('publish', value);
let runtime;
const fail = error => {
  const message = error?.message || String(error);
  document.querySelector('#error').textContent = message;
  publish({ error: message }).catch(() => {});
};
window.addEventListener('error', event => { event.preventDefault(); fail(event.error || event.message); });
window.addEventListener('unhandledrejection', event => { event.preventDefault(); fail(event.reason); });
bridge.onEvent(async event => {
  try {
    if (!runtime) return;
    if (event.type === 'context') runtime.update(event.value);
    if (event.type === 'settings') runtime.showSettings();
    if (event.type === 'command') await runtime.execute(event.id);
    if (event.type === 'unload') { await runtime.unload(); await publish({ phase: 'unloaded' }); }
  } catch (error) { fail(error); }
});
try {
  const { program, state } = await request('initialize');
  document.title = `${program.manifest.name} · Dynote`;
  document.querySelector('#name').textContent = `${program.manifest.name} ${program.manifest.version}`;
  runtime = createPluginRuntime(window, program, { request, publish: value => publish(value).catch(fail) }, state);
  await runtime.load();
  for (const command of runtime.commands()) {
    const button = document.createElement('button'); button.textContent = command.name;
    button.onclick = () => runtime.execute(command.id).catch(fail); document.querySelector('#commands').appendChild(button);
  }
  document.querySelector('#preferences').onclick = () => runtime.showSettings();
  await publish({ phase: 'loaded' });
} catch (error) { if (runtime) await runtime.unload().catch(() => {}); fail(error); }
