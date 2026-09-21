"""
Second pass over caller supplied strings, run after _clean.

_clean strips the invisible stuff (unicode C*, whitespace, caps) and leaves
visible punctuation alone, so <script>, ' OR 1=1 -- and ${...} all survive it.
This module judges what is left: scanners hard reject payloads nobody types by
hand, and anything milder gets its punctuation swapped for whitespace.
"""

import re
import unicodedata
from typing import NamedTuple

# Swapped for whitespace once every scanner passes. Left out on purpose because
# real notes use them: = * % / & # ! ? . , : and single hyphens.
_SOFTEN = re.compile(r"""[;'"`\\<>{}$|]|-{2,}""")

# Parens become brackets. Nothing can be called without ( ) -- not pg_sleep(10),
# not alert(1), not $(). Brackets subscript an array and accessorize an object,
# neither of which invokes anything.
_PARENS = str.maketrans({"(": "[", ")": "]"})

# Adjacent SQL keyword pairs get an underscore rather than a rejection. The
# barber wonders about the underscore, the table stays up.
_DEFANG_PAIRS = re.compile(
    r"\b(?:"
    r"drop[ \t]+(?:table|database|schema)"
    r"|truncate[ \t]+table"
    r"|alter[ \t]+table"
    r"|delete[ \t]+from"
    r"|select[ \t]+from"
    r"|insert[ \t]+into"
    r")\b",
    re.IGNORECASE,
)
_PAIR_GAP = re.compile(r"[ \t]+")

# '@' reads as "at" everywhere except inside an address, which needs it intact.
# Split on whitespace and inspect tokens rather than regexing for an address:
# [^\s@]+@[^\s@]+ backtracks catastrophically on a long run with no '@'.
_WS_SPLIT = re.compile(r"(\s+)")

# Scanners read this view, so UnIoN/**/SeLeCt and union    select both hit.
_COMMENT_BLOCK = re.compile(r"/\*.*?\*/", re.DOTALL)

# Checked against the raw string, because _normalize deletes what it looks for.
# Postgres nests block comments, so /*/**/*/ hides a keyword split across it.
_COMMENT_MARKER = re.compile(r"/\*|\*/")

# SQL keywords double as English words, so the statement shapes only count when
# the string also carries punctuation that prose does not use. A quote between
# two letters is a contraction ("I'll select from the menu"), not a delimiter,
# and ')' is out entirely -- "my son (age 7)" in the same note as "select from"
# is a sentence, and no payload needs ')' as its only marker.
_SQL_MARKER = re.compile(r"""(?<![a-z])['"]|['"](?![a-z])|[;*`]|--|/\*|\bnull\b|=""")


class CleanResult(NamedTuple):
    ok: bool
    reasons: list[str] | None
    cleaned: list[str]


def _normalize(s: str) -> str:
    """
    Fold to NFKC, lowercase, drop inline comment blocks, collapse whitespace.
    NFKC is what turns fullwidth ＳＥＬＥＣＴ back into select. It only changes
    what the scanners read, never what gets stored.
    """
    s = unicodedata.normalize("NFKC", str(s)).lower()
    return " ".join(_COMMENT_BLOCK.sub(" ", s).split())


def _scan_comment(s: str) -> str | None:
    """
    Raw-string scanner. A SQL block comment never appears in a barber note, and
    _normalize strips the balanced ones before the other scanners see them.
    """
    if _COMMENT_MARKER.search(str(s)):
        return "comment: sql block comment"
    return None


