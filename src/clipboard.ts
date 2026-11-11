// Writes the system clipboard from the worker. The editor runs in an isolated frame that Orca gives
// no clipboard access: the async API is refused there, and the old copy-command trick can report
// success without copying anything. The worker is an ordinary process, so it pipes the text to
// the platform's clipboard tool, which either copies or fails with a reason.
import { spawn } from 'node:child_process'

export type ClipboardCommand = { command: string; args: string[] }

/** The tools to try, in order, on `platform`. */
export function clipboardCommands(platform: string = process.platform): ClipboardCommand[] {
  if (platform === 'darwin') return [{ command: 'pbcopy', args: [] }]
  if (platform === 'win32') return [{ command: 'clip', args: [] }]
  return [
    { command: 'wl-copy', args: [] },
    { command: 'xclip', args: ['-selection', 'clipboard'] },
    { command: 'xsel', args: ['--clipboard', '--input'] }
  ]
}

function pipeTo({ command, args }: ClipboardCommand, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // pbcopy reads its input in the locale's encoding; without a UTF-8 one, "–" and "→" arrive mangled.
    const child = spawn(command, args, { stdio: ['pipe', 'ignore', 'pipe'], env: { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' } })
    let stderr = ''
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${command} did not finish`)) }, 5000)
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(stderr.trim() || `${command} exited with ${code}`))
    })
    child.stdin.on('error', () => undefined)
    child.stdin.end(text, 'utf8')
  })
}

/** Puts `text` on the clipboard with the first tool that works; rejects naming why when none does. */
export async function writeClipboard(text: string, commands: ClipboardCommand[] = clipboardCommands()): Promise<void> {
  const failures: string[] = []
  for (const command of commands) {
    try {
      await pipeTo(command, text)
      return
    } catch (error) {
      failures.push(`${command.command}: ${(error as Error).message}`)
    }
  }
  throw new Error(`Could not write the clipboard (${failures.join('; ')})`)
}
