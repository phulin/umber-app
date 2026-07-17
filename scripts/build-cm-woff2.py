#!/usr/bin/env fontforge
"""Build packaged TeX metrics and Unicode CM browser faces.

Run with: SOURCE_DATE_EPOCH=0 fontforge -script scripts/build-cm-woff2.py
The source fonts are resolved through kpsewhich and verified before conversion.
Classic text fonts map to CMU Unicode faces; classic math fonts retain the
AMS Type 1 conversion because CMU's text faces are not TeX math encodings.
"""

import hashlib
import json
import os
import pathlib
import subprocess

import fontforge


ROOT = pathlib.Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "src" / "assets" / "fonts"
TFM_OUTPUT = ROOT / "src" / "assets" / "tfm"
PRIVATE_USE_BASE = 0xE000

CMU_TEXT_SOURCES = {
    "cmbx10": (
        "cmunbx.otf",
        "e956d496776533b0ca1b6e1acaeac896b81b81b908667cbf49840048ed16bd0c",
    ),
    "cmcsc10": (
        "cmunrm.otf",
        "5089693f81ed5b83435be7167bf2f93c2608ce92fb3a7e13f6be238a733c38f2",
    ),
    "cmr10": (
        "cmunrm.otf",
        "5089693f81ed5b83435be7167bf2f93c2608ce92fb3a7e13f6be238a733c38f2",
    ),
    "cmr7": (
        "cmunrm.otf",
        "5089693f81ed5b83435be7167bf2f93c2608ce92fb3a7e13f6be238a733c38f2",
    ),
    "cmr5": (
        "cmunrm.otf",
        "5089693f81ed5b83435be7167bf2f93c2608ce92fb3a7e13f6be238a733c38f2",
    ),
    "cmss10": (
        "cmunss.otf",
        "a0e41b8611156eed280c3a730ddcf03c35090fb03efc9413bbe2b1e2915de95b",
    ),
    "cmsl10": (
        "cmunsl.otf",
        "976d4906bc40308ade25b44d6ee784cba03bf830a2a16b1e274a985fa88bd23f",
    ),
    "cmti10": (
        "cmunti.otf",
        "fc38ce9ea06e49bda118a8be9f053791d043a547c248ae30c9e4fad956de3267",
    ),
    "cmtt10": (
        "cmuntt.otf",
        "f4302554e94621459f33526dca714e7f9d537128b37556741568ae7115b252b5",
    ),
}

LEGACY_MATH_SOURCES = {
    "cmmi10": "e3661061e8aa474d6de5ffa916edceb0e3d8b998862018c147f0357fce00bcd7",
    "cmmi7": "5b293a581ddb937b02559c3ce1a60184cc434295533204a2cd3864a6ad8a1f53",
    "cmmi5": "35048e58e53f4aa53025069c1d0de33a16d8d4c111bfa329669e6456ec0a967b",
    "cmsy10": "62ee8cef552017551cd3e026a483e700730103eceaad959c87b7730017f59cff",
    "cmsy7": "583b65bd1857bffc2ab184fcb4aad4e70e12eb05c9ca9f1c58c9a00a86c8bccf",
    "cmsy5": "46da57e5a06866efa9a20f3dd350811b5d3279a5ae789af63e530f1f570e3c7f",
    "cmex10": "791b31aa1db8608d0144b3a40fc0fe53383a60f6b00d0e8fd9f06ac4a11df8cb",
}

LEGACY_ENCODING_SOURCES = {
    "cmbx10": "ca41102968b817bf6e8b22fd6de205ca23bf5088218511cce0c8129e1577cb70",
    "cmcsc10": "06c64598f2ff53539677835e26630083d32abd5258d7e4fa029d742ba213d2f5",
    "cmr10": "fdcede8794018df5f2b58f0905fb20a2b418ed8f67b73ee12445855dfbe5b1be",
    "cmr7": "b37e8671820b0753c6e233eaa3230c6ab9cff04e6c4baee312d60ae261e5aba1",
    "cmr5": "84d38aac226b5274baca7a292e2039f5284a35d8a2ae31074a475fad87da310b",
    "cmss10": "c9071fd676395df32520c3d906f2829898ea735f66c40a40578dec3c0ac51738",
    "cmsl10": "2f7889c542b515c31c533f278b20aeee3cc963d1dff8bf6f83d5710c91890823",
    "cmti10": "b6f162e1549a649c7e9b2edfb77306f60e1b0da74547f33cba39ff6ba0bdd473",
    "cmtt10": "d6bdecc0378f3cd16683d1ac348bdbc4ccde9a552e87b53fe9e2de5cfc7aa61d",
}

