/**
 * @fileoverview Tests of the test-comment gate: which calls count as a test, what counts as the comment above
 * one, and the command's exit status against throwaway git repositories, so the gate itself is held by a test and
 * not by a habit.
 * @layer scripts
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(new URL('./check-test-comments.mjs', import.meta.url))

const roots = []

/** The default baseline path the script reads, relative to the repository root. */
const BASELINE = join('scripts', 'test-comment-baseline.json')

/**
 * Lays out a git repository holding `files` (path to text), all added to the index.
 *
 * @param {Record<string, string>} files Path to file text.
 * @param {unknown} baseline The baseline JSON value written to the default baseline path.
 * @returns {string} The repository root.
 */
function repo(files, baseline = { files: {} }) {
  const root = mkdtempSync(join(tmpdir(), 'test-comments-'))
  roots.push(root)
  spawnSync('git', ['init', '-q'], { cwd: root })
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, dirname(path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  mkdirSync(join(root, 'scripts'), { recursive: true })
  writeFileSync(join(root, BASELINE), JSON.stringify(baseline))
  spawnSync('git', ['add', '-A'], { cwd: root })
  return root
}

/**
 * Runs the script in `root`.
 *
 * @param {string} root The repository root.
 * @param {...string} args Extra command-line arguments.
 * @returns {{ status: number | null, output: string }} Exit status and combined output.
 */
function run(root, ...args) {
  const result = spawnSync(process.execPath, [SCRIPT, '--root', root, ...args], {
    encoding: 'utf8',
  })
  return { status: result.status, output: `${result.stdout}${result.stderr}` }
}

/**
 * The lines the gate reports as a test without a comment, for one spec text.
 *
 * @param {string[]} lines The spec's lines.
 * @param {string} path Where the spec lives in the repository.
 * @returns {number[]} The reported line numbers, in order.
 */
function flagged(lines, path = 'src/a.spec.ts') {
  const { output } = run(repo({ [path]: `${lines.join('\n')}\n` }))
  return [...output.matchAll(/^✖ (\S+):(\d+): /gm)]
    .filter((match) => match[1] === path)
    .map((match) => Number(match[2]))
}

/** Commits the index as the base revision of `root`, so `--base HEAD` can read the baseline from it. */
function commitBase(root) {
  spawnSync(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'base'],
    { cwd: root },
  )
}

/** Rewrites the working-tree baseline of `root` without committing it. */
function setBaseline(root, baseline) {
  writeFileSync(join(root, BASELINE), JSON.stringify(baseline))
}

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

