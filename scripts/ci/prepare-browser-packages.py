"""Ephemeral CI runner only: avoid the slow Azure package mirror, keep APT trust intact."""
import json
import os
import re
from pathlib import Path


def official_archive(text):
    return re.sub(
        r"https?://azure\.archive\.ubuntu\.com/ubuntu(?=/|\s|$)",
        "https://archive.ubuntu.com/ubuntu",
        text,
    )


def configure(apt_root):
    paths = [apt_root / "sources.list", *apt_root.glob("apt-mirrors*.txt")]
    source_dir = apt_root / "sources.list.d"
    paths += list(source_dir.glob("*.list")) + list(source_dir.glob("*.sources"))
    changed = 0
    for path in paths:
        if not path.is_file():
            continue
        previous = path.read_text()
        updated = official_archive(previous)
        if updated != previous:
            path.write_text(updated)
            changed += 1
    config = apt_root / "apt.conf.d" / "80-yorisoi-download-bounds"
    config.parent.mkdir(parents=True, exist_ok=True)
    config.write_text('Acquire::http::Timeout "30";\nAcquire::https::Timeout "30";\nAcquire::Retries "2";\n')
    return {"changedSourceFiles": changed, "signatureVerification": "unchanged"}


if __name__ == "__main__":
    if os.environ.get("GITHUB_ACTIONS") != "true" or os.environ.get("RUNNER_OS") != "Linux":
        raise SystemExit("Only the ephemeral Linux GitHub Actions runner is supported.")
    print(json.dumps(configure(Path("/etc/apt"))))
