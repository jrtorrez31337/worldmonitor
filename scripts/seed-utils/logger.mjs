/**
 * Prefixed console logger for seed orchestrator.
 * @param {string} name — seeder name (e.g. 'earthquakes')
 * @param {{ write?: (msg: string) => void }} [sink] — override for testing
 */
export function createLogger(name, sink) {
  const prefix = name === 'orchestrator' ? '[orchestrator]' : `[seed:${name}]`;
  const out = sink?.write ?? ((msg) => console.log(msg));
  const err = sink?.write ?? ((msg) => console.error(msg));

  return {
    info: (msg) => out(`${prefix} ${msg}`),
    error: (msg) => err(`${prefix} error: ${msg}`),
    warn: (msg) => err(`${prefix} warn: ${msg}`),
  };
}