describe('what is a test call', () => {
  // Scenario: a bare it() and test() with no comment above. Expected: both are reported, at their own line.
  // Why: these are the two spellings of a test, and the rule applies to each.
  it('reports it() and test()', () => {
    assert.deepEqual(flagged(["it('x', () => {})", "test('y', () => {})"]), [1, 2])
  })

  // Scenario: every modifier of it and of test (only, skip, todo, concurrent, failing) with no comment.
  // Expected: every one is reported. Why: a skipped or focused test still has a scenario worth stating.
  it('reports it and test with each modifier', () => {
    const lines = []
    for (const name of ['it', 'test']) {
      for (const modifier of ['only', 'skip', 'todo', 'concurrent', 'failing']) {
        lines.push(`${name}.${modifier}('x', () => {})`)
      }
    }
    assert.deepEqual(
      flagged(lines),
      lines.map((_, index) => index + 1),
    )
  })

  // Scenario: it.each(table)(...) and test.each(table)(...) with no comment. Expected: both reported.
  // Why: a parameterized test is a test, and its table does not say what the rule is.
  it('reports a .each call that is called with a table', () => {
    assert.deepEqual(
      flagged(["it.each([1, 2])('x', (n) => {})", "test.each([[1, 2]])('y', (a, b) => {})"]),
      [1, 2],
    )
  })

  // Scenario: it.each as a tagged template spread over several lines, with no comment.
  // Expected: reported once, at the line where the statement starts. Why: the report must point at a line
  // where the comment would go.
  it('reports a .each call with a tagged template at the first line of the statement', () => {
    const lines = ['it.each`', '  a | b', '  ${1} | ${2}', "`('x', ({ a }) => {})"]
    assert.deepEqual(flagged(lines), [1])
  })

  // Scenario: it.skip.each and it.only.each with no comment. Expected: both reported.
  // Why: a modifier before .each is still a test.
  it('reports a modifier before .each', () => {
    assert.deepEqual(
      flagged(["it.skip.each([1])('x', () => {})", "it.only.each([1])('y', () => {})"]),
      [1, 2],
    )
  })

  // Scenario: it.each(table) alone, never called with a title and a body. Expected: not reported.
  // Why: nothing is registered until the second call, so there is no test to comment.
  it('does not report a .each that is not called', () => {
    assert.deepEqual(flagged(['it.each([1, 2])', 'const run = it.each([1])']), [])
  })

  // Scenario: tests inside describe, describe.each callbacks, an if and a function body, plus the top level.
  // Expected: all reported at any depth. Why: the rule is about the call, not where it sits.
  it('reports a test at any depth', () => {
    const lines = [
      "describe('g', () => {",
      "  it('a', () => {})",
      '})',
      "describe.each([1])('g', () => {",
      "  test('b', () => {})",
      '})',
      'if (flag) {',
      "  it('c', () => {})",
      '}',
      'function register() {',
      "  it('d', () => {})",
      '}',
    ]
    assert.deepEqual(flagged(lines), [2, 5, 8, 11])
  })

  // Scenario: an if without a block, where the test is the statement of the branch. Expected: reported.
  // Why: the branch statement is still a statement, and braces are a style choice.
  it('reports a test that is the body of an if without braces', () => {
    assert.deepEqual(flagged(['if (flag)', "  it('a', () => {})"]), [2])
  })

  // Scenario: obj.it(), a regex .test(), it and test as property names, as variables and as a bare identifier.
  // Expected: none reported. Why: only the global test functions are tests.
  it('does not report calls and names that only look like a test', () => {
    const lines = [
      "obj.it('x', fn)",
      "pattern.test('x')",
      'const test = 1',
      'const holder = { it: 1, test: 2 }',
      'holder.it',
      'it',
      'test.length',
      'foo(it)',
      "api.test.only('x', fn)",
    ]
    assert.deepEqual(flagged(lines), [])
  })

  // Scenario: a property that is not .each followed by two calls, and .each read off something other than it
  // or test, with no comment. Expected: none reported. Why: only it.each and test.each register tests.
  it('does not report a lookalike of the .each form', () => {
    const lines = [
      "it.name([1])('x', fn)",
      "it.name`a`('x', fn)",
      "obj.each([1])('x', fn)",
      "obj.each`a`('x', fn)",
      "other.skip.each([1])('x', fn)",
    ]
    assert.deepEqual(flagged(lines), [])
  })

  // Scenario: xit, fit, xtest and ftest with no comment. Expected: not reported.
  // Why: the jest aliases are deliberately outside the rule; this pins the boundary.
  it('does not report the jest aliases', () => {
    assert.deepEqual(
      flagged(["xit('a', fn)", "fit('b', fn)", "xtest('c', fn)", "ftest('d', fn)"]),
      [],
    )
  })

  // Scenario: describe() with no comment. Expected: not reported. Why: a group is not a test.
  it('does not report describe', () => {
    assert.deepEqual(
      flagged(["describe('g', () => {})", 'describe.each([1])(', "  'g', () => {})"]),
      [],
    )
  })

  // Scenario: a test call wrapped in await, void or parentheses. Expected: not reported.
  // Why: a wrapper is not a plain test statement; the gate states this limit.
  it('does not report a test call wrapped in await, void or parentheses', () => {
    const lines = ["async function f() { await it('a', fn) }", "void it('b', fn)", "(it('c', fn))"]
    assert.deepEqual(flagged(lines), [])
  })
})