def _scan_sql_keywords(s: str) -> str | None:
    """
    Names no one types by accident. Always rejected, no context needed.
    """
    patterns = {
        "union select": r"\bunion\b\s+(all\s+)?\bselect\b",
        "information_schema": r"\binformation_schema\b",
        "pg_catalog": r"\bpg_catalog\b",
        "pg_sleep": r"\bpg_sleep\s*\(",
        "pg_read_file": r"\bpg_read_file\s*\(",
        "xp_cmdshell": r"\bxp_cmdshell\b",
        "waitfor delay": r"\bwaitfor\b\s+\bdelay\b",
        "into outfile": r"\binto\b\s+(outfile|dumpfile)\b",
        "load_file": r"\bload_file\s*\(",
        "benchmark": r"\bbenchmark\s*\(",
        "from program": r"\bfrom\s+program\b",
        "copy to/from": r"\bcopy\b\s+.{0,40}?\b(to|from)\b\s+program\b",
    }
    for name, pattern in patterns.items():
        if re.search(pattern, s):
            return f"sql-keywords: {name}"
    return None


def _scan_sql_statement(s: str) -> str | None:
    """
    Statement shapes that are also plain English -- "select from the options",
    "insert into the schedule". Only a hit when the string also carries SQL
    punctuation, which prose does not.
    """
    if not _SQL_MARKER.search(s):
        return None
    patterns = {
        "drop table": r"\bdrop\b\s+\b(table|database|schema)\b",
        "delete from": r"\bdelete\b\s+\bfrom\b",
        "insert into": r"\binsert\b\s+\binto\b",
        "truncate table": r"\btruncate\b\s+\btable\b",
        "alter table": r"\balter\b\s+\btable\b",
        "update set": r"\bupdate\b\s+.{0,40}?\bset\b",
        "select from": r"\bselect\b\s*.{0,40}?\bfrom\b",
    }
    for name, pattern in patterns.items():
        if re.search(pattern, s):
            return f"sql-statement: {name}"
    return None


def _scan_sql_tautology(s: str) -> str | None:
    """The always-true tails that turn a WHERE clause into a no-op."""
    patterns = {
        # [\s+] because URL encoding sends a space as '+': '+OR+1=1--
        "or numeric equality": r"\b(or|and)\b[\s+]+\d+\s*=\s*\d+",
        "or boolean": r"\b(or|and)\b[\s+]+(true|false)\b",
        # Catches ') OR ('1'='1 without making ')' a marker for everything else.
        "quoted equality": r"['\"][^'\"]{0,24}['\"]\s*=\s*['\"]?",
        "quote comment tail": r"['\"]\s*(--|#|/\*)",
        "quote or": r"['\"][\s+)]*\b(or|and)\b[\s+]",
    }
    for name, pattern in patterns.items():
        if re.search(pattern, s):
            return f"sql-tautology: {name}"
    return None


def _scan_script(s: str) -> str | None:
    """Markup and JS that would fire wherever this text gets rendered."""
    patterns = {
        "script tag": r"<\s*/?\s*script\b",
        "embedding tag": r"<\s*(iframe|object|embed|svg|math|link|meta|base)\b",
        "js uri": r"\b(javascript|vbscript)\s*:",
        "html data uri": r"\bdata\s*:\s*text/html",
        "event handler": r"\bon[a-z]{3,15}\s*=",
        "srcdoc": r"\bsrcdoc\s*=",
        "entity encoded tag": r"&(lt|#0*60|#x0*3c);\s*/?\s*[a-z]",
        "entity inside word": r"[a-z]&#x?[0-9a-f]{2,6};[a-z]",
    }
    for name, pattern in patterns.items():
        if re.search(pattern, s):
            return f"script: {name}"
    return None


def _scan_template(s: str) -> str | None:
    """Server side template and expression language injection."""
    patterns = {
        "dollar brace": r"\$\{",
        "double brace": r"\{\{",
        "asp tag": r"<%",
        "hash brace": r"#\{",
        "jinja statement": r"\{%",
    }
    for name, pattern in patterns.items():
        if re.search(pattern, s):
            return f"template: {name}"
    return None


def _scan_command(s: str) -> str | None:
    """Shell metacharacters paired with something worth running."""
    patterns = {
        "command substitution": r"\$\(",
        "backtick pair": r"`[^`]*`",
        "chained operator": r"(&&|\|\|)",
        "piped shell": r"\|\s*(sh|bash|zsh|nc|curl|wget)\b",
        "separator plus command": r"[;\n]\s*(rm|curl|wget|nc|sh|bash|chmod|cat)\s",
        "system path": r"/(etc/passwd|bin/(ba)?sh|etc/shadow)\b",
    }
    for name, pattern in patterns.items():
        if re.search(pattern, s):
            return f"command: {name}"
    return None


