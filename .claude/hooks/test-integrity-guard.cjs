#!/usr/bin/env node
/**
 * PreToolUse/Bash — test-integrity guard.
 * Denies Bash commands that RUN a test/verify/typecheck AND mask its failure,
 * so a green result can never be faked by swallowing the exit code or skipping.
 * Only fires when BOTH a runner and a masking construct are present → no false
 * positives on normal commands.
 */
'use strict';

let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let cmd = '';
  try {
    const input = JSON.parse(raw || '{}');
    if (input.tool_name && input.tool_name !== 'Bash') return allow();
    cmd = String(input.tool_input?.command ?? '');
  } catch {
    return allow();
  }
  if (!cmd) return allow();

  const c = cmd.toLowerCase();

  // Bypassing the git test-gate is always denied, independent of runner detection.
  if (/\bgit\s+(commit|push)\b/.test(c) && /--no-verify/.test(c)) {
    return deny(
      'Test-integrity: `--no-verify` bypasses the pre-commit/push test gate. ' +
        'Run the hooks; fix what fails instead of skipping them.'
    );
  }

  // Is this command running a test/verify/typecheck?
  const runsCheck =
    /\btsc\b/.test(c) ||
    /\btypecheck\b/.test(c) ||
    /verify-[a-z0-9-]+\.ts/.test(c) ||
    /\bnpm\s+(run\s+)?test\b/.test(c) ||
    /\b(jest|vitest|mocha|pytest)\b/.test(c) ||
    /\bgo\s+test\b/.test(c);

  if (!runsCheck) return allow();

  // Masking constructs that hide a failing check.
  const masks = [
    { re: /\|\|\s*(true|:|echo|exit\s+0)/, why: '`|| true`/`|| :`/`|| echo` swallows a failing exit code' },
    { re: /;\s*true\s*$/, why: 'trailing `; true` forces success' },
    { re: /--pass-?with-?no-?tests/, why: '--passWithNoTests hides an empty/failing run' },
    { re: /--no-verify/, why: '--no-verify skips the pre-commit/push test gate' },
    { re: /\.(skip|todo)\s*\(/, why: 'test .skip()/.todo() disables the assertion' },
    { re: /\bxit\s*\(|\bxdescribe\s*\(/, why: 'xit/xdescribe disables the test' },
  ];

  const hit = masks.find((m) => m.re.test(c));
  if (!hit) return allow();

  return deny(
    `Test-integrity: this command runs a test/typecheck but masks its result — ${hit.why}. ` +
      `Run the check so its real exit code surfaces; fix failures instead of hiding them.`
  );
});

function allow() {
  process.stdout.write('{}');
  process.exit(0);
}
function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    })
  );
  process.exit(0);
}