describe('what counts as the comment above a test', () => {
  // Scenario: a // comment on the line directly above. Expected: passes. Why: this is the form the standards ask for.
  it('accepts a line comment directly above', () => {
    assert.deepEqual(flagged(['// Scenario: x. Expected: y.', "it('x', fn)"]), [])
  })

  // Scenario: a /** */ and a /* */ comment directly above, one-line and multi-line. Expected: pass.
  // Why: the block forms are as valid as the line form.
  it('accepts a block comment directly above', () => {
    const lines = [
      '/** the scenario */',
      "it('a', fn)",
      '',
      '/* the scenario */',
      "it('b', fn)",
      '',
      '/**',
      ' * The scenario, over lines.',
      ' */',
      "it('c', fn)",
    ]
    assert.deepEqual(flagged(lines), [])
  })

  // Scenario: several // lines in a row above the test. Expected: passes. Why: one comment may take many lines.
  it('accepts several contiguous line comments', () => {
    assert.deepEqual(flagged(['// Scenario: x.', '// Expected: y.', "it('x', fn)"]), [])
  })

  // Scenario: a directive above a real comment, and the real comment above a directive. Expected: both pass.
  // Why: a tool directive may sit in the same block as the comment without cancelling it.
  it('accepts a real comment next to a directive', () => {
    const lines = [
      '// eslint-disable-next-line max-lines-per-function',
      '// Scenario: x. Expected: y.',
      "it('a', fn)",
      '',
      '// Scenario: x. Expected: y.',
      '// eslint-disable-next-line max-lines-per-function',
      "it('b', fn)",
    ]
    assert.deepEqual(flagged(lines), [])
  })

  // Scenario: a comment above a test whose call is split over several lines. Expected: passes.
  // Why: the comment is measured against the first line of the statement, not the last.
  it('measures the comment against the first line of a multi-line statement', () => {
    assert.deepEqual(flagged(['// Scenario: x.', "it('x', () => {", '  run()', '})']), [])
  })

  // Scenario: a test with nothing above it, at the top of a file and after code. Expected: reported.
  // Why: this is the offence itself.
  it('reports a test with no comment', () => {
    assert.deepEqual(flagged(["it('a', fn)", 'const x = 1', "it('b', fn)"]), [1, 3])
  })

  // Scenario: a comment, a blank line, then the test. Expected: reported. Why: a detached comment does not
  // belong to the test below it.
  it('reports a test whose comment is detached by a blank line', () => {
    assert.deepEqual(flagged(['// Scenario: x. Expected: y.', '', "it('x', fn)"]), [3])
  })

  // Scenario: a real comment, a blank line, then a directive directly above the test. Expected: reported.
  // Why: only the directive is attached to the test, and a directive says nothing.
  it('reports a test where only a directive is attached', () => {
    const lines = ['// Scenario: x.', '', '// eslint-disable-next-line x', "it('x', fn)"]
    assert.deepEqual(flagged(lines), [4])
  })

  // Scenario: empty comments in every form, and a comment of punctuation only. Expected: all reported.
  // Why: a comment with no word says nothing, so the gate is not satisfied by its mere presence.
  it('reports an empty comment', () => {
    const empties = ['//', '// ', '/** */', '/* */', '/**\n *\n */', '// ----', '/** ... */']
    const lines = []
    const expected = []
    for (const text of empties) {
      lines.push(...text.split('\n'))
      lines.push("it('x', fn)", '')
      expected.push(lines.length - 1)
    }
    assert.deepEqual(flagged(lines), expected)
  })

  // Scenario: a tool directive alone above the test, in each spelling. Expected: all reported.
  // Why: a directive tells a tool what to do and tells the reader nothing about the test.
  it('reports a directive-only comment', () => {
    const directives = [
      '// eslint-disable-next-line',
      '// eslint-disable-next-line max-lines-per-function',
      '// eslint-disable-line',
      '// eslint-disable',
      '// @ts-expect-error',
      '// @ts-ignore',
      '/* istanbul ignore next */',
      '// prettier-ignore',
      '/* eslint-disable-next-line x */',
      '// @ts-expect-error: the fixture is wrong on purpose',
      '// v8 ignore next',
      '// c8 ignore next',
    ]
    const lines = directives.flatMap((text) => [text, "it('x', fn)", ''])
    const expected = directives.map((_, index) => index * 3 + 2)
    assert.deepEqual(flagged(lines), expected)
  })

  // Scenario: a comment on the test's own line, after it. Expected: reported. Why: a trailing comment is not
  // above the test.
  it('reports a trailing comment on the test line', () => {
    assert.deepEqual(flagged(["it('x', fn) // the scenario"]), [1])
  })

  // Scenario: a trailing comment on the line above the test, after another statement. Expected: reported.
  // Why: that comment belongs to the statement before it.
  it('reports a test whose only comment trails the statement above', () => {
    assert.deepEqual(flagged(['const x = 1 // the scenario', "it('x', fn)"]), [2])
  })

  // Scenario: the comment is above describe, and the tests inside have none. Expected: the tests are reported,
  // describe is not. Why: the comment of a group does not stand for its tests.
  it('reports a test whose comment is above the enclosing describe', () => {
    const lines = ['// the group', "describe('g', () => {", "  it('a', fn)", '})']
    assert.deepEqual(flagged(lines), [3])
  })

  // Scenario: the comment is the first line inside the callback. Expected: reported. Why: it is not above the test.
  it('reports a test whose comment is inside the callback', () => {
    assert.deepEqual(flagged(["it('x', () => {", '  // the scenario', '  run()', '})']), [1])
  })

  // Scenario: text that looks like a comment inside a string or a template literal on the line above.
  // Expected: reported. Why: a comment inside a string is not a comment.
  it('does not take a string or a template for a comment', () => {
    const lines = [
      "const a = '// the scenario'",
      "it('a', fn)",
      'const b = `',
      '// the scenario',
      '`',
      "it('b', fn)",
      "const c = '/* the scenario */'",
      "it('c', fn)",
    ]
    assert.deepEqual(flagged(lines), [2, 6, 8])
  })

  // Scenario: a block comment on the same line, before the test. Expected: reported. Why: the comment must end
  // on the line above the statement, and a same-line comment is not above it.
  it('reports a test whose comment is on its own line before the call', () => {
    assert.deepEqual(flagged(["/* the scenario */ it('x', fn)"]), [1])
  })

  // Scenario: a comment above the test and another one trailing it. Expected: passes. Why: the trailing
  // comment does not cancel the one above.
  it('accepts a comment above a test that also has a trailing comment', () => {
    assert.deepEqual(flagged(['// Scenario: x.', "it('x', fn) // trailing"]), [])
  })

  // Scenario: a .tsx file with JSX text holding an apostrophe, then two uncommented tests. Expected: both are
  // reported at their own lines. Why: the file must be parsed as TSX or the apostrophe opens a string.
  it('parses a .tsx file as tsx', () => {
    const lines = ["const el = <p>don't</p>", "it('a', fn)", "it('b', fn)"]
    assert.deepEqual(flagged(lines, 'src/view.spec.tsx'), [2, 3])
    // JSX text that looks like a comment is text, so the test below it is still uncommented.
    assert.deepEqual(
      flagged(['const el = <p>', '// scenario</p>', "it('a', fn)"], 'src/view.spec.tsx'),
      [3],
    )
  })

  // Scenario: a comment above a test inside a describe, indented. Expected: passes. Why: depth does not change
  // what is adjacent.
  it('accepts a comment above a nested test', () => {
    const lines = ["describe('g', () => {", '  // Scenario: x.', "  it('a', fn)", '})']
    assert.deepEqual(flagged(lines), [])
  })

  // Scenario: a comment above an it.each tagged template and above a .each called with a table.
  // Expected: both pass. Why: the comment goes above the first line of the whole statement.
  it('accepts a comment above a .each statement', () => {
    const lines = [
      '// Scenario: x.',
      'it.each`',
      '  a',
      "`('x', fn)",
      '// Scenario: y.',
      "it.each([1])('y', fn)",
    ]
    assert.deepEqual(flagged(lines), [])
  })

  // Scenario: a tsx spec and a .test.ts file with an uncommented test. Expected: both are read and reported.
  // Why: the parser must handle JSX and every listed extension.
  it('reads .tsx specs', () => {
    const lines = ["it('x', () => { render(<div />) })"]
    assert.deepEqual(flagged(lines, 'src/view.spec.tsx'), [1])
    assert.deepEqual(flagged(["it('x', fn)"], 'src/view.test.ts'), [1])
  })
})

