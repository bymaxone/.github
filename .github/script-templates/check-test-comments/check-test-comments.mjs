/**
 * @fileoverview Test-comment gate: fails when a test call in a tracked spec file has no comment directly above
 * it that says something, unless its file is on a frozen baseline that can only shrink.
 * @layer scripts
 *
 * The standards ask that every `it()` carries a comment with the scenario and the rule it protects. A reader
 * of a failing test meets the title first, and the comment is the one place that says why the test exists.
 * The gate checks that a comment exists and says something, not that it states a scenario and a rule.
 *
 * A test call is an expression statement whose call is `it` or `test`, with or without `.only`, `.skip`,
 * `.todo`, `.concurrent` or `.failing`, or `.each(table)` or an `.each` template followed by the title and the
 * body, at any depth. `obj.it(...)`, a regex `.test(...)`, the aliases `xit` and `fit`, and a call wrapped in
 * `await`, `void` or parentheses are not read as tests. The comment is a `/** *\/`, a `/* *\/` or a run of
 * `//` lines that ends on the line directly above the statement, with no blank line between. It must hold a
 * word and not be only a tool directive (`eslint-disable-next-line`, `@ts-expect-error`, `istanbul ignore`).
 * A directive next to a real comment does not cancel it. A comment after the call on its own line is not above it.
 *
 * The gate is red for what a change introduces; an offender is allowed only while its file is on a baseline
 * whose counts can only shrink. The baseline records how many each file holds, and is kept honest from both
 * sides:
 *
 * - a file with an offender that is not on the baseline fails (a new offender);
 * - a baselined file that gained an offender fails (the baseline cannot widen);
 * - a baselined file that lost offenders fails until its entry is lowered to the new count, and an entry at
 *   zero is removed, so a fixed file cannot quietly regress later.
 *
 * With `--base <ref>` the baseline is also compared with the one at that revision, because the baseline in a
 * change is the change's own file and could otherwise admit the offender it adds. A base revision without a
 * baseline file imposes nothing, which is the change that introduces it.
 *
 * The check reads the syntax tree, so text inside a string or a template literal is never a comment.
 *
 * Usage: node scripts/check-test-comments.mjs [--root <dir>] [--baseline <file>] [--base <ref>]
 *                                             [--write-baseline]
 *   --root            repository root (default: the current directory)
 *   --baseline        JSON `{ "files": { "<path>": <count> } }` (default: scripts/test-comment-baseline.json)
 *   --base            a git revision whose baseline the current one may not widen (default: none)
 *   --write-baseline  write the baseline from the offenders found and exit
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import ts from 'typescript'

/** Directories whose specs are checked: the library and its tests. */
const SCOPE = /^(?:src|test)\//

/** Tracked files named like a spec: `*.spec.ts(x)`, `*.test.ts(x)` and the end-to-end `*.e2e-spec.ts`. */
const SPEC_FILE = /(?:\.(?:spec|test)\.tsx?|\.e2e-spec\.ts)$/

/** The global test functions. */
const TEST_FUNCTIONS = new Set(['it', 'test'])

/** Properties that keep a test call a test call when read off `it` or `test`. */
const TEST_MODIFIERS = new Set(['only', 'skip', 'todo', 'concurrent', 'failing'])

/** The start of a comment that tells a tool what to do and tells a reader nothing. */
const DIRECTIVE =
  /^(?:eslint-(?:disable|enable)\b|@ts-(?:expect-error|ignore|nocheck|check)\b|(?:istanbul|c8|v8)\s+ignore\b|prettier-ignore\b|biome-ignore\b|stryker\s+(?:disable|restore)\b|tslint:)/i

/** A letter, a digit or an underscore: what a comment needs at least one of to say something. */
const WORD_CHARACTER = /[\p{L}\p{N}_]/u

/**
 * Reads `--name value` from the arguments, or returns the fallback.
 *
 * @param {string} name The option name.
 * @param {string | undefined} fallback Used when the option is absent.
 * @returns {string | undefined} The option's value or the fallback.
 */
function option(name, fallback) {
  const index = process.argv.indexOf(name)
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback)
}

/**
 * Whether an expression is `it` or `test`, optionally with modifiers, as in `it.skip` or `test.only`.
 *
 * @param {ts.Expression} node The expression to inspect.
 * @returns {boolean} True when it names a test function.
 */
function isTestFunction(node) {
  if (ts.isIdentifier(node)) return TEST_FUNCTIONS.has(node.text)
  return (
    ts.isPropertyAccessExpression(node) &&
    TEST_MODIFIERS.has(node.name.text) &&
    isTestFunction(node.expression)
  )
}