TFM_SOURCES = {
    "cmbx10": "ae296e8e41b2b0f73e9a17fdc42c743b9ddcc58d23c30acaa3411206f7824780",
    "cmcsc10": "0d691f70f365e55b83096764fe0c65338842d704bd5b979ed0c6882f9e17ce0d",
    "cmr10": "87f2d8981927644cbecaf3d639e96e348ea4e7be49d8804468bd8ba9ff3f5244",
    "cmss10": "431472f34665b6243a32936215f2e17d1f124cdf8513e86e2bedc4c3de3f980b",
    "cmsl10": "dcbfc25c5aac16dc2b820e089a00aedef20a1af6d8d3c2efa54f6f17a985d33f",
    "cmti10": "46a66e937f809c4fbe317947b583a14b408aca41ecb835eca3be46391190432a",
    "cmtt10": "11f3331c958b696fd484fe45c28285622617a2593d7a34511a1d6b279e1578a2",
}


def checked_kpsewhich(filename, expected):
    path = pathlib.Path(
        subprocess.check_output(["kpsewhich", filename], text=True).strip()
    )
    if not path.is_file():
        raise RuntimeError(f"kpsewhich did not resolve {filename}")
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != expected:
        raise RuntimeError(f"unexpected {filename} SHA-256: {digest}")
    return path


def cmu_source_path(name):
    filename, expected = CMU_TEXT_SOURCES[name]
    return checked_kpsewhich(filename, expected)


def legacy_source_path(name, sources=LEGACY_MATH_SOURCES):
    return checked_kpsewhich(f"{name}.pfb", sources[name])


def tfm_source_path(name):
    candidates = subprocess.check_output(
        ["kpsewhich", "-all", f"{name}.tfm"], text=True
    ).splitlines()
    expected = TFM_SOURCES[name]
    for candidate in candidates:
        path = pathlib.Path(candidate)
        if path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest() == expected:
            return path
    raise RuntimeError(f"kpsewhich did not resolve canonical {name}.tfm ({expected})")


def legacy_encoding(name, source):
    font = fontforge.open(str(source))
    slot_glyphs = [font[slot] if slot in font else None for slot in range(128)]
    used_scalars = set()
    slot_encoding = [None] * 256
    for slot, glyph in enumerate(slot_glyphs):
        if glyph is not None:
            if slot == 32:
                scalar = 0x2423 if name == "cmtt10" else 0x20
            else:
                scalar = fontforge.unicodeFromName(glyph.glyphname)
            if scalar < 0 or scalar in used_scalars:
                scalar = PRIVATE_USE_BASE + slot
            used_scalars.add(scalar)
            slot_encoding[slot] = chr(scalar)
    font.close()
    return slot_encoding


def apply_small_caps(font, encoding):
    for scalar in {ord(value) for value in encoding if value is not None}:
        if scalar not in font:
            continue
        source = font[scalar]
        substitution = next(
            (
                entry[2]
                for entry in source.getPosSub("*")
                if len(entry) >= 3
                and entry[1] == "Substitution"
                and "'smcp'" in entry[0]
            ),
            None,
        )
        if substitution is None or substitution not in font:
            continue
        source.unicode = -1
        target = font[substitution]
        if target.unicode < 0:
            target.unicode = scalar
        elif target.unicode != scalar:
            alternates = list(target.altuni or ())
            if not any(entry[0] == scalar for entry in alternates):
                alternates.append((scalar, -1, 0))
                target.altuni = tuple(alternates)