def _scan_path(s: str) -> str | None:
    """Directory traversal, raw or percent encoded."""
    patterns = {
        "dot segment": r"\.\.[\\/]",
        "encoded dot segment": r"%2e%2e",
    }
    for name, pattern in patterns.items():
        if re.search(pattern, s):
            return f"path: {name}"
    return None


def _scan_encoding(s: str) -> str | None:
    """
    Obfuscation used to smuggle the payloads above past a naive filter.
    Bare % is fine so "50% off" survives, only %XX pairs count.
    """
    patterns = {
        "percent hex": r"%[0-9a-f]{2}",
        "hex escape": r"\\x[0-9a-f]{2}",
        "unicode escape": r"\\u[0-9a-f]{4}",
        "char builder": r"\b(char|chr|concat|unhex|fromcharcode)\s*\(",
        "base64 decode": r"\batob\s*\(",
        "hex literal": r"\b0x[0-9a-f]{8,}",
    }
    for name, pattern in patterns.items():
        if re.search(pattern, s):
            return f"encoding: {name}"
    return None


def _scan_nosql(s: str) -> str | None:
    """Mongo style operators. Cheap to check, harmless to keep."""
    if re.search(r"\$(where|ne|gt|lt|regex|expr|function)\b", s):
        return "nosql: query operator"
    return None


# Run against the raw string, before _normalize rewrites it.
_RAW_SCANNERS = (_scan_comment,)

# Run against the normalized view.
_SCANNERS = (
    _scan_sql_keywords,
    _scan_sql_statement,
    _scan_sql_tautology,
    _scan_script,
    _scan_template,
    _scan_command,
    _scan_path,
    _scan_encoding,
    _scan_nosql,
)


def _defang_pairs(s: str) -> str:
    """drop table -> drop_table. Still readable, no longer a keyword pair."""
    return _DEFANG_PAIRS.sub(lambda m: _PAIR_GAP.sub("_", m.group(0)), s)


def _looks_like_email(token: str) -> bool:
    if token.count("@") != 1:
        return False
    local, _, domain = token.partition("@")
    return bool(local) and "." in domain and bool(domain.rpartition(".")[2])


def _at_to_word(s: str) -> str:
    """'@' becomes 'at', except inside an email address."""
    if "@" not in s:
        return s
    return "".join(
        tok if _looks_like_email(tok) else tok.replace("@", " at ") for tok in _WS_SPLIT.split(s)
    )


def _soften(s: str) -> str:
    """Defang what can be defanged, blank the rest, then tidy the gaps."""
    s = _defang_pairs(str(s))
    s = _at_to_word(s)
    s = s.translate(_PARENS)
    return " ".join(_SOFTEN.sub(" ", s).split())


def injection_cleaning(strs: list[str]) -> CleanResult:
    """
    Args:
        strs (list[str]): semi clean strings, products of _clean or _clean_email

    Returns:
        CleanResult. ok is True when every string passed, with cleaned holding
        the softened versions in the order they came in. When any string fails,
        ok is False, reasons lists every hit as "[index] scanner: pattern" for
        the logger, and cleaned is empty. Reasons name the pattern and never
        echo the payload.
    """
    reasons: list[str] = []
    cleaned: list[str] = []

    for i, raw in enumerate(strs):
        s = str(raw)
        view = _normalize(s)
        hits = [hit for scan in _RAW_SCANNERS if (hit := scan(s))]
        hits += [hit for scan in _SCANNERS if (hit := scan(view))]
        if hits:
            reasons.extend(f"[{i}] {hit}" for hit in hits)
        else:
            cleaned.append(_soften(s))

    if reasons:
        return CleanResult(False, reasons, [])
    return CleanResult(True, None, cleaned)
