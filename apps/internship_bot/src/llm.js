// Claude via the Claude Code CLI in headless mode: runs on Ben's plan, so no API bill.
import { spawn } from 'node:child_process';

export function askClaude(system, prompt, schema, { model = 'sonnet' } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn('claude', ['-p', '--output-format', 'json', '--model', model, '--tools', '',
      '--no-session-persistence', '--strict-mcp-config', '--setting-sources', '',
      '--system-prompt', system, '--json-schema', JSON.stringify(schema)], { stdio: ['pipe', 'pipe', 'inherit'] });
    let out = '';
    p.stdout.on('data', d => (out += d));
    p.on('error', reject);
    p.on('close', code => {
      try {
        const r = JSON.parse(out);
        if (r.is_error || !r.structured_output) throw new Error(r.result || `claude exited ${code}`);
        resolve(r.structured_output);
      } catch (e) { reject(new Error(`claude: ${e.message}`)); }
    });
    p.stdin.end(prompt);
  });
}