/**
 * Whether an expression is `it.each` or `test.each`, optionally with modifiers before `each`.
 *
 * @param {ts.Expression} node The expression to inspect.
 * @returns {boolean} True when it is the `.each` form of a test function.
 */
function isEach(node) {
  return (
    ts.isPropertyAccessExpression(node) &&
    node.name.text === 'each' &&
    isTestFunction(node.expression)
  )
}

/**
 * Whether an expression statement registers a test: a call of a test function, or a call of the result of
 * `.each(table)` or of an `.each` template.
 *
 * @param {ts.Expression} expression The statement's expression.
 * @returns {boolean} True when it is a test call.
 */
function isTestCall(expression) {
  if (!ts.isCallExpression(expression)) return false
  const callee = expression.expression
  if (isTestFunction(callee)) return true
  if (ts.isCallExpression(callee)) return isEach(callee.expression)
  if (ts.isTaggedTemplateExpression(callee)) return isEach(callee.tag)
  return false
}

/**
 * The words of a comment, with its markers and the leading stars of block lines taken out.
 *
 * @param {string} text The source text.
 * @param {ts.CommentRange} range The comment's range.
 * @returns {string} The comment's content, trimmed.
 */
function commentContent(text, range) {
  const raw = text.slice(range.pos, range.end)
  if (range.kind === ts.SyntaxKind.SingleLineCommentTrivia) return raw.replace(/^\/\/+/, '').trim()
  return raw
    .replace(/^\/\*+/, '')
    .replace(/\*+\/$/, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\*+/, '').trim())
    .join('\n')
    .trim()
}

/**
 * Whether a comment says something: it holds a word and is not a tool directive.
 *
 * @param {string} content A comment's content from `commentContent`.
 * @returns {boolean} True when a reader learns something from it.
 */
function isMeaningful(content) {
  return WORD_CHARACTER.test(content) && !DIRECTIVE.test(content)
}

/**
 * Whether the comments directly above a statement say something.
 *
 * The comments that count are the run that ends on the line right above the statement, each starting no
 * more than one line after the previous ends. Any meaningful comment in the run is enough.
 *
 * @param {ts.SourceFile} file The parsed file.
 * @param {ts.Node} statement The statement.
 * @returns {boolean} True when the statement has a comment above it.
 */
function hasComment(file, statement) {
  const text = file.text
  const lineOf = (position) => file.getLineAndCharacterOfPosition(position).line
  const ranges = ts.getLeadingCommentRanges(text, statement.getFullStart()) ?? []
  let next = lineOf(statement.getStart(file))
  let nearest = true
  for (let index = ranges.length - 1; index >= 0; index -= 1) {
    const range = ranges[index]
    const gap = next - lineOf(range.end)
    if (gap > 1 || (nearest && gap < 1)) return false
    if (isMeaningful(commentContent(text, range))) return true
    next = lineOf(range.pos)
    nearest = false
  }
  return false
}

/**
 * The 1-based lines of the test calls in a source text that have no comment above them.
 *
 * @param {string} path The file path, for its extension.
 * @param {string} text The source text.
 * @returns {number[]} The lines, in order.
 */
function offenderLines(path, text) {
  const kind = path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind)
  const lines = []
  const visit = (node) => {
    if (ts.isExpressionStatement(node) && isTestCall(node.expression) && !hasComment(file, node)) {
      lines.push(file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return lines
}

/**
 * Paths of the tracked specs in scope, relative to the root.
 *
 * @param {string} root The repository root.
 * @returns {string[]} The paths.
 */
function trackedSpecs(root) {
  const listing = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
  return listing.split('\0').filter((path) => SCOPE.test(path) && SPEC_FILE.test(path))
}

/**
 * Offending lines per file, for the files that hold at least one.
 *
 * @param {string} root The repository root.
 * @returns {Map<string, number[]>} Path to the lines of its uncommented tests.
 */
function offendersByFile(root) {
  const offenders = new Map()
  for (const path of trackedSpecs(root)) {
    const lines = offenderLines(path, readFileSync(join(root, path), 'utf8'))
    if (lines.length > 0) offenders.set(path, lines)
  }
  return offenders
}

/**
 * Reads the baseline's `files` table from JSON text as a map, failing loudly on a file that is not one.
 *
 * @param {string} text The baseline file's text.
 * @param {string} path Where it came from, for the message.
 * @returns {Map<string, number>} Path to its recorded count.
 */
function parseBaseline(text, path) {
  const files = JSON.parse(text)?.files
  if (files === null || typeof files !== 'object' || Array.isArray(files)) {
    throw new Error(`${path}: expected { "files": { "<path>": <count> } }`)
  }
  const table = new Map(Object.entries(files))
  for (const [file, count] of table) {
    if (!Number.isInteger(count) || count < 1) {
      throw new Error(
        `${path}: ${file} must record an integer count of 1 or more, got ${String(count)}`,
      )
    }
  }
  return table
}

/**
 * The baseline table at a git revision, or `null` when that revision has no baseline file.
 *
 * @param {string} root The repository root.
 * @param {string} ref The git revision.
 * @param {string} path The baseline file's path.
 * @returns {Map<string, number> | null} The table, or `null`.
 */
function baselineAt(root, ref, path) {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
      cwd: root,
      stdio: 'ignore',
    })
  } catch {
    throw new Error(`${ref}: not a revision in this repository`)
  }
  const spec = `${ref}:${relative(root, path).split('\\').join('/')}`
  try {
    execFileSync('git', ['cat-file', '-e', spec], { cwd: root, stdio: 'ignore' })
  } catch {
    return null
  }
  return parseBaseline(execFileSync('git', ['show', spec], { cwd: root, encoding: 'utf8' }), spec)
}

