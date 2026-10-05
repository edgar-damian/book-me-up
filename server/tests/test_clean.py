"""
_clean and _clean_email: what free text looks like once it is stored.

This is storage hygiene, not a security filter. SQL injection is handled by
parameterization -- the insert body travels as JSON that PostgREST binds as a
parameter -- and XSS by React escaping text when it renders. So the contract
is the opposite of a filter's: anything a person can type is stored exactly as
typed, and only characters that would break the insert or the display go.
"""

import pytest

from server.supabase.booking import _NAME_CAP, _NOTES_CAP, _clean, _clean_email

REAL_NAMES = [
    "O'Brien",
    "D'Angelo",
    "D'Arcy-O'Neill",
    "Ng'ang'a",
    "Hawai'i Kealoha",
    "Mary-Jane",
    "Anne-Marie",
    "Jean-Luc",
    "José García",
    "François Müller",
    "Nguyễn Văn A",
    "Seán Ó Súilleabháin",
    "Åsa Öberg",
    "田中太郎",
    "Владимир Петров",
    "محمد علي",
    "\u0639\u0644\u06cc\u200c\u0631\u0636\u0627",  # Alireza in Persian, spelled with a ZWNJ
    "van der Berg",
    "DeAndre Jr.",
    "Bill III",
    'Robert "Bobby"',
    "Robert (Bob)",
]

REAL_NOTES = [
    "I want a low burst fade; nothing on the top",
    "#2 on the sides, scissors on top",
    "3/4 guard please",
    "50% off coupon from IG",
    "Mike & Sons referral",
    "R&B playlist if possible :)",
    "call me @ 5pm",
    "budget is $40",
    "my son (age 7) is coming too",
    "can you do a design? maybe a star!",
    "don't cut too much -- growing it out",
    "5 * 2 inches off please",
    "I'm 6'2\" so raise the chair",
    "see photo I sent — same as before",
    "running ~10 min late, sorry!",
    # The keyword filter this replaced rejected each of these outright.
    "my sons' and my cuts back to back",
    '"skin fade" or "low taper", your call',
    'my "usual" = mid fade',
    'the "#2" guard on the sides',
    "let me select from your options; thanks",
    "insert into the schedule if possible; thanks!",
    "fade && beard trim",
    "keep it short and true to the photo",
    "pic: https://example.com/fade%20ref.jpg",
    "beard trim; cat allergy so no cat products",
    # ...and rewrote these.
    "thanks <3",
    "skin fade > taper",
    "see my IG @fadeking for the cut",
    # Damaged by the old NFKC fold and C* strip.
    "½ inch off the top",
    "\U0001f487\u200d\u2642\ufe0f fade please",  # man getting a haircut: a ZWJ sequence
    "\u0dc1\u0dca\u200d\u0dbb\u0dd3 (Sri)",  # Sinhala, spelled with a ZWJ
    "\U0001f3f4\U000e0067\U000e0062\U000e0073\U000e0063\U000e0074\U000e007f fan",  # Scotland
    "\U0001fae9 long week",  # Unicode 16 emoji, unassigned as far as Python 3.12 knows
    "x" * _NOTES_CAP,
]

LOOKS_LIKE_CODE = [
    "Robert'); DROP TABLE appointment;--",
    "' OR 1=1--",
    "1 UNION SELECT NULL, NULL--",
    "<script>alert(1)</script>",
    "<img src=x onerror=alert(1)>",
    "${7*7}",
    "{{7*7}}",
    "../../etc/passwd",
]

MESSY = [
    ("  Pearl  ", "Pearl"),
    ("Pearl \t  Krabs", "Pearl Krabs"),
    ("Fade on the sides\nScissors on top", "Fade on the sides Scissors on top"),
    ("Fade on the sides\r\nScissors on top", "Fade on the sides Scissors on top"),
    ("Fade\n\n\nScissors", "Fade Scissors"),
    ("Jean\u00a0Luc", "Jean Luc"),  # no-break space
    ("Fade\u2028Scissors", "Fade Scissors"),  # line separator
    ("Pearl\x00Krabs", "Pearl Krabs"),  # Postgres rejects NUL in text
    ("\x1b[31mPearl", "[31mPearl"),  # a terminal escape loses its ESC
    ("Pearl\x85Krabs", "Pearl Krabs"),  # C1 next-line control
    ("\u202eKrabs", "Krabs"),  # right-to-left override
    ("call \u2066Pearl\u2069 back", "call Pearl back"),  # bidi isolate pair
    ("Pearl\ud800Krabs", "Pearl Krabs"),  # lone surrogate, which UTF-8 can't encode
]


@pytest.mark.parametrize("name", REAL_NAMES)
def test_real_names_are_stored_as_typed(name):
    assert _clean(name, _NAME_CAP) == name


@pytest.mark.parametrize("note", REAL_NOTES)
def test_real_notes_are_stored_as_typed(note):
    assert _clean(note, _NOTES_CAP) == note


@pytest.mark.parametrize("text", LOOKS_LIKE_CODE)
def test_code_shaped_text_is_stored_as_data(text):
    """
    Not filtered, on purpose. The insert is parameterized, so this never runs
    as SQL, and React renders it as text, so it never runs as markup. A filter
    strict enough to catch it also catches the real notes above.
    """
    assert _clean(text, _NOTES_CAP) == text


@pytest.mark.parametrize("given,stored", MESSY)
def test_whitespace_collapses_and_invisible_characters_go(given, stored):
    assert _clean(given, _NOTES_CAP) == stored


@pytest.mark.parametrize("given", [given for given, _ in MESSY])
def test_cleaning_twice_changes_nothing(given):
    once = _clean(given, _NOTES_CAP)
    assert _clean(once, _NOTES_CAP) == once


def test_decomposed_accents_are_composed():
    assert _clean("Jose\u0301", _NAME_CAP) == "Jos\u00e9"


@pytest.mark.parametrize("blank", ["", "   ", "\t\n", "\u200b", "\u200b \u200d", "\x00\x07"])
def test_nothing_visible_is_blank(blank):
    """A first name made only of zero-width characters still fails the required check."""
    assert _clean(blank, _NAME_CAP) == ""


def test_cap_is_exact():
    assert _clean("x" * 1500, _NOTES_CAP) == "x" * _NOTES_CAP


def test_cap_never_leaves_a_trailing_space():
    assert _clean("a" * 99 + " bcd", 100) == "a" * 99


@pytest.mark.parametrize(
    "given,stored",
    [
        ("Pearl@Krusty.TEST", "pearl@krusty.test"),
        ("  pearl@krusty.test  ", "pearl@krusty.test"),
        ("o'brien@example.com", "o'brien@example.com"),
        ("pearl+booking@krusty.test", "pearl+booking@krusty.test"),
        # Full-width, as a CJK keyboard can produce it.
        ("ｐｅａｒｌ＠ｋｒｕｓｔｙ．ｔｅｓｔ", "pearl@krusty.test"),
    ],
)
def test_email_is_normalized(given, stored):
    assert _clean_email(given) == stored


@pytest.mark.parametrize(
    "junk", ["", "not-an-email", "pearl@krusty@test.com", "pearl@localhost", "@krusty.test"]
)
def test_junk_email_is_dropped(junk):
    assert _clean_email(junk) is None