def configure_identity(font, name, source_kind):
    font.fontname = f"UmberCMWeb-{name}"
    font.familyname = "Umber CM Web"
    font.fullname = f"Umber CM Web {name}"
    font.version = "1.0"
    if source_kind == "legacy-math":
        # The Type 1 sources have no OS/2 regular-style bit. Set explicit
        # webfont metadata so browser sanitizers do not infer or repair it.
        font.os2_weight = 400
        font.os2_stylemap = 0x40
        font.copyright = (
            "Copyright (c) 1997, 2009, American Mathematical Society. "
            "Converted for Umber under the SIL Open Font License 1.1."
        )


def validate_output(name, output, encoding):
    font = fontforge.open(str(output))
    if 0x20 not in font or font[0x20].width <= 0:
        raise RuntimeError(f"{name} WOFF2 must encode a positive-width U+0020")
    missing = sorted(
        {ord(value) for value in encoding if value is not None and ord(value) not in font}
    )
    font.close()
    if missing:
        formatted = ", ".join(f"U+{scalar:04X}" for scalar in missing)
        raise RuntimeError(f"{name} WOFF2 is missing encoded TeX glyphs: {formatted}")


def build_cmu_text(name):
    encoding_source = legacy_source_path(name, LEGACY_ENCODING_SOURCES)
    encoding = legacy_encoding(name, encoding_source)
    font = fontforge.open(str(cmu_source_path(name)))
    if name == "cmcsc10":
        apply_small_caps(font, encoding)
    configure_identity(font, name, "cmu-text")
    output = OUTPUT / f"umber-{name}.woff2"
    font.generate(str(output))
    font.close()
    validate_output(name, output, encoding)
    print(f"{output.relative_to(ROOT)} {hashlib.sha256(output.read_bytes()).hexdigest()}")
    return encoding


def build_legacy_math(name):
    font = fontforge.open(str(legacy_source_path(name)))
    slot_glyphs = [font[slot] if slot in font else None for slot in range(128)]
    font.encoding = "UnicodeFull"
    configure_identity(font, name, "legacy-math")
    glyphs = list(font.glyphs())
    for glyph in glyphs:
        glyph.unicode = -1
    used_scalars = {0x20}
    slot_encoding = [None] * 256
    for slot, glyph in enumerate(slot_glyphs):
        if glyph is not None:
            scalar = fontforge.unicodeFromName(glyph.glyphname)
            if scalar < 0 or scalar in used_scalars:
                scalar = PRIVATE_USE_BASE + slot
            glyph.unicode = scalar
            used_scalars.add(scalar)
            slot_encoding[slot] = chr(scalar)

    # Semantic spaces are emitted independently from TeX character codes.
    # Every web font therefore needs a real ASCII-space cmap entry.
    if "space" in font:
        font["space"].unicode = 0x20

    output = OUTPUT / f"umber-{name}.woff2"
    font.generate(str(output))
    font.close()
    validate_output(name, output, slot_encoding)
    print(f"{output.relative_to(ROOT)} {hashlib.sha256(output.read_bytes()).hexdigest()}")
    return slot_encoding


def main():
    if os.environ.get("SOURCE_DATE_EPOCH") != "0":
        raise RuntimeError("set SOURCE_DATE_EPOCH=0 for reproducible font metadata")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    TFM_OUTPUT.mkdir(parents=True, exist_ok=True)
    encodings = {
        **{name: build_cmu_text(name) for name in CMU_TEXT_SOURCES},
        **{name: build_legacy_math(name) for name in LEGACY_MATH_SOURCES},
    }
    for name in TFM_SOURCES:
        output = TFM_OUTPUT / f"{name}.tfm"
        output.write_bytes(tfm_source_path(name).read_bytes())
        print(f"{output.relative_to(ROOT)} {hashlib.sha256(output.read_bytes()).hexdigest()}")
    encoding_path = OUTPUT / "encodings.json"
    encoding_path.write_text(
        json.dumps(encodings, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


main()