/**
 * Problems with how the baseline differs from the base revision's: it may only lose or lower entries.
 *
 * @param {Map<string, number>} baseline The change's baseline.
 * @param {Map<string, number>} base The base revision's baseline.
 * @returns {string[]} One message per problem.
 */
function widening(baseline, base) {
  const problems = []
  for (const [file, count] of baseline) {
    const inBase = base.get(file)
    if (inBase === undefined) {
      problems.push(
        `${file} is on the baseline but the base revision does not have it. A new test gets a comment, it is not listed.`,
      )
    } else if (count > inBase) {
      problems.push(
        `${file} is recorded at ${count} offenders, above ${inBase} on the base revision.`,
      )
    }
  }
  return problems
}

/**
 * Compares the offenders found with the baseline and returns one message per problem.
 *
 * @param {Map<string, number[]>} found The offending lines per file.
 * @param {Map<string, number>} baseline The recorded counts.
 * @returns {string[]} One message per problem.
 */
function problemsOf(found, baseline) {
  const problems = []
  for (const [file, lines] of found) {
    const recorded = baseline.get(file)
    const where = lines.map((line) => `${file}:${line}`).join(', ')
    if (recorded === undefined) {
      for (const line of lines) {
        problems.push(
          `${file}:${line}: test call has no comment directly above it. Say what the scenario is and the rule it protects.`,
        )
      }
    } else if (lines.length > recorded) {
      problems.push(
        `${file} grew from ${recorded} to ${lines.length} offender(s). A baselined file may only shrink. Uncommented: ${where}.`,
      )
    } else if (lines.length < recorded) {
      problems.push(
        `${file} now has ${lines.length} offender(s). Lower its baseline entry from ${recorded} to ${lines.length}.`,
      )
    }
  }
  for (const file of baseline.keys()) {
    if (!found.has(file)) {
      problems.push(
        `${file} is on the baseline but has no offender left or is no longer tracked. Remove its entry.`,
      )
    }
  }
  return problems
}

const root = resolve(option('--root', process.cwd()))
const baselinePath = resolve(
  option('--baseline', join(root, 'scripts', 'test-comment-baseline.json')),
)

if (process.argv.includes('--write-baseline')) {
  const files = Object.fromEntries(
    [...offendersByFile(root)]
      .map(([path, lines]) => [path, lines.length])
      .sort(([a], [b]) => a.localeCompare(b)),
  )
  writeFileSync(baselinePath, `${JSON.stringify({ files }, null, 2)}\n`)
  console.log(`Wrote ${Object.keys(files).length} baseline entries to ${baselinePath}.`)
  process.exit(0)
}

const baseline = parseBaseline(readFileSync(baselinePath, 'utf8'), baselinePath)
const baseRef = option('--base', undefined)
const base = baseRef === undefined ? null : baselineAt(root, baseRef, baselinePath)

const problems = [
  ...problemsOf(offendersByFile(root), baseline),
  ...(base === null ? [] : widening(baseline, base)),
]

if (problems.length > 0) {
  for (const problem of problems) console.error(`✖ ${problem}`)
  console.error(`\n${problems.length} test-comment problem(s).`)
  process.exit(1)
}

console.log('Every test call in a tracked spec file has a comment or is on the baseline.')
