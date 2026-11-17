"""Warns before an `ignoreUntil` date of an adopter's osv-scanner.toml, so a dependency audit does not go red on the
day an ignored advisory comes back. Layer: CI tooling for script-family-check.yml.

    python3 -I osv_expiry.py --list <file> [--days 21] [--summary <file>] [--from-dir <dir>]
    python3 -I osv_expiry.py --file <toml> --now <iso> [--days 21]      (one file, for tests)

The repositories are those of the adopter list, once each, and this repository. Each file is read from the default
branch with the job's own token (the repositories are public) and parsed with the standard library's TOML parser, so
its forms are read as TOML defines them. It is a reminder and never a gate: the exit code is 0 whatever the files say.
A file that is missing, unreadable or not TOML is a note that names the repository and never prints the file.
"""
import datetime
import json
import re
import subprocess
import sys

DAY = 86400.0
PATH = "osv-scanner.toml"
HERE = "bymaxone/.github"
REPO = re.compile(r"^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$")
NAME = re.compile(r"^[a-z0-9][a-z0-9-]*$")
UNSAFE = re.compile(r"[\x00-\x1f\x7f-\x9f  %\[\]()<>`*_|!&\\]")


def clean(text):
    """Text from another repository's file, made safe to print in a workflow command and a summary."""
    return UNSAFE.sub("", str(text)).replace("::", ":")[:80]


def read_list(text):
    """The repositories of an adopter list: `owner/name template` lines, comments and blank lines ignored."""
    repos = []
    for raw in text.split("\n"):
        line = re.sub(r"#.*$", "", raw).strip()
        if not line:
            continue
        parts = line.split()
        if len(parts) != 2 or not REPO.match(parts[0]) or not NAME.match(parts[1]):
            raise ValueError("A line of the adopter list is not `owner/name template`.")
        if parts[0] not in repos:
            repos.append(parts[0])
    return repos


def moment(value):
    """A TOML date or date-time, or a string of one, as an aware UTC datetime; None when it is not a date."""
    if isinstance(value, datetime.datetime):
        return value.replace(tzinfo=datetime.timezone.utc) if value.tzinfo is None else value.astimezone(datetime.timezone.utc)
    if isinstance(value, datetime.date):
        return datetime.datetime(value.year, value.month, value.day, tzinfo=datetime.timezone.utc)
    if isinstance(value, str):
        text = value.strip().replace(" ", "T", 1) if re.match(r"^\d{4}-\d{2}-\d{2} \d", value.strip()) else value.strip()
        try:
            parsed = datetime.datetime.fromisoformat(text.replace("z", "Z").replace("Z", "+00:00"))
        except ValueError:
            return None
        return moment(parsed)
    return None


def ignores(document):
    """`(id, until or None)` for each `[[IgnoredVulns]]` table that names an id; None when the date is absent or no date."""
    found = []
    for table in document.get("IgnoredVulns", []):
        if not isinstance(table, dict) or not isinstance(table.get("id"), str):
            continue
        found.append((table["id"], moment(table["ignoreUntil"]) if "ignoreUntil" in table else None, "ignoreUntil" in table))
    return found


def due(document, now, days):
    """The ignores that end within `days` days of `now`, or already have, soonest first: `(id, until, left, ended)`."""
    out = []
    for ident, until, _ in ignores(document):
        if until is None:
            continue
        left = -((-(until - now).total_seconds()) // DAY)  # whole days, rounded up
        if left <= days:
            out.append((ident, until, int(left), until <= now))
    return sorted(out, key=lambda item: item[1])


def unreadable(document):
    """How many ignores carry an `ignoreUntil` that is not a date."""
    return sum(1 for _, until, dated in ignores(document) if dated and until is None)


def line(repo, item):
    ident, until, left, ended = item
    when = until.strftime("%Y-%m-%d")
    if ended:
        return f"{clean(repo)}: the ignore of {clean(ident)} ended on {when}; the audit reports it again"
    return f"{clean(repo)}: the ignore of {clean(ident)} ends on {when} ({left} day{'' if left == 1 else 's'}); re-triage it or the audit goes red"


def parse(text):
    import tomllib

    return tomllib.loads(text)


def fetch(repo):
    return subprocess.run(
        ["gh", "api", f"repos/{repo}/contents/{PATH}", "-H", "Accept: application/vnd.github.raw+json"],
        check=True, capture_output=True, text=True,
    ).stdout


def scan(repos, now, days, read):
    """One `(repo, [items], note)` per repository; `read(repo)` returns the file text or raises."""
    results = []
    for repo in repos:
        try:
            text = read(repo)
        except Exception:
            results.append((repo, [], f"{PATH}: none or unreadable"))
            continue
        try:
            document = parse(text)
        except Exception:
            results.append((repo, [], f"{PATH}: not valid TOML, not read"))
            continue
        bad = unreadable(document)
        note = f"{bad} ignore(s) with an ignoreUntil that is not a date" if bad else None
        results.append((repo, due(document, now, days), note))
    return results


def option(argv, name, default=None):
    if name not in argv:
        return default
    index = argv.index(name)
    if index + 1 >= len(argv):
        raise SystemExit(f"{name} needs a value")
    return argv[index + 1]


def main(argv):
    if sys.version_info < (3, 11):
        print("::warning title=osv-expiry::the expiry check needs Python 3.11 or later (the TOML parser); it did not run")
        return 0
    days = int(option(argv, "--days", "21"))
    now_text = option(argv, "--now")
    now = moment(now_text) if now_text else datetime.datetime.now(datetime.timezone.utc)
    if now is None:
        raise SystemExit("--now is not a date")
    one = option(argv, "--file")
    if one:
        with open(one, encoding="utf-8") as handle:
            text = handle.read()
        results = scan(["file"], now, days, lambda _repo: text)
        print(json.dumps([[repo, [[i, u.isoformat(), left, ended] for i, u, left, ended in items], note] for repo, items, note in results]))
        return 0
    with open(option(argv, "--list"), encoding="utf-8") as handle:
        repos = read_list(handle.read())
    if HERE not in repos:
        repos.append(HERE)
    directory = option(argv, "--from-dir")
    if directory:
        def read(repo):
            with open(f"{directory}/{repo.replace('/', '__')}.toml", encoding="utf-8") as handle:
                return handle.read()
    else:
        read = fetch
    out = []
    for repo, items, note in scan(repos, now, days, read):
        for item in items:
            print(f"::warning title=osv-expiry::{line(repo, item)}")
            out.append(f"- {line(repo, item)}")
        if note:
            out.append(f"- {clean(repo)}: {note}")
    text = "\n".join(out) if out else f"No ignore ends within {days} days in {len(repos)} repositories."
    print(text)
    summary = option(argv, "--summary")
    if summary:
        with open(summary, "a", encoding="utf-8") as handle:
            handle.write(f"### OSV ignores that end soon\n\n{text}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