describe('the gate', () => {
  /** A spec with one uncommented test, and one with a comment. */
  const BAD = "it('x', fn)\n"
  const GOOD = "// Scenario: x.\nit('x', fn)\n"

  // Scenario: every test in scope has a comment. Expected: exit 0 and a success line. Why: a clean tree passes.
  it('passes when every test has a comment', () => {
    const result = run(repo({ 'src/a.spec.ts': GOOD, 'test/b.test.ts': GOOD }))
    assert.equal(result.status, 0)
    assert.match(result.output, /Every test call in a tracked spec file has a comment/)
  })

  // Scenario: an uncommented test in a file that is not on the baseline, in each listed extension and directory.
  // Expected: exit 1 and a message naming file:line. Why: a new offender is the thing the gate stops.
  it('fails a new offender and names file and line', () => {
    for (const path of [
      'src/a.spec.ts',
      'src/a.spec.tsx',
      'src/a.test.ts',
      'src/a.test.tsx',
      'test/a.e2e-spec.ts',
      'src/deep/er/a.spec.ts',
    ]) {
      const result = run(repo({ [path]: `// x\nconst a = 1\n${BAD}` }))
      assert.equal(result.status, 1, path)
      assert.ok(result.output.includes(`✖ ${path}:3: `), path)
    }
  })

  // Scenario: uncommented tests in a docs/ directory, in a scripts/ file, in a non-spec name and in a .mts spec.
  // Expected: ignored, exit 0. Why: the gate covers tracked specs under src/ and test/ only.
  it('ignores files out of scope', () => {
    const files = {
      'docs/a.spec.ts': BAD,
      'scripts/a.spec.ts': BAD,
      'src/helper.ts': BAD,
      'src/a.spec.mts': BAD,
      'src/a.spec.js': BAD,
      'src/a.e2e-spec.tsx': BAD,
    }
    assert.equal(run(repo(files)).status, 0)
  })

  // Scenario: an untracked spec with an uncommented test. Expected: ignored. Why: the listing is git's.
  it('ignores a file that is not tracked', () => {
    const root = repo({ 'src/a.spec.ts': GOOD })
    writeFileSync(join(root, 'src', 'b.spec.ts'), BAD)
    assert.equal(run(root).status, 0)
  })

  // Scenario: a baselined file at its recorded count. Expected: exit 0. Why: the baseline admits existing debt.
  it('passes a baselined file at its recorded count', () => {
    assert.equal(run(repo({ 'src/a.spec.ts': BAD }, { files: { 'src/a.spec.ts': 1 } })).status, 0)
  })

  // Scenario: a baselined file that gained an offender. Expected: exit 1, "grew". Why: the baseline cannot widen.
  it('fails a baselined file that gained an offender', () => {
    const result = run(repo({ 'src/a.spec.ts': BAD + BAD }, { files: { 'src/a.spec.ts': 1 } }))
    assert.equal(result.status, 1)
    assert.match(result.output, /src\/a\.spec\.ts grew from 1 to 2 offender\(s\)/)
  })

  // Scenario: a baselined file that lost an offender. Expected: exit 1 until the entry is lowered.
  // Why: otherwise the freed room could be spent on a new offender later.
  it('fails until the entry of a file that lost an offender is lowered', () => {
    const result = run(repo({ 'src/a.spec.ts': BAD }, { files: { 'src/a.spec.ts': 2 } }))
    assert.equal(result.status, 1)
    assert.match(result.output, /Lower its baseline entry from 2 to 1/)
  })

  // Scenario: a baselined file that is clean now, and one that is not tracked. Expected: exit 1, remove the entry.
  // Why: an entry at zero is removed so a fixed file cannot regress quietly.
  it('fails until the entry of a file with no offender left is removed', () => {
    const clean = run(repo({ 'src/a.spec.ts': GOOD }, { files: { 'src/a.spec.ts': 1 } }))
    assert.equal(clean.status, 1)
    assert.match(clean.output, /Remove its entry/)
    const missing = run(repo({ 'src/b.spec.ts': GOOD }, { files: { 'src/gone.spec.ts': 1 } }))
    assert.equal(missing.status, 1)
    assert.match(missing.output, /src\/gone\.spec\.ts .*Remove its entry/)
  })

  // Scenario: a baseline count that is zero, negative, fractional or not a number. Expected: refused.
  // Why: a zero entry is a way to keep a slot open.
  it('refuses a baseline count that is not a positive integer', () => {
    for (const count of [0, -1, 1.5, 'x']) {
      const result = run(repo({ 'src/a.spec.ts': BAD }, { files: { 'src/a.spec.ts': count } }))
      assert.notEqual(result.status, 0, String(count))
      assert.match(result.output, /must record an integer count of 1 or more/)
    }
  })

  // Scenario: a baseline file that is not { files: { ... } }. Expected: refused. Why: a malformed baseline must
  // not read as an empty one.
  it('refuses a baseline of the wrong shape', () => {
    for (const baseline of [[], { files: [] }, { files: null }, {}]) {
      const result = run(repo({ 'src/a.spec.ts': GOOD }, baseline))
      assert.notEqual(result.status, 0)
      assert.match(result.output, /expected \{ "files"/)
    }
  })

  // Scenario: two baselined files, one over and one under its count, in one run. Expected: both are reported.
  // Why: the gate collects every problem, so one run tells the whole story.
  it('reports every problem in one run', () => {
    const files = { 'src/a.spec.ts': BAD + BAD, 'src/b.spec.ts': BAD }
    const result = run(repo(files, { files: { 'src/a.spec.ts': 1, 'src/b.spec.ts': 2 } }))
    assert.match(result.output, /src\/a\.spec\.ts grew/)
    assert.match(result.output, /src\/b\.spec\.ts now has/)
    assert.match(result.output, /2 test-comment problem\(s\)/)
  })

  // Scenario: --baseline points at another file. Expected: that file is the one read. Why: an adopter may keep
  // the baseline elsewhere.
  it('reads the baseline named by --baseline', () => {
    const root = repo({ 'src/a.spec.ts': BAD })
    writeFileSync(join(root, 'other.json'), JSON.stringify({ files: { 'src/a.spec.ts': 1 } }))
    assert.equal(run(root, '--baseline', join(root, 'other.json')).status, 0)
    assert.equal(run(root).status, 1)
  })
})

describe('against a base revision', () => {
  const BAD = "it('x', fn)\n"

  // Scenario: the change lists a file the base baseline did not have. Expected: exit 1.
  // Why: the baseline in a change is the change's own file and could otherwise admit the offender it adds.
  it('refuses a baseline entry the base did not have', () => {
    const root = repo({ 'src/a.spec.ts': BAD }, { files: {} })
    commitBase(root)
    setBaseline(root, { files: { 'src/a.spec.ts': 1 } })
    const result = run(root, '--base', 'HEAD')
    assert.equal(result.status, 1)
    assert.match(result.output, /the base revision does not have it/)
  })

  // Scenario: the change raises an entry above the base's. Expected: exit 1 naming both counts.
  // Why: a baseline may only shrink.
  it('refuses a baseline entry raised above the base', () => {
    const root = repo({ 'src/a.spec.ts': BAD + BAD }, { files: { 'src/a.spec.ts': 1 } })
    commitBase(root)
    setBaseline(root, { files: { 'src/a.spec.ts': 2 } })
    const result = run(root, '--base', 'HEAD')
    assert.equal(result.status, 1)
    assert.match(
      result.output,
      /src\/a\.spec\.ts is recorded at 2 offenders, above 1 on the base revision/,
    )
  })

  // Scenario: an entry unchanged from the base, and one lowered from it. Expected: exit 0 both times.
  // Why: only widening is refused; keeping or lowering is the normal path.
  it('passes an entry unchanged or lowered from the base revision', () => {
    const root = repo({ 'src/a.spec.ts': BAD }, { files: { 'src/a.spec.ts': 1 } })
    commitBase(root)
    assert.equal(run(root, '--base', 'HEAD').status, 0)
    const lowered = repo({ 'src/a.spec.ts': BAD }, { files: { 'src/a.spec.ts': 2 } })
    commitBase(lowered)
    setBaseline(lowered, { files: { 'src/a.spec.ts': 1 } })
    assert.equal(run(lowered, '--base', 'HEAD').status, 0)
  })

  // Scenario: a revision that does not exist. Expected: non-zero exit and a message. Why: a typo must not read
  // as "no base".
  it('fails on an unknown revision', () => {
    const result = run(
      repo({ 'src/a.spec.ts': BAD }, { files: { 'src/a.spec.ts': 1 } }),
      '--base',
      'no-such-ref',
    )
    assert.notEqual(result.status, 0)
    assert.match(result.output, /not a revision in this repository/)
  })

  // Scenario: `--base` or `--baseline` is the last argument, so it has no value,
  // in a repository whose baseline widened. Expected: exit 2 naming the option, not exit 0. Why: a truncated or
  // mistyped invocation must not read as "no base revision" and switch the widening guard off.
  it('refuses an option that has no value', () => {
    const root = repo({ 'src/a.spec.ts': BAD + BAD }, { files: { 'src/a.spec.ts': 1 } })
    commitBase(root)
    setBaseline(root, { files: { 'src/a.spec.ts': 2 } })
    for (const args of [['--base'], ['--baseline']]) {
      const result = run(root, ...args)
      assert.equal(result.status, 2, args.join(' '))
      assert.match(result.output, new RegExp(`${args[0]} needs a value`))
    }
  })

  // Scenario: a base revision that has no baseline file. Expected: nothing is imposed, exit 0.
  // Why: that is the change that introduces the baseline.
  it('imposes nothing when the base has no baseline file', () => {
    const root = repo({ 'src/a.spec.ts': BAD }, { files: { 'src/a.spec.ts': 1 } })
    spawnSync('git', ['rm', '-q', '--cached', BASELINE], { cwd: root })
    commitBase(root)
    assert.equal(run(root, '--base', 'HEAD').status, 0)
  })
})

describe('--write-baseline', () => {
  // Scenario: a repository with offenders in two files, run with --write-baseline. Expected: exit 0, the file
  // holds the per-file counts in path order and no zero entries, and the next check passes.
  // Why: this is how an adopter freezes the debt it has today.
  it('writes the counts of the offenders it finds', () => {
    const files = {
      'test/b.spec.ts': "it('x', fn)\nit('y', fn)\n",
      'src/a.spec.ts': "it('x', fn)\n",
      'src/B.spec.ts': "it('x', fn)\n",
      'src/clean.spec.ts': "// Scenario: x.\nit('x', fn)\n",
    }
    const root = repo(files, { files: {} })
    const written = run(root, '--write-baseline')
    assert.equal(written.status, 0)
    assert.match(written.output, /Wrote 3 baseline entries/)
    const text = readFileSync(join(root, BASELINE), 'utf8')
    assert.deepEqual(JSON.parse(text), {
      files: { 'src/a.spec.ts': 1, 'src/B.spec.ts': 1, 'test/b.spec.ts': 2 },
    })
    assert.deepEqual(Object.keys(JSON.parse(text).files), [
      'src/a.spec.ts',
      'src/B.spec.ts',
      'test/b.spec.ts',
    ])
    assert.equal(run(root).status, 0)
  })
})
