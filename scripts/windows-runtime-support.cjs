const { execFile } = require("node:child_process");
const {
  existsSync,
  readSync,
  openSync,
  closeSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} = require("node:fs");
const { appendFile } = require("node:fs/promises");
const { Writable } = require("node:stream");

function numberedLogPath(logPath, index) {
  return `${logPath}.${index}`;
}

function moveIfPresent(source, destination) {
  if (!existsSync(source)) return;
  rmSync(destination, { force: true });
  renameSync(source, destination);
}

function rotateExistingLog(logPath, maxBytes, backups) {
  let size = 0;
  try {
    size = statSync(logPath).size;
  } catch {
    return 0;
  }
  if (size < maxBytes) return size;

  for (let index = backups; index >= 2; index -= 1) {
    moveIfPresent(numberedLogPath(logPath, index - 1), numberedLogPath(logPath, index));
  }
  const firstBackup = numberedLogPath(logPath, 1);
  rmSync(firstBackup, { force: true });

  // Old affected builds can leave hundreds of megabytes in one file. Keep
  // only the most useful tail instead of carrying an unbounded file forward.
  if (size > maxBytes * 2) {
    const length = Math.min(size, maxBytes);
    const buffer = Buffer.alloc(length);
    const descriptor = openSync(logPath, "r");
    try {
      readSync(descriptor, buffer, 0, length, size - length);
    } finally {
      closeSync(descriptor);
    }
    writeFileSync(firstBackup, buffer);
    writeFileSync(logPath, "");
  } else {
    renameSync(logPath, firstBackup);
  }
  return 0;
}

function createRotatingLogSink(logPath, options = {}) {
  const maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
  const backups = Math.max(1, options.backups ?? 3);
  let size = rotateExistingLog(logPath, maxBytes, backups);

  return new Writable({
    write(chunk, encoding, callback) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
      Promise.resolve()
        .then(() => {
          if (size > 0 && size + buffer.length > maxBytes) {
            size = rotateExistingLog(logPath, Math.max(1, size), backups);
          }
          return appendFile(logPath, buffer);
        })
        .then(() => {
          size += buffer.length;
          callback();
        }, callback);
    },
  });
}

function powerShellLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function windowsArgument(value) {
  const text = String(value);
  return /[\s"]/u.test(text) ? `"${text.replace(/"/g, '\\"')}"` : text;
}

function runPowerShell(script) {
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true, timeout: 30_000 },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          code: typeof error?.code === "number" ? error.code : error ? -1 : 0,
          stdout: String(stdout || "").trim(),
          stderr: String(stderr || error?.message || "").trim(),
        });
      },
    );
  });
}

async function configureScheduledTask({
  taskName,
  executablePath,
  arguments: actionArguments = ["background"],
  description,
  enabled,
}) {
  if (!enabled) {
    return await runPowerShell(`
      $task = Get-ScheduledTask -TaskName ${powerShellLiteral(taskName)} -ErrorAction SilentlyContinue
      if ($task) { Unregister-ScheduledTask -TaskName ${powerShellLiteral(taskName)} -Confirm:$false }
      'disabled'
    `);
  }

  const argumentText = actionArguments.map(windowsArgument).join(" ");
  return await runPowerShell(`
    $ErrorActionPreference = 'Stop'
    $userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    if (-not $userId) { throw 'Windows user identity is unavailable.' }
    $existing = Get-ScheduledTask -TaskName ${powerShellLiteral(taskName)} -ErrorAction SilentlyContinue
    if (
      $existing -and
      $existing.Actions.Count -eq 1 -and
      $existing.Actions[0].Execute -eq ${powerShellLiteral(executablePath)} -and
      $existing.Actions[0].Arguments -eq ${powerShellLiteral(argumentText)} -and
      $existing.Triggers.Count -ge 2 -and
      $existing.Settings.RestartCount -ge 1 -and
      -not $existing.Settings.DisallowStartIfOnBatteries -and
      -not $existing.Settings.StopIfGoingOnBatteries
    ) {
      'enabled'
      exit 0
    }
    $action = New-ScheduledTaskAction -Execute ${powerShellLiteral(executablePath)} -Argument ${powerShellLiteral(argumentText)}
    $logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
    $watchdogTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 2) -RepetitionDuration (New-TimeSpan -Days 3650)
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
    $principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName ${powerShellLiteral(taskName)} -Action $action -Trigger @($logonTrigger, $watchdogTrigger) -Settings $settings -Principal $principal -Description ${powerShellLiteral(description)} -Force -ErrorAction Stop | Out-Null
    $task = Get-ScheduledTask -TaskName ${powerShellLiteral(taskName)}
    if (-not $task -or -not $task.Settings -or $task.Settings.RestartCount -lt 1) { throw 'Scheduled task verification failed.' }
    'enabled'
  `);
}

module.exports = {
  configureScheduledTask,
  createRotatingLogSink,
};
